import type { DatabaseSync } from "node:sqlite";

export type Session = {
  id: string;
  topic: string;
  context: string;
  lastActiveAt: number;
  lastMessage: string;
  lastReply: string;
};

export type ClosedSession = { id: string; topic: string; closedAt: number; summary: string };

type Activity = { id: string; topic: string; context: string; eventId: number };

export function recordActivity(db: DatabaseSync, { id, topic, context, eventId }: Activity, now: number): void {
  db.prepare(
    `INSERT INTO sessions (id, topic, context, last_event_id, last_active_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET last_event_id = excluded.last_event_id, last_active_at = excluded.last_active_at`,
  ).run(id, topic, context, eventId, now);
}

export function sessionsActiveSince(db: DatabaseSync, since: number): Session[] {
  return db
    .prepare(
      `SELECT sessions.id, sessions.topic, context, last_active_at AS lastActiveAt,
         json_extract(events.payload, '$.text') AS lastMessage, events.result AS lastReply
       FROM sessions JOIN events ON events.id = sessions.last_event_id
       WHERE last_active_at >= ?
       ORDER BY last_active_at DESC`,
    )
    .all(since) as Session[];
}

export function saveSummary(db: DatabaseSync, id: string, summary: string, now: number): void {
  db.prepare("UPDATE sessions SET summary = ?, summarized_at = ? WHERE id = ?").run(summary, now, id);
}

export function closedSessions(db: DatabaseSync, since: number): ClosedSession[] {
  return db
    .prepare(
      `SELECT id, topic, summarized_at AS closedAt, summary FROM sessions
       WHERE summarized_at >= last_active_at AND summarized_at >= ?
       ORDER BY summarized_at DESC`,
    )
    .all(since) as ClosedSession[];
}
