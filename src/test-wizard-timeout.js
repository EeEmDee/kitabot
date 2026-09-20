/**
 * test-wizard-timeout.js
 *
 * Verifies the "still there?" nudge + auto-cancel logic, using a fake sock
 * and manually back-dated conversation_state rows (no real waiting).
 */

import { unlinkSync, existsSync } from 'node:fs';

const TEST_DB = './test-wizard-timeout.db';
for (const f of [TEST_DB, `${TEST_DB}-wal`, `${TEST_DB}-shm`]) {
  if (existsSync(f)) unlinkSync(f);
}
process.env.KITA_BOT_DB = TEST_DB;

const { setState, getState } = await import('./conversationState.js');
const { checkWizardTimeouts } = await import('./wizard.js');
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

function backdate(phoneId, minutesAgo) {
  db.prepare("UPDATE conversation_state SET updated_at = datetime('now', ? || ' minutes') WHERE phone_id = ?").run(
    -minutesAgo,
    phoneId
  );
}

// Fake send function that just records what was sent.
const sent = [];
const fakeSend = async (jid, text) => {
  sent.push({ to: jid, text });
};

// Case 1: fresh conversation (not stale) - should be left alone.
setState('fresh@s.whatsapp.net', 'awaiting_message_text', {});
await checkWizardTimeouts(fakeSend);
check('fresh conversation gets no nudge', sent.length === 0);

// Case 2: stale (4 min old, past the 3-min threshold) - should get nudged once.
setState('stale@s.whatsapp.net', 'awaiting_message_text', {});
backdate('stale@s.whatsapp.net', 4);
await checkWizardTimeouts(fakeSend);
check('stale conversation gets exactly one nudge', sent.length === 1 && sent[0].to === 'stale@s.whatsapp.net');

const stateAfterNudge = getState('stale@s.whatsapp.net');
check('state persists after nudge (not cleared yet)', stateAfterNudge !== null);
check('state is marked as nudged', stateAfterNudge.data._nudged === true);

// Running again immediately should NOT send a second nudge.
await checkWizardTimeouts(fakeSend);
check('does not nudge twice', sent.length === 1);

// Case 3: already nudged, and now old enough to hit the cancel threshold.
backdate('stale@s.whatsapp.net', 7); // 7 min since last update > 6 min cancel threshold
await checkWizardTimeouts(fakeSend);
check('cancel threshold sends exactly one cancellation message', sent.length === 2 && sent[1].to === 'stale@s.whatsapp.net');
check('cancellation message says the flow was aborted', sent[1].text.includes('abgebrochen'));
check('state is gone after cancel threshold', getState('stale@s.whatsapp.net') === null);

// Running again should not send anything more - state is already gone.
await checkWizardTimeouts(fakeSend);
check('nothing further sent once state is already cleared', sent.length === 2);

console.log(`\n${pass} passed, ${fail} failed`);
db.close();
process.exitCode = fail > 0 ? 1 : 0;
