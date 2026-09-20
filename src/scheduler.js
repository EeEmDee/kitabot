/**
 * scheduler.js
 *
 * Checks, at regular intervals, whether any active reminder is due today
 * AND its fire_time has arrived - if so, sends it (to the group or the
 * creator's private chat, whichever it's targeted at) and advances it to
 * its next occurrence.
 *
 * Same design as wizard.js's checkWizardTimeouts: takes a plain `send`
 * function rather than a Baileys sock, so this is fully testable without
 * a real WhatsApp connection.
 *
 * Error handling: each reminder's send is wrapped individually. One
 * reminder failing to send (e.g. WhatsApp "forbidden" because the bot
 * isn't a member of its target group) does NOT stop the rest of that
 * tick's due reminders from firing, and does NOT retry forever - after
 * MAX_SEND_FAILURES consecutive failures the reminder is deactivated
 * automatically (see reminders.js: recordSendFailure/advanceAfterFiring,
 * config.js: MAX_SEND_FAILURES).
 */

import { getDueToday, advanceAfterFiring, formatFireMessage, recordSendFailure, cancelReminder } from './reminders.js';
import { findJidByName } from './contacts.js';
import { MAX_SEND_FAILURES } from './config.js';

function currentTimeHHMM(now) {
  const h = String(now.getHours()).padStart(2, '0');
  const m = String(now.getMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}

/**
 * Builds the actual message to send for a reminder. For group reminders
 * assigned to a specific (non-"alle") person we know the WhatsApp ID of
 * (they've posted in the group before), this properly @mentions them -
 * otherwise it falls back to plain text with their name.
 */
function buildFireMessage(reminder) {
  if (reminder.targetType === 'group' && reminder.assignee && reminder.assignee.toLowerCase() !== 'alle') {
    const jid = findJidByName(reminder.assignee);
    if (jid) {
      return { text: `@${reminder.assignee} ${reminder.messageText}`, mentions: [jid] };
    }
  }
  return { text: formatFireMessage(reminder), mentions: [] };
}

/**
 * Call this periodically (e.g. every minute). Fires any reminder that is
 * due today and whose fire_time has arrived (or already passed, in case
 * the bot was offline right at the scheduled moment - it'll catch up on
 * the next tick rather than skipping the day entirely).
 *
 * @param {(jid: string, text: string, extra?: object) => Promise<void>} send
 * @param {Date} [now] - override for testing; defaults to the real time.
 * @param {(message: string) => void} [log] - how to report a send failure
 *   or a give-up event. Defaults to console.error so it shows up in the
 *   normal terminal/log output; tests can pass their own to inspect it.
 */
export async function checkAndFireReminders(send, now = new Date(), log = console.error) {
  const currentTime = currentTimeHHMM(now);
  const due = getDueToday();

  for (const reminder of due) {
    if (reminder.fireTime > currentTime) continue;

    try {
      const { text, mentions } = buildFireMessage(reminder);
      await send(reminder.targetChatId, text, mentions.length > 0 ? { mentions } : {});
      advanceAfterFiring(reminder);
    } catch (err) {
      // Deliberately caught per-reminder: one broken reminder must not
      // stop the rest of this tick's due reminders from firing, and must
      // not make the whole checkAndFireReminders() call reject (which
      // would also skip the wizard-timeout check running alongside it).
      const updated = recordSendFailure(reminder.id);
      const errorText = err && err.message ? err.message : String(err);
      if (updated.failureCount >= MAX_SEND_FAILURES) {
        cancelReminder(reminder.id);
        log(
          `[Scheduler] Erinnerung #${reminder.id} ("${reminder.messageText}") wurde nach ${updated.failureCount} ` +
            `fehlgeschlagenen Sende-Versuchen in Folge automatisch deaktiviert. Letzter Fehler: ${errorText}`
        );
      } else {
        log(
          `[Scheduler] Senden von Erinnerung #${reminder.id} ("${reminder.messageText}") fehlgeschlagen ` +
            `(Versuch ${updated.failureCount}/${MAX_SEND_FAILURES}): ${errorText}`
        );
      }
    }
  }
}
