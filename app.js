require('dotenv').config();
const axios = require('axios');
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const app = express();
app.use(express.static(path.join(__dirname, 'public')));
const port = process.env.PORT || 3000;

const dbPath = path.resolve(__dirname, 'whatsapp_messages.db');
console.log('📂 Adatbázis fájl helye:', dbPath);

const db = new sqlite3.Database(dbPath);

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

// Webhook verifikáció
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

app.post('/send-message', async (req, res) => {
  const { phone, message } = req.body;
  const phoneNumberId = process.env.PHONE_NUMBER_ID;
  const accessToken = process.env.ACCESS_TOKEN;

  console.log('🚩 Access Token:', process.env.ACCESS_TOKEN);
  console.log('🚩 All env vars:', process.env);

  console.log('Access token:', accessToken);  // <--- Itt a log

  if (!phone || !message) {
    return res.status(400).json({ message: 'Hiányzó adat (telefonszám vagy üzenet)' });
  }

  try {
    const response = await axios.post(
      `https://graph.facebook.com/v19.0/${phoneNumberId}/messages`,
      {
        messaging_product: 'whatsapp',
        to: phone,
        type: 'text',
        text: {
          preview_url: false,
          body: message
        },
      },
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      }
    );
    console.log('✅ Üzenet elküldve:', response.data);
    res.json({ message: 'Üzenet sikeresen elküldve ✅' });
  } catch (error) {
    console.error('❌ Hiba az üzenetküldés során:', error.response?.data || error.message);
    res.status(500).json({ message: 'Hiba az üzenetküldés során' });
  }
});
// Webhook POST - üzenet és kontakt mentése
app.post('/webhook', (req, res) => {
  console.log("📨 Webhook kérés érkezett:", JSON.stringify(req.body, null, 2));

  const entry = req.body.entry?.[0];
  const changes = entry?.changes?.[0];
  const value = changes?.value;

  const contactsData = value?.contacts?.[0];
  const wa_id = contactsData?.wa_id || null;
  const name = contactsData?.profile?.name || null;

  if (wa_id) {
    if (name) {
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

  const messages = value?.messages;
  if (messages) {
    const message = messages[0];
    const messageBody = message.text?.body || '';
    const messageType = message.type;
    const timestamp = new Date().toISOString();
    const wa_message_id = message.id;

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
        if (err) {
          console.error(`❌ Hiba üzenet keresésnél (metadata mentéshez):`, err);
          return;
        }

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

// JSON válasz: Összes kontakt
app.get('/contacts', (req, res) => {
  const query = `
    SELECT id AS ID, wa_id AS Phone_number, name AS Name
    FROM contacts
    ORDER BY id ASC
  `;

  db.all(query, [], (err, rows) => {
    if (err) {
      console.error('❌ Hiba a kontaktok lekérdezésekor:', err);
      return res.sendStatus(500);
    }
    res.json(rows);
  });
});

// JSON válasz: Összes üzenet
app.get('/messages', (req, res) => {
  const query = `
    SELECT 
      messages.id AS ID,
      contacts.wa_id AS Phone_number,
      contacts.name AS Name,
      messages.message_body AS Body,
      messages.message_type AS Type,
      datetime(messages.received_at, 'localtime') AS Received_at
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

// JSON válasz: Üzenet státusz metaadatok
app.get('/message-metadata', (req, res) => {
  const query = `
    SELECT 
      id AS ID,
      message_id AS Message_ID,
      status AS Status,
      timestamp AS Timestamp,
      error_code AS Error_Code,
      error_message AS Error_Message
    FROM message_metadata
    ORDER BY id ASC
  `;

  db.all(query, [], (err, rows) => {
    if (err) {
      console.error('❌ Hiba a message_metadata lekérdezésekor:', err);
      return res.sendStatus(500);
    }
    res.json(rows);
  });
});

// Adatbázis fájl letöltése
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

// Szerver indítása
app.listen(port, '0.0.0.0', () => {
  console.log(`🚀 Szerver fut a http://0.0.0.0:${port} címen`);
});
