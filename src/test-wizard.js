/**
 * test-wizard.js
 *
 * Simulates full private-chat conversations through the wizard, no
 * WhatsApp involved. Run with: node src/test-wizard.js
 */

import { unlinkSync, existsSync } from 'node:fs';

const TEST_DB = './test-wizard.db';
for (const f of [TEST_DB, `${TEST_DB}-wal`, `${TEST_DB}-shm`]) {
  if (existsSync(f)) unlinkSync(f);
}
process.env.KITA_BOT_DB = TEST_DB;

const { handleWizardMessage } = await import('./wizard.js');
const { listActiveReminders } = await import('./reminders.js');
const { todayISO, addDays } = await import('./dates.js');
const { db } = await import('./db.js');
const { GROUP_CHAT_ID } = await import('./config.js');

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

async function converse(senderId, messages) {
  const replies = [];
  for (const msg of messages) {
    replies.push(await handleWizardMessage(senderId, msg));
  }
  return replies;
}

const today = todayISO();
console.log(`Running wizard tests against today = ${today}\n`);

// --- weekly reminder, full happy path ---
{
  const replies = await converse('peter@s.whatsapp.net', [
    '1', // start
    'Brot mitbringen',
    'Peter',
    '3', // weekly
    '1', // Monday
    'ja',
  ]);
  check('weekly flow: final reply confirms creation', replies.at(-1).includes('Erledigt'));
  const created = listActiveReminders().find((r) => r.messageText === 'Brot mitbringen');
  check('weekly flow: reminder actually created with correct assignee', created && created.assignee === 'Peter');
  check('weekly flow: recurrence type is weekly with weekday=1', created.recurrenceType === 'weekly' && created.recurrenceData.weekday === 1);
}

// --- once reminder ---
{
  const futureDate = addDays(today, 10);
  const [d, m, y] = [futureDate.slice(8, 10), futureDate.slice(5, 7), futureDate.slice(0, 4)];
  const dateDE = `${d}.${m}.${y}`;
  const replies = await converse('mama2@s.whatsapp.net', [
    '1',
    'Helm und Fahrrad mitbringen',
    'alle',
    '1', // once
    dateDE,
    'ja',
  ]);
  check('once flow: confirms creation', replies.at(-1).includes('Erledigt'));
  const created = listActiveReminders().find((r) => r.messageText === 'Helm und Fahrrad mitbringen');
  check('once flow: assignee normalized to "alle"', created && created.assignee === 'alle');
  check('once flow: date stored correctly', created.recurrenceData.date === futureDate);
}

// --- invalid date should re-prompt, not crash or advance ---
{
  const replies = await converse('mama3@s.whatsapp.net', [
    '1',
    'Test invalid date',
    'alle',
    '1',
    '31.02.2026', // invalid: Feb has no 31st
    '24.12.2026', // now valid
    'ja',
  ]);
  check('invalid date triggers re-prompt (not silently accepted)', replies[4].includes('nicht verstanden'));
  check('after correction, flow completes normally', replies.at(-1).includes('Erledigt'));
}

// --- past date should be rejected ---
{
  const replies = await converse('mama4@s.whatsapp.net', [
    '1',
    'Test past date',
    'alle',
    '1',
    '01.01.2020',
    'abbrechen',
  ]);
  check('past date rejected with clear message', replies[4].includes('Vergangenheit'));
  check('abbrechen cancels the flow', replies.at(-1).startsWith('Vorgang abgebrochen.'));
  check('abbrechen also shows the main menu again in the same reply', replies.at(-1).includes('Was moechtest du tun'));
}

// --- range (closure) reminder ---
{
  const start = addDays(today, 20);
  const end = addDays(today, 22);
  const toDE = (iso) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;
  const replies = await converse('mama5@s.whatsapp.net', [
    '1',
    'Kita geschlossen',
    'alle',
    '2', // range
    toDE(start),
    toDE(end),
    '5', // lead days
    'ja',
  ]);
  check('range flow completes', replies.at(-1).includes('Erledigt'));
  const created = listActiveReminders().find((r) => r.messageText === 'Kita geschlossen');
  check('range flow: fire date is 5 days before start', created.nextFireDate === addDays(start, -5));
}

// --- range with end before start should re-prompt ---
{
  const start = addDays(today, 20);
  const earlierThanStart = addDays(today, 15);
  const toDE = (iso) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;
  const replies = await converse('mama6@s.whatsapp.net', [
    '1',
    'Ungueltiger Zeitraum Test',
    'alle',
    '2',
    toDE(start),
    toDE(earlierThanStart), // before start - invalid
    toDE(addDays(start, 2)), // now valid
    '2',
    'ja',
  ]);
  check('range: end-before-start rejected', replies[5].includes('Enddatum'));
  check('range: recovers and completes after valid end date', replies.at(-1).includes('Erledigt'));
}

// --- monthly by date ---
{
  const replies = await converse('mama7@s.whatsapp.net', [
    '1',
    'Monatsbeitrag faellig',
    'alle',
    '4', // monthly
    '1', // by date
    '3',
    'ja',
  ]);
  check('monthly_date flow completes', replies.at(-1).includes('Erledigt'));
  const created = listActiveReminders().find((r) => r.messageText === 'Monatsbeitrag faellig');
  check('monthly_date: day stored correctly', created.recurrenceData.day === 3);
}

// --- monthly by weekday (3rd Monday) ---
{
  const replies = await converse('mama8@s.whatsapp.net', [
    '1',
    'Elternabend',
    'alle',
    '4',
    '2', // by weekday
    '1', // Monday
    '3', // 3rd occurrence
    'ja',
  ]);
  check('monthly_weekday flow completes', replies.at(-1).includes('Erledigt'));
  const created = listActiveReminders().find((r) => r.messageText === 'Elternabend');
  check(
    'monthly_weekday: weekday and occurrence stored correctly',
    created.recurrenceData.weekday === 1 && created.recurrenceData.occurrence === 3
  );
}

// --- monthly by weekday, "last" option ---
{
  const replies = await converse('mama9@s.whatsapp.net', [
    '1',
    'Letzter Freitag Test',
    'alle',
    '4',
    '2',
    '5', // Friday
    '5', // "Letzter"
    'ja',
  ]);
  check('monthly_weekday "last" flow completes', replies.at(-1).includes('Erledigt'));
  const created = listActiveReminders().find((r) => r.messageText === 'Letzter Freitag Test');
  check('monthly_weekday: occurrence -1 for "last"', created.recurrenceData.occurrence === -1);
}

// --- countdown (birthday) with mixed lead times ---
{
  const target = addDays(today, 10);
  const toDE = (iso) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;
  const replies = await converse('mama10@s.whatsapp.net', [
    '1',
    'Geburtstag von Mia',
    'Mia',
    '5', // countdown
    toDE(target),
    '30,7,1',
    'ja',
  ]);
  check('countdown flow completes', replies.at(-1).includes('Erledigt'));
  check('countdown flow mentions skipped lead time', replies.at(-1).includes('uebersprungen'));
  const createdCount = listActiveReminders().filter((r) => r.messageText === 'Geburtstag von Mia').length;
  check('countdown: only non-past lead times actually created (2 of 3)', createdCount === 2);
}

// --- rejecting the confirmation (nein) should not create anything ---
{
  const replies = await converse('mama11@s.whatsapp.net', [
    '1',
    'Sollte nicht erstellt werden',
    'alle',
    '3',
    '2',
    'nein',
  ]);
  check('answering "nein" cancels without creating', replies.at(-1).includes('abgebrochen'));
  const created = listActiveReminders().find((r) => r.messageText === 'Sollte nicht erstellt werden');
  check('nothing was created after "nein"', created === undefined);
}

// --- invalid menu choice re-prompts with the same menu, not a crash ---
{
  const replies = await converse('mama12@s.whatsapp.net', [
    '1',
    'Menu robustness test',
    'alle',
    '99', // invalid recurrence choice
    '3', // now valid (weekly)
    '2',
    'ja',
  ]);
  check('invalid menu number re-prompts', replies[3].includes('1-6'));
  check('recovers after valid input', replies.at(-1).includes('Erledigt'));
}

// --- listing: "meine" reflects only reminders created by that sender ---
{
  const replies = await converse('lister@s.whatsapp.net', ['5']);
  check('listing with no reminders created says so', replies[0].includes('noch keine'));

  await converse('lister@s.whatsapp.net', ['1', 'Meine eigene Erinnerung', 'alle', '3', '4', 'ja']);
  const replies2 = await converse('lister@s.whatsapp.net', ['5']);
  check('listing after creating one shows it', replies2[0].includes('Meine eigene Erinnerung'));
  check('listing does not show reminders created by other senders', !replies2[0].includes('Brot mitbringen'));
}

// --- personal/private reminder: skips the "who is it for" question ---
{
  const replies = await converse('privatperson@s.whatsapp.net', [
    '2', // personal reminder
    'Medikament nehmen',
    '6', // daily
    '08:00',
    'ja',
  ]);
  check('private flow completes without an assignee question', replies.at(-1).includes('Erledigt'));
  const created = listActiveReminders().find((r) => r.messageText === 'Medikament nehmen');
  check('private reminder assignee auto-set to "ich"', created.assignee === 'ich');
  check('private reminder targetType is "private"', created.targetType === 'private');
  check('private reminder targets the creator\'s own chat', created.targetChatId === 'privatperson@s.whatsapp.net');
  check('private reminder stores the chosen fire time', created.fireTime === '08:00');
  check('private reminder recurrenceType is "daily"', created.recurrenceType === 'daily');
}

// --- group reminder still defaults to the standard fire time (no time question asked) ---
{
  const replies = await converse('gruppenperson@s.whatsapp.net', [
    '1',
    'Gruppen-Erinnerung Test',
    'alle',
    '6', // daily
    'ja',
  ]);
  check('group daily flow completes without a time question', replies.at(-1).includes('Erledigt'));
  const created = listActiveReminders().find((r) => r.messageText === 'Gruppen-Erinnerung Test');
  check('group reminder targetType is "group"', created.targetType === 'group');
  check('group reminder targets the configured group chat', created.targetChatId === GROUP_CHAT_ID);
  check('group reminder uses the default fire time', created.fireTime === '07:00');
}

// --- invalid time input during private flow re-prompts rather than crashing ---
{
  const replies = await converse('badtime@s.whatsapp.net', [
    '2',
    'Test invalid time',
    '3', // weekly
    '2', // Tuesday
    '25:99', // invalid time
    '08:30', // valid
    'ja',
  ]);
  check('invalid time re-prompts', replies[4].includes('nicht verstanden'));
  check('recovers after valid time', replies.at(-1).includes('Erledigt'));
}

// --- unrecognized input at menu level shows the main menu, not an error ---
{
  const replies = await converse('confused@s.whatsapp.net', ['asdkjfh']);
  check('gibberish at menu level shows main menu', replies[0].includes('Was moechtest du tun'));
}

// --- cancel hint appears while mid-flow, but not on finished/menu replies ---
{
  const replies = await converse('hinttest@s.whatsapp.net', ['1', 'Hint Test']);
  check('cancel hint appears on the message-text prompt (mid-flow)', replies[0].includes('abbrechen'));
  check('cancel hint appears on the assignee prompt (mid-flow)', replies[1].includes('abbrechen'));

  const menuReply = await handleWizardMessage('hinttest2@s.whatsapp.net', 'blah');
  check('cancel hint does NOT appear on the main menu (nothing to cancel)', !menuReply.includes('abbrechen'));

  const finishedReplies = await converse('hinttest3@s.whatsapp.net', [
    '1', 'Finished flow test', 'alle', '3', '2', 'ja',
  ]);
  check('cancel hint does NOT appear on the final "Erledigt" message', !finishedReplies.at(-1).includes('abbrechen'));
}

// --- group-only listing (menu option 3) ---
{
  await converse('grouplist@s.whatsapp.net', ['1', 'Gruppenliste Test', 'alle', '3', '2', 'ja']);
  await converse('grouplist@s.whatsapp.net', ['2', 'Private Erinnerung fuer Liste', '6', '09:00', 'ja']);

  const replies = await converse('grouplist2@s.whatsapp.net', ['3']);
  check('group-only listing includes a group reminder', replies[0].includes('Gruppenliste Test'));
  check('group-only listing excludes private reminders', !replies[0].includes('Private Erinnerung fuer Liste'));
}

// --- person-specific listing (menu option 4) ---
{
  await converse('personlist@s.whatsapp.net', ['1', 'Peters Aufgabe', 'Peter', '3', '4', 'ja']);
  await converse('personlist@s.whatsapp.net', ['1', 'Annas Aufgabe', 'Anna', '3', '5', 'ja']);
  await converse('personlist@s.whatsapp.net', ['1', 'Fuer alle Aufgabe', 'alle', '3', '6', 'ja']);

  const replies = await converse('personlist2@s.whatsapp.net', ['4', 'Peter']);
  check('person listing option prompts for a name first', replies[0].includes('Fuer welche Person'));
  check('person listing shows that person\'s reminder', replies[1].includes('Peters Aufgabe'));
  check('person listing also includes "alle" reminders (they apply to everyone)', replies[1].includes('Fuer alle Aufgabe'));
  check('person listing excludes a different person\'s reminder', !replies[1].includes('Annas Aufgabe'));

  const emptyReplies = await converse('personlist3@s.whatsapp.net', ['4', 'NichtExistierendeePerson']);
  check(
    'person listing for an unknown name still correctly excludes named reminders (only "alle" ones legitimately match)',
    !emptyReplies[1].includes('Peters Aufgabe') && !emptyReplies[1].includes('Annas Aufgabe')
  );
}

// --- unified menu template: every menu leads with "0 - Abbrechen", right
// after the question, before the numbered choices - and cancelling always
// clears state AND shows the main menu again in the same reply. ---
{
  // Helper: every menu's lines, with any leading "" (blank prompt lines
  // some replies carry) stripped, so we can check exact line positions.
  const lines = (text) => text.split('\n');

  const mainMenuReply = await converse('templatecheck0@s.whatsapp.net', ['irgendwas-unbekanntes']);
  const mainLines = lines(mainMenuReply[0]);
  check('main menu: line 0 is the question', mainLines[0].includes('Was moechtest du tun'));
  check('main menu: line 1 is "0 - Abbrechen"', mainLines[1] === '0 - Abbrechen');
  check('main menu: line 2 is option 1', mainLines[2].startsWith('1 -'));

  const menus = await converse('menucancel@s.whatsapp.net', ['1', 'Testtext', 'Peter']);
  const recurrenceLines = lines(menus[2]);
  check('recurrence menu: line 0 is the question', recurrenceLines[0].includes('Wie oft'));
  check('recurrence menu: line 1 is "0 - Abbrechen"', recurrenceLines[1] === '0 - Abbrechen');
  check('recurrence menu: line 2 is option 1', recurrenceLines[2].startsWith('1 -'));

  const cancelled = await converse('menucancel2@s.whatsapp.net', ['1', 'Testtext', 'Peter', '0']);
  check('choosing 0 at the recurrence menu cancels', cancelled[3].startsWith('Vorgang abgebrochen.'));
  check('choosing 0 also shows the main menu again in the same reply', cancelled[3].includes('Was moechtest du tun'));
  const afterCancel = await converse('menucancel2@s.whatsapp.net', ['irgendwas']);
  check('after cancelling via 0, state is reset to the main menu', afterCancel[0].includes('Was moechtest du tun'));

  // weekday menu (weekly recurrence) - no question line of its own, the
  // caller prefixes one, but "0" must still be the very next line after it.
  const weekdayMenuReply = await converse('weekdaymenucheck@s.whatsapp.net', ['1', 'Testtext', 'Peter', '3']);
  const weekdayLines = lines(weekdayMenuReply[3]);
  check('weekday menu: line 1 (right after the prefixed question) is "0 - Abbrechen"', weekdayLines[1] === '0 - Abbrechen');
  check('weekday menu: line 2 is option 1 (Montag)', weekdayLines[2] === '1 - Montag');

  const cancelledWeekday = await converse('menucancel3@s.whatsapp.net', ['1', 'Testtext', 'Peter', '3', '0']);
  check('choosing 0 at the weekday menu cancels', cancelledWeekday[4].startsWith('Vorgang abgebrochen.'));
  check('choosing 0 at the weekday menu also shows the main menu again', cancelledWeekday[4].includes('Was moechtest du tun'));

  // monthly mode menu
  const monthlyModeReply = await converse('monthlymodecheck@s.whatsapp.net', ['1', 'Testtext', 'Peter', '4']);
  const monthlyModeLines = lines(monthlyModeReply[3]);
  check('monthly mode menu: line 1 is "0 - Abbrechen"', monthlyModeLines[1] === '0 - Abbrechen');

  const cancelledMonthly = await converse('menucancel4@s.whatsapp.net', ['1', 'Testtext', 'Peter', '4', '0']);
  check('choosing 0 at the monthly mode menu cancels', cancelledMonthly[4].startsWith('Vorgang abgebrochen.'));
  check('choosing 0 at the monthly mode menu also shows the main menu again', cancelledMonthly[4].includes('Was moechtest du tun'));

  // monthly weekday -> occurrence menu
  const occurrenceReply = await converse('occurrencecheck@s.whatsapp.net', ['1', 'Testtext', 'Peter', '4', '2', '1']);
  const occurrenceLines = lines(occurrenceReply[5]);
  check('occurrence menu: line 1 is "0 - Abbrechen"', occurrenceLines[1] === '0 - Abbrechen');

  const cancelledOccurrence = await converse('menucancel5@s.whatsapp.net', ['1', 'Testtext', 'Peter', '4', '2', '1', '0']);
  check('choosing 0 at the occurrence menu cancels', cancelledOccurrence[6].startsWith('Vorgang abgebrochen.'));
  check('choosing 0 at the occurrence menu also shows the main menu again', cancelledOccurrence[6].includes('Was moechtest du tun'));

  // typing "abbrechen" behaves identically to choosing "0" (same shared helper)
  const cancelledByWord = await converse('menucancel7@s.whatsapp.net', ['1', 'Testtext', 'Peter', 'abbrechen']);
  check('typing "abbrechen" also shows the main menu again, same as "0"', cancelledByWord[3].includes('Was moechtest du tun'));

  // 0 is still a legitimate free-text answer where it isn't a menu (e.g. 0 days lead time for a range)
  const rangeWithZeroLead = await converse(
    'menucancel6@s.whatsapp.net',
    ['1', 'Testtext', 'Peter', '2', '24.12.2026', '31.12.2026', '0']
  );
  check(
    '"0" is NOT treated as cancel outside a numbered menu (range lead days)',
    rangeWithZeroLead[6].includes('Bitte pruefen') && !rangeWithZeroLead[6].includes('abgebrochen')
  );
}

// --- expired-but-still-active reminders don't clutter the DM wizard's listings ---
{
  const senderId = 'expiredtest@s.whatsapp.net';
  await converse(senderId, ['1', 'Aktuell fuer Peter', 'Peter', '3', '6', 'ja']); // group, weekly Saturday
  await converse(senderId, ['1', 'Abgelaufen fuer Peter', 'Peter', '3', '6', 'ja']);

  const current = listActiveReminders().find((r) => r.messageText === 'Aktuell fuer Peter');
  const expired = listActiveReminders().find((r) => r.messageText === 'Abgelaufen fuer Peter');
  db.prepare('UPDATE reminders SET next_fire_date = ? WHERE id = ?').run(addDays(todayISO(), -3), expired.id);

  const groupListing = await converse(senderId, ['3']);
  check('group listing (option 3) shows a current reminder', groupListing[0].includes('Aktuell fuer Peter'));
  check('group listing (option 3) hides an expired (backdated) reminder', !groupListing[0].includes('Abgelaufen fuer Peter'));

  const personListing = await converse(senderId, ['4', 'Peter']);
  check('person listing (option 4) shows a current reminder', personListing[1].includes('Aktuell fuer Peter'));
  check('person listing (option 4) hides an expired (backdated) reminder', !personListing[1].includes('Abgelaufen fuer Peter'));

  const mineListing = await converse(senderId, ['5']);
  check('"created by me" listing (option 5) shows a current reminder', mineListing[0].includes('Aktuell fuer Peter'));
  check('"created by me" listing (option 5) hides an expired (backdated) reminder', !mineListing[0].includes('Abgelaufen fuer Peter'));
}

console.log(`\n${pass} passed, ${fail} failed`);
db.close();
process.exitCode = fail > 0 ? 1 : 0;
