import { mkdirSync } from "node:fs";
import { openDb } from "./db.ts";
import { addEvent, recentEvents } from "./inbox.ts";
import { dbPath, socketPath, stateDir } from "./paths.ts";
import { startServer } from "./server.ts";

mkdirSync(stateDir, { recursive: true });
const db = openDb(dbPath);

await startServer(socketPath, {
  chat: ({ text }) => ({ id: addEvent(db, { type: "user.message", payload: { text } }, Date.now()) }),
  status: () => ({ events: recentEvents(db, 10) }),
});

console.log("mei daemon started");
