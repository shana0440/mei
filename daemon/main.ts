import { EventEmitter, once } from "node:events";
import { mkdirSync } from "node:fs";
import { runCommand } from "./client.ts";
import { loadConfig } from "./config.ts";
import { openDb } from "./db.ts";
import { addEvent, recentEvents, recoverRunning } from "./inbox.ts";
import type { InboxEvent } from "./inbox.ts";
import { configPath, dbPath, socketPath, stateDir } from "./paths.ts";
import { run } from "./runner.ts";
import { startServer } from "./server.ts";
import { startWorker } from "./worker.ts";

const maxAttempts = 3;

await runCommand(async () => {
  const config = loadConfig(configPath);
  mkdirSync(stateDir, { recursive: true });
  const db = openDb(dbPath);
  const finished = new EventEmitter();
  const wake = startWorker({ db, config, run, onFinished: (event) => finished.emit(String(event.id), event) });

  await startServer(socketPath, {
    chat: async ({ text }) => {
      const id = addEvent(db, { type: "user.message", payload: { text } }, Date.now());
      wake();
      const [event]: InboxEvent[] = await once(finished, String(id));
      if (event.error !== null) throw new Error(event.error);
      return { result: event.result ?? "" };
    },
    status: () => ({ events: recentEvents(db, 10) }),
  });

  recoverRunning(db, maxAttempts, Date.now());
  wake();
  console.log("mei daemon started");
});
