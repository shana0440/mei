import type { DatabaseSync } from "node:sqlite";
import type { ScheduledJob } from "./config.ts";

export type Step = "command" | "agent" | "voice";

export type InboxEvent = {
  id: number;
  type: string;
  payload: unknown;
  status: "pending" | "running" | "done" | "failed";
  step: Step;
  handoff: string | null;
  attempts: number;
  sessionId: string | null;
  topic: string | null;
  result: string | null;
  error: string | null;
  createdAt: number;
  startedAt: number | null;
  finishedAt: number | null;
};

type NewEvent = Pick<InboxEvent, "type" | "payload">;
export type StepOutput = { output: string; sessionId?: string; topic?: string };

export function stepsOf({ type, payload }: NewEvent): Step[] {
  if (type === "user.message") return ["agent", "voice"];
  if (type === "session.idle") return ["agent"];
  const job = payload as ScheduledJob;
  return [
    ...("command" in job ? (["command"] as const) : []),
    ...("prompt" in job ? (["agent"] as const) : []),
    ...(job.notify ? (["voice"] as const) : []),
  ];
}

export function stepAfter(event: InboxEvent): Step | undefined {
  const steps = stepsOf(event);
  return steps[steps.indexOf(event.step) + 1];
}

const selectEvents = `
  SELECT id, type, payload, status, step, handoff, attempts,
    session_id AS sessionId, topic, result, error,
    created_at AS createdAt, started_at AS startedAt, finished_at AS finishedAt
  FROM events`;

function findEvents(db: DatabaseSync, where: string, ...params: (string | number)[]): InboxEvent[] {
  return db
    .prepare(`${selectEvents} ${where}`)
    .all(...params)
    .map((row) => ({ ...row, payload: JSON.parse(row.payload as string) }) as InboxEvent);
}

export function addEvent(db: DatabaseSync, event: NewEvent, now: number): number {
  const { lastInsertRowid } = db
    .prepare(`INSERT INTO events (id, type, payload, status, step, created_at)
      SELECT COALESCE(MAX(id), (SELECT CAST(value AS INTEGER) FROM kv WHERE key = 'eventId'), 0) + 1,
        ?, ?, 'pending', ?, ? FROM events`)
    .run(event.type, JSON.stringify(event.payload), stepsOf(event)[0], now);
  return Number(lastInsertRowid);
}

export function nextAt(db: DatabaseSync, step: Step): InboxEvent | undefined {
  return findEvents(
    db,
    "WHERE status = 'pending' AND step = ? ORDER BY type = 'user.message' DESC, id LIMIT 1",
    step,
  )[0];
}

const scheduleName = "json_extract(payload, '$.name')";

export function schedulesWaitingForCommand(db: DatabaseSync): string[] {
  return db
    .prepare(`SELECT DISTINCT ${scheduleName} AS name FROM events WHERE status = 'pending' AND step = 'command'`)
    .all()
    .map(({ name }) => String(name));
}

export function nextCommand(db: DatabaseSync, schedule: string): InboxEvent | undefined {
  return findEvents(
    db,
    `WHERE status = 'pending' AND step = 'command' AND ${scheduleName} = ? ORDER BY id LIMIT 1`,
    schedule,
  )[0];
}

export function lastRun(db: DatabaseSync, schedule: string): number | undefined {
  const row = db
    .prepare(`SELECT MAX(created_at) AS at FROM events WHERE type = 'timer.fired' AND status = 'done' AND ${scheduleName} = ?`)
    .get(schedule);
  return row?.at === null || row?.at === undefined ? undefined : Number(row.at);
}

export function markRunning(db: DatabaseSync, id: number, now: number): void {
  db.prepare(
    "UPDATE events SET status = 'running', attempts = attempts + 1, started_at = COALESCE(started_at, ?) WHERE id = ?",
  ).run(now, id);
}

function keepSession(db: DatabaseSync, id: number, { sessionId, topic }: StepOutput): void {
  db.prepare("UPDATE events SET session_id = COALESCE(?, session_id), topic = COALESCE(?, topic) WHERE id = ?").run(
    sessionId ?? null,
    topic ?? null,
    id,
  );
}

export function markDone(db: DatabaseSync, id: number, done: StepOutput, now: number): void {
  keepSession(db, id, done);
  db.prepare("UPDATE events SET status = 'done', result = ?, finished_at = ? WHERE id = ?").run(done.output, now, id);
}

export function handOff(db: DatabaseSync, id: number, step: Step, done: StepOutput): void {
  keepSession(db, id, done);
  db.prepare("UPDATE events SET status = 'pending', step = ?, handoff = ?, attempts = 0 WHERE id = ?").run(
    step,
    done.output,
    id,
  );
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
