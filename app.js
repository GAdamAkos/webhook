require('dotenv').config();
const axios = require('axios');
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const multer = require('multer');

const app = express();
app.use(express.static(path.join(__dirname, 'public')));
const port = process.env.PORT || 3000;

const upload = multer({ dest: 'uploads/' }); // ideiglenes fájltárolás

const dbPath = path.resolve(__dirname, 'whatsapp_messages.db');
console.log('📂 Adatbázis fájl helye:', dbPath);

const db = new sqlite3.Database(dbPath);

// Tábla létrehozások (meglévő részed megtartva)
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS contacts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    wa_id TEXT UNIQUE,
    name TEXT
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    contact_id INTEGER,
    message_body TEXT,
    message_type TEXT,
    received_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    wa_message_id TEXT UNIQUE,
    FOREIGN KEY(contact_id) REFERENCES contacts(id)
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS message_metadata (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    message_id INTEGER,
    status TEXT,
    timestamp TEXT,
    error_code INTEGER,
    error_message TEXT,
    FOREIGN KEY(message_id) REFERENCES messages(id)
  )`);
  console.log('✅ Adatbázis táblák készen állnak');
});

app.use(express.json());

// Webhook verifikáció (marad)
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

// Szöveges üzenet küldése
app.post('/send-message', async (req, res) => {
  const { phone, message } = req.body;
  const phoneNumberId = process.env.PHONE_NUMBER_ID;
  const accessToken = process.env.ACCESS_TOKEN;

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
        text: { body: message },
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

// 📎 Fájlüzenet küldése (új)
app.post('/send-file-message', upload.single('file'), async (req, res) => {
  const file = req.file;
  const { phone, message } = req.body;
  const phoneNumberId = process.env.PHONE_NUMBER_ID;
  const accessToken = process.env.ACCESS_TOKEN;

  if (!file || !phone) {
    return res.status(400).json({ message: 'Fájl és telefonszám kötelező' });
  }

  try {
    // 1️⃣ Először a fájlt fel kell tölteni a Meta Graph API-ra
    const formData = new FormData();
    formData.append('file', fs.createReadStream(file.path));
    formData.append('type', 'image/jpeg'); // vagy: application/pdf stb.

    const mediaUpload = await axios.post(
      `https://graph.facebook.com/v19.0/${phoneNumberId}/media`,
      formData,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          ...formData.getHeaders(),
        },
      }
    );

    const mediaId = mediaUpload.data.id;
    console.log('🖼 Fájl feltöltve, media ID:', mediaId);

    // 2️⃣ Fájl üzenet elküldése
    const messageType = file.mimetype.startsWith('image/') ? 'image' : 'document';

    const payload = {
      messaging_product: 'whatsapp',
      to: phone,
      type: messageType,
      [messageType]: {
        id: mediaId,
        caption: message || '',
      },
    };

    const sendResponse = await axios.post(
      `https://graph.facebook.com/v19.0/${phoneNumberId}/messages`,
      payload,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      }
    );

    console.log('✅ Fájl üzenet elküldve:', sendResponse.data);
    res.json({ message: 'Fájl elküldve ✅' });
  } catch (err) {
    console.error('❌ Hiba fájlküldés során:', err.response?.data || err.message);
    res.status(500).json({ message: 'Hiba történt a fájlküldés során' });
  } finally {
    fs.unlink(file.path, () => {}); // töröljük az ideiglenes fájlt
  }
});

// 🔁 Webhook POST mentés (meglévő webhook marad érintetlen)
app.post('/webhook', (req, res) => {
  // ... változatlan ...
  // benne van contact + message + metadata mentésed
  // (meghagyom, nem ismétlem meg)
  res.sendStatus(200);
});

// Lekérdező endpointok (változatlan)
app.get('/contacts', (req, res) => {
  const query = `SELECT id AS ID, wa_id AS Phone_number, name AS Name FROM contacts ORDER BY id ASC`;
  db.all(query, [], (err, rows) => {
    if (err) return res.sendStatus(500);
    res.json(rows);
  });
});

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
    if (err) return res.sendStatus(500);
    res.json(rows);
  });
});

app.get('/message-metadata', (req, res) => {
  const query = `
    SELECT id AS ID, message_id AS Message_ID, status AS Status,
    timestamp AS Timestamp, error_code AS Error_Code, error_message AS Error_Message
    FROM message_metadata ORDER BY id ASC
  `;
  db.all(query, [], (err, rows) => {
    if (err) return res.sendStatus(500);
    res.json(rows);
  });
});

// DB letöltés
app.get('/download-db', (req, res) => {
  fs.access(dbPath, fs.constants.F_OK, (err) => {
    if (err) return res.status(404).send('Fájl nem található.');
    res.download(dbPath, 'whatsapp_messages.db');
  });
});

// Szerver indítás
app.listen(port, '0.0.0.0', () => {
  console.log(`🚀 Szerver fut a http://0.0.0.0:${port} címen`);
});
