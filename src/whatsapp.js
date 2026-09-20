/**
 * whatsapp.js
 *
 * Reusable Baileys connection setup: handles QR display, reconnect logic,
 * and session persistence. Emits parsed incoming messages via a callback so
 * the rest of the app (wizard, group commands) never has to touch Baileys
 * internals directly.
 */

import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import qrcode from 'qrcode-terminal';
import pino from 'pino';

const AUTH_DIR = process.env.KITA_BOT_AUTH_DIR || './auth';

// IDs of messages *we* sent via sendText() below. Used to tell the bot's
// own outgoing replies apart from genuine incoming messages when testing
// with a self-chat (bot account == your own account). In normal operation
// (bot has its own separate number), real senders are never fromMe=true,
// so this only matters for local testing.
const botSentIds = new Set();

/**
 * Use this instead of sock.sendMessage() directly, so outgoing replies
 * don't get mistaken for incoming user messages during self-chat testing.
 * `extra` can carry additional Baileys message fields, e.g. { mentions: [jid] }.
 */
export async function sendText(sock, jid, text, extra = {}) {
  const sent = await sock.sendMessage(jid, { text, ...extra });
  if (sent?.key?.id) {
    botSentIds.add(sent.key.id);
  }
  return sent;
}

/**
 * @param {object} handlers
 * @param {(ctx: {sock, chatId, senderId, isGroup, text, pushName}) => Promise<void>} handlers.onMessage
 * @param {(sock) => void} [handlers.onReady] - called once the connection is open
 */
export async function connectWhatsApp({ onMessage, onReady } = {}) {
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: state,
    logger: pino({ level: 'silent' }),
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log('\nScan diesen QR-Code mit dem WhatsApp-Konto des Bots:\n');
      qrcode.generate(qr, { small: true });
    }

    if (connection === 'close') {
      const statusCode = new Boom(lastDisconnect?.error)?.output?.statusCode;
      const loggedOut = statusCode === DisconnectReason.loggedOut;
      console.log(
        `Verbindung getrennt. Ausgeloggt: ${loggedOut}. ${
          loggedOut ? 'auth-Ordner loeschen und neu scannen.' : 'Verbinde erneut...'
        }`
      );
      if (!loggedOut) {
        connectWhatsApp({ onMessage, onReady });
      }
    } else if (connection === 'open') {
      console.log('Mit WhatsApp verbunden.');
      if (onReady) onReady(sock);
    }
  });

  sock.ev.on('messages.upsert', async (upsert) => {
    for (const msg of upsert.messages) {
      if (!msg.message) {
        console.log(`[Nicht entschluesselt] von=${msg.key.remoteJid} - Nachricht konnte nicht gelesen werden (siehe "Bad MAC" oben, falls vorhanden)`);
        continue;
      }

      if (msg.key.fromMe) {
        if (msg.key.id && botSentIds.has(msg.key.id)) {
          botSentIds.delete(msg.key.id);
          continue; // this is our own reply echoing back - ignore it
        }
        // fromMe but not something we sent ourselves: this happens when the
        // bot's WhatsApp account is the same as your personal account
        // (self-chat testing before a dedicated number is set up). Treat it
        // as genuine incoming input rather than dropping it.
      }

      const chatId = msg.key.remoteJid;
      const isGroup = chatId?.endsWith('@g.us');
      const senderId = isGroup ? msg.key.participant || chatId : chatId;
      const text =
        msg.message.conversation || msg.message.extendedTextMessage?.text || '';
      const pushName = msg.pushName || null;

      if (onMessage) {
        try {
          await onMessage({ sock, chatId, senderId, isGroup, text, pushName });
        } catch (err) {
          console.error('Fehler bei der Nachrichtenverarbeitung:', err);
        }
      }
    }
  });

  return sock;
}
