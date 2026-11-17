import { appendFileSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import type { Config, ScheduledJob } from "./config.ts";
import { getEvent, markDone, markFailed, markRunning, nextForAgent, pendingCommands, queueForAgent } from "./inbox.ts";
import type { InboxEvent, Outcome } from "./inbox.ts";
import { chatSessionsDir, home, logsDir, summarizePromptPath } from "./paths.ts";
import { fillPrompt } from "./prompts.ts";
import { route } from "./router.ts";
import { runScript } from "./script.ts";
import type { run } from "./runner.ts";
import { recordActivity, saveSummary } from "./sessions.ts";
import { setIdleTimer } from "./timers.ts";
import { voice } from "./voice.ts";

export type Deps = {
  db: DatabaseSync;
  config: Config;
  run: typeof run;
  rearm: () => void;
  onLine: (eventId: number, line: string) => void;
  onFinished: (event: InboxEvent) => void;
};

type Handler = (event: InboxEvent, deps: Deps) => Promise<Outcome>;
type CommandSchedule = Extract<ScheduledJob, { command: string }>;

function logFileOf(event: InboxEvent): string {
  return join(logsDir, `${event.id}.jsonl`);
}

function watermarkKey({ name }: ScheduledJob): string {
  return `watermark:${name}`;
}

function lastRun(db: DatabaseSync, schedule: ScheduledJob): string {
  const watermark = Number(db.prepare("SELECT value FROM kv WHERE key = ?").get(watermarkKey(schedule))?.value ?? 0);
  return watermark ? new Date(watermark).toISOString() : "never";
}

function finishSchedule(db: DatabaseSync, event: InboxEvent, result: string): Outcome {
  const schedule = event.payload as ScheduledJob;
  db.prepare(
    "INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
  ).run(watermarkKey(schedule), String(event.createdAt));
  return { result, topic: schedule.name };
}

async function runCommandStep(event: InboxEvent, deps: Deps): Promise<Outcome | { commandOutput: string }> {
  const schedule = event.payload as CommandSchedule;
  const output = await runScript({ ...schedule, env: { MEI_LAST_RUN: lastRun(deps.db, schedule) }, logFile: logFileOf(event) });
  if ("prompt" in schedule || schedule.notify) return { commandOutput: output };
  return finishSchedule(deps.db, event, output);
}

const agentSteps: Record<string, Handler | undefined> = {
  "user.message": async (event, deps) => {
    const { text } = event.payload as { text: string };
    const logFile = logFileOf(event);
    const onLine = (line: string) => deps.onLine(event.id, line);

    const { sessionId, topic, role, folder, isNew, reason, context } = await route(deps, text);
    const routeLine = JSON.stringify({ type: "mei_route", sessionId, topic, role: role.name, folder, isNew, reason });
    appendFileSync(logFile, `${routeLine}\n`);
    onLine(routeLine);

    const { ok, response, error } = await deps.run({
      prompt: text,
      cwd: folder,
      sessionId,
      sessionDir: chatSessionsDir,
      model: role.model,
      appendSystemPrompt: context,
      logFile,
      onLine,
    });
    if (!ok) throw new Error(error);
    const voiced = await voice(deps, { message: text, answer: response, logFile });
    const now = Date.now();
    recordActivity(deps.db, { id: sessionId, topic, role: role.name, folder, context, eventId: event.id }, now);
    setIdleTimer(deps.db, sessionId, now + deps.config.idle.afterMinutes * 60_000);
    deps.rearm();
    return { result: voiced, sessionId, topic: `${topic} · ${role.name}` };
  },
  "timer.fired": async (event, deps) => {
    const schedule = event.payload as ScheduledJob;
    const logFile = logFileOf(event);
    const output = event.commandOutput;
    const result =
      "prompt" in schedule
        ? await runPrompt(deps, {
            ...schedule,
            values: {
              now: new Date().toLocaleString(),
              last_run: lastRun(deps.db, schedule),
              sessions_dir: chatSessionsDir,
              ...(output === null ? {} : { output }),
            },
            logFile,
          })
        : (output ?? "");
    const said = schedule.notify ? await voice(deps, { schedule: schedule.name, answer: result, logFile }) : result;
    return finishSchedule(deps.db, event, said);
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
      logFile: logFileOf(event),
    });
    if (!ok) throw new Error(error);
    saveSummary(deps.db, sessionId, response, Date.now());
    return { result: response, sessionId };
  },
};

type PromptOptions = { prompt: string; model: string; values: Record<string, string>; logFile: string };

async function runPrompt(deps: Deps, { prompt, model, values, logFile }: PromptOptions): Promise<string> {
  const { ok, response, error } = await deps.run({
    prompt: fillPrompt(readFileSync(join(home, prompt), "utf8"), values),
    model,
    logFile,
  });
  if (!ok) throw new Error(error);
  return response;
}

async function handle(
  deps: Deps,
  event: InboxEvent,
  step: (event: InboxEvent, deps: Deps) => Promise<Outcome | { commandOutput: string }>,
): Promise<void> {
  const { db } = deps;
  markRunning(db, event.id, Date.now());
  try {
    const handled = await step(event, deps);
    if ("commandOutput" in handled) return queueForAgent(db, event.id, handled.commandOutput);
    markDone(db, event.id, handled, Date.now());
  } catch (error) {
    markFailed(db, event.id, (error as Error).message, Date.now());
  }
  deps.onFinished(getEvent(db, event.id) ?? event);
}

function runAgentStep(event: InboxEvent, deps: Deps): Promise<Outcome> {
  const step = agentSteps[event.type];
  if (!step) throw new Error(`No handler for event type "${event.type}"`);
  return step(event, deps);
}

function startQueue(next: () => InboxEvent | undefined, run: (event: InboxEvent) => Promise<void>): () => void {
  let nudge = () => {};
  void (async () => {
    for (;;) {
      const event = next();
      if (event) await run(event);
      else await new Promise<void>((resolve) => (nudge = resolve));
    }
  })();
  return () => nudge();
}

export function startWorker(deps: Deps): () => void {
  const nudgeAgent = startQueue(
    () => nextForAgent(deps.db),
    (event) => handle(deps, event, runAgentStep),
  );
  const runningSchedules = new Set<string>();
  function startCommands(): void {
    for (const event of pendingCommands(deps.db)) {
      const { name } = event.payload as CommandSchedule;
      if (runningSchedules.has(name)) continue;
      runningSchedules.add(name);
      void handle(deps, event, runCommandStep).finally(() => {
        runningSchedules.delete(name);
        nudgeAgent();
        startCommands();
      });
    }
  }
  return () => {
    startCommands();
    nudgeAgent();
  };
}
