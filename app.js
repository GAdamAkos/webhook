const express = require('express');
const fs = require('fs');
const path = require('path');
const axios = require('axios');

const app = express();
app.use(express.json());

// Messages tároló fájl helye
const MESSAGES_FILE = path.join(__dirname, 'messages.json');

// Környezeti változók
const port = process.env.PORT || 3000;
const verifyToken = process.env.VERIFY_TOKEN;
const whatsappToken = process.env.WHATSAPP_TOKEN;       // Meta API tokened
const phoneNumberId = process.env.PHONE_NUMBER_ID;      // WhatsApp Business Phone Number ID

// Segédfüggvény üzenetek mentésére
function saveMessage(message) {
  let messages = [];
  if (fs.existsSync(MESSAGES_FILE)) {
    messages = JSON.parse(fs.readFileSync(MESSAGES_FILE));
  }
  messages.push(message);
  fs.writeFileSync(MESSAGES_FILE, JSON.stringify(messages, null, 2));
}

// Webhook GET ellenőrzés
app.get('/', (req, res) => {
  const { 'hub.mode': mode, 'hub.challenge': challenge, 'hub.verify_token': token } = req.query;

  if (mode === 'subscribe' && token === verifyToken) {
    console.log('WEBHOOK VERIFIED');
    res.status(200).send(challenge);
  } else {
    res.status(403).end();
  }
});

// Webhook POST - bejövő üzenetek fogadása és mentése
app.post('/', (req, res) => {
  const msg = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
  if (msg) {
    const messageData = {
      from: msg.from,
      id: msg.id,
      timestamp: new Date().toISOString(),
      text: msg.text?.body || '[Nem szöveges üzenet]'
    };
    saveMessage(messageData);
    console.log('Üzenet mentve:', messageData);
  }
  res.sendStatus(200);
});

// Lekérdezhető üzenetek listája JSON-ként
app.get('/messages', (req, res) => {
  if (fs.existsSync(MESSAGES_FILE)) {
    const messages = JSON.parse(fs.readFileSync(MESSAGES_FILE));
    res.json(messages);
  } else {
    res.json([]);
  }
});

// Meta API-n keresztül válasz küldése
async function sendReply(to, message) {
  if (!whatsappToken || !phoneNumberId) {
    throw new Error('Hiányzó WhatsApp token vagy Phone Number ID környezeti változó.');
  }

  const url = `https://graph.facebook.com/v15.0/${phoneNumberId}/messages`;

  const data = {
    messaging_product: 'whatsapp',
    to: to,
    text: {
      body: message
    }
  };

  await axios.post(url, data, {
    headers: {
      'Authorization': `Bearer ${whatsappToken}`,
      'Content-Type': 'application/json'
    }
  });
}

// Válasz küldése POST-tal
app.post('/reply', async (req, res) => {
  const { to, message } = req.body;
  if (!to || !message) {
    return res.status(400).send('Hiányzik a "to" vagy a "message" a kérésből.');
  }
  try {
    await sendReply(to, message);
    res.send('Válasz elküldve');
  } catch (e) {
    console.error(e);
    res.status(500).send('Hiba a válasz küldésekor.');
  }
});

// Szerver indítása
app.listen(port, () => {
  console.log(`Listening on port ${port}`);
});
