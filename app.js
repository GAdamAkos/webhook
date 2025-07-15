require('dotenv').config();
const express = require('express');
const { MongoClient } = require('mongodb');

const app = express();
const port = process.env.PORT || 3000;
const mongoClient = new MongoClient(process.env.MONGODB_URI);
let messagesCollection;

app.use(express.json());

// MongoDB kapcsolódás
async function connectToMongoDB() {
  try {
    await mongoClient.connect();
    const db = mongoClient.db('whatsapp'); // adatbázis neve
    messagesCollection = db.collection('messages'); // gyűjtemény neve
    console.log('✅ MongoDB kapcsolat létrejött');
  } catch (err) {
    console.error('❌ MongoDB csatlakozási hiba:', err);
    process.exit(1);
  }
}

// Webhook fogadása
app.post('/webhook', async (req, res) => {
  const body = req.body;

  if (!body || !body.entry) {
    return res.status(400).json({ error: 'Érvénytelen webhook payload' });
  }

  try {
    for (const entry of body.entry) {
      const changes = entry.changes || [];

      for (const change of changes) {
        const value = change.value;

        // Üzenet érkezése
        if (value.messages && Array.isArray(value.messages)) {
          for (const message of value.messages) {
            const messageData = {
              type: 'incoming',
              messageId: message.id,
              from: message.from,
              timestamp: message.timestamp,
              content: message,
              receivedAt: new Date()
            };

            await messagesCollection.insertOne(messageData);
            console.log('📥 Üzenet elmentve:', messageData);
          }
        }

        // Státusz érkezése (pl. sent, delivered, read)
        if (value.statuses && Array.isArray(value.statuses)) {
          for (const status of value.statuses) {
            const statusData = {
              type: 'status',
              messageId: status.id,
              status: status.status,
              timestamp: status.timestamp,
              recipientId: status.recipient_id,
              content: status,
              receivedAt: new Date()
            };

            await messagesCollection.insertOne(statusData);
            console.log('📬 Válasz/státusz elmentve:', statusData);
          }
        }
      }
    }

    res.sendStatus(200);
  } catch (err) {
    console.error('❌ Hiba a webhook feldolgozása közben:', err);
    res.sendStatus(500);
  }
});

// Üzenetek lekérdezése
app.get('/messages', async (req, res) => {
  try {
    const messages = await messagesCollection.find().sort({ receivedAt: -1 }).toArray();
    res.json(messages);
  } catch (err) {
    console.error('❌ Hiba az üzenetek lekérdezésekor:', err);
    res.sendStatus(500);
  }
});

// Egyszerű ellenőrző GET endpoint a webhook validálásához (Meta/Facebook API-hoz)
app.get('/webhook', (req, res) => {
  const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN;

  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode && token) {
    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
      console.log('✅ Webhook validálás sikeres');
      return res.status(200).send(challenge);
    } else {
      return res.sendStatus(403);
    }
  }

  res.sendStatus(400);
});

// Szerver indítása
app.listen(port, async () => {
  console.log(`🚀 Szerver fut a http://localhost:${port} címen`);
  await connectToMongoDB();
});
