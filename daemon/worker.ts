import { appendFileSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import type { Config, ScheduledJob } from "./config.ts";
import {
  getEvent,
  handOff,
  lastRun,
  markDone,
  markFailed,
  markRunning,
  nextAt,
  nextCommand,
  schedulesWaitingForCommand,
  stepAfter,
} from "./inbox.ts";
import type { InboxEvent, Step, StepOutput } from "./inbox.ts";
import { commitMemory } from "./memory.ts";
import { chatSessionsDir, dreamPromptPath, home, logsDir, summarizePromptPath } from "./paths.ts";
import { fillPrompt } from "./prompts.ts";
import { route } from "./router.ts";
import { runScript } from "./script.ts";
import type { run } from "./runner.ts";
import { describeSummaries, forgetSummaries, recordActivity, saveSummary, shortTermMemory } from "./sessions.ts";
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

type Work = (event: InboxEvent, deps: Deps) => Promise<StepOutput>;
type CommandJob = Extract<ScheduledJob, { command: string }>;
type PromptJob = Extract<ScheduledJob, { prompt: string }>;

export function startWorker(deps: Deps): () => void {
  const { db } = deps;
  const perform = (event: InboxEvent) => performStep(deps, event, wake);
  const wake: Record<Step, () => void> = {
    command: oneAtATimePer(() => schedulesWaitingForCommand(db), (name) => nextCommand(db, name), perform),
    agent: oneAtATime(() => nextAt(db, "agent"), perform),
    voice: oneAtATime(() => nextAt(db, "voice"), perform),
  };
  return () => Object.values(wake).forEach((nudge) => nudge());
}

function oneAtATime(next: () => InboxEvent | undefined, perform: (event: InboxEvent) => Promise<void>): () => void {
  let nudge = () => {};
  void (async () => {
    for (;;) {
      await new Promise<void>((resolve) => (nudge = resolve));
      for (let event = next(); event; event = next()) await perform(event);
    }
  })();
  return () => nudge();
}

function oneAtATimePer(
  keys: () => string[],
  next: (key: string) => InboxEvent | undefined,
  perform: (event: InboxEvent) => Promise<void>,
): () => void {
  const queues = new Map<string, () => void>();
  return () => {
    for (const key of keys()) {
      if (!queues.has(key)) queues.set(key, oneAtATime(() => next(key), perform));
      queues.get(key)?.();
    }
  };
}

async function performStep(deps: Deps, event: InboxEvent, wake: Record<Step, () => void>): Promise<void> {
  const { db } = deps;
  markRunning(db, event.id, Date.now());
  try {
    const done = await work[event.step](event, deps);
    const next = stepAfter(event);
    if (next) {
      handOff(db, event.id, next, done);
      return wake[next]();
    }
    markDone(db, event.id, done, Date.now());
  } catch (error) {
    markFailed(db, event.id, (error as Error).message, Date.now());
  }
  deps.onFinished(getEvent(db, event.id) ?? event);
}

const work: Record<Step, Work> = {
  command: async (event, deps) => {
    const job = event.payload as CommandJob;
    const output = await runScript({ ...job, env: { MEI_LAST_RUN: lastRunText(deps.db, job) }, logFile: logFileOf(event) });
    return { output, topic: job.name };
  },
  agent: (event, deps) => {
    const agentWork = agentWorkByType[event.type];
    if (!agentWork) throw new Error(`No handler for event type "${event.type}"`);
    return agentWork(event, deps);
  },
  voice: async (event, deps) => {
    const about =
      event.type === "user.message"
        ? { message: (event.payload as { text: string }).text }
        : { schedule: (event.payload as ScheduledJob).name };
    return { output: await voice(deps, { ...about, answer: event.handoff ?? "", logFile: logFileOf(event) }) };
  },
};

const agentWorkByType: Record<string, Work | undefined> = {
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
    const now = Date.now();
    recordActivity(deps.db, { id: sessionId, topic, role: role.name, folder, context, eventId: event.id }, now);
    setIdleTimer(deps.db, sessionId, now + deps.config.idle.afterMinutes * 60_000);
    deps.rearm();
    return { output: response, sessionId, topic: `${topic} · ${role.name}` };
  },
  "timer.fired": async (event, deps) => {
    const job = event.payload as PromptJob;
    const output = event.handoff;
    const { ok, response, error } = await deps.run({
      prompt: fillPrompt(readFileSync(join(home, job.prompt), "utf8"), {
        now: new Date().toLocaleString(),
        last_run: lastRunText(deps.db, job),
        sessions_dir: chatSessionsDir,
        ...(output === null ? {} : { output }),
      }),
      model: job.model,
      logFile: logFileOf(event),
    });
    if (!ok) throw new Error(error);
    return { output: response, topic: job.name };
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
    return { output: response, sessionId };
  },
  dream: async (event, deps) => {
    const summaries = shortTermMemory(deps.db);
    if (summaries.length === 0) return { output: "No summaries to write into memory", topic: "dream" };
    await commitMemory(`Before dream ${event.id}`);
    const { ok, response, error } = await deps.run({
      prompt: fillPrompt(readFileSync(dreamPromptPath, "utf8"), {
        summaries: describeSummaries(summaries),
        now: new Date().toLocaleString(),
      }),
      model: deps.config.dream.model,
      logFile: logFileOf(event),
    });
    if (!ok) throw new Error(error);
    await commitMemory(`Dream ${event.id}`);
    forgetSummaries(deps.db, summaries);
    return { output: response, topic: "dream" };
  },
};

function logFileOf(event: InboxEvent): string {
  return join(logsDir, `${event.id}.jsonl`);
}

function lastRunText(db: DatabaseSync, job: ScheduledJob): string {
  const at = lastRun(db, job.name);
  return at === undefined ? "never" : new Date(at).toISOString();
}
