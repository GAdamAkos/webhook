require('dotenv').config();
const express = require('express');
const { MongoClient } = require('mongodb');

const app = express();
const port = process.env.PORT || 3000;
const mongoClient = new MongoClient(process.env.MONGODB_URI);
let messagesCollection;

app.use(express.json());

// Csatlakozás MongoDB-hez
async function connectToMongoDB() {
  try {
    await mongoClient.connect();
    const db = mongoClient.db('whatsapp'); // adatbázis neve
    messagesCollection = db.collection('messages'); // gyűjtemény neve
    console.log('MongoDB kapcsolat sikeres');
  } catch (err) {
    console.error('MongoDB csatlakozási hiba:', err);
    process.exit(1);
  }
}

// Webhook fogadása
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
    console.log('Üzenet mentve:', message);
    res.sendStatus(200);
  } catch (err) {
    console.error('Hiba az üzenet mentésekor:', err);
    res.sendStatus(500);
  }
});

// Összes üzenet lekérdezése
app.get('/messages', async (req, res) => {
  try {
    const messages = await messagesCollection.find().toArray();
    res.json(messages);
  } catch (err) {
    console.error('Hiba az üzenetek lekérdezésekor:', err);
    res.sendStatus(500);
  }
});

// Alkalmazás indítása
app.listen(port, async () => {
  console.log(`Szerver fut a http://localhost:${port} címen`);
  await connectToMongoDB();
});
