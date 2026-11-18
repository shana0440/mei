import { EventEmitter, once } from "node:events";
import { cpSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { runCommand } from "./client.ts";
import { loadConfig } from "./config.ts";
import type { Config } from "./config.ts";
import { openDb } from "./db.ts";
import { addEvent, lastFinishedId, publishedAfter, recentEvents, recoverRunning } from "./inbox.ts";
import type { InboxEvent } from "./inbox.ts";
import { chatSessionsDir, configPath, dbPath, home, logsDir, notebooksDir, socketPath, templateDir } from "./paths.ts";
import { run } from "./runner.ts";
import { startScheduler } from "./scheduler.ts";
import { changeSchedules } from "./schedules.ts";
import { shortTermMemory } from "./sessions.ts";
import { startServer } from "./server.ts";
import { listTimers, queueDream, syncTimers } from "./timers.ts";
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
    onFinished: (event) => {
      progress.emit(`finished:${event.id}`, event);
      progress.emit("finished");
    },
  };
  recoverRunning(db, maxAttempts, Date.now());
  syncTimers(db, config, Date.now());
  const wake = startWorker(deps);
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
      publish();
      await closed;
      progress.off("finished", publish);
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
      for (const path of [join(home, "memory"), notebooksDir, join(home, "state", "sessions"), logsDir]) {
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
