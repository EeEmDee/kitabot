/**
 * groupCommands.js
 *
 * Handles the commands the bot listens for in the group chat:
 *   /neu           - shows the menu (same one the DM wizard opens with) so
 *                    people know how to start; the actual step-by-step
 *                    creation still happens in a private chat with the
 *                    bot, to keep the group feed clean.
 *   /löschen       - numbered list of active reminders (with "0 -
 *                    Abbrechen" first, same as every other menu) -> reply
 *                    with a number to cancel it (anyone can cancel
 *                    anything), or "0" to back out without cancelling
 *                    anything
 *   /liste         - shows all active reminders for the group
 *   /liste <name>  - shows all active reminders assigned to that person
 *                    (plus "alle" ones, since those apply to everyone)
 *   /hilfe         - shows an overview of these commands
 *
 * All commands are matched case-insensitively (e.g. "/Liste", "/LISTE" and
 * "/liste" all work the same).
 *
 * No dependency on Baileys, same testability principle as wizard.js.
 *
 * The "pending cancel list" state is shared per-group (not per-person),
 * since anyone in the group can respond to it. We reuse the same
 * conversation_state table as the DM wizard, keyed by the group's chat ID
 * instead of a phone number - it's just a generic string key.
 */

import { getState, setState, clearState } from './conversationState.js';
import {
  listActiveReminders,
  cancelReminder,
  formatReminderLine,
  listGroupReminders,
  listForAssignee,
} from './reminders.js';
import { MAIN_MENU } from './wizard.js';

const CANCEL_LIST_TTL_MINUTES = 5;

const HELP_TEXT = [
  'Verfuegbare Befehle in der Gruppe:',
  '/neu - Menue anzeigen, um eine neue Erinnerung anzulegen (per Privatchat mit dem Bot)',
  '/löschen - Eine bestehende Erinnerung stornieren',
  '/liste - Alle Erinnerungen fuer die Gruppe anzeigen',
  '/liste <Name> - Erinnerungen fuer eine bestimmte Person anzeigen',
  '/hilfe - Diese Uebersicht anzeigen',
].join('\n');

const NEW_REMINDER_INTRO = 'Um eine neue Erinnerung anzulegen, schreib mir eine private Nachricht. Dort kannst du aus diesem Menue waehlen:\n\n';

function minutesSince(isoTimestamp) {
  return (Date.now() - new Date(isoTimestamp + 'Z').getTime()) / 60000;
}

function parseSelection(text) {
  const cleaned = text.trim().replace(/^#/, '');
  if (!/^\d+$/.test(cleaned)) return null;
  return Number.parseInt(cleaned, 10);
}

/**
 * Processes one incoming group-chat message. Returns the reply text to
 * post in the group, or null if the bot should say nothing at all (e.g.
 * ordinary chat unrelated to any command).
 */
export function handleGroupMessage(chatId, rawText) {
  const text = (rawText || '').trim();
  const lower = text.toLowerCase();

  if (lower === '/neu') {
    return `${NEW_REMINDER_INTRO}${MAIN_MENU}`;
  }

  if (lower === '/löschen' || lower === '/loeschen') {
    return startCancelFlow(chatId);
  }

  if (lower === '/hilfe' || lower === '/help') {
    return HELP_TEXT;
  }

  if (lower === '/liste') {
    return listGroupOnly();
  }

  if (lower.startsWith('/liste ')) {
    const name = text.slice('/liste '.length).trim().replace(/^@/, '');
    if (!name) return listGroupOnly();
    return listForPerson(name);
  }

  const selection = parseSelection(text);
  if (selection === null) {
    return null; // ordinary chat, nothing to do with any command
  }

  return handleSelection(chatId, selection);
}

function listGroupOnly() {
  const reminders = listGroupReminders();
  if (reminders.length === 0) return 'Aktuell sind keine Erinnerungen fuer die Gruppe aktiv.';
  return ['Erinnerungen fuer die Gruppe:', ...reminders.map(formatReminderLine)].join('\n');
}

function listForPerson(name) {
  const reminders = listForAssignee(name);
  if (reminders.length === 0) return `Keine aktiven Erinnerungen fuer "${name}" gefunden.`;
  return [`Erinnerungen fuer ${name}:`, ...reminders.map(formatReminderLine)].join('\n');
}

// Same template as the DM wizard's menus: the question, then "0 -
// Abbrechen" right below it, then the actual choices (here: the
// reminders themselves, standing in for numbered options).
function startCancelFlow(chatId) {
  const reminders = listActiveReminders();
  if (reminders.length === 0) {
    return 'Aktuell sind keine Erinnerungen aktiv.';
  }

  setState(chatId, 'awaiting_cancel_number', { ids: reminders.map((r) => r.id) });

  const lines = [
    'Welche Erinnerung soll storniert werden?',
    '0 - Abbrechen',
    ...reminders.map(formatReminderLine),
    '',
    'Antworte mit der Nummer (z.B. "3").',
  ];
  return lines.join('\n');
}

function handleSelection(chatId, selection) {
  const state = getState(chatId);

  // No active /löschen flow in this group - a bare number is just normal
  // chat (e.g. someone typing a phone number, a count, a date). Say nothing.
  if (!state || state.step !== 'awaiting_cancel_number') {
    return null;
  }

  if (minutesSince(state.updatedAt) > CANCEL_LIST_TTL_MINUTES) {
    clearState(chatId);
    return null; // list is stale; treat this as unrelated chat rather than guessing
  }

  if (selection === 0) {
    clearState(chatId);
    return 'Vorgang abgebrochen.';
  }

  if (!state.data.ids.includes(selection)) {
    return `#${selection} ist keine gueltige Nummer aus der Liste. Bitte "/löschen" erneut schreiben, um die Liste erneut zu sehen.`;
  }

  clearState(chatId);
  const cancelled = cancelReminder(selection);
  if (!cancelled) {
    return `#${selection} wurde bereits storniert oder existiert nicht mehr.`;
  }
  return `Erledigt! Erinnerung #${selection} wurde storniert.`;
}
