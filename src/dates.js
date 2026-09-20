/**
 * dates.js
 *
 * Pure date-math helpers for computing recurrence dates. No WhatsApp or DB
 * code here on purpose - this is the trickiest logic (monthly-by-weekday
 * especially), so it's isolated and easy to test standalone.
 *
 * All dates are plain 'YYYY-MM-DD' strings, interpreted as local calendar
 * dates (no time-of-day, no timezone math). We build JS Date objects at
 * noon local time internally to sidestep DST edge cases when adding days.
 */

export function todayISO() {
  return toISODate(new Date());
}

export function toISODate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function parseISO(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  // noon local time avoids DST-boundary day-shift bugs
  return new Date(y, m - 1, d, 12, 0, 0);
}

export function addDays(dateStr, days) {
  const date = parseISO(dateStr);
  date.setDate(date.getDate() + days);
  return toISODate(date);
}

export function compareDates(a, b) {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

export function isBeforeToday(dateStr) {
  return compareDates(dateStr, todayISO()) < 0;
}

/**
 * ISO weekday: 1 = Monday ... 7 = Sunday
 */
export function isoWeekday(dateStr) {
  const jsDay = parseISO(dateStr).getDay(); // 0 = Sunday ... 6 = Saturday
  return jsDay === 0 ? 7 : jsDay;
}

/**
 * Next date (today or later) that falls on the given ISO weekday (1-7).
 */
export function nextWeeklyDate(weekday, fromDateStr = todayISO()) {
  let candidate = fromDateStr;
  for (let i = 0; i < 7; i++) {
    if (isoWeekday(candidate) === weekday) return candidate;
    candidate = addDays(candidate, 1);
  }
  // Should never happen, but guard against infinite loops on bad input.
  throw new Error(`Could not find weekday ${weekday}`);
}

/**
 * Next date (today or later) that falls on the given day-of-month.
 * If the day doesn't exist in a given month (e.g. 31st in April), it rolls
 * to the next month that has it.
 */
export function nextMonthlyByDate(dayOfMonth, fromDateStr = todayISO()) {
  const from = parseISO(fromDateStr);
  let year = from.getFullYear();
  let month = from.getMonth(); // 0-indexed

  for (let i = 0; i < 24; i++) {
    // guard: search up to 2 years ahead
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    if (dayOfMonth <= daysInMonth) {
      const candidate = toISODate(new Date(year, month, dayOfMonth, 12, 0, 0));
      if (compareDates(candidate, fromDateStr) >= 0) return candidate;
    }
    month += 1;
    if (month > 11) {
      month = 0;
      year += 1;
    }
  }
  throw new Error(`Could not resolve monthly date ${dayOfMonth}`);
}

/**
 * Next date (today or later) that is the Nth occurrence of a weekday in a
 * month, e.g. occurrence=3, weekday=1 (Monday) => "3rd Monday of the month".
 * occurrence=-1 means "last <weekday> of the month".
 */
export function nextMonthlyByWeekday(weekday, occurrence, fromDateStr = todayISO()) {
  const from = parseISO(fromDateStr);
  let year = from.getFullYear();
  let month = from.getMonth();

  for (let i = 0; i < 24; i++) {
    const candidate = occurrence === -1
      ? lastWeekdayOfMonth(year, month, weekday)
      : nthWeekdayOfMonth(year, month, weekday, occurrence);

    if (candidate && compareDates(candidate, fromDateStr) >= 0) {
      return candidate;
    }
    month += 1;
    if (month > 11) {
      month = 0;
      year += 1;
    }
  }
  throw new Error(`Could not resolve monthly weekday ${weekday}/${occurrence}`);
}

function nthWeekdayOfMonth(year, month, weekday, occurrence) {
  const firstOfMonth = new Date(year, month, 1, 12, 0, 0);
  const firstWeekday = isoWeekday(toISODate(firstOfMonth));
  let offset = weekday - firstWeekday;
  if (offset < 0) offset += 7;
  const day = 1 + offset + (occurrence - 1) * 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  if (day > daysInMonth) return null; // e.g. "5th Monday" doesn't exist that month
  return toISODate(new Date(year, month, day, 12, 0, 0));
}

function lastWeekdayOfMonth(year, month, weekday) {
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  for (let day = daysInMonth; day > daysInMonth - 7; day--) {
    const candidate = toISODate(new Date(year, month, day, 12, 0, 0));
    if (isoWeekday(candidate) === weekday) return candidate;
  }
  throw new Error('Unreachable: no matching weekday in last 7 days of month');
}
