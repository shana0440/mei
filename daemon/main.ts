import { EventEmitter, once } from "node:events";
import { cpSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { runCommand } from "./client.ts";
import { loadConfig } from "./config.ts";
import { openDb } from "./db.ts";
import { addEvent, lastFinishedId, publishedAfter, recentEvents, recoverRunning } from "./inbox.ts";
import type { InboxEvent } from "./inbox.ts";
import { chatSessionsDir, configPath, dbPath, home, logsDir, socketPath, templateDir } from "./paths.ts";
import { run } from "./runner.ts";
import { startScheduler } from "./scheduler.ts";
import { closedSessions } from "./sessions.ts";
import { startServer } from "./server.ts";
import { listTimers, syncSchedules } from "./timers.ts";
import { startWorker } from "./worker.ts";
import type { Deps } from "./worker.ts";

const maxAttempts = 3;
const recentlyClosed = 7 * 24 * 60 * 60_000;

await runCommand(async () => {
  cpSync(templateDir, home, { recursive: true, force: false });
  const config = loadConfig(configPath);
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
  const wake = startWorker(deps);
  recoverRunning(db, maxAttempts, Date.now());
  syncSchedules(db, config.schedules, Date.now());
  const rearm = startScheduler(deps, wake);
  wake();

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
    job: ({ name }) => {
      const timer = listTimers(db).find((candidate) => candidate.kind === "schedule" && candidate.name === name);
      if (!timer) throw new Error(`No schedule is named "${name}"`);
      const eventId = addEvent(db, { type: "timer.fired", payload: timer.payload }, Date.now());
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
    reset: () => {
      if (db.prepare("SELECT 1 FROM events WHERE status = 'running'").get()) {
        throw new Error("mei is working. Wait for it to finish, then try resetting again.");
      }
      const pending = recentEvents(db, 0);
      const lastId = Number(db.prepare("SELECT MAX(id) AS id FROM events").get()?.id ??
        db.prepare("SELECT value FROM kv WHERE key = 'eventId'").get()?.value ?? 0);
      for (const path of [join(home, "memory"), join(home, "state", "sessions"), logsDir]) {
        rmSync(path, { recursive: true, force: true });
        mkdirSync(path, { recursive: true });
      }
      mkdirSync(chatSessionsDir, { recursive: true });
      db.exec("BEGIN");
      try {
        db.exec("DELETE FROM events; DELETE FROM sessions; DELETE FROM timers; DELETE FROM kv");
        db.prepare("INSERT INTO kv (key, value) VALUES ('eventId', ?)").run(String(lastId));
        syncSchedules(db, config.schedules, Date.now());
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
      closed: closedSessions(db, Date.now() - recentlyClosed),
    }),
  });

  console.log("mei daemon started");
});
