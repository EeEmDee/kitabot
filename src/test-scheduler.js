/**
 * test-scheduler.js
 *
 * Verifies the daily scheduler: fires due reminders at the right time,
 * routes them to the right destination (group vs private), advances
 * recurring ones, deactivates single-shot ones, and doesn't double-fire.
 * No WhatsApp involved - uses a fake `send` function.
 */

import { unlinkSync, existsSync } from 'node:fs';

const TEST_DB = './test-scheduler.db';
for (const f of [TEST_DB, `${TEST_DB}-wal`, `${TEST_DB}-shm`]) {
  if (existsSync(f)) unlinkSync(f);
}
process.env.KITA_BOT_DB = TEST_DB;

const { checkAndFireReminders } = await import('./scheduler.js');
const { createReminder, listActiveReminders, getReminderById, cancelReminder } = await import('./reminders.js');
const { todayISO, addDays } = await import('./dates.js');
const { GROUP_CHAT_ID, MAX_SEND_FAILURES } = await import('./config.js');
const { db } = await import('./db.js');

let pass = 0;
let fail = 0;
function check(label, condition, extra = '') {
  if (condition) {
    console.log(`OK   - ${label}`);
    pass++;
  } else {
    console.log(`FAIL - ${label} ${extra}`);
    fail++;
  }
}

const today = todayISO();

function makeSend() {
  const sent = [];
  const send = async (jid, text, extra = {}) => {
    sent.push({ jid, text, extra });
  };
  return { send, sent };
}

function at(hh, mm) {
  const d = new Date();
  d.setHours(hh, mm, 0, 0);
  return d;
}

// --- group reminder: fires once its time arrives, not before ---
{
  const { send, sent } = makeSend();
  const reminder = createReminder({
    creatorId: 'peter@s.whatsapp.net',
    assignee: 'Peter',
    messageText: 'Brot mitbringen',
    recurrenceType: 'once',
    recurrenceData: { date: today },
    fireTime: '07:00',
  });

  await checkAndFireReminders(send, at(6, 59));
  check('does not fire before its scheduled time', sent.length === 0);

  await checkAndFireReminders(send, at(7, 0));
  check('fires exactly at its scheduled time', sent.length === 1);
  check('fires to the group chat', sent[0].jid === GROUP_CHAT_ID);
  check('fire message mentions the assignee', sent[0].text.includes('Peter'));
  check('fire message includes the reminder text', sent[0].text.includes('Brot mitbringen'));

  const stillActive = listActiveReminders().some((r) => r.id === reminder.id);
  check('single-shot (once) reminder deactivated after firing', !stillActive);
}

// --- does not double-fire on a later tick the same day ---
{
  const { send, sent } = makeSend();
  createReminder({
    creatorId: 'mama@s.whatsapp.net',
    assignee: 'alle',
    messageText: 'Helm mitbringen',
    recurrenceType: 'once',
    recurrenceData: { date: today },
    fireTime: '07:00',
  });

  await checkAndFireReminders(send, at(7, 0));
  check('fires once', sent.length === 1);

  await checkAndFireReminders(send, at(7, 5));
  check('does not fire again on a later tick the same day', sent.length === 1);

  await checkAndFireReminders(send, at(23, 59));
  check('does not fire again later that day either', sent.length === 1);
}

// --- private reminder: fires to the creator's own chat, not the group ---
{
  const { send, sent } = makeSend();
  createReminder({
    creatorId: 'privatperson@s.whatsapp.net',
    assignee: 'ich',
    messageText: 'Medikament nehmen',
    recurrenceType: 'daily',
    recurrenceData: {},
    targetType: 'private',
    targetChatId: 'privatperson@s.whatsapp.net',
    fireTime: '08:00',
  });

  await checkAndFireReminders(send, at(8, 0));
  check('private reminder fires', sent.length === 1);
  check('private reminder fires to the creator, not the group', sent[0].jid === 'privatperson@s.whatsapp.net');
  check('private fire message has no "fuer X" framing (it is obviously personal)', !sent[0].text.includes('fuer'));
}

// --- daily reminder advances to tomorrow after firing, stays active ---
{
  const { send } = makeSend();
  const reminder = createReminder({
    creatorId: 'x@s.whatsapp.net',
    assignee: 'ich',
    messageText: 'Daily advance test',
    recurrenceType: 'daily',
    recurrenceData: {},
    targetType: 'private',
    targetChatId: 'x@s.whatsapp.net',
    fireTime: '09:00',
  });

  await checkAndFireReminders(send, at(9, 0));
  const after = listActiveReminders().find((r) => r.id === reminder.id);
  check('daily reminder still active after firing', !!after);
  check('daily reminder advanced to tomorrow', after && after.nextFireDate === addDays(today, 1));
}

// --- reminders not due today are left untouched ---
{
  const { send, sent } = makeSend();
  createReminder({
    creatorId: 'future@s.whatsapp.net',
    assignee: 'alle',
    messageText: 'Zukunft Test',
    recurrenceType: 'once',
    recurrenceData: { date: addDays(today, 5) },
    fireTime: '00:00',
  });

  await checkAndFireReminders(send, at(23, 59));
  check('reminder due in the future does not fire today regardless of time', sent.length === 0);
}

// --- multiple reminders with different times on the same day fire independently ---
{
  const { send, sent } = makeSend();
  createReminder({
    creatorId: 'multi@s.whatsapp.net',
    assignee: 'alle',
    messageText: 'Fruehe Erinnerung',
    recurrenceType: 'once',
    recurrenceData: { date: today },
    fireTime: '06:00',
  });
  createReminder({
    creatorId: 'multi@s.whatsapp.net',
    assignee: 'alle',
    messageText: 'Spaete Erinnerung',
    recurrenceType: 'once',
    recurrenceData: { date: today },
    fireTime: '18:00',
  });

  await checkAndFireReminders(send, at(12, 0));
  check('only the early one fires by noon', sent.length === 1 && sent[0].text.includes('Fruehe'));

  await checkAndFireReminders(send, at(18, 0));
  check('the late one fires once its time arrives', sent.length === 2 && sent[1].text.includes('Spaete'));
}

// --- @mention: assignee is a known contact -> proper mention ---
{
  const { upsertContact } = await import('./contacts.js');
  upsertContact('4917600000009@s.whatsapp.net', 'Peter');

  const { send, sent } = makeSend();
  createReminder({
    creatorId: 'creator@s.whatsapp.net',
    assignee: 'Peter',
    messageText: 'Brot mitbringen',
    recurrenceType: 'once',
    recurrenceData: { date: today },
    fireTime: '10:00',
  });

  await checkAndFireReminders(send, at(10, 0));
  check('mentioned message goes out', sent.length === 1);
  check('mention text starts with "@Peter"', sent[0].text.startsWith('@Peter'));
  check('mentions array contains Peter\'s JID', sent[0].extra?.mentions?.includes('4917600000009@s.whatsapp.net'));
}

// --- @mention: assignee is NOT a known contact -> falls back to plain text ---
{
  const { send, sent } = makeSend();
  createReminder({
    creatorId: 'creator@s.whatsapp.net',
    assignee: 'UnbekanntePerson',
    messageText: 'Helm mitbringen',
    recurrenceType: 'once',
    recurrenceData: { date: today },
    fireTime: '11:00',
  });

  await checkAndFireReminders(send, at(11, 0));
  check('falls back to plain text when the contact is unknown', sent[0].text.includes('UnbekanntePerson') && !sent[0].text.startsWith('@'));
  check('no mentions option passed when contact is unknown', !sent[0].extra?.mentions);
}

// --- @mention: private reminders never get mentioned (they're obviously personal) ---
{
  const { upsertContact } = await import('./contacts.js');
  upsertContact('privatgeheim@s.whatsapp.net', 'ich');

  const { send, sent } = makeSend();
  createReminder({
    creatorId: 'privatgeheim@s.whatsapp.net',
    assignee: 'ich',
    messageText: 'Medikament nehmen',
    recurrenceType: 'once',
    recurrenceData: { date: today },
    targetType: 'private',
    targetChatId: 'privatgeheim@s.whatsapp.net',
    fireTime: '12:00',
  });

  await checkAndFireReminders(send, at(12, 0));
  check('private reminders are never @mentioned even if a contact matches', !sent[0].extra?.mentions);
}

// --- hardening: one failing reminder does not block others in the same tick ---
{
  const goodReminder = createReminder({
    creatorId: 'iso@s.whatsapp.net',
    assignee: 'alle',
    messageText: 'Funktioniert',
    recurrenceType: 'once',
    recurrenceData: { date: today },
    fireTime: '13:00',
  });
  const badReminder = createReminder({
    creatorId: 'iso@s.whatsapp.net',
    assignee: 'alle',
    messageText: 'Schlaegt fehl',
    recurrenceType: 'once',
    recurrenceData: { date: today },
    fireTime: '13:00',
  });

  const sent = [];
  const send = async (jid, text, extra = {}) => {
    if (text.includes('Schlaegt fehl')) {
      throw new Error('forbidden');
    }
    sent.push({ jid, text, extra });
  };
  const logMessages = [];
  const log = (msg) => logMessages.push(msg);

  await checkAndFireReminders(send, at(13, 0), log);

  check('the good reminder still fires even though another one in the same tick failed', sent.some((s) => s.text.includes('Funktioniert')));
  check('the good reminder is deactivated as a one-shot normally would be', !listActiveReminders().some((r) => r.id === goodReminder.id));
  check('the failing reminder is still active (will retry), not silently dropped', listActiveReminders().some((r) => r.id === badReminder.id));
  check('a failure for the bad reminder was logged', logMessages.some((m) => m.includes(`#${badReminder.id}`)));
  check('checkAndFireReminders itself does not throw when a send fails', true); // implicit - the await above didn't throw

  // Clean up: this reminder was deliberately left active/perpetually-failing
  // to prove it survives one failed attempt. Left as-is it would keep
  // getting reprocessed (fireTime 13:00 is <= every later test's time) and
  // pollute the sent-message counts in the test blocks below.
  cancelReminder(badReminder.id);
}

// --- hardening: failure counter increments, then resets on eventual success ---
{
  const recurring = createReminder({
    creatorId: 'reset@s.whatsapp.net',
    assignee: 'alle',
    messageText: 'Reset Test',
    recurrenceType: 'daily',
    recurrenceData: {},
    fireTime: '15:00',
  });

  const failingSend = async () => {
    throw new Error('temporaerer Fehler');
  };
  await checkAndFireReminders(failingSend, at(15, 0), () => {});
  await checkAndFireReminders(failingSend, at(15, 0), () => {});

  const afterTwoFailures = getReminderById(recurring.id);
  check('failure count increments on each consecutive failure', afterTwoFailures.failureCount === 2);
  check('reminder is still active while under the failure limit', afterTwoFailures.active === true);

  const { send: goodSend, sent: goodSent } = makeSend();
  await checkAndFireReminders(goodSend, at(15, 0));
  check('reminder still fires successfully after prior failures', goodSent.length === 1);

  const afterSuccess = getReminderById(recurring.id);
  check('failure count resets to 0 after a successful send', afterSuccess.failureCount === 0);
  check('recurring reminder still advances normally after recovering from failures', afterSuccess.nextFireDate === addDays(today, 1));
}

// --- hardening: gives up after MAX_SEND_FAILURES consecutive failures ---
{
  const stubborn = createReminder({
    creatorId: 'giveup@s.whatsapp.net',
    assignee: 'alle',
    messageText: 'Gibt nie auf Test',
    recurrenceType: 'once',
    recurrenceData: { date: today },
    fireTime: '14:00',
  });

  const alwaysFailSend = async () => {
    throw new Error('forbidden');
  };
  const logMessages = [];
  const log = (msg) => logMessages.push(msg);

  for (let i = 0; i < MAX_SEND_FAILURES; i++) {
    await checkAndFireReminders(alwaysFailSend, at(14, 0), log);
  }

  check(
    `reminder is deactivated after ${MAX_SEND_FAILURES} consecutive failures`,
    !listActiveReminders().some((r) => r.id === stubborn.id)
  );
  check('a "automatisch deaktiviert" message was logged when giving up', logMessages.some((m) => m.includes('automatisch deaktiviert')));

  // One more tick shouldn't touch it again - it's inactive now, so getDueToday() won't even return it.
  const { send: quietSend, sent: quietSent } = makeSend();
  await checkAndFireReminders(quietSend, at(14, 0), log);
  check('a deactivated reminder is not retried again on a later tick', quietSent.length === 0);
}

console.log(`\n${pass} passed, ${fail} failed`);
db.close();
process.exitCode = fail > 0 ? 1 : 0;
