require('dotenv').config();
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const app = express();
const port = process.env.PORT || 3000;

// SQLite adatbázis elérési útja (ugyanebben a mappában)
const dbPath = path.resolve(__dirname, 'whatsapp_messages.db');
const db = new sqlite3.Database(dbPath);

// Adatbázis tábla létrehozása, ha még nincs
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      message TEXT NOT NULL,
      receivedAt DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `, (err) => {
    if (err) {
      console.error('Hiba az üzenetek tábla létrehozásakor:', err.message);
    } else {
      console.log('Messages tábla készen áll');
    }
  });
});

app.use(express.json());

// === WEBHOOK VERIFICATION (Facebook GET kérés) ===
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

// === WEBHOOK MESSAGE RECEIVER (Facebook POST kérés) ===
app.post('/webhook', (req, res) => {
  const message = req.body;

  if (!message || Object.keys(message).length === 0) {
    return res.status(400).json({ error: 'Üres üzenet' });
  }

  // Üzenet beszúrása SQLite táblába
  const insertQuery = `INSERT INTO messages (message) VALUES (?)`;
  db.run(insertQuery, [JSON.stringify(message)], function(err) {
    if (err) {
      console.error('Hiba az üzenet mentésekor:', err.message);
      res.sendStatus(500);
    } else {
      console.log(`Üzenet mentve, ID: ${this.lastID}`);
      res.sendStatus(200);
    }
  });
});

// === ÖSSZES ÜZENET LEKÉRDEZÉSE ===
app.get('/messages', (req, res) => {
  db.all(`SELECT * FROM messages ORDER BY receivedAt DESC`, [], (err, rows) => {
    if (err) {
      console.error('Hiba az üzenetek lekérdezésekor:', err.message);
      res.sendStatus(500);
    } else {
      // JSON-ból visszaalakítjuk az eredeti objektumokat
      const messages = rows.map(row => ({
        id: row.id,
        message: JSON.parse(row.message),
        receivedAt: row.receivedAt
      }));
      res.json(messages);
    }
  });
});

// === APP INDÍTÁSA ===
app.listen(port, () => {
  console.log(`Szerver fut a http://localhost:${port} címen`);
});
