import type { DatabaseSync } from "node:sqlite";

export type InboxEvent = {
  id: number;
  type: string;
  payload: unknown;
  status: "pending" | "running" | "done" | "failed";
  attempts: number;
  sessionId: string | null;
  topic: string | null;
  result: string | null;
  error: string | null;
  createdAt: number;
  startedAt: number | null;
  finishedAt: number | null;
};

type NewEvent = { type: string; payload: unknown };
export type Outcome = { result: string; sessionId?: string; topic?: string };

const selectEvents = `
  SELECT id, type, payload, status, attempts,
    session_id AS sessionId, topic, result, error,
    created_at AS createdAt, started_at AS startedAt, finished_at AS finishedAt
  FROM events`;

function findEvents(db: DatabaseSync, where: string, ...params: (string | number)[]): InboxEvent[] {
  return db
    .prepare(`${selectEvents} ${where}`)
    .all(...params)
    .map((row) => ({ ...row, payload: JSON.parse(row.payload as string) }) as InboxEvent);
}

export function addEvent(db: DatabaseSync, { type, payload }: NewEvent, now: number): number {
  const { lastInsertRowid } = db
    .prepare(`INSERT INTO events (id, type, payload, status, created_at)
      SELECT COALESCE(MAX(id), (SELECT CAST(value AS INTEGER) FROM kv WHERE key = 'eventId'), 0) + 1,
        ?, ?, 'pending', ? FROM events`)
    .run(type, JSON.stringify(payload), now);
  return Number(lastInsertRowid);
}

export function nextPending(db: DatabaseSync): InboxEvent | undefined {
  return findEvents(db, "WHERE status = 'pending' ORDER BY id LIMIT 1")[0];
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
