/**
 * db.js
 *
 * SQLite connection and schema. Uses better-sqlite3 (synchronous, simple,
 * no async/await needed for queries - fine for our scale of usage).
 */

import Database from 'better-sqlite3';
import { GROUP_CHAT_ID, DEFAULT_FIRE_TIME } from './config.js';

const DB_PATH = process.env.KITA_BOT_DB || './kita-bot.db';

export const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS reminders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    creator_id TEXT NOT NULL,
    assignee TEXT NOT NULL,
    message_text TEXT NOT NULL,
    recurrence_type TEXT NOT NULL,
    recurrence_data TEXT NOT NULL,
    next_fire_date TEXT,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_reminders_next_fire_date
    ON reminders (next_fire_date) WHERE active = 1;

  CREATE TABLE IF NOT EXISTS conversation_state (
    phone_id TEXT PRIMARY KEY,
    step TEXT NOT NULL,
    partial_data TEXT NOT NULL DEFAULT '{}',
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

// --- Migration: target_type / target_chat_id / fire_time columns -----
// Added after the initial schema, so we add them defensively (ALTER TABLE
// ADD COLUMN isn't idempotent like CREATE TABLE IF NOT EXISTS - running
// this twice would error, so we check first).
const existingColumns = db.prepare('PRAGMA table_info(reminders)').all().map((c) => c.name);

if (!existingColumns.includes('target_type')) {
  db.exec(`ALTER TABLE reminders ADD COLUMN target_type TEXT NOT NULL DEFAULT 'group'`);
}
if (!existingColumns.includes('target_chat_id')) {
  db.exec(`ALTER TABLE reminders ADD COLUMN target_chat_id TEXT`);
  // Backfill any pre-existing rows (created before this migration existed)
  // so they keep firing into the group as before.
  db.prepare(`UPDATE reminders SET target_chat_id = ? WHERE target_chat_id IS NULL`).run(GROUP_CHAT_ID);
}
if (!existingColumns.includes('fire_time')) {
  db.exec(`ALTER TABLE reminders ADD COLUMN fire_time TEXT NOT NULL DEFAULT '${DEFAULT_FIRE_TIME}'`);
}
if (!existingColumns.includes('failure_count')) {
  // Tracks consecutive send failures (e.g. WhatsApp "forbidden" because the
  // bot isn't a member of the target group anymore) so the scheduler can
  // give up on a broken reminder instead of retrying it forever. Reset to
  // 0 every time a send actually succeeds.
  db.exec(`ALTER TABLE reminders ADD COLUMN failure_count INTEGER NOT NULL DEFAULT 0`);
}
