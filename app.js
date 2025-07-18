require('dotenv').config();
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const app = express();
const port = process.env.PORT || 3000;

// ✅ Adatbázis elérési útvonal logolása
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
      FOREIGN KEY(contact_id) REFERENCES contacts(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS message_metadata (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      message_id INTEGER,
      status TEXT,
      timestamp DATETIME,
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

  // 1️⃣ Üzenet fogadása
  const messages = value?.messages;
  if (messages) {
    const contact = value.contacts?.[0];
    const profileName = contact?.profile?.name || null;
    const wa_id = contact?.wa_id;

    // 📌 Kontakt mentése (név frissítése, ha van)
    db.get('SELECT id FROM contacts WHERE wa_id = ?', [wa_id], (err, row) => {
      if (err) return console.error('DB hiba (contacts):', err);
      if (row) {
        db.run('UPDATE contacts SET name = ? WHERE id = ?', [profileName, row.id]);
      } else {
        db.run('INSERT INTO contacts (wa_id, name) VALUES (?, ?)', [wa_id, profileName]);
      }
    });

    // 📌 Üzenet mentése
    const message = messages[0];
    const messageBody = message.text?.body;
    const messageType = message.type;
    const timestamp = new Date().toISOString();

    db.get('SELECT id FROM contacts WHERE wa_id = ?', [wa_id], (err, contactRow) => {
      if (contactRow) {
        db.run(
          'INSERT INTO messages (contact_id, message_body, message_type, received_at) VALUES (?, ?, ?, ?)',
          [contactRow.id, messageBody, messageType, timestamp],
          function (err) {
            if (err) return console.error('❌ DB hiba (messages):', err);
            console.log('✅ Üzenet mentve, ID:', this.lastID);
          }
        );
      }
    });
  }

  // 2️⃣ Status típusú webhook esemény mentése
  const statuses = value?.statuses;
  if (statuses) {
    statuses.forEach(status => {
      const message_id = status.id;
      const statusValue = status.status;
      const timestamp = new Date(parseInt(status.timestamp) * 1000).toISOString();
      const error = status.errors?.[0];
      const error_code = error?.code || null;
      const error_message = error?.message || null;

      db.run(
        'INSERT INTO message_metadata (message_id, status, timestamp, error_code, error_message) VALUES (?, ?, ?, ?, ?)',
        [message_id, statusValue, timestamp, error_code, error_message],
        function (err) {
          if (err) return console.error('❌ DB hiba (statuses):', err);
          console.log('✅ Státusz mentve:', message_id, statusValue);
        }
      );
    });
  }

  res.sendStatus(200);
});

// ÖSSZES ÜZENET LEKÉRDEZÉSE
app.get('/messages', (req, res) => {
  const query = `
    SELECT messages.id, contacts.wa_id, messages.message_body, messages.message_type, messages.received_at
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

// ✅ ADATBÁZIS LETÖLTÉSE
app.get('/download-db', (req, res) => {
  const filePath = dbPath;

  fs.access(filePath, fs.constants.F_OK, (err) => {
    if (err) {
      console.error('❌ Az adatbázis fájl nem található.');
      return res.status(404).send('Fájl nem található.');
    }

    res.download(filePath, 'whatsapp_messages.db', (err) => {
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
