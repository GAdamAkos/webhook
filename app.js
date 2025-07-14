// Import Express.js és más szükséges modulok
const express = require('express');
const fs = require('fs');
const axios = require('axios');
const path = require('path');

// Express app létrehozása
const app = express();

// Middleware a JSON feldolgozásához
app.use(express.json());

// Port és VERIFY_TOKEN / ACCESS_TOKEN környezeti változókból
const port = process.env.PORT || 3000;
const verifyToken = process.env.VERIFY_TOKEN;
const accessToken = process.env.ACCESS_TOKEN;

// messages.json fájl elérési útja
const messagesPath = path.join(__dirname, 'messages.json');

// GET webhook ellenőrzéshez
app.get('/', (req, res) => {
  const { 'hub.mode': mode, 'hub.challenge': challenge, 'hub.verify_token': token } = req.query;

  if (mode === 'subscribe' && token === verifyToken) {
    console.log('WEBHOOK VERIFIED');
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

// POST webhook bejövő üzenetekhez
app.post('/', async (req, res) => {
  const timestamp = new Date().toISOString().replace('T', ' ').slice(0, 19);
  console.log(`\nWebhook received ${timestamp}\n`);
  console.log(JSON.stringify(req.body, null, 2));

  // Ellenőrzés, hogy van-e bejövő üzenet
  const entry = req.body.entry?.[0];
  const changes = entry?.changes?.[0];
  const messages = changes?.value?.messages?.[0];

  if (messages) {
    const from = messages.from; // Feladó telefonszáma
    const text = messages.text?.body || '[nem szöveges üzenet]';

    // Üzenet mentése JSON fájlba
    let storedMessages = [];
    try {
      if (fs.existsSync(messagesPath)) {
        storedMessages = JSON.parse(fs.readFileSync(messagesPath, 'utf8'));
      }
    } catch (err) {
      console.error('Hiba a messages.json olvasásakor:', err);
    }

    const newMessage = { from, text, timestamp, reply: "" };
    storedMessages.push(newMessage);
    fs.writeFileSync(messagesPath, JSON.stringify(storedMessages, null, 2), 'utf8');
    console.log('Üzenet mentve a messages.json fájlba.');

    // Automatikus válasz, ha van beállított válasz
    if (newMessage.reply && newMessage.reply.trim() !== "") {
      try {
        await axios.post(
          'https://graph.facebook.com/v18.0/675376605666287/messages',
          {
            messaging_product: 'whatsapp',
            to: from,
            text: { body: newMessage.reply }
          },
          {
            headers: {
              Authorization: `Bearer ${accessToken}`,
              'Content-Type': 'application/json'
            }
          }
        );
        console.log('Válasz elküldve:', newMessage.reply);
      } catch (error) {
        console.error('Hiba az üzenet küldésekor:', error.response?.data || error.message);
      }
    }
  }

  res.sendStatus(200);
});

// Szerver indítása
app.listen(port, () => {
  console.log(`\nListening on port ${port}\n`);
});
