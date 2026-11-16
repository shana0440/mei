import { appendFileSync } from "node:fs";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import type { Config } from "./config.ts";
import { getEvent, markDone, markFailed, markRunning, nextPending } from "./inbox.ts";
import type { InboxEvent, Outcome } from "./inbox.ts";
import { chatSessionsDir, logsDir } from "./paths.ts";
import { route } from "./router.ts";
import type { run } from "./runner.ts";

export type Deps = {
  db: DatabaseSync;
  config: Config;
  run: typeof run;
  onLine: (eventId: number, line: string) => void;
  onFinished: (event: InboxEvent) => void;
};

type Handler = (event: InboxEvent, deps: Deps) => Promise<Outcome>;

const handlers: Record<string, Handler | undefined> = {
  "user.message": async (event, deps) => {
    const { text } = event.payload as { text: string };
    const logFile = join(logsDir, `${event.id}.jsonl`);
    const onLine = (line: string) => deps.onLine(event.id, line);

    const { sessionId, topic, isNew, reason } = await route(deps, text);
    const routeLine = JSON.stringify({ type: "mei_route", sessionId, topic, isNew, reason });
    appendFileSync(logFile, `${routeLine}\n`);
    onLine(routeLine);

    const { ok, response, error } = await deps.run({
      prompt: text,
      sessionId,
      sessionDir: chatSessionsDir,
      model: deps.config.chat.model,
      logFile,
      onLine,
    });
    if (!ok) throw new Error(error);
    return { result: response, sessionId, topic };
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
