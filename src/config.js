/**
 * config.js
 *
 * Small shared constants. Kept in one place so the group chat ID isn't
 * duplicated across wizard.js, the scheduler, etc.
 */

// The Kita parent group's WhatsApp chat ID. Override via env var if it
// ever changes (e.g. group recreated).
export const GROUP_CHAT_ID = process.env.KITA_BOT_GROUP_ID || '120363431148241552@g.us';

// Default time-of-day for reminders that don't specify their own (all
// group reminders use this - only personal/private reminders let the
// creator pick a custom time).
export const DEFAULT_FIRE_TIME = process.env.KITA_BOT_DEFAULT_FIRE_TIME || '07:00';

// How many consecutive send failures a single reminder tolerates (e.g. the
// WhatsApp send throwing "forbidden" because the bot isn't a member of the
// target group) before the scheduler gives up on it and deactivates it,
// instead of retrying every minute forever. A successful send resets the
// counter back to 0. Watch the terminal/log output for a "wurde
// automatisch deaktiviert" message - that's how you find out a reminder
// hit this limit (it just quietly stops appearing in /liste afterwards).
export const MAX_SEND_FAILURES = 5;

// DEBUG ONLY. When true, the wizard also asks for a custom fire time
// (HH:MM) when creating a GROUP reminder, instead of always defaulting to
// DEFAULT_FIRE_TIME above. Useful for quickly testing that the scheduler
// actually fires (e.g. set a time one minute from now) without waiting
// for the normal daily time. Deliberately a code-only switch, not exposed
// via chat - flip it back to false for normal day-to-day use.
export const DEBUG_ASK_GROUP_FIRE_TIME = false;
