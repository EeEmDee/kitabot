/**
 * bot.js
 *
 * The real entry point (npm start). Wires the WhatsApp connection to the
 * DM wizard, the group commands (/neu, /löschen, /list, /hilfe), and the
 * daily reminder scheduler. Also auto-learns contacts (name -> JID) from
 * group activity, so reminders assigned to a specific person can @mention
 * them.
 */

import { connectWhatsApp, sendText } from './whatsapp.js';
import { handleWizardMessage, checkWizardTimeouts } from './wizard.js';
import { handleGroupMessage } from './groupCommands.js';
import { checkAndFireReminders } from './scheduler.js';
import { upsertContact } from './contacts.js';

const CHECK_INTERVAL_MS = 60 * 1000; // once a minute, for both timeouts and firing reminders

connectWhatsApp({
  onMessage: async ({ sock, chatId, senderId, isGroup, text, pushName }) => {
    if (isGroup) {
      if (pushName) {
        upsertContact(senderId, pushName);
      }

      console.log(`[Gruppe eingehend] von=${senderId} (${pushName || 'unbekannt'}) text="${text}"`);
      const reply = handleGroupMessage(chatId, text);
      if (reply) {
        console.log(`[Gruppe ausgehend] an=${chatId} text="${reply.slice(0, 80)}${reply.length > 80 ? '...' : ''}"`);
        await sendText(sock, chatId, reply);
      }
      return;
    }

    console.log(`[DM eingehend] von=${senderId} text="${text}"`);

    const reply = await handleWizardMessage(senderId, text);

    if (reply) {
      console.log(`[DM ausgehend] an=${senderId} text="${reply.slice(0, 80)}${reply.length > 80 ? '...' : ''}"`);
      await sendText(sock, senderId, reply);
    } else {
      console.log(`[DM] keine Antwort generiert fuer von=${senderId}`);
    }
  },
  onReady: (sock) => {
    const send = async (jid, text, extra = {}) => {
      console.log(`[Ausgehend] an=${jid} text="${text.slice(0, 80)}${text.length > 80 ? '...' : ''}"${extra.mentions ? ' (mit @mention)' : ''}`);
      await sendText(sock, jid, text, extra);
    };

    setInterval(() => {
      checkWizardTimeouts(send).catch((err) => console.error('Fehler bei Timeout-Pruefung:', err));
      // checkAndFireReminders() already catches and logs per-reminder send
      // failures internally (see scheduler.js) - one bad reminder can't
      // reject this call or block the others due in the same tick anymore.
      // This .catch() is just a safety net for something truly unexpected
      // (e.g. a DB error while reading due reminders).
      checkAndFireReminders(send).catch((err) => console.error('Unerwarteter Fehler beim Feuern von Erinnerungen:', err));
    }, CHECK_INTERVAL_MS);
  },
});
