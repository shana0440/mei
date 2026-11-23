import { EventEmitter, once } from "node:events";
import { randomUUID } from "node:crypto";
import { cpSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { runCommand } from "./client.ts";
import { loadConfig } from "./config.ts";
import type { Config } from "./config.ts";
import { openDb } from "./db.ts";
import {
  addEvent,
  backgroundTasks,
  getEvent,
  lastFinishedId,
  markFailed,
  publishedAfter,
  recentEvents,
  recoverRunning,
  takingOverScript,
} from "./inbox.ts";
import type { BackgroundTask, InboxEvent } from "./inbox.ts";
import { chatSessionsDir, configPath, dbPath, home, logsDir, memoryDir, notebooksDir, socketPath, templateDir } from "./paths.ts";
import { run } from "./runner.ts";
import { maxScriptAttempts } from "./script.ts";
import type { ScriptTask } from "./script.ts";
import { startScheduler } from "./scheduler.ts";
import { changeSchedules } from "./schedules.ts";
import { conversation, findSession, shortTermMemory } from "./sessions.ts";
import { startServer } from "./server.ts";
import { listTimers, queueDream, setIdleTimer, syncTimers } from "./timers.ts";
import { startWorker } from "./worker.ts";
import type { Deps } from "./worker.ts";

const maxAttempts = 3;

await runCommand(async () => {
  cpSync(templateDir, home, { recursive: true, force: false });
  let config = loadConfig(configPath);
  mkdirSync(logsDir, { recursive: true });
  const db = openDb(dbPath);
  const progress = new EventEmitter();
  const deps: Deps = {
    db,
    config,
    run,
    rearm: () => rearm(),
    onLine: (eventId, line) => progress.emit(`line:${eventId}`, line),
    onStarted: (event) => progress.emit("started", event),
    onFinished: (event) => {
      const origin = event.type === "task.background" ? (event.payload as BackgroundTask).origin
        : event.type === "task.script" ? (event.payload as ScriptTask).sessionId : undefined;
      if (origin && findSession(db, origin)) {
        setIdleTimer(db, origin, Date.now() + config.idle.afterMinutes * 60_000);
        deps.rearm();
      }
      progress.emit(`finished:${event.id}`, event);
      progress.emit("finished");
    },
  };
  recoverRunning(db, maxAttempts, Date.now());
  syncTimers(db, config, Date.now());
  const { wake, cancel } = startWorker(deps);
  const rearm = startScheduler(deps, wake);
  wake();

  function apply(next: Config): void {
    db.exec("BEGIN");
    try {
      syncTimers(db, next, Date.now());
      db.prepare("UPDATE timers SET due_at = due_at + ? WHERE kind = 'idle' AND status = 'active'").run(
        (next.idle.afterMinutes - config.idle.afterMinutes) * 60_000,
      );
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    config = next;
    deps.config = next;
    rearm();
  }

  await startServer(socketPath, {
    chat: async ({ text, debug }, send) => {
      const id = addEvent(db, { type: "user.message", payload: { text } }, Date.now());
      if (debug) progress.on(`line:${id}`, (line: string) => send(JSON.parse(line)));
      wake();
      const [event]: InboxEvent[] = await once(progress, `finished:${id}`);
      progress.removeAllListeners(`line:${id}`);
      if (event.error !== null) throw new Error(event.error);
      return { result: event.result ?? "", topic: event.topic ?? "" };
    },
    history: ({ sessionId }) => ({ messages: conversation(db, sessionId) }),
    dream: () => {
      const eventId = queueDream(db, Date.now());
      if (eventId === undefined) throw new Error("No summaries are waiting for dream");
      wake();
      return { eventId };
    },
    job: ({ name }) => {
      const schedule = config.schedules.find((candidate) => candidate.name === name);
      if (!schedule) throw new Error(`No schedule is named "${name}"`);
      const { spec, enabled, ...payload } = schedule;
      const eventId = addEvent(db, { type: "timer.fired", payload }, Date.now());
      wake();
      return { eventId };
    },
    listen: async ({ after }, send, closed) => {
      let cursor = after ?? lastFinishedId(db);
      const publish = () => {
        for (const event of publishedAfter(db, cursor)) {
          send(event);
          cursor = event.id;
        }
      };
      progress.on("finished", publish);
      progress.on("started", send);
      publish();
      await closed;
      progress.off("finished", publish);
      progress.off("started", send);
      return {};
    },
    task: ({ text, at, say, fromSession }) => {
      const now = Date.now();
      if (at !== undefined && at < now - 60_000) throw new Error(`${new Date(at).toLocaleString()} is in the past`);
      const session = fromSession === undefined ? undefined : findSession(db, fromSession);
      const payload: BackgroundTask = {
        text,
        origin: fromSession,
        say: say ?? false,
        role: session?.role || config.router.defaultRole,
        folder: session?.folder || home,
      };
      const eventId = addEvent(db, { type: "task.background", payload, runAt: at }, now);
      rearm();
      return { eventId };
    },
    watch: ({ command, folder, fromSession }) => {
      const sessionId = fromSession ?? randomUUID();
      const takingOver = takingOverScript(db, sessionId)?.payload as ScriptTask | undefined;
      const attempt = (takingOver?.attempt ?? 0) + 1;
      if (attempt > maxScriptAttempts) {
        throw new Error(`This script was started ${maxScriptAttempts} times already; report to the user instead of starting it again`);
      }
      const payload: ScriptTask = { command, folder, sessionId, attempt };
      const eventId = addEvent(db, { type: "task.script", payload }, Date.now());
      wake();
      return { eventId };
    },
    tasks: () => ({ tasks: backgroundTasks(db), timeoutMinutes: config.background.timeoutMinutes }),
    cancel: ({ eventId }) => {
      const event = getEvent(db, eventId);
      if (event?.type !== "task.background" && event?.type !== "task.script") throw new Error(`No background task is numbered ${eventId}`);
      if (event.status === "done" || event.status === "failed") throw new Error(`Background task #${eventId} has already finished`);
      if (event.status === "pending") {
        markFailed(db, eventId, "Cancelled", Date.now());
        deps.onFinished(getEvent(db, eventId) ?? event);
        return {};
      }
      if (event.step !== "background" && event.step !== "script") throw new Error(`Background task #${eventId} is already reporting back`);
      cancel(eventId);
      return {};
    },
    reload: () => {
      apply(loadConfig(configPath));
      return {};
    },
    schedules: () => {
      const timers = listTimers(db);
      return {
        schedules: config.schedules.map((schedule) => ({
          ...schedule,
          dueAt: timers.find((timer) => timer.kind === "schedule" && timer.name === schedule.name)?.dueAt ?? null,
        })),
      };
    },
    schedule: ({ change }) => {
      apply(changeSchedules(change));
      return {};
    },
    reset: () => {
      if (db.prepare("SELECT 1 FROM events WHERE status = 'running'").get()) {
        throw new Error("mei is working. Wait for it to finish, then try resetting again.");
      }
      const pending = recentEvents(db, 0);
      const lastId = Number(db.prepare("SELECT MAX(id) AS id FROM events").get()?.id ??
        db.prepare("SELECT value FROM kv WHERE key = 'eventId'").get()?.value ?? 0);
      for (const path of [memoryDir, notebooksDir, join(home, "state", "sessions"), logsDir]) {
        rmSync(path, { recursive: true, force: true });
        mkdirSync(path, { recursive: true });
      }
      mkdirSync(chatSessionsDir, { recursive: true });
      db.exec("BEGIN");
      try {
        db.exec("DELETE FROM events; DELETE FROM sessions; DELETE FROM timers; DELETE FROM kv");
        db.prepare("INSERT INTO kv (key, value) VALUES ('eventId', ?)").run(String(lastId));
        syncTimers(db, config, Date.now());
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
      for (const event of pending) {
        progress.emit(`finished:${event.id}`, { ...event, error: "Cleared by memory reset" });
      }
      rearm();
      return {};
    },
    status: () => ({
      events: recentEvents(db, 10),
      timers: listTimers(db),
      shortTerm: shortTermMemory(db),
    }),
  });

  console.log("mei daemon started");
});
