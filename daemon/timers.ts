import type { DatabaseSync } from "node:sqlite";
import type { Schedule, ScheduleSpec } from "./config.ts";
import { addEvent } from "./inbox.ts";

export type Timer = {
  id: number;
  name: string;
  payload: unknown;
  dueAt: number;
  status: "active" | "done";
} & ({ kind: "schedule"; spec: ScheduleSpec } | { kind: "idle"; spec: {} });

function findTimers(db: DatabaseSync, where: string, ...params: number[]): Timer[] {
  return db
    .prepare(`SELECT id, name, kind, spec, payload, due_at AS dueAt, status FROM timers ${where} ORDER BY due_at`)
    .all(...params)
    .map(
      (row) => ({ ...row, spec: JSON.parse(row.spec as string), payload: JSON.parse(row.payload as string) }) as Timer,
    );
}

export function nextDue(spec: ScheduleSpec, now: number): number {
  if (spec.every_minutes !== undefined) return now + spec.every_minutes * 60_000;
  const [hours, minutes] = spec.daily_at.split(":").map(Number);
  const due = new Date(now);
  due.setHours(hours, minutes, 0, 0);
  if (due.getTime() <= now) due.setDate(due.getDate() + 1);
  return due.getTime();
}

export function syncSchedules(db: DatabaseSync, configured: Schedule[], now: number): void {
  const schedules = configured.filter(({ enabled }) => enabled);
  const upsert = db.prepare(
    `INSERT INTO timers (name, kind, spec, payload, due_at, status) VALUES (?, 'schedule', ?, ?, ?, 'active')
     ON CONFLICT (name) DO UPDATE SET
       spec = excluded.spec,
       payload = excluded.payload,
       due_at = CASE WHEN spec = excluded.spec THEN due_at ELSE excluded.due_at END`,
  );
  for (const { spec, enabled, ...payload } of schedules) {
    upsert.run(payload.name, JSON.stringify(spec), JSON.stringify(payload), nextDue(spec, now));
  }
  db.prepare("DELETE FROM timers WHERE kind = 'schedule' AND name NOT IN (SELECT value FROM json_each(?))").run(
    JSON.stringify(schedules.map(({ name }) => name)),
  );
}

export function setIdleTimer(db: DatabaseSync, sessionId: string, dueAt: number): void {
  db.prepare(
    `INSERT INTO timers (name, kind, spec, payload, due_at, status) VALUES (?, 'idle', '{}', ?, ?, 'active')
     ON CONFLICT (name) DO UPDATE SET due_at = excluded.due_at, status = 'active'`,
  ).run(`idle:${sessionId}`, JSON.stringify({ sessionId }), dueAt);
}

export function listTimers(db: DatabaseSync): Timer[] {
  return findTimers(db, "WHERE status = 'active'");
}

export function dueTimers(db: DatabaseSync, now: number): Timer[] {
  return findTimers(db, "WHERE status = 'active' AND due_at <= ?", now);
}

export function earliestDue(db: DatabaseSync): number | undefined {
  return listTimers(db)[0]?.dueAt;
}

export function fire(db: DatabaseSync, timer: Timer, now: number): void {
  db.exec("BEGIN");
  try {
    if (timer.kind === "idle") {
      addEvent(db, { type: "session.idle", payload: timer.payload }, now);
      db.prepare("UPDATE timers SET status = 'done' WHERE id = ?").run(timer.id);
    } else {
      addEvent(db, { type: "timer.fired", payload: timer.payload }, now);
      db.prepare("UPDATE timers SET due_at = ? WHERE id = ?").run(nextDue(timer.spec, now), timer.id);
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
