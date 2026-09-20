/**
 * reminders.js
 *
 * All the logic for creating, querying, firing, and cancelling reminders.
 * This is the layer the WhatsApp wizard, the /cancel command, the daily
 * scheduler, and the admin UI will all call into - none of them should
 * touch db.js or dates.js directly.
 *
 * recurrence_data shapes (stored as JSON in the DB):
 *   once:            { date: 'YYYY-MM-DD' }
 *   range:           { start: 'YYYY-MM-DD', end: 'YYYY-MM-DD', leadDays: N }
 *   weekly:          { weekday: 1-7 }               // 1 = Monday
 *   monthly_date:    { day: 1-31 }
 *   monthly_weekday: { weekday: 1-7, occurrence: 1-5 | -1 }  // -1 = last
 *   countdown:       { targetDate: 'YYYY-MM-DD', leadDays: N }
 *   daily:           {}                              // every single day
 *
 * Countdown reminders with multiple lead times (e.g. 30/7/1 days before a
 * birthday) are stored as multiple separate rows, one per lead time - see
 * createCountdownReminders(). Each row is otherwise a normal single-shot
 * reminder.
 *
 * Every reminder also has a delivery target: targetType ('group' or
 * 'private') and targetChatId (where it actually gets sent - the group's
 * chat ID, or the creator's own DM for private/personal reminders), plus
 * a fireTime (HH:MM) for what time of day it goes out. Group reminders all
 * default to the same fireTime; private reminders let the creator pick
 * their own.
 */

import { db } from './db.js';
import {
  todayISO,
  addDays,
  nextWeeklyDate,
  nextMonthlyByDate,
  nextMonthlyByWeekday,
  compareDates,
} from './dates.js';
import { GROUP_CHAT_ID, DEFAULT_FIRE_TIME } from './config.js';

const WEEKDAY_NAMES_DE = ['', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'];

function computeInitialFireDate(type, data) {
  switch (type) {
    case 'once':
      return data.date;
    case 'range': {
      const candidate = addDays(data.start, -data.leadDays);
      return compareDates(candidate, todayISO()) < 0 ? todayISO() : candidate;
    }
    case 'weekly':
      return nextWeeklyDate(data.weekday);
    case 'monthly_date':
      return nextMonthlyByDate(data.day);
    case 'monthly_weekday':
      return nextMonthlyByWeekday(data.weekday, data.occurrence);
    case 'countdown':
      return addDays(data.targetDate, -data.leadDays);
    case 'daily':
      return todayISO();
    default:
      throw new Error(`Unknown recurrence type: ${type}`);
  }
}

/**
 * After a reminder fires, compute its next fire date (for recurring types)
 * or return null (for single-shot types, meaning: deactivate it).
 */
function computeNextFireDate(type, data, firedOnDate) {
  const searchFrom = addDays(firedOnDate, 1);
  switch (type) {
    case 'once':
    case 'range':
    case 'countdown':
      return null;
    case 'weekly':
      return nextWeeklyDate(data.weekday, searchFrom);
    case 'monthly_date':
      return nextMonthlyByDate(data.day, searchFrom);
    case 'monthly_weekday':
      return nextMonthlyByWeekday(data.weekday, data.occurrence, searchFrom);
    case 'daily':
      return searchFrom;
    default:
      throw new Error(`Unknown recurrence type: ${type}`);
  }
}

const insertStmt = db.prepare(`
  INSERT INTO reminders (creator_id, assignee, message_text, recurrence_type, recurrence_data, next_fire_date, target_type, target_chat_id, fire_time)
  VALUES (@creator_id, @assignee, @message_text, @recurrence_type, @recurrence_data, @next_fire_date, @target_type, @target_chat_id, @fire_time)
`);

/**
 * Create a single reminder (any type except 'countdown', which has its own
 * function below since it can produce multiple rows).
 *
 * targetType/targetChatId/fireTime default to "group reminder, fires into
 * the Kita group at the standard daily time" so existing call sites (and
 * tests) that don't care about personal reminders keep working unchanged.
 */
export function createReminder({
  creatorId,
  assignee,
  messageText,
  recurrenceType,
  recurrenceData,
  targetType = 'group',
  targetChatId = GROUP_CHAT_ID,
  fireTime = DEFAULT_FIRE_TIME,
}) {
  const nextFireDate = computeInitialFireDate(recurrenceType, recurrenceData);
  const info = insertStmt.run({
    creator_id: creatorId,
    assignee,
    message_text: messageText,
    recurrence_type: recurrenceType,
    recurrence_data: JSON.stringify(recurrenceData),
    next_fire_date: nextFireDate,
    target_type: targetType,
    target_chat_id: targetChatId,
    fire_time: fireTime,
  });
  return getReminderById(info.lastInsertRowid);
}

/**
 * Create one reminder row per lead time for a countdown (e.g. birthday).
 * Lead times whose resulting fire date has already passed are skipped, and
 * their labels are returned in `skipped` so the caller (the wizard) can
 * tell the user "these were skipped because the date already passed".
 */
export function createCountdownReminders({
  creatorId,
  assignee,
  messageText,
  targetDate,
  leadDaysList,
  targetType = 'group',
  targetChatId = GROUP_CHAT_ID,
  fireTime = DEFAULT_FIRE_TIME,
}) {
  const created = [];
  const skipped = [];
  const today = todayISO();

  for (const leadDays of leadDaysList) {
    const fireDate = addDays(targetDate, -leadDays);
    if (compareDates(fireDate, today) < 0) {
      skipped.push(leadDays);
      continue;
    }
    const row = createReminder({
      creatorId,
      assignee,
      messageText,
      recurrenceType: 'countdown',
      recurrenceData: { targetDate, leadDays },
      targetType,
      targetChatId,
      fireTime,
    });
    created.push(row);
  }
  return { created, skipped };
}

export function getReminderById(id) {
  return deserialize(db.prepare('SELECT * FROM reminders WHERE id = ?').get(id));
}

/**
 * All active reminders that haven't expired yet (next_fire_date is today
 * or later). This is the shared base every listing (/liste, /löschen,
 * the DM wizard's listings) builds on, so "expired" reminders never
 * clutter any of them. Under normal operation an active reminder's date
 * never falls behind today anyway (it either fires and advances/
 * deactivates, or hasn't happened yet) - this mainly guards against the
 * rare case where a reminder's exact scheduled day was missed (e.g. the
 * bot was offline right through midnight), which would otherwise leave a
 * stale, never-firing entry sitting in every list forever.
 */
export function listActiveReminders() {
  const today = todayISO();
  return db
    .prepare('SELECT * FROM reminders WHERE active = 1 AND next_fire_date >= ? ORDER BY next_fire_date ASC')
    .all(today)
    .map(deserialize);
}

export function getDueToday() {
  const today = todayISO();
  return db
    .prepare('SELECT * FROM reminders WHERE active = 1 AND next_fire_date = ?')
    .all(today)
    .map(deserialize);
}

export function getUpcoming(days) {
  const today = todayISO();
  const until = addDays(today, days);
  return db
    .prepare('SELECT * FROM reminders WHERE active = 1 AND next_fire_date BETWEEN ? AND ? ORDER BY next_fire_date ASC')
    .all(today, until)
    .map(deserialize);
}

export function getUpcomingForAssignee(assignee, days) {
  return getUpcoming(days).filter(
    (r) => r.assignee.toLowerCase() === assignee.toLowerCase() || r.assignee.toLowerCase() === 'alle'
  );
}

/**
 * All active group-targeted reminders, regardless of date (not just
 * upcoming ones) - for "show me everything for the group" requests.
 */
export function listGroupReminders() {
  return listActiveReminders().filter((r) => r.targetType === 'group');
}

/**
 * All active reminders assigned to a specific named person (plus "alle"
 * ones, since those apply to everyone too), regardless of date.
 */
export function listForAssignee(name) {
  const needle = name.trim().toLowerCase();
  return listActiveReminders().filter(
    (r) => r.assignee.toLowerCase() === needle || r.assignee.toLowerCase() === 'alle'
  );
}

export function cancelReminder(id) {
  const result = db.prepare('UPDATE reminders SET active = 0 WHERE id = ? AND active = 1').run(id);
  return result.changes > 0;
}

/**
 * Call this after a reminder has actually been sent to the group. Advances
 * it to its next occurrence, or deactivates it if it was single-shot. Also
 * resets its failure counter (see recordSendFailure below), since a
 * successful send means whatever was wrong before is fixed now.
 */
export function advanceAfterFiring(reminder) {
  const nextFireDate = computeNextFireDate(reminder.recurrenceType, reminder.recurrenceData, reminder.nextFireDate);
  if (nextFireDate === null) {
    db.prepare('UPDATE reminders SET active = 0, failure_count = 0 WHERE id = ?').run(reminder.id);
  } else {
    db.prepare('UPDATE reminders SET next_fire_date = ?, failure_count = 0 WHERE id = ?').run(nextFireDate, reminder.id);
  }
}

/**
 * Call this when actually sending a reminder throws (e.g. WhatsApp
 * "forbidden" because the bot isn't a member of the target group anymore).
 * Increments its consecutive-failure counter and returns the updated
 * reminder, so the scheduler can decide whether to keep retrying or give
 * up (see MAX_SEND_FAILURES in config.js).
 */
export function recordSendFailure(id) {
  db.prepare('UPDATE reminders SET failure_count = failure_count + 1 WHERE id = ?').run(id);
  return getReminderById(id);
}

function deserialize(row) {
  if (!row) return null;
  return {
    id: row.id,
    creatorId: row.creator_id,
    assignee: row.assignee,
    messageText: row.message_text,
    recurrenceType: row.recurrence_type,
    recurrenceData: JSON.parse(row.recurrence_data),
    nextFireDate: row.next_fire_date,
    active: !!row.active,
    createdAt: row.created_at,
    targetType: row.target_type,
    targetChatId: row.target_chat_id,
    fireTime: row.fire_time,
    failureCount: row.failure_count,
  };
}

/**
 * Human-readable (German) description of a reminder's schedule, e.g.
 * "jeden Montag", "am 3. jeden Monats", "einmalig am 15.09.2026".
 */
export function describeRecurrence(reminder) {
  const { recurrenceType: type, recurrenceData: data } = reminder;
  switch (type) {
    case 'once':
      return `einmalig am ${formatDateDE(data.date)}`;
    case 'range':
      return `${formatDateDE(data.start)} bis ${formatDateDE(data.end)} (Hinweis ${data.leadDays} Tag(e) vorher)`;
    case 'weekly':
      return `jeden ${WEEKDAY_NAMES_DE[data.weekday]}`;
    case 'monthly_date':
      return `am ${data.day}. jeden Monats`;
    case 'monthly_weekday': {
      const label = data.occurrence === -1 ? 'letzten' : `${data.occurrence}.`;
      return `am ${label} ${WEEKDAY_NAMES_DE[data.weekday]} im Monat`;
    }
    case 'countdown':
      return `${data.leadDays} Tag(e) vor dem ${formatDateDE(data.targetDate)}`;
    case 'daily':
      return 'jeden Tag';
    default:
      return type;
  }
}

export function formatDateDE(isoDate) {
  const [y, m, d] = isoDate.split('-');
  return `${d}.${m}.${y}`;
}

/**
 * One-line summary used in /cancel lists and DM listings, e.g.
 * "#7 - Peter - Brot mitbringen - jeden Montag - 07:00 - Gruppe"
 */
export function formatReminderLine(reminder) {
  const target = reminder.targetType === 'private' ? 'privat' : 'Gruppe';
  return `#${reminder.id} - ${reminder.assignee} - ${reminder.messageText} - ${describeRecurrence(reminder)} - ${reminder.fireTime} - ${target}`;
}

/**
 * The actual announcement text sent when a reminder fires (group or
 * private). Kept separate from formatReminderLine, which is an admin-style
 * listing line, not something meant to be posted as-is into a chat.
 */
export function formatFireMessage(reminder) {
  if (reminder.targetType === 'private') {
    return `Erinnerung: ${reminder.messageText}`;
  }
  if (reminder.assignee && reminder.assignee.toLowerCase() !== 'alle') {
    return `Erinnerung fuer ${reminder.assignee}: ${reminder.messageText}`;
  }
  return `Erinnerung: ${reminder.messageText}`;
}
