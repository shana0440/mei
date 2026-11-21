import type { DatabaseSync } from "node:sqlite";
import type { ScheduledJob } from "./config.ts";
import type { ScriptTask } from "./script.ts";

export type Step = "command" | "script" | "agent" | "background" | "voice";

export type BackgroundTask = { text: string; say: boolean; role: string; folder: string };

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
  runAt: number | null;
};

type NewEvent = Pick<InboxEvent, "type" | "payload"> & { runAt?: number };
export type StepOutput = { output: string; sessionId?: string; topic?: string };

export function stepsOf({ type, payload }: Pick<InboxEvent, "type" | "payload">): Step[] {
  if (type === "user.message") return ["agent", "voice"];
  if (type === "session.idle" || type === "dream") return ["agent"];
  if (type === "task.background") return (payload as BackgroundTask).say ? ["voice"] : ["background", "voice"];
  if (type === "task.script") return ["script", "agent", "voice"];
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
    created_at AS createdAt, started_at AS startedAt, finished_at AS finishedAt, run_at AS runAt
  FROM events`;

function findEvents(db: DatabaseSync, where: string, ...params: (string | number)[]): InboxEvent[] {
  return db
    .prepare(`${selectEvents} ${where}`)
    .all(...params)
    .map((row) => ({ ...row, payload: JSON.parse(row.payload as string) }) as InboxEvent);
}

export function addEvent(db: DatabaseSync, event: NewEvent, now: number): number {
  const { lastInsertRowid } = db
    .prepare(`INSERT INTO events (id, type, payload, status, step, created_at, run_at)
      SELECT COALESCE(MAX(id), (SELECT CAST(value AS INTEGER) FROM kv WHERE key = 'eventId'), 0) + 1,
        ?, ?, 'pending', ?, ?, ? FROM events`)
    .run(event.type, JSON.stringify(event.payload), stepsOf(event)[0], now, event.runAt ?? null);
  return Number(lastInsertRowid);
}

const anyEvent = (where: string) => `EXISTS (SELECT 1 FROM events WHERE ${where})`;

const mayStart: Record<Step, string> = {
  command: "TRUE",
  script: "TRUE",
  agent: `NOT (type = 'dream' AND ${anyEvent("status = 'running' AND step = 'background'")})
    AND NOT (type = 'task.script' AND EXISTS (SELECT 1 FROM events AS other
      WHERE other.status = 'running' AND other.step = 'background'
        AND other.session_id = json_extract(events.payload, '$.sessionId')))`,
  background: `NOT ${anyEvent("status = 'running' AND type = 'dream'")}`,
  voice: `(type = 'user.message' OR NOT ${anyEvent("type = 'user.message' AND status IN ('pending', 'running') AND step = 'agent'")})`,
};

export function waitingAt(db: DatabaseSync, step: Step, now: number, limit = -1): InboxEvent[] {
  return findEvents(
    db,
    `WHERE status = 'pending' AND step = ? AND (run_at IS NULL OR run_at <= ?) AND ${mayStart[step]}
     ORDER BY type = 'user.message' DESC, id LIMIT ?`,
    step,
    now,
    limit,
  );
}

export function nextAt(db: DatabaseSync, step: Step, now: number): InboxEvent | undefined {
  return waitingAt(db, step, now, 1)[0];
}

export function earliestWaiting(db: DatabaseSync, now: number): number | undefined {
  const row = db.prepare("SELECT MIN(run_at) AS at FROM events WHERE status = 'pending' AND run_at > ?").get(now);
  return row?.at === null || row?.at === undefined ? undefined : Number(row.at);
}

export function backgroundTasks(db: DatabaseSync): InboxEvent[] {
  return findEvents(
    db,
    `WHERE type IN ('task.background', 'task.script') AND status IN ('pending', 'running')
     ORDER BY COALESCE(run_at, created_at), id`,
  );
}

export function takingOverScript(db: DatabaseSync, sessionId: string): InboxEvent | undefined {
  return findEvents(
    db,
    `WHERE type = 'task.script' AND status = 'running' AND step = 'agent'
       AND json_extract(payload, '$.sessionId') = ?`,
    sessionId,
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

export function keepSession(db: DatabaseSync, id: number, { sessionId, topic }: Omit<StepOutput, "output">): void {
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
     WHERE status = 'running' AND step != 'script' AND attempts >= ?`,
  ).run(now, maxAttempts);
  db.exec("UPDATE events SET status = 'pending' WHERE status = 'running'");
}

export function getEvent(db: DatabaseSync, id: number): InboxEvent | undefined {
  return findEvents(db, "WHERE id = ?", id)[0];
}

export function lastFinishedId(db: DatabaseSync): number {
  const last = db
    .prepare("SELECT id FROM events WHERE status IN ('done', 'failed') ORDER BY finished_at DESC, id DESC LIMIT 1")
    .get();
  return Number(last?.id ?? 0);
}

export function publishedAfter(db: DatabaseSync, id: number): InboxEvent[] {
  return findEvents(
    db,
    `WHERE (finished_at, id) > (COALESCE((SELECT finished_at FROM events WHERE id = ?), 0), ?) AND (
       status IN ('done', 'failed') AND type = 'timer.fired' AND json_extract(payload, '$.notify')
       OR status IN ('done', 'failed') AND type IN ('task.background', 'task.script')
       OR status = 'failed' AND type = 'dream'
     )
     ORDER BY finished_at, id`,
    id,
    id,
  );
}

export type Said =
  | { minutesAgo: number; topic: string; message: string; reply: string }
  | { minutesAgo: number; schedule: string; result: string }
  | { minutesAgo: number; task: string; result: string }
  | { minutesAgo: number; script: string; result: string };

const saidLength = 1000;

function cut(text: string): string {
  return text.length > saidLength ? `${text.slice(0, saidLength)}…` : text;
}

export function recentlySaid(db: DatabaseSync, limit: number, now: number): Said[] {
  return findEvents(
    db,
    `WHERE status = 'done' AND (
       type IN ('user.message', 'task.background', 'task.script') OR (type = 'timer.fired' AND json_extract(payload, '$.notify'))
     )
     ORDER BY finished_at DESC LIMIT ?`,
    limit,
  )
    .reverse()
    .map(({ type, payload, topic, result, finishedAt }) => {
      const minutesAgo = Math.round((now - (finishedAt ?? now)) / 60_000);
      if (type === "user.message") {
        return { minutesAgo, topic: topic ?? "", message: cut((payload as { text: string }).text), reply: cut(result ?? "") };
      }
      if (type === "task.background") {
        return { minutesAgo, task: cut((payload as BackgroundTask).text), result: cut(result ?? "") };
      }
      if (type === "task.script") {
        return { minutesAgo, script: cut((payload as ScriptTask).command), result: cut(result ?? "") };
      }
      return { minutesAgo, schedule: topic ?? "", result: cut(result ?? "") };
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
