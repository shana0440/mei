import type { DatabaseSync } from "node:sqlite";

export type Session = {
  id: string;
  topic: string;
  role: string;
  folder: string;
  context: string;
  lastActiveAt: number;
  summary: string | null;
};

export type SummarizedSession = { id: string; topic: string; closedAt: number; summary: string };

export type RecentMessage = { id: number; sessionId: string; topic: string; at: number; message: string; reply: string };

type Activity = { id: string; topic: string; role: string; folder: string; context: string; eventId: number };

export function recordActivity(db: DatabaseSync, activity: Activity, now: number): void {
  const { id, topic, role, folder, context, eventId } = activity;
  db.prepare(
    `INSERT INTO sessions (id, topic, role, folder, context, last_event_id, last_active_at) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET last_event_id = excluded.last_event_id, last_active_at = excluded.last_active_at`,
  ).run(id, topic, role, folder, context, eventId, now);
}

export function findSession(db: DatabaseSync, id: string): Session | undefined {
  return db
    .prepare(
      `SELECT id, topic, role, folder, context, last_active_at AS lastActiveAt, summary FROM sessions WHERE id = ?`,
    )
    .get(id) as Session | undefined;
}

export function recentMessages(db: DatabaseSync, limit: number): RecentMessage[] {
  return db
    .prepare(
      `SELECT events.id, sessions.id AS sessionId, sessions.topic, events.finished_at AS at,
         COALESCE(json_extract(events.payload, '$.text'), json_extract(events.payload, '$.command')) AS message,
         COALESCE(events.result, events.handoff) AS reply
       FROM events JOIN sessions ON sessions.id = events.session_id
       WHERE events.type IN ('user.message', 'task.background', 'task.script') AND events.status = 'done'
       ORDER BY events.id DESC LIMIT ?`,
    )
    .all(limit) as RecentMessage[];
}

export function saveSummary(db: DatabaseSync, id: string, summary: string, now: number): void {
  db.prepare("UPDATE sessions SET summary = ?, summarized_at = ? WHERE id = ?").run(summary, now, id);
}

export function shortTermMemory(db: DatabaseSync): SummarizedSession[] {
  return db
    .prepare(
      `SELECT id, topic, summarized_at AS closedAt, summary FROM sessions
       WHERE summary IS NOT NULL
       ORDER BY summarized_at DESC`,
    )
    .all() as SummarizedSession[];
}

export function describeSummaries(sessions: SummarizedSession[]): string {
  return sessions
    .map(({ topic, closedAt, summary }) => `### ${topic} (${new Date(closedAt).toLocaleString()})\n\n${summary}`)
    .join("\n\n");
}

export function forgetSummaries(db: DatabaseSync, sessions: SummarizedSession[]): void {
  const forget = db.prepare("UPDATE sessions SET summary = NULL WHERE id = ?");
  for (const { id } of sessions) forget.run(id);
}
