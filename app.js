require('dotenv').config();
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const app = express();
const port = process.env.PORT || 3000;

// SQLite adatbázis elérési útja
const dbPath = path.resolve(__dirname, 'whatsapp_messages.db');
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

  console.log('Adatbázis táblák készen állnak');
});

app.use(express.json());

// WEBHOOK VERIFICATION (GET)
app.get('/webhook', (req, res) => {
  const VERIFY_TOKEN = process.env.VERIFY_TOKEN || 'sajat_verify_token';
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode && token === VERIFY_TOKEN) {
    console.log('Webhook verifikálva!');
    res.status(200).send(challenge);
  } else {
    console.log('Webhook verifikáció sikertelen');
    res.sendStatus(403);
  }
});

// WEBHOOK MESSAGE RECEIVER (POST)
app.post('/webhook', (req, res) => {
  console.log('Webhook kérés érkezett:', JSON.stringify(req.body, null, 2));

  try {
    const body = req.body;
    const entry = body.entry && body.entry[0];
    const changes = entry && entry.changes && entry.changes[0];
    const value = changes && changes.value;
    const messages = value && value.messages;

    if (!messages || messages.length === 0) {
      // nincs új üzenet, 200 OK vissza
      return res.sendStatus(200);
    }

    const message = messages[0];
    const from = message.from;
    const messageBody = message.text?.body || '';
    const messageType = message.type || 'unknown';

    // Kontakt keresése vagy létrehozása
    db.get(`SELECT id FROM contacts WHERE wa_id = ?`, [from], (err, row) => {
      if (err) {
        console.error('Kontakt lekérdezési hiba:', err);
        return res.sendStatus(500);
      }

      if (row) {
        // Kontakt létezik, üzenet mentése
        saveMessage(row.id);
      } else {
        // Új kontakt beszúrása
        db.run(`INSERT INTO contacts (wa_id) VALUES (?)`, [from], function(err) {
          if (err) {
            console.error('Kontakt beszúrási hiba:', err);
            return res.sendStatus(500);
          }
          saveMessage(this.lastID);
        });
      }
    });

    function saveMessage(contactId) {
      db.run(
        `INSERT INTO messages (contact_id, message_body, message_type) VALUES (?, ?, ?)`,
        [contactId, messageBody, messageType],
        function(err) {
          if (err) {
            console.error('Üzenet beszúrási hiba:', err);
            return res.sendStatus(500);
          }
          console.log(`Üzenet mentve, ID: ${this.lastID}`);
          res.sendStatus(200);
        }
      );
    }
  } catch (e) {
    console.error('Webhook feldolgozási hiba:', e);
    res.sendStatus(400);
  }
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
      console.error('Hiba az üzenetek lekérdezésekor:', err);
      return res.sendStatus(500);
    }
    res.json(rows);
  });
});

// APP INDÍTÁSA
app.listen(port, () => {
  console.log(`Szerver fut a http://localhost:${port} címen`);
});
