import { DatabaseSync } from "node:sqlite";

const migrations = [
  `CREATE TABLE IF NOT EXISTS events (
     id INTEGER PRIMARY KEY,
     type TEXT NOT NULL,
     payload TEXT NOT NULL,
     status TEXT NOT NULL,
     attempts INTEGER NOT NULL DEFAULT 0,
     session_id TEXT,
     topic TEXT,
     result TEXT,
     error TEXT,
     created_at INTEGER NOT NULL,
     started_at INTEGER,
     finished_at INTEGER
   );
   CREATE TABLE IF NOT EXISTS sessions (
     id TEXT PRIMARY KEY,
     topic TEXT NOT NULL,
     last_event_id INTEGER NOT NULL,
     last_active_at INTEGER NOT NULL
   );
   CREATE TABLE IF NOT EXISTS timers (
     id INTEGER PRIMARY KEY,
     name TEXT UNIQUE NOT NULL,
     kind TEXT NOT NULL,
     spec TEXT NOT NULL,
     payload TEXT NOT NULL,
     due_at INTEGER NOT NULL,
     status TEXT NOT NULL
   )`,
  `ALTER TABLE sessions ADD COLUMN summary TEXT;
   ALTER TABLE sessions ADD COLUMN summarized_at INTEGER`,
  "ALTER TABLE sessions ADD COLUMN context TEXT NOT NULL DEFAULT ''",
  "CREATE TABLE kv (key TEXT PRIMARY KEY, value TEXT NOT NULL)",
];

export function openDb(path: string): DatabaseSync {
  const db = new DatabaseSync(path);
  const applied = db.prepare("PRAGMA user_version").get()?.user_version as number;
  migrations.slice(applied).forEach((migration, index) => {
    db.exec(`BEGIN; ${migration}; PRAGMA user_version = ${applied + index + 1}; COMMIT`);
  });
  return db;
}
