# Kita-Bot

WhatsApp Erinnerungs-Bot fuer die Kita-Gruppe. Laeuft als ein einzelner
Node.js-Prozess auf einem Raspberry Pi.

## Status

**Meilenstein 1 (fertig):** WhatsApp-Verbindung ueber Baileys herstellen und
eine Testnachricht senden.

**Meilenstein 2 (fertig):** SQLite-Datenmodell fuer Erinnerungen
(`src/db.js`, `src/reminders.js`, `src/conversationState.js`,
`src/dates.js`). Getestet mit `npm run test:reminders` (18/18).

**Meilenstein 3 (fertig):** Der Erinnerungs-Assistent im privaten Chat
(`src/wizard.js`) - menuegesteuert, legt alle 5 Wiederholungsarten an
(einmalig, Zeitraum, woechentlich, monatlich, Countdown), plus Listing
("meine Erinnerungen" / "diese Woche") und automatischer Timeout mit
Nachfrage. Getestet mit `npm run test:wizard` (31/31) und
`npm run test:wizard-timeout` (9/9) - alles ohne echte WhatsApp-Verbindung.
`src/bot.js` ist der neue Haupteinstiegspunkt (`npm start`), der die
WhatsApp-Verbindung mit dem Assistenten verbindet. **Live in WhatsApp
getestet und bestaetigt funktionierend** (kompletter Erstellungs-Dialog,
Listing, Timeout-Nachfrage und automatischer Abbruch).

**Meilenstein 4 (fertig):** Der `/cancel`-Befehl in der Gruppe
(`src/groupCommands.js`) - zeigt eine nummerierte Liste aktiver
Erinnerungen, storniert per Zahlen-Antwort. Jeder in der Gruppe kann
stornieren, keine Berechtigungspruefung. Liste verfaellt nach 5 Minuten
(alte Zahlen-Antworten werden dann als normaler Chat ignoriert, nicht als
Stornierung missverstanden). Getestet mit `npm run test:group-commands`
(15/15).

**Meilenstein 5 (fertig):** Der taegliche Scheduler (`src/scheduler.js`)
- prueft jede Minute, ob eine aktive Erinnerung heute faellig ist UND ihre
Uhrzeit erreicht wurde, verschickt sie dann und aktualisiert den naechsten
Termin. Ausserdem: **persoenliche Erinnerungen** - im Hauptmenue gibt es
jetzt eine zweite Option, um eine Erinnerung anzulegen, die NUR privat an
den Ersteller geht statt in die Gruppe. Bei persoenlichen Erinnerungen
entfaellt die Frage "Fuer wen?" (ist immer fuer einen selbst) und man kann
selbst eine Uhrzeit waehlen (bei Gruppen-Erinnerungen bleibt es bei der
festen Standardzeit, 07:00). Zusaetzlich neuer Wiederholungstyp "Jeden Tag"
fuer taegliche Erinnerungen (z.B. Medikamente). Getestet mit
`npm run test:scheduler` (17/17).

**Als naechstes:** Das Wetter-Modul (DWD), dann die Admin-Weboberflaeche.

**Meilenstein 6 (fertig) - Verbesserungen nach echtem Nutzungstest:**
- **Abbrechen ist jetzt sichtbar:** jede Frage waehrend der Erinnerungs-Erstellung
  zeigt einen Hinweis "(Antworte mit \"abbrechen\", um den Vorgang zu stoppen.)" -
  vorher funktionierte es schon, war aber nicht offensichtlich.
- **Neue Listen-Optionen** im Hauptmenue (privater Chat):
  - "Alle Erinnerungen fuer die Gruppe anzeigen" (unabhaengig vom Datum)
  - "Erinnerungen fuer eine bestimmte Person anzeigen" (fragt nach einem Namen)
- **Neue Gruppen-Befehle** (`src/groupCommands.js`):
  - `/list` - alle aktiven Gruppen-Erinnerungen
  - `/list <Name>` oder `/list @Name` - alle Erinnerungen fuer diese Person
    (plus "alle"-Erinnerungen, da die fuer jeden gelten)
- **@Erwaehnungen (`src/contacts.js`):** Wenn eine Erinnerung einer bestimmten
  Person zugewiesen ist (z.B. "Peter"), erwaehnt der Bot diese Person jetzt
  per @-Tag in der Gruppennachricht, sofern die Person schon einmal in der
  Gruppe geschrieben hat (der Bot merkt sich automatisch Name -> WhatsApp-ID
  aus jeder Gruppennachricht - keine manuelle Einrichtung noetig). Hat die
  Person noch nie geschrieben, faellt die Nachricht auf reinen Text zurueck
  ("Erinnerung fuer Peter: ...") ohne Erwaehnung.
  Hinweis: WhatsApp hat inzwischen ein Datenschutz-System (LID), das echte
  Telefonnummern vor Bots verbergen kann - die Erwaehnung nutzt daher die
  interne WhatsApp-ID statt der Telefonnummer, was in der Praxis
  funktioniert, aber nicht zu 100% mit dem klassischen "@Telefonnummer"-Stil
  identisch aussehen muss.

Getestet mit `npm run test:wizard` (54/54, inkl. neuer Tests),
`npm run test:group-commands` (23/23), `npm run test:scheduler` (23/23,
inkl. @Erwaehnungs-Tests) und `npm run test:contacts` (10/10).

**Meilenstein 7 (fertig) - Weitere Gruppen-Befehle & Debug-Uhrzeit:**
- **`/neu`:** zeigt das Hauptmenue in der Gruppe an (als Hinweis/Vorschau) und
  erklaert, dass die eigentliche Erstellung weiterhin per privater Nachricht
  an den Bot laeuft - so bleibt der Gruppen-Feed sauber, aber der Befehl ist
  in der Gruppe leicht zu finden.
- **`/löschen` ersetzt `/cancel`:** gleiches Verhalten wie vorher (nummerierte
  Liste, per Zahl stornieren). Die ASCII-Schreibweise `/loeschen` (ohne
  Umlaut) funktioniert ebenfalls, falls die Tastatur mal kein "ö" hat.
- **`/hilfe`:** listet alle verfuegbaren Gruppen-Befehle auf
  (`/neu`, `/löschen`, `/liste`, `/liste <Name>`, `/hilfe`).
- **Sichtbare "Abbrechen"-Option im Menue:** jedes nummerierte Menue waehrend
  der Erinnerungs-Erstellung (Wiederholungsart, Wochentag, monatlicher Modus,
  "der wievielte") zeigt jetzt zusaetzlich `0 - Abbrechen` - Tippen von "0"
  bricht den Vorgang sofort ab, ohne dass man das Wort "abbrechen" kennen
  muss. Der Text-Befehl funktioniert natuerlich weiterhin.
- **Debug-Schalter fuer die Uhrzeit bei Gruppen-Erinnerungen**
  (`src/config.js`, `DEBUG_ASK_GROUP_FIRE_TIME`): standardmaessig `false` -
  Gruppen-Erinnerungen nutzen dann wie bisher immer die feste Standardzeit
  (07:00). Auf `true` gesetzt, fragt der Assistent bei JEDER neuen
  Gruppen-Erinnerung zusaetzlich nach einer Uhrzeit (genau wie bei
  persoenlichen Erinnerungen) - praktisch, um den Scheduler schnell zu testen
  (z.B. eine Uhrzeit eine Minute in der Zukunft eintragen und live zusehen,
  wie die Erinnerung ankommt). Bewusst NUR im Code umschaltbar (nicht per
  Chat), also: auf dem Pi `src/config.js` oeffnen, Wert aendern, `npm start`
  neu starten. Fuer den normalen Betrieb wieder auf `false` zuruecksetzen.

Getestet mit `npm run test:wizard` (61/61, inkl. neuer "0 - Abbrechen"-Tests)
und `npm run test:group-commands` (32/32, inkl. `/neu`, `/hilfe` und
`/loeschen`-Alias).

**Meilenstein 8 (fertig) - `/liste` statt `/list`, Befehle Gross-/Kleinschreibung egal:**
- **`/list` heisst jetzt `/liste`:** gleiches Verhalten wie vorher (mit und
  ohne Namen, `@Name`-Praefix wird weiterhin entfernt).
- **Alle Gruppen-Befehle sind jetzt ausdruecklich Gross-/Kleinschreibung-
  unempfindlich getestet:** `/NEU`, `/HilFe`, `/LISTE`, `/LÖSCHEN` funktionieren
  genauso wie die kleingeschriebenen Varianten (das war technisch schon so,
  ist jetzt aber mit eigenen Tests abgesichert).

Getestet mit `npm run test:group-commands` (39/39, inkl. neuer
Gross-/Kleinschreibungs-Tests).

**Meilenstein 9 (fertig) - Scheduler abgesichert (kein Endlos-Retry mehr):**
Hintergrund: Eine Erinnerung mit einer falschen/alten Gruppen-ID hat den
Scheduler jede Minute mit dem gleichen `forbidden`-Fehler abstuerzen lassen,
ohne dass andere faellige Erinnerungen im selben Durchlauf noch verschickt
wurden (`src/scheduler.js`, `npm run test:scheduler` deckt das jetzt ab).
- **Jede Erinnerung wird einzeln abgesichert** (`try/catch` pro Erinnerung in
  `checkAndFireReminders`): Schlaegt das Senden einer Erinnerung fehl, werden
  alle anderen faelligen Erinnerungen im selben Durchlauf trotzdem verschickt.
- **Kein Endlos-Retry mehr:** Jede Erinnerung hat jetzt einen internen
  Fehlerzaehler (`failure_count`, neue Spalte in der Datenbank, per
  automatischer Migration ergaenzt - bestehende Erinnerungen bleiben
  unveraendert, Zaehler startet bei 0). Nach `MAX_SEND_FAILURES`
  (`src/config.js`, Standard: 5) fehlgeschlagenen Versuchen IN FOLGE wird die
  Erinnerung automatisch deaktiviert, mit einer klaren Meldung im
  Terminal/Log ("... wurde nach 5 fehlgeschlagenen Sende-Versuchen in Folge
  automatisch deaktiviert."). Ein einzelner erfolgreicher Versand setzt den
  Zaehler wieder auf 0 zurueck.
- Jeder einzelne Fehlversuch wird ebenfalls geloggt (z.B. "Versuch 2/5"), so
  ist auf dem Pi im Log jederzeit nachvollziehbar, welche Erinnerung gerade
  Probleme macht, ohne dass der ganze Bot-Prozess betroffen ist.

Getestet mit `npm run test:scheduler` (36/36, inkl. neuer Tests fuer
Fehler-Isolation, Zaehler-Reset nach Erfolg und automatische Deaktivierung
nach Erreichen des Limits).

**Meilenstein 10 (fertig) - Abgelaufene Erinnerungen nicht mehr in Listen:**
Hintergrund: In seltenen Faellen (z.B. der Bot war ueber Mitternacht hinweg
offline und hat den genauen Tag einer Erinnerung verpasst) kann eine
Erinnerung als "aktiv" in der Datenbank stehen bleiben, obwohl ihr
geplantes Datum schon in der Vergangenheit liegt - sie wird nie mehr
feuern, tauchte bisher aber trotzdem weiter in jeder Liste auf.
- **`listActiveReminders()`** (`src/reminders.js`) - die gemeinsame
  Basis-Funktion, auf der ALLE Listen aufbauen - zeigt jetzt nur noch
  Erinnerungen mit einem Datum von heute oder in der Zukunft. Das wirkt
  sich automatisch auf jede Liste aus, ohne dass an mehreren Stellen etwas
  geaendert werden musste:
  - `/liste` und `/liste <Name>` (Gruppe)
  - `/löschen`-Liste (Gruppe)
  - "Alle Erinnerungen fuer die Gruppe anzeigen", "Erinnerungen fuer eine
    bestimmte Person anzeigen", "Von mir erstellte Erinnerungen anzeigen"
    (privater Chat / Assistent)
- Eine Erinnerung, die heute noch faellig ist (aber ihre Uhrzeit heute
  einfach noch nicht erreicht hat), bleibt selbstverstaendlich weiterhin
  sichtbar - "abgelaufen" heisst hier ausschliesslich "Datum vor heute",
  nicht "heute schon faellig gewesen".
- Das eigentliche Feuern der Erinnerungen (`getDueToday()` im Scheduler) ist
  von dieser Aenderung nicht betroffen - reine Anzeige-Aenderung.

Getestet mit `npm run test:reminders` (20/20), `npm run test:wizard`
(67/67) und `npm run test:group-commands` (43/43), jeweils inkl. neuer
Tests, die eine kuenstlich "abgelaufene" Erinnerung anlegen und pruefen,
dass sie in keiner Liste mehr auftaucht.

**Meilenstein 11 (fertig) - Einheitliches Menue-Template ueberall:**
Jedes Menue (Hauptmenue, Wiederholungsart, Wochentag, monatlicher Modus,
"der wievielte", und die `/löschen`-Liste in der Gruppe) folgt jetzt genau
dem gleichen Aufbau: zuerst die Frage, direkt danach `0 - Abbrechen`, dann
erst die eigentlichen Auswahlmoeglichkeiten. "0" bedeutet ueberall exakt
dasselbe, an keiner Stelle muss man sich merken, ob oder wo es verfuegbar
ist.
- **"0" bricht jetzt IMMER ab UND zeigt sofort wieder das Hauptmenue** (statt
  nur "Vorgang abgebrochen." stehen zu lassen und darauf zu warten, dass
  jemand selbst weiss, was als naechstes zu tippen ist). Das gilt auch fuer
  das Tippen von "abbrechen" als Text - beides nutzt jetzt denselben Weg
  und verhaelt sich identisch.
  **Hinweis:** Dieses Verhalten (Hauptmenue nach "0" erneut anzeigen) wurde
  in Meilenstein 12 wieder geaendert - siehe dort fuer den aktuellen Stand.
- **Die `/löschen`-Liste in der Gruppe hat jetzt ebenfalls `0 - Abbrechen`**
  als erste Zeile: Man kann den Storno-Vorgang jetzt abbrechen, ohne 5
  Minuten auf den automatischen Ablauf warten zu muessen oder aus Versehen
  eine falsche Nummer zu waehlen.
- Die Hinweistexte bei einer ungueltigen Eingabe in einem Menue erwaehnen
  "0" jetzt explizit (z.B. "Bitte antworte mit 0 zum Abbrechen oder einer
  Zahl von 1-6.").

Getestet mit `npm run test:wizard` (82/82, inkl. Tests, die pruefen, dass
"0 - Abbrechen" in jedem Menue exakt die zweite Zeile ist - direkt nach der
Frage, vor den Auswahlmoeglichkeiten) und `npm run test:group-commands`
(49/49, inkl. neuer Tests fuer "0" in der `/löschen`-Liste).

**Meilenstein 12 (fertig) - "0" wirklich ueberall, und Abbrechen beendet
sauber (statt Hauptmenue erneut zu zeigen):**
Nach echtem Nutzungstest von Meilenstein 11 kamen drei Korrekturen:
- **"0" funktioniert jetzt auch im Hauptmenue selbst** ("Was moechtest du
  tun?"). Vorher stand `0 - Abbrechen` dort zwar schon in der Menue-Liste,
  hatte aber keine Wirkung, wenn man es tatsaechlich eingegeben hat - das
  war ein Fehler und ist jetzt behoben.
- **"0" funktioniert jetzt auch bei freien Texteingaben**, nicht nur in
  nummerierten Menues - z.B. beim Eintippen des Erinnerungstexts, des
  Namens fuer "Fuer wen?", eines Datums oder einer Uhrzeit. Der Hinweistext
  unter jeder solchen Frage zeigt das jetzt auch an: "(Antworte mit \"0\"
  oder \"abbrechen\", um den Vorgang zu stoppen.)".
  Ausnahme, bewusst: bei der Frage nach der Vorlaufzeit in Tagen (Zeitraum-
  und Countdown-Erinnerungen) ist "0" selbst eine gueltige Antwort (z.B.
  "0 Tage Vorlauf" bzw. "am Tag selbst ankuendigen"). Dort bricht nur das
  Wort "abbrechen" (bzw. "stop"/"abort") ab, und der Hinweistext zeigt dort
  konsequenterweise auch nur "abbrechen" an, nicht "0".
- **Abbrechen zeigt jetzt NICHT mehr automatisch das Hauptmenue an** - das
  war die Aenderung aus Meilenstein 11, hat sich in der Praxis aber nicht
  richtig angefuehlt. Jetzt gilt wieder: "0" oder "abbrechen" beendet den
  laufenden Vorgang komplett und antwortet nur noch mit "Vorgang
  abgebrochen." - ohne im gleichen Zug ein neues Menue hinterherzuschicken.
  Wer danach etwas Neues machen moechte, schreibt einfach wieder eine
  normale Nachricht an den Bot.

Getestet mit `npm run test:wizard` (82/82, u.a. neue Tests fuer "0" im
Hauptmenue, "0" als Erinnerungstext, und dass nach dem Abbrechen exakt nur
"Vorgang abgebrochen." zurueckkommt statt zusaetzlich das Hauptmenue).

**Meilenstein 13 (fertig) - Als systemd-Dienst einrichten (dauerhafter
Betrieb):**
- Neue Datei `kita-bot.service` (Vorlage fuer systemd) im Projekt-
  Hauptordner.
- Startet den Bot automatisch beim Hochfahren des Pi und startet ihn
  automatisch neu, falls der Prozess mal abstuerzt (`Restart=always`, ohne
  Limit fuer die Anzahl der Neustarts - ein kurzer Internetausfall o.ae.
  beendet den Bot also nicht dauerhaft).
- Logs landen im systemd-Journal (`journalctl -u kita-bot -f`) statt in
  einer eigenen Log-Datei - kein zusaetzliches Log-Management noetig.
- Neuer README-Abschnitt "Als systemd-Dienst laufen lassen" (siehe unten)
  mit Schritt-fuer-Schritt-Anleitung, inkl. dem wichtigen Hinweis, den Bot
  VOR dem Einrichten des Dienstes einmal manuell zu starten - der erste
  Start braucht einen QR-Code-Scan, der nur in einem echten, interaktiven
  Terminal funktioniert, nicht als Hintergrund-Dienst.

Reine Betriebs-/Konfigurationsaenderung, kein Code in `src/` veraendert -
weiterhin 206/206 bestehende Tests gruen.

## Wichtiger Hinweis zur Node.js-Version

Dieses Projekt braucht **Node.js 22** (in `.nvmrc` und `package.json`
festgelegt). Node.js 24 hat aktuell einen offenen, ungeloesten Fehler im
Node-Core (nodejs/node#65196), der beim Beenden des Prozesses native Module
wie `better-sqlite3` abstuerzen laesst (Stacktrace erwaehnt
`RemoveEnvironmentCleanupHook` / `Statement::~Statement()`,
"Assertion failed: (env) != nullptr"). Getestet und bestaetigt: mit Node 22
tritt das Problem nicht auf.

Falls `node -v` nicht `v22.x.x` zeigt, mit `nvm` wechseln:
```
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.4/install.sh | bash
# neues Terminal oeffnen, dann:
nvm install 22
nvm use 22
rm -rf node_modules package-lock.json
npm install
```
(Das Loeschen von `node_modules` ist noetig, damit `better-sqlite3` sein
natives Modul neu gegen Node 22 baut.)

## Setup auf dem Raspberry Pi

1. Node.js installieren, falls noch nicht vorhanden (Node 18+ empfohlen):
   ```
   curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
   sudo apt-get install -y nodejs
   ```

2. Projekt auf den Pi kopieren, dann:
   ```
   cd kita-bot
   npm install
   ```
   `better-sqlite3` kompiliert dabei ein natives Modul fuer ARM. Falls das
   fehlschlaegt, `build-essential` und `python3` nachinstallieren
   (`sudo apt-get install -y build-essential python3`).

   **Falls `npm install` eine Meldung wie "install scripts not yet covered
   by allowScripts" zeigt** (neuere npm-Versionen, ab ca. npm 11): das ist
   eine Sicherheitsfunktion, die Install-Skripte standardmaessig blockiert.
   `better-sqlite3` braucht sein Install-Skript aber, um das native Modul zu
   bauen. Freigeben mit:
   ```
   npm install-scripts approve --all
   npm install
   ```
   (Wir vertrauen hier allen drei betroffenen Paketen - `baileys`,
   `better-sqlite3`, `protobufjs` - das sind bewusst gewaehlte,
   bekannte Bibliotheken.)

3. Alle Tests laufen lassen (rein lokal, kein WhatsApp noetig):
   ```
   npm run test:reminders        # Datenmodell
   npm run test:wizard           # Erinnerungs-Assistent (privater Chat)
   npm run test:wizard-timeout   # Timeout/Nachfrage-Logik
   npm run test:group-commands   # /neu, /löschen, /liste, /hilfe in der Gruppe
   npm run test:scheduler        # Taeglicher Scheduler, inkl. @Erwaehnungen & Fehler-Haertung
   npm run test:contacts         # Name -> WhatsApp-ID Zuordnung
   ```
   Aktueller Stand: 206 Tests insgesamt, alle sollten "passed" zeigen.

4. Verbindungstest starten:
   ```
   node src/connect-test.js
   ```

5. A QR code will print in the terminal.
6. Auf dem Telefon, dessen Nummer der Bot verwenden soll (das alte iPhone):
   WhatsApp -> Einstellungen -> Verknuepfte Geraete -> Geraet verknuepfen ->
   QR-Code scannen.

7. Nach erfolgreicher Verbindung: Beim ersten Lauf ist `TEST_CHAT_ID` in
   `src/connect-test.js` noch leer. Schreib irgendeine Nachricht in die
   Ziel-Gruppe (von einem beliebigen Handy) - die Chat-ID der Gruppe wird
   dann im Terminal geloggt (Format `123456789-123456789@g.us`).

8. Diese ID in `TEST_CHAT_ID` eintragen und das Skript neu starten. Es sollte
   dann automatisch eine Testnachricht in die Gruppe schicken.

9. Sobald das funktioniert: Skript stoppen, neu starten (ohne den `auth`
   Ordner zu loeschen) und pruefen, dass **kein** neuer QR-Code noetig ist -
   das bestaetigt, dass die Session dauerhaft gespeichert wird.

## Den echten Bot starten und den Assistenten ausprobieren

Sobald `connect-test.js` erfolgreich verbunden war (Session in `auth/`
gespeichert), kann der echte Bot gestartet werden:
```
npm start
```
Das startet `src/bot.js`, welches sich verbindet und dann auf private
Nachrichten reagiert. Zum Testen: Schreib dem Bot-Account (nicht der Gruppe)
irgendeine Nachricht - er antwortet mit einem Menue:
```
1 - Neue Erinnerung anlegen
2 - Von mir erstellte Erinnerungen anzeigen
3 - Diese Woche anzeigen
```
Antworte mit "1" und folge dem Dialog (Text -> Person -> Wiederholungsart ->
Details -> Bestaetigung). Jederzeit "abbrechen" schreiben, um den Vorgang
zu stoppen.

Hinweis: In der Gruppe gibt es zusaetzlich die Befehle `/neu` (zeigt das
Menue), `/löschen` (nummerierte Liste aktiver Erinnerungen, mit der Nummer
antworten storniert sie), `/liste` (bzw. `/liste <Name>`) und `/hilfe`
(Uebersicht aller Befehle). Alle Befehle funktionieren unabhaengig von
Gross-/Kleinschreibung.

Hinweis: Im Hauptmenue gibt es jetzt Option 2 fuer **persoenliche
Erinnerungen** - diese gehen nur an den Ersteller selbst (privater Chat),
nicht in die Gruppe, und man kann eine eigene Uhrzeit dafuer waehlen. Der
Scheduler prueft jede Minute im Hintergrund, ob etwas faellig ist.

## Als systemd-Dienst laufen lassen (automatischer Start + Neustart bei Absturz)

Damit der Bot dauerhaft im Hintergrund laeuft - startet automatisch beim
Hochfahren des Pi und startet sich selbst neu, falls der Prozess mal
abstuerzt - kann er als systemd-Dienst eingerichtet werden. Dann ist kein
offenes Terminal, kein `screen` und kein `nohup` mehr noetig.

**Wichtig - zuerst einmal ganz normal manuell starten:** Der allererste
Start braucht einen QR-Code zum Scannen (siehe oben, Schritte 5-6 unter
"Setup auf dem Raspberry Pi"). Das funktioniert nur in einem echten,
interaktiven Terminal - nicht als Hintergrund-Dienst. Also erst `npm start`
von Hand ausfuehren, QR-Code scannen, pruefen dass der `auth/`-Ordner
gefuellt ist und der Bot normal reagiert. **Erst danach** den systemd-
Dienst einrichten - die gespeicherte Session in `auth/` wird dann
automatisch wiederverwendet, kein erneuter QR-Code noetig.

1. Node-Pfad herausfinden (wichtig, falls Node ueber `nvm` installiert
   wurde - systemd kennt `nvm` nicht und findet `node` sonst nicht):
   ```
   which node
   ```
   Beispiel-Ausgabe: `/home/pi/.nvm/versions/node/v22.20.0/bin/node`

2. `kita-bot.service` (liegt im Projekt-Hauptordner) mit einem Editor
   oeffnen (z.B. `nano kita-bot.service`) und drei Werte anpassen:
   - `User=` / `Group=` - dein Benutzername auf dem Pi (`whoami` zeigt ihn)
   - `WorkingDirectory=` - der volle Pfad zum Projektordner (`pwd` im
     Projektordner zeigt ihn)
   - `ExecStart=` - der Node-Pfad aus Schritt 1, gefolgt von einem
     Leerzeichen und dem vollen Pfad zu `src/bot.js`

3. Datei nach `/etc/systemd/system/` kopieren:
   ```
   sudo cp kita-bot.service /etc/systemd/system/kita-bot.service
   ```

4. Dienst aktivieren und sofort starten:
   ```
   sudo systemctl daemon-reload
   sudo systemctl enable --now kita-bot
   ```
   `enable` sorgt dafuer, dass der Bot bei jedem Neustart des Pi automatisch
   mitstartet. `--now` startet ihn zusaetzlich sofort, ohne auf den naechsten
   Neustart warten zu muessen.

5. Status pruefen:
   ```
   sudo systemctl status kita-bot
   ```
   Sollte `active (running)` zeigen. Falls nicht: Schritt 6 (Logs) zeigt
   meistens sofort, woran es liegt (haeufigste Ursache: falscher Node-Pfad
   in `ExecStart=`).

6. Live-Logs ansehen (entspricht dem, was frueher im Terminal zu sehen war):
   ```
   journalctl -u kita-bot -f
   ```
   (`-f` = "follow", zeigt neue Zeilen live mit; ohne `-f` werden alle
   bisherigen Log-Zeilen angezeigt. `Strg+C` zum Beenden.)

Nuetzliche Befehle danach:
```
sudo systemctl stop kita-bot      # Bot anhalten
sudo systemctl restart kita-bot   # Bot neu starten (z.B. nach einer Aenderung an config.js)
sudo systemctl disable kita-bot   # Autostart beim Booten wieder abschalten
```

Der Dienst ist so eingestellt, dass er sich nach einem Absturz automatisch
nach 10 Sekunden neu startet - unbegrenzt oft, ohne dass systemd irgendwann
aufgibt (`Restart=always` zusammen mit `StartLimitIntervalSec=0`). Ein
einzelner Absturz (z.B. durch einen kurzzeitigen Internetausfall) beendet
den Bot also nicht dauerhaft.

## Wichtig

- Der Ordner `auth/` enthaelt die Sitzungsdaten fuer das WhatsApp-Konto des
  Bots. Nicht teilen, nicht committen (steht in `.gitignore`).
- Das Handy mit der Bot-Nummer muss gelegentlich online sein, damit die
  Verknuepfung aktiv bleibt (WhatsApp-Vorgabe fuer verknuepfte Geraete).
- Diese Verbindungsmethode ist inoffiziell (kein offizielles WhatsApp
  Business API). Funktioniert zuverlaessig in der Praxis, ist aber nicht von
  WhatsApp offiziell unterstuetzt.

## Naechste Schritte (nach Meilenstein 5)

1. Wetter-Modul (DWD)
2. Admin-Weboberflaeche (lokal, Express)
