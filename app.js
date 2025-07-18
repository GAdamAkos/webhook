require('dotenv').config();
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const app = express();
const port = process.env.PORT || 3000;

// Adatbázis elérési útvonal logolása
const dbPath = path.resolve(__dirname, 'whatsapp_messages.db');
console.log('📂 Adatbázis fájl helye:', dbPath);

const db = new sqlite3.Database(dbPath);

// Táblák létrehozása, ha még nincsenek
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS contacts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      wa_id TEXT UNIQUE,
      name TEXT
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      contact_id INTEGER,
      message_body TEXT,
      message_type TEXT,
      received_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      wa_message_id TEXT UNIQUE,
      FOREIGN KEY(contact_id) REFERENCES contacts(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS message_metadata (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      message_id INTEGER,
      status TEXT,
      timestamp TEXT,
      error_code INTEGER,
      error_message TEXT,
      FOREIGN KEY(message_id) REFERENCES messages(id)
    )
  `);

  console.log('✅ Adatbázis táblák készen állnak');
});

app.use(express.json());

// WEBHOOK VERIFICATION (GET)
app.get('/webhook', (req, res) => {
  const VERIFY_TOKEN = process.env.VERIFY_TOKEN || 'webhooktoken';
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode && token === VERIFY_TOKEN) {
    console.log('🔐 Webhook verifikálva!');
    res.status(200).send(challenge);
  } else {
    console.log('❌ Webhook verifikáció sikertelen');
    res.sendStatus(403);
  }
});

// WEBHOOK MESSAGE RECEIVER (POST)
app.post('/webhook', (req, res) => {
  console.log("📨 Webhook kérés érkezett:", JSON.stringify(req.body, null, 2));

  const entry = req.body.entry?.[0];
  const changes = entry?.changes?.[0];
  const value = changes?.value;

  const contactsData = value?.contacts?.[0];
  const wa_id = contactsData?.wa_id || null;
  const name = contactsData?.profile?.name || null;

  // Név és wa_id mentése vagy frissítése a contacts táblába
  if (wa_id) {
    if (name) {
      // Ha van név, beszúrjuk vagy frissítjük
      db.run(
        `INSERT INTO contacts (wa_id, name)
         VALUES (?, ?)
         ON CONFLICT(wa_id) DO UPDATE SET name = excluded.name`,
        [wa_id, name],
        (err) => {
          if (err) console.error("❌ DB hiba (contacts - névvel):", err);
        }
      );
    } else {
      // Ha nincs név, csak beszúrjuk, ha még nincs benne
      db.run(
        `INSERT INTO contacts (wa_id)
         VALUES (?)
         ON CONFLICT(wa_id) DO NOTHING`,
        [wa_id],
        (err) => {
          if (err) console.error("❌ DB hiba (contacts - név nélkül):", err);
        }
      );

      console.warn(`⚠️ Név nem érkezett a webhook üzenetben (wa_id: ${wa_id})`);
    }
  }

  // Üzenetek mentése
  const messages = value?.messages;
  if (messages) {
    const message = messages[0];
    const messageBody = message.text?.body || '';
    const messageType = message.type;
    const timestamp = new Date().toISOString();
    const wa_message_id = message.id;

    // Kapcsolódó kontakt lekérdezése
    db.get('SELECT id FROM contacts WHERE wa_id = ?', [wa_id], (err, row) => {
      if (err || !row) {
        console.error('❌ Nem található a kontakt az adatbázisban:', err);
        return;
      }

      const contact_id = row.id;

      db.run(
        `INSERT INTO messages (contact_id, message_body, message_type, received_at, wa_message_id)
         VALUES (?, ?, ?, ?, ?)`,
        [contact_id, messageBody, messageType, timestamp, wa_message_id],
        function (err) {
          if (err) {
            console.error('❌ DB hiba (messages):', err);
          } else {
            console.log('✅ Üzenet mentve, ID:', this.lastID);
          }
        }
      );
    });
  }

  // Status üzenetek mentése
  const statuses = value?.statuses;
  if (statuses) {
    statuses.forEach(status => {
      const wa_message_id = status.id;
      const statusValue = status.status;
      const timestamp = new Date(parseInt(status.timestamp) * 1000).toISOString();
      const error = status.errors?.[0];
      const error_code = error?.code || null;
      const error_message = error?.message || null;

      db.get(
        'SELECT id FROM messages WHERE wa_message_id = ?',
        [wa_message_id],
        (err, msgRow) => {
          const localMessageId = msgRow?.id || null;

          if (!localMessageId) {
            console.warn(`⚠️ Nem található üzenet a message_metadata számára (wa_message_id: ${wa_message_id})`);
            return;
          }

          db.run(
            `INSERT INTO message_metadata (message_id, status, timestamp, error_code, error_message)
             VALUES (?, ?, ?, ?, ?)`,
            [localMessageId, statusValue, timestamp, error_code, error_message],
            function (err) {
              if (err) {
                console.error('❌ DB hiba (message_metadata):', err);
              } else {
                console.log(`✅ Status mentve: ${statusValue} (msg_id=${localMessageId})`);
              }
            }
          );
        }
      );
    });
  }

  res.sendStatus(200);
});

// ÖSSZES ÜZENET LEKÉRDEZÉSE
app.get('/messages', (req, res) => {
  const query = `
    SELECT messages.id, contacts.wa_id, contacts.name, messages.message_body, messages.message_type, messages.received_at
    FROM messages
    JOIN contacts ON messages.contact_id = contacts.id
    ORDER BY messages.received_at DESC
  `;
  db.all(query, [], (err, rows) => {
    if (err) {
      console.error('❌ Hiba az üzenetek lekérdezésekor:', err);
      return res.sendStatus(500);
    }
    res.json(rows);
  });
});

// ADATBÁZIS LETÖLTÉSE
app.get('/download-db', (req, res) => {
  fs.access(dbPath, fs.constants.F_OK, (err) => {
    if (err) {
      console.error('❌ Az adatbázis fájl nem található.');
      return res.status(404).send('Fájl nem található.');
    }

    res.download(dbPath, 'whatsapp_messages.db', (err) => {
      if (err) {
        console.error('❌ Hiba a fájl letöltésénél:', err);
      } else {
        console.log('✅ Adatbázis fájl sikeresen letöltve.');
      }
    });
  });
});

// APP INDÍTÁSA
app.listen(port, '0.0.0.0', () => {
  console.log(`🚀 Szerver fut a http://0.0.0.0:${port} címen`);
});
