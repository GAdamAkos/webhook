require('dotenv').config();
const express = require('express');
const { MongoClient } = require('mongodb');

const app = express();
const port = process.env.PORT || 3000;

const mongoClient = new MongoClient(process.env.MONGODB_URI);
let messagesCollection;

// MongoDB kapcsolat
async function connectToMongoDB() {
  try {
    await mongoClient.connect();
    const db = mongoClient.db('whatsapp');
    messagesCollection = db.collection('messages');
    console.log('MongoDB kapcsolat sikeres');
  } catch (err) {
    console.error('MongoDB csatlakozási hiba:', err);
    process.exit(1);
  }
}

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
app.post('/webhook', async (req, res) => {
  const message = req.body;

  if (!message || Object.keys(message).length === 0) {
    return res.status(400).json({ error: 'Üres üzenet' });
  }

  try {
    await messagesCollection.insertOne({
      message,
      receivedAt: new Date()
    });
    console.log('Üzenet mentve MongoDB-be');
    res.sendStatus(200);
  } catch (err) {
    console.error('Hiba az üzenet mentésekor:', err);
    res.sendStatus(500);
  }
});

// === ÖSSZES ÜZENET LEKÉRDEZÉSE ===
app.get('/messages', async (req, res) => {
  try {
    const messages = await messagesCollection.find().toArray();
    res.json(messages);
  } catch (err) {
    console.error('Hiba az üzenetek lekérdezésekor:', err);
    res.sendStatus(500);
  }
});

// === APP INDÍTÁSA ===
app.listen(port, async () => {
  await connectToMongoDB();
  console.log(`Szerver fut a http://localhost:${port} címen`);
});
