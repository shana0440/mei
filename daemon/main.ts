import { EventEmitter, once } from "node:events";
import { mkdirSync } from "node:fs";
import { runCommand } from "./client.ts";
import { loadConfig } from "./config.ts";
import { openDb } from "./db.ts";
import { addEvent, recentEvents, recoverRunning } from "./inbox.ts";
import type { InboxEvent } from "./inbox.ts";
import { configPath, dbPath, logsDir, socketPath } from "./paths.ts";
import { run } from "./runner.ts";
import { startScheduler } from "./scheduler.ts";
import { startServer } from "./server.ts";
import { listTimers, syncSchedules } from "./timers.ts";
import { startWorker } from "./worker.ts";
import type { Deps } from "./worker.ts";

const maxAttempts = 3;

await runCommand(async () => {
  const config = loadConfig(configPath);
  mkdirSync(logsDir, { recursive: true });
  const db = openDb(dbPath);
  const progress = new EventEmitter();
  const deps: Deps = {
    db,
    config,
    run,
    onLine: (eventId, line) => progress.emit(`line:${eventId}`, line),
    onFinished: (event) => progress.emit(`finished:${event.id}`, event),
  };
  const wake = startWorker(deps);

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
      const timer = listTimers(db).find((candidate) => candidate.name === name);
      if (!timer) throw new Error(`No schedule is named "${name}"`);
      const eventId = addEvent(db, { type: "timer.fired", payload: timer.payload }, Date.now());
      wake();
      return { eventId };
    },
    status: () => ({ events: recentEvents(db, 10), timers: listTimers(db) }),
  });

  recoverRunning(db, maxAttempts, Date.now());
  syncSchedules(db, config.schedules, Date.now());
  wake();
  startScheduler(deps, wake);
  console.log("mei daemon started");
});
