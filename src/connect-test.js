/**
 * connect-test.js
 *
 * Milestone 1: Verify that we can link this machine to a WhatsApp account
 * via Baileys, keep the connection alive, and send one test message.
 *
 * HOW TO USE ON THE RASPBERRY PI:
 *   1. npm install
 *   2. node src/connect-test.js
 *   3. A QR code will print in the terminal.
 *   4. On the phone whose number you want the BOT to use (the old iPhone):
 *      WhatsApp -> Settings -> Linked Devices -> Link a Device -> scan QR.
 *   5. Once connected, it will send a test message to whatever chat ID
 *      you put in TEST_CHAT_ID below (or just log its own chats so you can
 *      find the group's ID).
 *
 * Login credentials get saved to ./auth/ so you only need to scan once.
 * Do NOT commit the ./auth folder anywhere (it's effectively the session key
 * for the WhatsApp account).
 */

import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import qrcode from 'qrcode-terminal';
import pino from 'pino';

// Set this once you know the group's WhatsApp ID (looks like
// "1234567890-1234567890@g.us"). Leave null for the first run: the script
// will log every chat ID it sees so you can find the right one.
const TEST_CHAT_ID = '120363411993978415@g.us';

const AUTH_DIR = './auth';

async function start() {
  console.log('Loading auth state...');
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  console.log('Fetching latest Baileys version...');
  const { version } = await fetchLatestBaileysVersion();
  console.log('Creating socket, version:', version);

  const sock = makeWASocket({
    version,
    auth: state,
    logger: pino({ level: 'silent' }), // set to 'info' if you want verbose logs
    printQRInTerminal: false, // we handle QR display ourselves below
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log('\nScan this QR code with the bot\'s WhatsApp account:\n');
      qrcode.generate(qr, { small: true });
    }

    if (connection === 'close') {
      const statusCode = new Boom(lastDisconnect?.error)?.output?.statusCode;
      const loggedOut = statusCode === DisconnectReason.loggedOut;
      console.log(
        `Connection closed. Logged out: ${loggedOut}. ${
          loggedOut ? 'Delete ./auth and re-scan.' : 'Reconnecting...'
        }`
      );
      if (!loggedOut) {
        start();
      }
    } else if (connection === 'open') {
      console.log('Connected to WhatsApp successfully.');

      if (TEST_CHAT_ID) {
        sock
          .sendMessage(TEST_CHAT_ID, {
            text: 'Testnachricht vom Kita-Bot. Die Verbindung funktioniert.',
          })
          .then(() => console.log(`Test message sent to ${TEST_CHAT_ID}`))
          .catch((err) => console.error('Failed to send test message:', err));
      } else {
        console.log(
          'TEST_CHAT_ID is not set. Send any message in the target group now ' +
            '(from any phone) so its chat ID gets logged below.'
        );
      }
    }
  });

  // Logs every incoming message's chat ID + text, so you can find the
  // group's ID and confirm messages are received.
  sock.ev.on('messages.upsert', ({ messages }) => {
    for (const msg of messages) {
      if (!msg.message) continue;
      const chatId = msg.key.remoteJid;
      const isGroup = chatId?.endsWith('@g.us');
      const text =
        msg.message.conversation ||
        msg.message.extendedTextMessage?.text ||
        '(non-text message)';
      console.log(
        `[${isGroup ? 'GROUP' : 'DM'}] chatId=${chatId} from=${msg.key.participant || chatId} text="${text}"`
      );
    }
  });
}

start().catch((err) => {
  console.error('Fatal error starting connection:', err);
  process.exit(1);
});
