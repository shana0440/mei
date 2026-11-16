import { DatabaseSync } from "node:sqlite";

export function openDb(path: string): DatabaseSync {
  const db = new DatabaseSync(path);
  db.exec(`
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY,
      type TEXT NOT NULL,
      payload TEXT NOT NULL,
      dedupe_key TEXT UNIQUE,
      status TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      session_id TEXT,
      topic TEXT,
      result TEXT,
      error TEXT,
      created_at INTEGER NOT NULL,
      started_at INTEGER,
      finished_at INTEGER
    )
  `);
  return db;
}
