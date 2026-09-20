/**
 * test-reminders.js
 *
 * Standalone smoke test for the data layer - no WhatsApp involved. Run with:
 *   node src/test-reminders.js
 *
 * Uses a throwaway DB file (deleted and recreated each run) so it never
 * touches your real kita-bot.db.
 */

import { unlinkSync, existsSync } from 'node:fs';

const TEST_DB = './test-reminders.db';
for (const f of [TEST_DB, `${TEST_DB}-wal`, `${TEST_DB}-shm`]) {
  if (existsSync(f)) unlinkSync(f);
}
process.env.KITA_BOT_DB = TEST_DB;

const {
  createReminder,
  createCountdownReminders,
  listActiveReminders,
  getDueToday,
  getUpcoming,
  cancelReminder,
  advanceAfterFiring,
  formatReminderLine,
} = await import('./reminders.js');
const { setState, getState, clearState, getStaleStates } = await import('./conversationState.js');
const { todayISO, addDays } = await import('./dates.js');
const { db } = await import('./db.js');

let pass = 0;
let fail = 0;
function check(label, condition) {
  if (condition) {
    console.log(`OK   - ${label}`);
    pass++;
  } else {
    console.log(`FAIL - ${label}`);
    fail++;
  }
}

const today = todayISO();
console.log(`Running tests against today = ${today}\n`);

// --- weekly reminder ---
const weekly = createReminder({
  creatorId: 'tester@s.whatsapp.net',
  assignee: 'Peter',
  messageText: 'Brot mitbringen',
  recurrenceType: 'weekly',
  recurrenceData: { weekday: 1 }, // Monday
});
check('weekly reminder has a next_fire_date that is a Monday', new Date(weekly.nextFireDate + 'T12:00:00').getDay() === 1);

// --- once reminder, due today ---
const once = createReminder({
  creatorId: 'tester@s.whatsapp.net',
  assignee: 'alle',
  messageText: 'Helm und Fahrrad mitbringen',
  recurrenceType: 'once',
  recurrenceData: { date: today },
});
check('once reminder due today shows up in getDueToday()', getDueToday().some((r) => r.id === once.id));

// --- range reminder (kita closed), lead time 3 days ---
const closureStart = addDays(today, 5);
const range = createReminder({
  creatorId: 'tester@s.whatsapp.net',
  assignee: 'alle',
  messageText: 'Kita geschlossen',
  recurrenceType: 'range',
  recurrenceData: { start: closureStart, end: addDays(closureStart, 2), leadDays: 5 },
});
check('range reminder fires 5 days before start (== today)', range.nextFireDate === today);

// --- monthly by date ---
const monthlyDate = createReminder({
  creatorId: 'tester@s.whatsapp.net',
  assignee: 'alle',
  messageText: 'Monatsbeitrag faellig',
  recurrenceType: 'monthly_date',
  recurrenceData: { day: 1 },
});
check('monthly_date reminder next_fire_date is day 1 of a month', monthlyDate.nextFireDate.endsWith('-01'));

// --- monthly by weekday ---
const monthlyWeekday = createReminder({
  creatorId: 'tester@s.whatsapp.net',
  assignee: 'alle',
  messageText: 'Elternabend',
  recurrenceType: 'monthly_weekday',
  recurrenceData: { weekday: 3, occurrence: 2 }, // 2nd Wednesday
});
check('monthly_weekday reminder lands on a Wednesday', new Date(monthlyWeekday.nextFireDate + 'T12:00:00').getDay() === 3);

// --- countdown with mixed past/future lead times ---
const targetDate = addDays(today, 10);
const { created, skipped } = createCountdownReminders({
  creatorId: 'tester@s.whatsapp.net',
  assignee: 'Mia',
  messageText: 'Geburtstag von Mia',
  targetDate,
  leadDaysList: [30, 7, 1], // 30 days before is already in the past relative to a 10-day-out target
});
check('countdown: 30-day lead time skipped (would be in the past)', skipped.includes(30));
check('countdown: 7-day and 1-day lead times created', created.length === 2);

// --- upcoming window ---
const upcoming = getUpcoming(14);
check('getUpcoming(14) includes the once reminder', upcoming.some((r) => r.id === once.id));
check('getUpcoming(14) includes the 7-day-out countdown reminder', upcoming.some((r) => r.recurrenceType === 'countdown'));

// --- cancel ---
const cancelled = cancelReminder(once.id);
check('cancelReminder returns true for an active reminder', cancelled === true);
check('cancelled reminder no longer appears in listActiveReminders', !listActiveReminders().some((r) => r.id === once.id));
check('cancelling an already-cancelled reminder returns false', cancelReminder(once.id) === false);

// --- advanceAfterFiring: weekly should roll forward ~7 days, not deactivate ---
const beforeAdvance = weekly.nextFireDate;
advanceAfterFiring(weekly);
const afterAdvance = listActiveReminders().find((r) => r.id === weekly.id);
check('weekly reminder still active after firing', !!afterAdvance);
check('weekly reminder advanced to a later date', afterAdvance && afterAdvance.nextFireDate > beforeAdvance);

// --- advanceAfterFiring: once-type (range) should deactivate ---
advanceAfterFiring(range);
check('range reminder deactivated after firing (single-shot)', !listActiveReminders().some((r) => r.id === range.id));

// --- listActiveReminders() hides expired-but-still-active reminders ---
// (e.g. a reminder whose exact scheduled day got missed while the bot was
// offline - active=1 in the DB, but a next_fire_date before today. Without
// this filter it would sit in every listing forever, cluttering the view.)
{
  const notExpired = createReminder({
    creatorId: 'tester@s.whatsapp.net',
    assignee: 'alle',
    messageText: 'Nicht abgelaufen',
    recurrenceType: 'once',
    recurrenceData: { date: today },
  });
  const stuck = createReminder({
    creatorId: 'tester@s.whatsapp.net',
    assignee: 'alle',
    messageText: 'Abgelaufen, nie gefeuert',
    recurrenceType: 'once',
    recurrenceData: { date: today },
  });
  // Directly backdate it in the DB to simulate the "missed day" scenario -
  // still active=1, but its date is now in the past.
  db.prepare('UPDATE reminders SET next_fire_date = ? WHERE id = ?').run(addDays(today, -3), stuck.id);

  const active = listActiveReminders();
  check('listActiveReminders includes a reminder due today', active.some((r) => r.id === notExpired.id));
  check('listActiveReminders excludes an active-but-expired (backdated) reminder', !active.some((r) => r.id === stuck.id));

  cancelReminder(notExpired.id);
  cancelReminder(stuck.id);
}

// --- formatReminderLine sanity check ---
const line = formatReminderLine(weekly);
check('formatReminderLine includes the id and assignee', line.includes(`#${weekly.id}`) && line.includes('Peter'));

// --- conversation state ---
setState('491234@s.whatsapp.net', 'awaiting_message_text', { assignee: 'Peter' });
const state = getState('491234@s.whatsapp.net');
check('conversation state round-trips correctly', state.step === 'awaiting_message_text' && state.data.assignee === 'Peter');
clearState('491234@s.whatsapp.net');
check('conversation state cleared', getState('491234@s.whatsapp.net') === null);

console.log(`\n${pass} passed, ${fail} failed`);
db.close();
process.exitCode = fail > 0 ? 1 : 0;
