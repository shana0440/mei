import { appendFileSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import type { Config } from "./config.ts";
import { getEvent, markDone, markFailed, markRunning, nextPending } from "./inbox.ts";
import type { InboxEvent, Outcome } from "./inbox.ts";
import { chatSessionsDir, logsDir, root, summarizePromptPath } from "./paths.ts";
import { fillPrompt } from "./prompts.ts";
import { route } from "./router.ts";
import type { run } from "./runner.ts";
import { recordActivity, saveSummary } from "./sessions.ts";
import { setIdleTimer } from "./timers.ts";

export type Deps = {
  db: DatabaseSync;
  config: Config;
  run: typeof run;
  rearm: () => void;
  onLine: (eventId: number, line: string) => void;
  onFinished: (event: InboxEvent) => void;
};

type Handler = (event: InboxEvent, deps: Deps) => Promise<Outcome>;

const handlers: Record<string, Handler | undefined> = {
  "user.message": async (event, deps) => {
    const { text } = event.payload as { text: string };
    const logFile = join(logsDir, `${event.id}.jsonl`);
    const onLine = (line: string) => deps.onLine(event.id, line);

    const { sessionId, topic, isNew, reason, context } = await route(deps, text);
    const routeLine = JSON.stringify({ type: "mei_route", sessionId, topic, isNew, reason });
    appendFileSync(logFile, `${routeLine}\n`);
    onLine(routeLine);

    const { ok, response, error } = await deps.run({
      prompt: text,
      sessionId,
      sessionDir: chatSessionsDir,
      model: deps.config.chat.model,
      appendSystemPrompt: context,
      logFile,
      onLine,
    });
    if (!ok) throw new Error(error);
    const now = Date.now();
    recordActivity(deps.db, { id: sessionId, topic, context, eventId: event.id }, now);
    setIdleTimer(deps.db, sessionId, now + deps.config.idle.afterMinutes * 60_000);
    deps.rearm();
    return { result: response, sessionId, topic };
  },
  "timer.fired": async (event, deps) => {
    const { name, prompt, model } = event.payload as { name: string; prompt: string; model: string };
    const { ok, response, error } = await deps.run({
      prompt: readFileSync(join(root, prompt), "utf8"),
      model,
      logFile: join(logsDir, `${event.id}.jsonl`),
    });
    if (!ok) throw new Error(error);
    return { result: response, topic: name };
  },
  "session.idle": async (event, deps) => {
    const { sessionId } = event.payload as { sessionId: string };
    const transcript = readdirSync(chatSessionsDir).find((file) => file.endsWith(`${sessionId}.jsonl`));
    if (!transcript) throw new Error(`No transcript for session ${sessionId} in ${chatSessionsDir}`);
    const { ok, response, error } = await deps.run({
      prompt: fillPrompt(readFileSync(summarizePromptPath, "utf8"), {
        transcript: join(chatSessionsDir, transcript),
        now: new Date().toLocaleString(),
      }),
      model: deps.config.idle.model,
      logFile: join(logsDir, `${event.id}.jsonl`),
    });
    if (!ok) throw new Error(error);
    saveSummary(deps.db, sessionId, response, Date.now());
    return { result: response, sessionId };
  },
};

async function handle(deps: Deps, event: InboxEvent): Promise<void> {
  const { db } = deps;
  markRunning(db, event.id, Date.now());
  try {
    const handler = handlers[event.type];
    if (!handler) throw new Error(`No handler for event type "${event.type}"`);
    markDone(db, event.id, await handler(event, deps), Date.now());
  } catch (error) {
    markFailed(db, event.id, (error as Error).message, Date.now());
  }
  deps.onFinished(getEvent(db, event.id) ?? event);
}

export function startWorker(deps: Deps): () => void {
  let working = false;
  async function work(): Promise<void> {
    if (working) return;
    working = true;
    for (let event = nextPending(deps.db); event; event = nextPending(deps.db)) await handle(deps, event);
    working = false;
  }
  return () => void work();
}
