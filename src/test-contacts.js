/**
 * test-contacts.js
 *
 * Standalone test for the auto-learned contacts (name -> JID) store.
 * Run with: node src/test-contacts.js
 */

import { unlinkSync, existsSync } from 'node:fs';

const TEST_DB = './test-contacts.db';
for (const f of [TEST_DB, `${TEST_DB}-wal`, `${TEST_DB}-shm`]) {
  if (existsSync(f)) unlinkSync(f);
}
process.env.KITA_BOT_DB = TEST_DB;

const { upsertContact, findJidByName } = await import('./contacts.js');
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

// --- unknown name returns null ---
check('unknown name returns null', findJidByName('Peter') === null);

// --- basic upsert + lookup ---
upsertContact('4917600000001@s.whatsapp.net', 'Peter');
check('known name resolves to the right JID', findJidByName('Peter') === '4917600000001@s.whatsapp.net');

// --- case-insensitive lookup ---
check('lookup is case-insensitive (lowercase)', findJidByName('peter') === '4917600000001@s.whatsapp.net');
check('lookup is case-insensitive (uppercase)', findJidByName('PETER') === '4917600000001@s.whatsapp.net');

// --- leading/trailing whitespace in the lookup name is tolerated ---
check('lookup trims whitespace', findJidByName('  Peter  ') === '4917600000001@s.whatsapp.net');

// --- re-upserting the same JID with a changed display name updates it ---
upsertContact('4917600000001@s.whatsapp.net', 'Peter M.');
check('old name no longer resolves after a name change', findJidByName('Peter') === null);
check('new name resolves after the update', findJidByName('Peter M.') === '4917600000001@s.whatsapp.net');

// --- different people with different JIDs coexist ---
upsertContact('4917600000002@s.whatsapp.net', 'Anna');
check('a second contact resolves independently', findJidByName('Anna') === '4917600000002@s.whatsapp.net');
check('the first contact is unaffected by adding a second', findJidByName('Peter M.') === '4917600000001@s.whatsapp.net');

// --- upsert with missing jid/name is a safe no-op ---
upsertContact(null, 'Ghost');
upsertContact('4917600000003@s.whatsapp.net', null);
check('upsert with missing jid does not create a bogus entry', findJidByName('Ghost') === null);

console.log(`\n${pass} passed, ${fail} failed`);
db.close();
process.exitCode = fail > 0 ? 1 : 0;
