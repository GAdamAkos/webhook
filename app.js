require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
const port = process.env.PORT || 3000;

// JSON fájl elérési útja
const messagesFilePath = path.resolve(__dirname, 'messages.json');

// Köztes réteg a JSON feldolgozáshoz
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
      return res.sendStatus(200);
    }

    const message = messages[0];
    const from = message.from;
    const messageBody = message.text?.body || '';
    const messageType = message.type || 'unknown';
    const receivedAt = new Date().toISOString();

    const newMessage = {
      from,
      messageBody,
      messageType,
      receivedAt
    };

    // Régi üzenetek beolvasása, ha van már fájl
    let existingMessages = [];
    if (fs.existsSync(messagesFilePath)) {
      const raw = fs.readFileSync(messagesFilePath);
      existingMessages = JSON.parse(raw);
    }

    // Új üzenet hozzáadása és fájlba írás
    existingMessages.push(newMessage);
    fs.writeFileSync(messagesFilePath, JSON.stringify(existingMessages, null, 2));

    console.log('Üzenet mentve a JSON fájlba');
    res.sendStatus(200);
  } catch (e) {
    console.error('Webhook feldolgozási hiba:', e);
    res.sendStatus(400);
  }
});

// MENTETT ÜZENETEK MEGJELENÍTÉSE
app.get('/messages', (req, res) => {
  if (fs.existsSync(messagesFilePath)) {
    const data = fs.readFileSync(messagesFilePath);
    res.setHeader('Content-Type', 'application/json');
    res.send(data);
  } else {
    res.send('[]');
  }
});

// APP INDÍTÁSA
app.listen(port, '0.0.0.0', () => {
  console.log(`Szerver fut a http://0.0.0.0:${port} címen`);
});
