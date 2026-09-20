/**
 * test-group-commands.js
 *
 * Simulates group-chat /löschen interactions, no WhatsApp involved.
 * Run with: node src/test-group-commands.js
 */

import { unlinkSync, existsSync } from 'node:fs';

const TEST_DB = './test-group-commands.db';
for (const f of [TEST_DB, `${TEST_DB}-wal`, `${TEST_DB}-shm`]) {
  if (existsSync(f)) unlinkSync(f);
}
process.env.KITA_BOT_DB = TEST_DB;

const { handleGroupMessage } = await import('./groupCommands.js');
const { createReminder, listActiveReminders } = await import('./reminders.js');
const { todayISO, addDays } = await import('./dates.js');
const { db } = await import('./db.js');
const { setState } = await import('./conversationState.js');

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

const GROUP_ID = '120363411993978415@g.us';
const today = todayISO();

function makeReminder(messageText, assignee = 'alle') {
  return createReminder({
    creatorId: 'someone@s.whatsapp.net',
    assignee,
    messageText,
    recurrenceType: 'once',
    recurrenceData: { date: addDays(today, 5) },
  });
}

// --- no active reminders ---
{
  const reply = handleGroupMessage(GROUP_ID, '/löschen');
  check('/löschen with nothing active says so', reply.includes('keine Erinnerungen aktiv'));
}

// --- basic happy path ---
{
  const r1 = makeReminder('Brot mitbringen', 'Peter');
  const r2 = makeReminder('Helm mitbringen', 'alle');

  const listReply = handleGroupMessage(GROUP_ID, '/löschen');
  check('cancel list includes both reminders', listReply.includes('Brot mitbringen') && listReply.includes('Helm mitbringen'));

  const selectReply = handleGroupMessage(GROUP_ID, String(r1.id));
  check('selecting a valid number confirms cancellation', selectReply.includes('storniert'));
  check('selecting a valid number mentions the right id', selectReply.includes(`#${r1.id}`));

  const stillActive = listActiveReminders();
  check('cancelled reminder no longer active', !stillActive.some((r) => r.id === r1.id));
  check('other reminder untouched', stillActive.some((r) => r.id === r2.id));
}

// --- bare numbers with no active /löschen flow are ignored entirely ---
{
  const reply = handleGroupMessage(GROUP_ID, '42');
  check('random number with no active flow produces no reply', reply === null);
}

// --- selecting a number not in the list ---
{
  const r3 = makeReminder('Elternabend', 'alle');
  handleGroupMessage(GROUP_ID, '/löschen'); // shows list containing r3.id (and maybe r2 too)
  const bogusId = r3.id + 9999;
  const reply = handleGroupMessage(GROUP_ID, String(bogusId));
  check('selecting a number not on the list gives a helpful message', reply.includes('keine gueltige Nummer'));

  // the flow should still be usable after an invalid attempt? Our design
  // clears state only on a *valid* selection or staleness, not on an
  // invalid number - but let's just confirm the valid one still works:
  const validReply = handleGroupMessage(GROUP_ID, String(r3.id));
  check('a valid selection still works after an invalid attempt', validReply.includes('storniert'));
}

// --- accepts a "#" prefix ---
{
  const r4 = makeReminder('Test Hash Prefix', 'alle');
  handleGroupMessage(GROUP_ID, '/löschen');
  const reply = handleGroupMessage(GROUP_ID, `#${r4.id}`);
  check('accepts "#3" style input, not just "3"', reply.includes('storniert'));
}

// --- non-numeric, non-/löschen text is always ignored ---
{
  makeReminder('Irrelevant fuer diesen Test', 'alle');
  handleGroupMessage(GROUP_ID, '/löschen');
  const reply = handleGroupMessage(GROUP_ID, 'Hallo zusammen, wie gehts?');
  check('ordinary chat text during an active /löschen flow is ignored', reply === null);
}

// --- staleness: an old cancel list should not react to a later number ---
{
  const r5 = makeReminder('Staleness Test', 'alle');
  handleGroupMessage(GROUP_ID, '/löschen');
  // Backdate the conversation_state row to simulate an old list.
  db.prepare("UPDATE conversation_state SET updated_at = datetime('now', '-10 minutes') WHERE phone_id = ?").run(GROUP_ID);
  const reply = handleGroupMessage(GROUP_ID, String(r5.id));
  check('stale cancel list does not react to a late number', reply === null);
  const stillActive = listActiveReminders().some((r) => r.id === r5.id);
  check('reminder was NOT cancelled after a stale reply', stillActive === true);
}

// --- cancelling an already-cancelled id gives a clear message, not a crash ---
{
  const r6 = makeReminder('Double Cancel Test', 'alle');
  handleGroupMessage(GROUP_ID, '/löschen');
  const first = handleGroupMessage(GROUP_ID, String(r6.id));
  check('first cancellation succeeds', first.includes('storniert'));

  // Re-open a cancel flow and try to select the same (now-inactive) id
  // artificially by re-injecting state, since it wouldn't appear in a
  // fresh list anymore - this tests the defensive cancelReminder() check.
  setState(GROUP_ID, 'awaiting_cancel_number', { ids: [r6.id] });
  const second = handleGroupMessage(GROUP_ID, String(r6.id));
  check('cancelling an already-cancelled id is handled gracefully', second.includes('bereits storniert'));
}

// --- /liste shows all active group reminders ---
{
  const r7 = makeReminder('Gruppenweite Erinnerung', 'alle');
  const reply = handleGroupMessage(GROUP_ID, '/liste');
  check('/liste shows an active group reminder', reply.includes('Gruppenweite Erinnerung'));
  check('/liste includes the id', reply.includes(`#${r7.id}`));
}

// --- /liste with nothing active says so ---
{
  // Cancel everything currently active so the group list is genuinely empty.
  for (const r of listActiveReminders()) {
    handleGroupMessage(GROUP_ID, '/löschen');
    handleGroupMessage(GROUP_ID, String(r.id));
  }
  const reply = handleGroupMessage(GROUP_ID, '/liste');
  check('/liste with nothing active says so', reply.includes('keine Erinnerungen fuer die Gruppe'));
}

// --- /liste <name> shows only that person's reminders (plus "alle" ones) ---
{
  makeReminder('Peters Sache', 'Peter');
  makeReminder('Annas Sache', 'Anna');
  makeReminder('Fuer alle', 'alle');

  const reply = handleGroupMessage(GROUP_ID, '/liste Peter');
  check('/liste <name> shows that person\'s reminder', reply.includes('Peters Sache'));
  check('/liste <name> includes "alle" reminders too', reply.includes('Fuer alle'));
  check('/liste <name> excludes a different person\'s reminder', !reply.includes('Annas Sache'));
}

// --- /liste <name> with no matching NAMED reminder still correctly excludes others ---
{
  const reply = handleGroupMessage(GROUP_ID, '/liste VollkommenUnbekannt');
  check(
    '/liste <name> for an unknown name excludes other people\'s named reminders',
    !reply.includes('Peters Sache') && !reply.includes('Annas Sache')
  );
}

// --- /liste @name (with an @ prefix, matching how people naturally type it) ---
{
  const reply = handleGroupMessage(GROUP_ID, '/liste @Peter');
  check('/liste @name strips the @ prefix and matches by name', reply.includes('Peters Sache'));
}

// --- /neu shows the main menu, pointing to a private chat ---
{
  const reply = handleGroupMessage(GROUP_ID, '/neu');
  check('/neu mentions writing a private message', reply.includes('private Nachricht'));
  check('/neu includes the main menu text', reply.includes('Was moechtest du tun'));
  check('/neu includes the menu option for a group reminder', reply.includes('Neue Erinnerung fuer die Gruppe anlegen'));
}

// --- /hilfe lists the available commands ---
{
  const reply = handleGroupMessage(GROUP_ID, '/hilfe');
  check('/hilfe mentions /neu', reply.includes('/neu'));
  check('/hilfe mentions /löschen', reply.includes('/löschen'));
  check('/hilfe mentions /liste', reply.includes('/liste'));
  check('/hilfe mentions itself', reply.includes('/hilfe'));
}

// --- /loeschen (ASCII, no umlaut) works as an alias for /löschen ---
{
  const r8 = makeReminder('Ascii Alias Test', 'alle');
  const listReply = handleGroupMessage(GROUP_ID, '/loeschen');
  check('/loeschen (ascii alias) opens the cancel list', listReply.includes('Ascii Alias Test'));
  const selectReply = handleGroupMessage(GROUP_ID, String(r8.id));
  check('/loeschen alias flow can cancel a reminder', selectReply.includes('storniert'));
}

// --- commands are matched case-insensitively ---
{
  const upperNeu = handleGroupMessage(GROUP_ID, '/NEU');
  check('/NEU (uppercase) works like /neu', upperNeu.includes('Was moechtest du tun'));

  const mixedHilfe = handleGroupMessage(GROUP_ID, '/HilFe');
  check('/HilFe (mixed case) works like /hilfe', mixedHilfe.includes('/neu'));

  const r9 = makeReminder('Case Insensitive Liste Test', 'alle');
  const upperListe = handleGroupMessage(GROUP_ID, '/LISTE');
  check('/LISTE (uppercase) works like /liste', upperListe.includes('Case Insensitive Liste Test'));

  const upperListeName = handleGroupMessage(GROUP_ID, '/LISTE Peter');
  check('/LISTE <name> (uppercase command, name case preserved) still matches by name', upperListeName.includes('Peters Sache'));

  const r10 = makeReminder('Case Insensitive Löschen Test', 'alle');
  const upperLoeschen = handleGroupMessage(GROUP_ID, '/LÖSCHEN');
  check('/LÖSCHEN (uppercase with umlaut) works like /löschen', upperLoeschen.includes('Case Insensitive Löschen Test'));
  const cancelReply = handleGroupMessage(GROUP_ID, String(r10.id));
  check('cancelling after an uppercase /LÖSCHEN still works', cancelReply.includes('storniert'));

  const r9StillListed = listActiveReminders().some((r) => r.id === r9.id);
  check('the earlier /LISTE reminder was untouched by the /LÖSCHEN test', r9StillListed === true);
}

// --- expired-but-still-active reminders don't clutter /liste or /löschen ---
{
  const current = makeReminder('Aktuell, sichtbar', 'alle');
  const expired = makeReminder('Abgelaufen, sollte nicht auftauchen', 'alle');
  db.prepare('UPDATE reminders SET next_fire_date = ? WHERE id = ?').run(addDays(today, -3), expired.id);

  const listeReply = handleGroupMessage(GROUP_ID, '/liste');
  check('/liste shows a current reminder', listeReply.includes('Aktuell, sichtbar'));
  check('/liste hides an expired (backdated) reminder', !listeReply.includes('Abgelaufen, sollte nicht auftauchen'));

  const cancelListReply = handleGroupMessage(GROUP_ID, '/löschen');
  check('/löschen list shows a current reminder', cancelListReply.includes('Aktuell, sichtbar'));
  check('/löschen list hides an expired (backdated) reminder', !cancelListReply.includes('Abgelaufen, sollte nicht auftauchen'));

  // clean up so it doesn't affect any earlier/later assertions relying on active reminder counts
  handleGroupMessage(GROUP_ID, String(current.id));
}

// --- unified menu template: /löschen's list leads with "0 - Abbrechen" too ---
{
  const r11 = makeReminder('Loeschen Template Test', 'alle');
  const listReply = handleGroupMessage(GROUP_ID, '/löschen');
  const lines = listReply.split('\n');
  check('/löschen list: line 0 is the question', lines[0].includes('Welche Erinnerung soll storniert werden'));
  check('/löschen list: line 1 is "0 - Abbrechen"', lines[1] === '0 - Abbrechen');

  const cancelledViaZero = handleGroupMessage(GROUP_ID, '0');
  check('choosing 0 in the /löschen list cancels the flow (not a reminder)', cancelledViaZero === 'Vorgang abgebrochen.');
  check('the reminder itself is untouched after choosing 0', listActiveReminders().some((r) => r.id === r11.id));

  // the flow is over after choosing 0, so a stray number afterwards is ordinary chat again
  const strayNumber = handleGroupMessage(GROUP_ID, String(r11.id));
  check('after choosing 0, a later bare number is ignored (no active flow anymore)', strayNumber === null);

  handleGroupMessage(GROUP_ID, '/löschen');
  const finalCancel = handleGroupMessage(GROUP_ID, String(r11.id));
  check('the reminder can still be cancelled normally afterwards', finalCancel.includes('storniert'));
}

console.log(`\n${pass} passed, ${fail} failed`);
db.close();
process.exitCode = fail > 0 ? 1 : 0;
