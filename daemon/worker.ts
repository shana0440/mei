import { randomUUID } from "node:crypto";
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
  waitingAt,
} from "./inbox.ts";
import type { BackgroundTask, InboxEvent, Step, StepOutput } from "./inbox.ts";
import { commitMemory } from "./memory.ts";
import { backgroundSkillPath, chatSessionsDir, dreamPromptPath, home, logsDir, summarizePromptPath } from "./paths.ts";
import { fillPrompt } from "./prompts.ts";
import { contextFor, findRole, firstWords, route } from "./router.ts";
import { describeEnd, runScript, scriptFiles, watchScript } from "./script.ts";
import type { ScriptTask } from "./script.ts";
import type { run } from "./runner.ts";
import { describeSummaries, forgetSummaries, recordActivity, saveSummary, shortTermMemory } from "./sessions.ts";
import { setIdleTimer } from "./timers.ts";
import { voice } from "./voice.ts";
import type { About } from "./voice.ts";

export type Deps = {
  db: DatabaseSync;
  config: Config;
  run: typeof run;
  rearm: () => void;
  onLine: (eventId: number, line: string) => void;
  onStarted: (event: InboxEvent) => void;
  onFinished: (event: InboxEvent) => void;
};

export type Worker = { wake: () => void; cancel: (eventId: number) => void };

type Work = (event: InboxEvent, deps: Deps, signal: AbortSignal) => Promise<StepOutput>;
type CommandJob = Extract<ScheduledJob, { command: string }>;
type PromptJob = Extract<ScheduledJob, { prompt: string }>;

const backgroundHint = `## Background tasks

When a task will take more than a few minutes, or the user wants something done or said at a later time, follow ${backgroundSkillPath} to hand it to a background task, then tell the user you will report back.`;

const inBackground =
  "You are running as a background task: the user is not here to answer questions, so decide for yourself and report what you did.";

export function startWorker(deps: Deps): Worker {
  const { db } = deps;
  const running = new Map<number, AbortController>();
  const perform = async (event: InboxEvent) => {
    await performStep(deps, event, running);
    wake();
  };
  const next = (step: Step) => () => nextAt(db, step, Date.now());
  const lanes = [
    oneAtATimePer(() => schedulesWaitingForCommand(db), (name) => nextCommand(db, name), perform),
    oneAtATime(next("agent"), perform),
    oneAtATime(next("background"), perform),
    oneAtATime(next("voice"), perform),
    () => waitingAt(db, "script", Date.now()).forEach(perform),
  ];
  const wake = () => lanes.forEach((nudge) => nudge());
  return { wake, cancel: (eventId) => running.get(eventId)?.abort() };
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

async function performStep(deps: Deps, event: InboxEvent, running: Map<number, AbortController>): Promise<void> {
  const { db } = deps;
  markRunning(db, event.id, Date.now());
  if (event.step === "background" || event.step === "script") deps.onStarted(getEvent(db, event.id) ?? event);
  const controller = new AbortController();
  running.set(event.id, controller);
  try {
    const done = await work[event.step](event, deps, controller.signal);
    const next = stepAfter(event);
    if (next) return handOff(db, event.id, next, done);
    markDone(db, event.id, done, Date.now());
  } catch (error) {
    markFailed(db, event.id, (error as Error).message, Date.now());
  } finally {
    running.delete(event.id);
  }
  deps.onFinished(getEvent(db, event.id) ?? event);
}

const work: Record<Step, Work> = {
  command: async (event, deps) => {
    const job = event.payload as CommandJob;
    const output = await runScript({ ...job, env: { MEI_LAST_RUN: lastRunText(deps.db, job) }, logFile: logFileOf(event) });
    return { output, topic: job.name };
  },
  script: async (event, _deps, signal) => {
    const files = scriptFiles(event.id);
    const status = await watchScript(event.payload as ScriptTask, files, signal);
    return { output: describeEnd(status, Date.now() - (event.startedAt ?? Date.now()), files) };
  },
  agent: (event, deps, signal) => {
    const agentWork = agentWorkByType[event.type];
    if (!agentWork) throw new Error(`No handler for event type "${event.type}"`);
    return agentWork(event, deps, signal);
  },
  background: async (event, deps, signal) => {
    const { text, role: roleName, folder } = event.payload as BackgroundTask;
    const role = findRole(deps.config, roleName);
    const sessionId = randomUUID();
    const topic = firstWords(text);
    const context = contextFor(undefined, shortTermMemory(deps.db));
    const { ok, response, error } = await deps.run({
      prompt: text,
      cwd: folder,
      sessionId,
      sessionDir: chatSessionsDir,
      model: role.model,
      appendSystemPrompt: [context, inBackground].filter(Boolean).join("\n\n"),
      logFile: logFileOf(event),
      timeoutMinutes: deps.config.background.timeoutMinutes,
      signal,
    });
    if (!ok) throw new Error(response ? `${error}\n\nWhat it had so far:\n${response}` : error);
    const now = Date.now();
    recordActivity(deps.db, { id: sessionId, topic, role: role.name, folder, context, eventId: event.id }, now);
    setIdleTimer(deps.db, sessionId, now + deps.config.idle.afterMinutes * 60_000);
    deps.rearm();
    return { output: response, sessionId, topic: `${topic} · ${role.name}` };
  },
  voice: async (event, deps) => {
    const answer = event.handoff ?? (event.payload as BackgroundTask).text;
    return { output: await voice(deps, { about: aboutOf(event), answer, logFile: logFileOf(event) }) };
  },
};

function aboutOf({ type, payload, runAt }: InboxEvent): About {
  if (type === "user.message") return { message: (payload as { text: string }).text };
  if (type === "timer.fired") return { schedule: (payload as ScheduledJob).name };
  if (type === "task.script") return { script: (payload as ScriptTask).command };
  const { text, say } = payload as BackgroundTask;
  if (!say) return { task: text };
  return { reminder: true, minutesLate: Math.max(0, Math.round((Date.now() - (runAt ?? Date.now())) / 60_000)) };
}

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
      appendSystemPrompt: [context, backgroundHint].filter(Boolean).join("\n\n"),
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
