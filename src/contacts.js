/**
 * contacts.js
 *
 * A tiny auto-learned address book: maps a person's WhatsApp display name
 * to their WhatsApp ID (JID). We never ask anyone to set this up manually -
 * whenever someone sends a message in the group, bot.js records their
 * JID + display name here. Once that's happened at least once for someone,
 * reminders assigned to them by name can properly @mention them.
 *
 * This is a best-effort mechanism: if someone has never posted in the
 * group, we simply don't have their JID yet, and mentions silently fall
 * back to plain text with their name.
 */

import { db } from './db.js';

db.exec(`
  CREATE TABLE IF NOT EXISTS contacts (
    jid TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

const upsertStmt = db.prepare(`
  INSERT INTO contacts (jid, display_name, updated_at)
  VALUES (@jid, @display_name, datetime('now'))
  ON CONFLICT(jid) DO UPDATE SET
    display_name = excluded.display_name,
    updated_at = excluded.updated_at
`);

/**
 * Record/update someone's display name for their JID. Safe to call on
 * every incoming message - it's just an upsert.
 */
export function upsertContact(jid, displayName) {
  if (!jid || !displayName) return;
  upsertStmt.run({ jid, display_name: displayName });
}

/**
 * Find a JID by display name, case-insensitive exact match. Returns null
 * if we don't know this person yet (they haven't posted in the group).
 */
export function findJidByName(name) {
  if (!name) return null;
  const row = db
    .prepare('SELECT jid FROM contacts WHERE LOWER(display_name) = LOWER(?) LIMIT 1')
    .get(name.trim());
  return row ? row.jid : null;
}
