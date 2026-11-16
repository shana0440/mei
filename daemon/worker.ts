import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import type { Config } from "./config.ts";
import { getEvent, markDone, markFailed, markRunning, nextPending } from "./inbox.ts";
import type { InboxEvent, Outcome } from "./inbox.ts";
import { chatSessionsDir, logsDir } from "./paths.ts";
import type { run } from "./runner.ts";

export type Deps = {
  db: DatabaseSync;
  config: Config;
  run: typeof run;
  onFinished: (event: InboxEvent) => void;
};

type Handler = (event: InboxEvent, deps: Deps) => Promise<Outcome>;

const handlers: Record<string, Handler | undefined> = {
  "user.message": async (event, { config, run }) => {
    const { text } = event.payload as { text: string };
    const { ok, response, error, sessionId } = await run({
      prompt: text,
      sessionId: randomUUID(),
      sessionDir: chatSessionsDir,
      model: config.chat.model,
      logFile: join(logsDir, `${event.id}.jsonl`),
    });
    if (!ok) throw new Error(error);
    return { result: response, sessionId };
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
