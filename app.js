require('dotenv').config();
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const app = express();
const port = process.env.PORT || 3000;

// === SQLite INIT ===
const dbPath = path.resolve(__dirname, 'messages.db');
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('SQLite csatlakozási hiba:', err);
    process.exit(1);
  } else {
    console.log('Kapcsolat létrejött az SQLite adatbázissal.');
  }
});

// Tábla létrehozása ha nem létezik
db.run(`
  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    direction TEXT NOT NULL,
    phone TEXT,
    content TEXT,
    raw_json TEXT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

app.use(express.json());

// === Webhook verification ===
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

// === Üzenet fogadása (bejövő) ===
app.post('/webhook', (req, res) => {
  const message = req.body;

  if (!message || Object.keys(message).length === 0) {
    return res.status(400).json({ error: 'Üres üzenet' });
  }

  const rawJson = JSON.stringify(message);

  // Esetleg próbáljuk meg kiszedni a telefonszámot és szöveget (ha van)
  let phone = null;
  let content = null;

  try {
    const entry = message.entry?.[0];
    const changes = entry?.changes?.[0];
    const msg = changes?.value?.messages?.[0];

    phone = msg?.from || null;
    content = msg?.text?.body || msg?.button?.text || null;
  } catch (err) {
    console.warn("Nem sikerült kibontani az üzenet tartalmát.");
  }

  db.run(
      `INSERT INTO messages (direction, phone, content, raw_json) VALUES (?, ?, ?, ?)`,
      ['incoming', phone, content, rawJson],
      function (err) {
        if (err) {
          console.error('Hiba az SQLite beszúráskor:', err.message);
          return res.sendStatus(500);
        }
        console.log('Bejövő üzenet mentve az SQLite adatbázisba.');
        res.sendStatus(200);
      }
  );
});

// === Elküldött üzenet rögzítése (opcionálisan a Java kliens hívhat egy endpointot is) ===
app.post('/sent', (req, res) => {
  const { phone, content } = req.body;

  if (!phone || !content) {
    return res.status(400).json({ error: 'Hiányzó mezők' });
  }

  db.run(
      `INSERT INTO messages (direction, phone, content, raw_json) VALUES (?, ?, ?, ?)`,
      ['outgoing', phone, content, JSON.stringify(req.body)],
      function (err) {
        if (err) {
          console.error('Hiba az elküldött üzenet mentésekor:', err.message);
          return res.sendStatus(500);
        }
        console.log('Elküldött üzenet mentve az SQLite adatbázisba.');
        res.sendStatus(200);
      }
  );
});

// === Összes üzenet lekérése ===
app.get('/messages', (req, res) => {
  db.all(`SELECT * FROM messages ORDER BY timestamp DESC`, [], (err, rows) => {
    if (err) {
      console.error('Hiba az adatok lekérésekor:', err.message);
      return res.sendStatus(500);
    }
    res.json(rows);
  });
});

// === APP INDÍTÁSA ===
app.listen(port, () => {
  console.log(`Szerver fut a http://localhost:${port} címen`);
});
