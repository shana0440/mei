import type { DatabaseSync } from "node:sqlite";

export type Step = "command" | "agent";

export type InboxEvent = {
  id: number;
  type: string;
  payload: unknown;
  status: "pending" | "running" | "done" | "failed";
  step: Step;
  commandOutput: string | null;
  attempts: number;
  sessionId: string | null;
  topic: string | null;
  result: string | null;
  error: string | null;
  createdAt: number;
  startedAt: number | null;
  finishedAt: number | null;
};

export type NewEvent = { type: string; payload: unknown; step: Step };
export type Outcome = { result: string; sessionId?: string; topic?: string };

const selectEvents = `
  SELECT id, type, payload, status, step, command_output AS commandOutput, attempts,
    session_id AS sessionId, topic, result, error,
    created_at AS createdAt, started_at AS startedAt, finished_at AS finishedAt
  FROM events`;

function findEvents(db: DatabaseSync, where: string, ...params: (string | number)[]): InboxEvent[] {
  return db
    .prepare(`${selectEvents} ${where}`)
    .all(...params)
    .map((row) => ({ ...row, payload: JSON.parse(row.payload as string) }) as InboxEvent);
}

export function addEvent(db: DatabaseSync, { type, payload, step }: NewEvent, now: number): number {
  const { lastInsertRowid } = db
    .prepare(`INSERT INTO events (id, type, payload, status, step, created_at)
      SELECT COALESCE(MAX(id), (SELECT CAST(value AS INTEGER) FROM kv WHERE key = 'eventId'), 0) + 1,
        ?, ?, 'pending', ?, ? FROM events`)
    .run(type, JSON.stringify(payload), step, now);
  return Number(lastInsertRowid);
}

export function pendingCommands(db: DatabaseSync): InboxEvent[] {
  return findEvents(db, "WHERE status = 'pending' AND step = 'command' ORDER BY id");
}

export function nextForAgent(db: DatabaseSync): InboxEvent | undefined {
  return findEvents(
    db,
    "WHERE status = 'pending' AND step = 'agent' ORDER BY type = 'user.message' DESC, id LIMIT 1",
  )[0];
}

export function markRunning(db: DatabaseSync, id: number, now: number): void {
  db.prepare(
    "UPDATE events SET status = 'running', attempts = attempts + 1, started_at = ? WHERE id = ?",
  ).run(now, id);
}

export function markDone(db: DatabaseSync, id: number, { result, sessionId, topic }: Outcome, now: number): void {
  db.prepare(
    "UPDATE events SET status = 'done', result = ?, session_id = ?, topic = ?, finished_at = ? WHERE id = ?",
  ).run(result, sessionId ?? null, topic ?? null, now, id);
}

export function queueForAgent(db: DatabaseSync, id: number, commandOutput: string): void {
  db.prepare(
    "UPDATE events SET status = 'pending', step = 'agent', command_output = ?, attempts = 0 WHERE id = ?",
  ).run(commandOutput, id);
}

export function markFailed(db: DatabaseSync, id: number, error: string, now: number): void {
  db.prepare("UPDATE events SET status = 'failed', error = ?, finished_at = ? WHERE id = ?").run(error, now, id);
}

export function recoverRunning(db: DatabaseSync, maxAttempts: number, now: number): void {
  db.prepare(
    `UPDATE events SET status = 'failed', error = 'Interrupted ' || attempts || ' times', finished_at = ?
     WHERE status = 'running' AND attempts >= ?`,
  ).run(now, maxAttempts);
  db.exec("UPDATE events SET status = 'pending' WHERE status = 'running'");
}

export function getEvent(db: DatabaseSync, id: number): InboxEvent | undefined {
  return findEvents(db, "WHERE id = ?", id)[0];
}

export function lastFinishedId(db: DatabaseSync): number {
  return Number(db.prepare("SELECT MAX(id) AS id FROM events WHERE status IN ('done', 'failed')").get()?.id ?? 0);
}

export function publishedAfter(db: DatabaseSync, id: number): InboxEvent[] {
  return findEvents(
    db,
    `WHERE id > ? AND status IN ('done', 'failed') AND type = 'timer.fired' AND json_extract(payload, '$.notify')
     ORDER BY id`,
    id,
  );
}

export type Said =
  | { minutesAgo: number; topic: string; message: string; reply: string }
  | { minutesAgo: number; schedule: string; result: string };

const saidLength = 1000;

function cut(text: string): string {
  return text.length > saidLength ? `${text.slice(0, saidLength)}…` : text;
}

export function recentlySaid(db: DatabaseSync, limit: number, now: number): Said[] {
  return findEvents(
    db,
    `WHERE status = 'done' AND (type = 'user.message' OR (type = 'timer.fired' AND json_extract(payload, '$.notify')))
     ORDER BY finished_at DESC LIMIT ?`,
    limit,
  )
    .reverse()
    .map(({ type, payload, topic, result, finishedAt }) => {
      const minutesAgo = Math.round((now - (finishedAt ?? now)) / 60_000);
      return type === "user.message"
        ? { minutesAgo, topic: topic ?? "", message: cut((payload as { text: string }).text), reply: cut(result ?? "") }
        : { minutesAgo, schedule: topic ?? "", result: cut(result ?? "") };
    });
}

export function recentEvents(db: DatabaseSync, limit: number): InboxEvent[] {
  return findEvents(
    db,
    `WHERE status IN ('pending', 'running') OR id IN (
       SELECT id FROM events WHERE status IN ('done', 'failed') ORDER BY finished_at DESC LIMIT ?
     )
     ORDER BY id`,
    limit,
  );
}
