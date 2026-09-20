/**
 * wizard.js
 *
 * The private-chat "control panel": a menu-driven state machine for
 * creating reminders and listing them. Deliberately has no dependency on
 * Baileys - it takes (senderId, text) and returns a reply string, which
 * makes the whole flow testable without a real WhatsApp connection (see
 * test-wizard.js).
 *
 * Design principle: every step is either a number-menu choice or a plain
 * name/date/number entry. No free-text command syntax a parent has to
 * remember.
 */

import { getState, setState, clearState, getStaleStates } from './conversationState.js';
import {
  createReminder,
  createCountdownReminders,
  listActiveReminders,
  getUpcoming,
  listGroupReminders,
  listForAssignee,
  formatReminderLine,
  formatDateDE,
} from './reminders.js';
import { todayISO, compareDates } from './dates.js';
import { GROUP_CHAT_ID, DEFAULT_FIRE_TIME, DEBUG_ASK_GROUP_FIRE_TIME } from './config.js';

const WEEKDAY_NAMES_DE = ['', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'];

// Every menu below follows the same template: the question, then "0 -
// Abbrechen" immediately below it, then the actual choices. "0" always
// means the same thing everywhere - cancel whatever's in progress and
// reset back to the main menu - so a person never has to remember whether
// it's available or where it sits in the list.
const CANCEL_OPTION_LINE = '0 - Abbrechen';

export const MAIN_MENU = [
  'Hallo! Was moechtest du tun?',
  CANCEL_OPTION_LINE,
  '1 - Neue Erinnerung fuer die Gruppe anlegen',
  '2 - Neue persoenliche Erinnerung anlegen (nur fuer dich, privat)',
  '3 - Alle Erinnerungen fuer die Gruppe anzeigen',
  '4 - Erinnerungen fuer eine bestimmte Person anzeigen',
  '5 - Von mir erstellte Erinnerungen anzeigen',
  '6 - Diese Woche anzeigen',
  '',
  'Antworte einfach mit der Zahl.',
].join('\n');

const RECURRENCE_MENU = [
  'Wie oft soll die Erinnerung gelten?',
  CANCEL_OPTION_LINE,
  '1 - Einmalig (an einem bestimmten Datum)',
  '2 - Zeitraum (z.B. "Kita geschlossen von... bis...")',
  '3 - Jede Woche',
  '4 - Jeden Monat',
  '5 - Countdown zu einem Datum (z.B. Geburtstag)',
  '6 - Jeden Tag',
].join('\n');

// No question line baked in here - callers prefix their own (e.g. "An
// welchem Wochentag?") before this. "0" still comes first, right after
// that prefixed question, matching every other menu's template.
const WEEKDAY_MENU = [
  CANCEL_OPTION_LINE,
  '1 - Montag',
  '2 - Dienstag',
  '3 - Mittwoch',
  '4 - Donnerstag',
  '5 - Freitag',
  '6 - Samstag',
  '7 - Sonntag',
].join('\n');

const MONTHLY_MODE_MENU = [
  'Wie soll der monatliche Termin festgelegt werden?',
  CANCEL_OPTION_LINE,
  '1 - Nach Datum (z.B. immer am 3. des Monats)',
  '2 - Nach Wochentag (z.B. immer der 3. Montag im Monat)',
].join('\n');

const OCCURRENCE_MENU = [
  'Der wievielte Wochentag im Monat?',
  CANCEL_OPTION_LINE,
  '1 - 1.',
  '2 - 2.',
  '3 - 3.',
  '4 - 4.',
  '5 - Letzter',
].join('\n');

const CANCEL_WORDS = ['abbrechen', 'stop', 'abort'];

// ---- small input parsers -------------------------------------------------

function parseMenuNumber(text, min, max) {
  const n = Number.parseInt(String(text).trim(), 10);
  if (!Number.isInteger(n) || n < min || n > max) return null;
  return n;
}

/**
 * Accepts TT.MM.JJJJ (e.g. "24.12.2026"). Returns an ISO date string, or
 * null if the input isn't a real calendar date.
 */
function parseDateDE(text) {
  const match = String(text).trim().match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (!match) return null;
  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  const date = new Date(year, month - 1, day);
  // Round-trip check: catches things like 31.02.2026
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return null;
  }
  const iso = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  return iso;
}

function parseIntList(text) {
  const parts = String(text)
    .split(',')
    .map((p) => Number.parseInt(p.trim(), 10))
    .filter((n) => Number.isInteger(n) && n >= 0 && n <= 365);
  const unique = [...new Set(parts)].sort((a, b) => b - a);
  return unique;
}

function parseYesNo(text) {
  const t = String(text).trim().toLowerCase();
  if (['ja', 'j', 'yes', 'y'].includes(t)) return true;
  if (['nein', 'n', 'no'].includes(t)) return false;
  return null;
}

/**
 * Accepts 24h HH:MM (e.g. "08:00", "18:30"). Returns the normalized
 * string, or null if not a valid time.
 */
function parseTimeHHMM(text) {
  const match = String(text).trim().match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  if (!match) return null;
  return `${match[1]}:${match[2]}`;
}

function describeDraftRecurrence(data) {
  switch (data.recurrenceType) {
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
      return `${data.leadDaysList.join(', ')} Tag(e) vor dem ${formatDateDE(data.targetDate)}`;
    case 'daily':
      return 'jeden Tag';
    default:
      return '';
  }
}

// ---- listing helpers ------------------------------------------------------

function listCreatedByMe(senderId) {
  const mine = listActiveReminders().filter((r) => r.creatorId === senderId);
  if (mine.length === 0) return 'Du hast noch keine Erinnerungen erstellt.';
  return ['Deine Erinnerungen:', ...mine.map(formatReminderLine)].join('\n');
}

function listThisWeek() {
  const upcoming = getUpcoming(7);
  if (upcoming.length === 0) return 'Fuer diese Woche sind keine Erinnerungen eingetragen.';
  return ['Diese Woche:', ...upcoming.map(formatReminderLine)].join('\n');
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

/**
 * Shared cancellation behavior: clears whatever's in progress AND shows
 * the main menu again in the same reply, so the person can immediately
 * start something else instead of being left to guess what to type next.
 * Used both by the global "abbrechen" text command and by choosing "0" in
 * any numbered menu - both mean exactly the same thing.
 */
function cancelAndShowMainMenu() {
  return `Vorgang abgebrochen.\n\n${MAIN_MENU}`;
}

// ---- main entry point -------------------------------------------------

/**
 * Processes one incoming private-chat message and returns the reply text.
 * Persists conversation state as a side effect.
 *
 * Any reply that leaves the person mid-flow (i.e. we're still waiting on
 * more input from them) gets a visible reminder that they can type
 * "abbrechen" to stop - rather than that only working silently. Finished
 * flows (a completed reminder, a listing, a rejected confirmation) don't
 * get the hint, since there's nothing left to cancel.
 */
export async function handleWizardMessage(senderId, rawText) {
  const text = (rawText || '').trim();
  const state = getState(senderId);

  // Global cancel, works at any step.
  if (state && CANCEL_WORDS.includes(text.toLowerCase())) {
    clearState(senderId);
    return cancelAndShowMainMenu();
  }

  const reply = !state ? handleMenuInput(senderId, text) : handleStepInput(senderId, state, text);

  const stillInProgress = getState(senderId) !== null;
  return stillInProgress ? `${reply}\n\n(Antworte mit "abbrechen", um den Vorgang zu stoppen.)` : reply;
}

function handleMenuInput(senderId, text) {
  const choice = text.toLowerCase();

  if (choice === '1' || choice === 'neu' || choice === 'erinnerung') {
    setState(senderId, 'awaiting_message_text', { targetType: 'group' });
    return 'Was soll die Erinnerung beinhalten? (z.B. "Brot mitbringen")';
  }
  if (choice === '2' || choice === 'privat' || choice === 'persoenlich') {
    setState(senderId, 'awaiting_message_text', { targetType: 'private' });
    return 'Was soll die persoenliche Erinnerung beinhalten? (z.B. "Medikament nehmen")';
  }
  if (choice === '3' || choice === 'gruppe') {
    return listGroupOnly();
  }
  if (choice === '4' || choice === 'person') {
    setState(senderId, 'awaiting_person_name_for_listing', {});
    return 'Fuer welche Person? Gib den Namen ein.';
  }
  if (choice === '5' || choice === 'meine') {
    return listCreatedByMe(senderId);
  }
  if (choice === '6' || choice === 'woche') {
    return listThisWeek();
  }
  return MAIN_MENU;
}

/**
 * Menu-driven steps (numbered choices) show a visible "0 - Abbrechen"
 * option, always first. This checks for it and, if chosen, cancels and
 * shows the main menu again. Returns that reply, or null if "0" wasn't
 * chosen (so the caller should continue handling the input normally).
 */
function checkMenuCancel(senderId, text) {
  if (text.trim() === '0') {
    clearState(senderId);
    return cancelAndShowMainMenu();
  }
  return null;
}

function handleStepInput(senderId, state, text) {
  const { step, data } = state;

  switch (step) {
    case 'awaiting_message_text': {
      if (!text) return 'Bitte gib einen Text fuer die Erinnerung ein.';
      const newData = { ...data, messageText: text };
      if (newData.targetType === 'private') {
        setState(senderId, 'awaiting_recurrence_type', { ...newData, assignee: 'ich' });
        return RECURRENCE_MENU;
      }
      setState(senderId, 'awaiting_assignee', newData);
      return 'Fuer wen ist das? Gib einen Namen ein, oder schreibe "alle".';
    }

    case 'awaiting_assignee': {
      if (!text) return 'Bitte gib einen Namen ein, oder schreibe "alle".';
      const assignee = text.toLowerCase() === 'alle' ? 'alle' : text;
      setState(senderId, 'awaiting_recurrence_type', { ...data, assignee });
      return RECURRENCE_MENU;
    }

    case 'awaiting_recurrence_type': {
      const cancelled = checkMenuCancel(senderId, text);
      if (cancelled) return cancelled;
      const choice = parseMenuNumber(text, 1, 6);
      if (!choice) return `Bitte antworte mit 0 zum Abbrechen oder einer Zahl von 1-6.\n\n${RECURRENCE_MENU}`;
      if (choice === 1) {
        setState(senderId, 'awaiting_once_date', data);
        return 'An welchem Datum? Format TT.MM.JJJJ (z.B. 24.12.2026)';
      }
      if (choice === 2) {
        setState(senderId, 'awaiting_range_start', data);
        return 'Ab welchem Datum beginnt es? Format TT.MM.JJJJ';
      }
      if (choice === 3) {
        setState(senderId, 'awaiting_weekly_day', data);
        return `An welchem Wochentag?\n${WEEKDAY_MENU}`;
      }
      if (choice === 4) {
        setState(senderId, 'awaiting_monthly_mode', data);
        return MONTHLY_MODE_MENU;
      }
      if (choice === 6) {
        return proceedAfterRecurrenceDetails(senderId, { ...data, recurrenceType: 'daily' });
      }
      // choice === 5 (countdown)
      setState(senderId, 'awaiting_countdown_target', data);
      return 'Auf welches Datum soll gezaehlt werden? Format TT.MM.JJJJ (z.B. Geburtstag)';
    }

    case 'awaiting_once_date': {
      const iso = parseDateDE(text);
      if (!iso) return 'Das habe ich nicht verstanden. Bitte gib ein Datum im Format TT.MM.JJJJ ein.';
      if (compareDates(iso, todayISO()) < 0) return 'Das Datum liegt in der Vergangenheit. Bitte gib ein zukuenftiges Datum ein.';
      const newData = { ...data, recurrenceType: 'once', date: iso };
      return proceedAfterRecurrenceDetails(senderId, newData);
    }

    case 'awaiting_range_start': {
      const iso = parseDateDE(text);
      if (!iso) return 'Das habe ich nicht verstanden. Bitte gib ein Datum im Format TT.MM.JJJJ ein.';
      if (compareDates(iso, todayISO()) < 0) return 'Das Datum liegt in der Vergangenheit. Bitte gib ein zukuenftiges Datum ein.';
      setState(senderId, 'awaiting_range_end', { ...data, start: iso });
      return 'Bis wann geht es? Format TT.MM.JJJJ';
    }

    case 'awaiting_range_end': {
      const iso = parseDateDE(text);
      if (!iso) return 'Das habe ich nicht verstanden. Bitte gib ein Datum im Format TT.MM.JJJJ ein.';
      if (compareDates(iso, data.start) < 0) return 'Das Enddatum darf nicht vor dem Startdatum liegen. Bitte nochmal eingeben.';
      setState(senderId, 'awaiting_range_lead', { ...data, end: iso });
      return 'Wie viele Tage vorher soll daran erinnert werden? (z.B. 3)';
    }

    case 'awaiting_range_lead': {
      const n = Number.parseInt(text.trim(), 10);
      if (!Number.isInteger(n) || n < 0 || n > 90) return 'Bitte gib eine Zahl zwischen 0 und 90 ein.';
      const newData = { ...data, recurrenceType: 'range', leadDays: n };
      return proceedAfterRecurrenceDetails(senderId, newData);
    }

    case 'awaiting_weekly_day': {
      const cancelled = checkMenuCancel(senderId, text);
      if (cancelled) return cancelled;
      const weekday = parseMenuNumber(text, 1, 7);
      if (!weekday) return `Bitte antworte mit 0 zum Abbrechen oder einer Zahl von 1-7.\n${WEEKDAY_MENU}`;
      const newData = { ...data, recurrenceType: 'weekly', weekday };
      return proceedAfterRecurrenceDetails(senderId, newData);
    }

    case 'awaiting_monthly_mode': {
      const cancelled = checkMenuCancel(senderId, text);
      if (cancelled) return cancelled;
      const choice = parseMenuNumber(text, 1, 2);
      if (!choice) return `Bitte antworte mit 0 zum Abbrechen oder mit 1 oder 2.\n\n${MONTHLY_MODE_MENU}`;
      if (choice === 1) {
        setState(senderId, 'awaiting_monthly_date_day', data);
        return 'Am wievielten Tag des Monats? (Zahl von 1-31)';
      }
      setState(senderId, 'awaiting_monthly_weekday_day', data);
      return `An welchem Wochentag?\n${WEEKDAY_MENU}`;
    }

    case 'awaiting_monthly_date_day': {
      const day = parseMenuNumber(text, 1, 31);
      if (!day) return 'Bitte gib eine Zahl von 1-31 ein.';
      const newData = { ...data, recurrenceType: 'monthly_date', day };
      return proceedAfterRecurrenceDetails(senderId, newData);
    }

    case 'awaiting_monthly_weekday_day': {
      const cancelled = checkMenuCancel(senderId, text);
      if (cancelled) return cancelled;
      const weekday = parseMenuNumber(text, 1, 7);
      if (!weekday) return `Bitte antworte mit 0 zum Abbrechen oder einer Zahl von 1-7.\n${WEEKDAY_MENU}`;
      setState(senderId, 'awaiting_monthly_weekday_occurrence', { ...data, weekday });
      return OCCURRENCE_MENU;
    }

    case 'awaiting_monthly_weekday_occurrence': {
      const cancelled = checkMenuCancel(senderId, text);
      if (cancelled) return cancelled;
      const choice = parseMenuNumber(text, 1, 5);
      if (!choice) return `Bitte antworte mit 0 zum Abbrechen oder einer Zahl von 1-5.\n\n${OCCURRENCE_MENU}`;
      const occurrence = choice === 5 ? -1 : choice;
      const newData = { ...data, recurrenceType: 'monthly_weekday', occurrence };
      return proceedAfterRecurrenceDetails(senderId, newData);
    }

    case 'awaiting_countdown_target': {
      const iso = parseDateDE(text);
      if (!iso) return 'Das habe ich nicht verstanden. Bitte gib ein Datum im Format TT.MM.JJJJ ein.';
      if (compareDates(iso, todayISO()) < 0) return 'Das Datum liegt in der Vergangenheit. Bitte gib ein zukuenftiges Datum ein.';
      setState(senderId, 'awaiting_countdown_leaddays', { ...data, targetDate: iso });
      return 'Wie viele Tage vorher soll erinnert werden? Mehrere moeglich, durch Komma getrennt (z.B. 30,7,1)';
    }

    case 'awaiting_countdown_leaddays': {
      const leadDaysList = parseIntList(text);
      if (leadDaysList.length === 0) return 'Bitte gib mindestens eine gueltige Zahl ein (z.B. 30,7,1).';
      const newData = { ...data, recurrenceType: 'countdown', leadDaysList };
      return proceedAfterRecurrenceDetails(senderId, newData);
    }

    case 'awaiting_fire_time': {
      const time = parseTimeHHMM(text);
      if (!time) return 'Das habe ich nicht verstanden. Bitte gib eine Uhrzeit im Format HH:MM ein (z.B. 08:00).';
      const newData = { ...data, fireTime: time };
      setState(senderId, 'awaiting_confirmation', newData);
      return confirmationText(newData);
    }

    case 'awaiting_person_name_for_listing': {
      if (!text) return 'Bitte gib einen Namen ein.';
      clearState(senderId);
      return listForPerson(text);
    }

    case 'awaiting_confirmation': {
      const answer = parseYesNo(text);
      if (answer === null) return 'Bitte antworte mit "ja" oder "nein".';
      if (answer === false) {
        clearState(senderId);
        return 'Vorgang abgebrochen. Schreib "neu", um von vorne zu beginnen.';
      }
      return finalizeReminder(senderId, data);
    }

    default:
      // Unknown/corrupted state - reset gracefully rather than getting stuck.
      clearState(senderId);
      return `Da ist etwas schiefgelaufen. Fangen wir nochmal an.\n\n${MAIN_MENU}`;
  }
}

function confirmationText(data) {
  const target = data.targetType === 'private' ? 'Privat (nur du)' : 'Gruppe';
  const lines = [
    'Bitte pruefen:',
    `Text: ${data.messageText}`,
    `Fuer: ${data.assignee}`,
    `Wann: ${describeDraftRecurrence(data)}`,
    `Uhrzeit: ${data.fireTime} Uhr`,
    `Ziel: ${target}`,
    '',
    'Passt das? (ja/nein)',
  ];
  return lines.join('\n');
}

/**
 * Called once all recurrence details are collected. Private reminders let
 * the creator pick their own time of day; group reminders normally use the
 * standard default time, so there's nothing more to ask them - unless
 * DEBUG_ASK_GROUP_FIRE_TIME is switched on in config.js, in which case
 * group reminders also get asked (handy for testing the scheduler).
 */
function proceedAfterRecurrenceDetails(senderId, newData) {
  if (newData.targetType === 'private' || DEBUG_ASK_GROUP_FIRE_TIME) {
    setState(senderId, 'awaiting_fire_time', newData);
    return 'Um wie viel Uhr soll erinnert werden? Format HH:MM (z.B. 08:00)';
  }
  const finalData = { ...newData, fireTime: DEFAULT_FIRE_TIME };
  setState(senderId, 'awaiting_confirmation', finalData);
  return confirmationText(finalData);
}

function finalizeReminder(senderId, data) {
  clearState(senderId);
  const targetChatId = data.targetType === 'private' ? senderId : GROUP_CHAT_ID;

  if (data.recurrenceType === 'countdown') {
    const { created, skipped } = createCountdownReminders({
      creatorId: senderId,
      assignee: data.assignee,
      messageText: data.messageText,
      targetDate: data.targetDate,
      leadDaysList: data.leadDaysList,
      targetType: data.targetType,
      targetChatId,
      fireTime: data.fireTime,
    });
    const lines = [`Erledigt! ${created.length} Erinnerung(en) angelegt:`, ...created.map(formatReminderLine)];
    if (skipped.length > 0) {
      lines.push('', `Hinweis: ${skipped.join(', ')} Tag(e) vorher wurde(n) uebersprungen, da das schon in der Vergangenheit liegt.`);
    }
    return lines.join('\n');
  }

  const { recurrenceType, messageText, assignee, targetType, fireTime, ...rest } = data;
  const reminder = createReminder({
    creatorId: senderId,
    assignee,
    messageText,
    recurrenceType,
    recurrenceData: rest,
    targetType,
    targetChatId,
    fireTime,
  });
  return `Erledigt! Erinnerung angelegt:\n${formatReminderLine(reminder)}`;
}

// ---- timeout handling -------------------------------------------------

const NUDGE_AFTER_MINUTES = 3;
const CANCEL_AFTER_MINUTES = 6;

/**
 * Call periodically (e.g. every minute). Sends one "still there?" nudge to
 * anyone stuck mid-wizard for a while, then silently cancels their flow if
 * they still haven't responded after that.
 *
 * @param {(jid: string, text: string) => Promise<void>} send - how to
 *   actually deliver a message. Kept generic (rather than taking a Baileys
 *   sock directly) so this stays testable without a real connection.
 */
export async function checkWizardTimeouts(send) {
  const stale = getStaleStates(NUDGE_AFTER_MINUTES);
  for (const entry of stale) {
    const alreadyNudged = entry.data && entry.data._nudged;
    const minutesInactive = (Date.now() - new Date(entry.updatedAt + 'Z').getTime()) / 60000;

    if (!alreadyNudged) {
      setState(entry.phoneId, entry.step, { ...entry.data, _nudged: true });
      await send(entry.phoneId, 'Bist du noch da? Antworte, um fortzufahren, sonst wird der Vorgang abgebrochen.');
    } else if (minutesInactive >= CANCEL_AFTER_MINUTES) {
      clearState(entry.phoneId);
      await send(entry.phoneId, 'Keine Antwort erhalten. Der Vorgang wurde abgebrochen. Schreib "neu", um es erneut zu versuchen.');
    }
  }
}
