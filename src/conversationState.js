/**
 * conversationState.js
 *
 * Tracks where each person is in the DM wizard (which step they're on,
 * and what they've entered so far). One row per phone/chat ID - a person
 * can only be in one flow at a time.
 */

import { db } from './db.js';

const upsertStmt = db.prepare(`
  INSERT INTO conversation_state (phone_id, step, partial_data, updated_at)
  VALUES (@phone_id, @step, @partial_data, datetime('now'))
  ON CONFLICT(phone_id) DO UPDATE SET
    step = excluded.step,
    partial_data = excluded.partial_data,
    updated_at = excluded.updated_at
`);

export function getState(phoneId) {
  const row = db.prepare('SELECT * FROM conversation_state WHERE phone_id = ?').get(phoneId);
  if (!row) return null;
  return {
    phoneId: row.phone_id,
    step: row.step,
    data: JSON.parse(row.partial_data),
    updatedAt: row.updated_at,
  };
}

export function setState(phoneId, step, data = {}) {
  upsertStmt.run({
    phone_id: phoneId,
    step,
    partial_data: JSON.stringify(data),
  });
}

export function clearState(phoneId) {
  db.prepare('DELETE FROM conversation_state WHERE phone_id = ?').run(phoneId);
}

/**
 * Returns all conversation states whose last update is older than
 * `minutesInactive` minutes - used by the scheduler to send "still there?"
 * nudges and eventually clear stale flows.
 */
export function getStaleStates(minutesInactive) {
  return db
    .prepare(`
      SELECT * FROM conversation_state
      WHERE updated_at < datetime('now', '-' || ? || ' minutes')
    `)
    .all(minutesInactive)
    .map((row) => ({
      phoneId: row.phone_id,
      step: row.step,
      data: JSON.parse(row.partial_data),
      updatedAt: row.updated_at,
    }));
}
