require('dotenv').config();
const axios = require('axios');
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const FormData = require('form-data');

const app = express();
app.use(express.static(path.join(__dirname, 'public')));
app.use('/sent-media', express.static(path.join(__dirname, 'public/sent_media')));
app.use('/uploads', express.static(path.join(__dirname, 'public/uploads')));
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
    CREATE TABLE IF NOT EXISTS sent_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      phone TEXT,
      type TEXT,
      content TEXT,
      timestamp TEXT,
      media_url TEXT,
      wa_message_id TEXT UNIQUE
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

app.get('/available-templates', async (req, res) => {
    const phoneNumberId = process.env.PHONE_NUMBER_ID;
    const accessToken = process.env.ACCESS_TOKEN;

    console.log('📞 Lekérdezett PHONE_NUMBER_ID:', phoneNumberId);

    if (!phoneNumberId || !accessToken) {
        return res.status(500).json({ error: 'PHONE_NUMBER_ID vagy ACCESS_TOKEN hiányzik a környezeti változók közül.' });
    }

    try {
        const response = await axios.get(
            `https://graph.facebook.com/v19.0/${phoneNumberId}/message_templates`,
            {
                headers: {
                    Authorization: `Bearer ${accessToken}`
                }
            }
        );

    // Átalakítás: sablon neve → paraméter helyőrzők
    const simplified = {};
    response.data.data.forEach(t => {
      const components = t.components || [];
      const body = components.find(c => c.type === 'BODY');
      const text = body?.text || '';
      const placeholders = [...text.matchAll(/{{(\d+)}}/g)].map(match => `Paraméter ${match[1]}`);
      simplified[t.name] = placeholders;
    });

    res.json(simplified);
  } catch (error) {
    console.error('❌ Hiba a sablonok lekérésénél:', error.response?.data || error.message);
    res.status(500).json({ message: 'Nem sikerült lekérni a sablonokat.' });
  }
});

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

        // 💾 Mentés az adatbázisba
        if (response.data.messages && response.data.messages[0]?.id) {
            await db.run(
                `INSERT INTO sent_messages (wa_message_id, phone, type, content, timestamp)
         VALUES (?, ?, ?, ?, ?)`,
                [
                    response.data.messages[0].id,
                    phone,
                    'text',
                    message,
                    new Date().toISOString()
                ]
            );
        }

        res.json({ message: 'Üzenet sikeresen elküldve ✅' });
    } catch (error) {
        console.error('❌ Hiba az üzenetküldés során:', error.response?.data || error.message);
        res.status(500).json({ message: 'Hiba az üzenetküldés során' });
    }
});

app.post('/send-template', async (req, res) => {
    const { phone, templateName, languageCode = 'hu' } = req.body;
    const phoneNumberId = process.env.PHONE_NUMBER_ID;
    const accessToken = process.env.ACCESS_TOKEN;

    if (!phone || !templateName) {
        return res.status(400).json({ message: 'Hiányzó telefonszám vagy sablon név' });
    }

    try {
        const response = await axios.post(
            `https://graph.facebook.com/v19.0/${phoneNumberId}/messages`,
            {
                messaging_product: 'whatsapp',
                to: phone,
                type: 'template',
                template: {
                    name: templateName,
                    language: {
                        code: languageCode,
                    },
                },
            },
            {
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                    'Content-Type': 'application/json',
                },
            }
        );

        console.log('✅ Sablon üzenet elküldve:', response.data);

        // 💾 Mentés a sent_messages táblába
        if (response.data.messages && response.data.messages[0]?.id) {
            await db.run(
                `INSERT INTO sent_messages (wa_message_id, phone, type, content, timestamp, media_url)
         VALUES (?, ?, ?, ?, ?, ?)`,
                [
                    response.data.messages[0].id,
                    phone,
                    'template',
                    templateName,
                    new Date().toISOString(),
                    null  // nincs media_url
                ]
            );
        }

        res.json({ message: 'Sablon üzenet sikeresen elküldve ✅' });
    } catch (error) {
        console.error('❌ Hiba a sablon üzenet küldésekor:', error.response?.data || error.message);
        res.status(500).json({ message: 'Hiba a sablon üzenet küldésekor' });
    }
});

const upload = multer({ dest: 'uploads/' });

app.post('/send-file-message', upload.single('file'), async (req, res) => {
    const { phone, message } = req.body;
    const phoneNumberId = process.env.PHONE_NUMBER_ID;
    const accessToken = process.env.ACCESS_TOKEN;
    const file = req.file;

    if (!phone || !file) {
        return res.status(400).json({ message: 'Hiányzó telefonszám vagy fájl' });
    }

    try {
        // 1. Média feltöltése
        const form = new FormData();
        form.append('messaging_product', 'whatsapp');
        form.append('file', fs.createReadStream(file.path), {
            filename: file.originalname || 'upload',
            contentType: file.mimetype || 'application/octet-stream',
        });

        const mediaUpload = await axios.post(
            `https://graph.facebook.com/v19.0/${phoneNumberId}/media`,
            form,
            {
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                    ...form.getHeaders(), // ez automatikusan hozzáadja a megfelelő multipart content-type-ot
                },
            }
        );


        const mediaId = mediaUpload.data.id;

        // 2. Média üzenet küldése
        const mediaType = file.mimetype.startsWith('image') ? 'image' : 'document';
        const response = await axios.post(
            `https://graph.facebook.com/v19.0/${phoneNumberId}/messages`,
            {
                messaging_product: 'whatsapp',
                to: phone,
                type: mediaType,
                [mediaType]: {
                    id: mediaId,
                    caption: message || ''
                }
            },
            {
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                    'Content-Type': 'application/json'
                }
            }
        );

        const sentMediaDir = path.join(__dirname, 'public/sent_media');
            fs.mkdirSync(sentMediaDir, { recursive: true });
            
            const localFilename = `${Date.now()}_${file.originalname}`;
            const localPath = path.join(__dirname, 'public/sent_media', localFilename);
            fs.renameSync(file.path, localPath);
            
            const mediaUrl = `/sent-media/${localFilename}`;

        console.log('✅ Média üzenet elküldve:', response.data);

        // 3. 💾 Mentés a sent_messages táblába
        if (response.data.messages && response.data.messages[0]?.id) {
            await db.run(
                `INSERT INTO sent_messages (wa_message_id, phone, type, content, timestamp, media_url)
         VALUES (?, ?, ?, ?, ?, ?)`,
                [
                    response.data.messages[0].id,
                    phone,
                    mediaType,
                    message || '',
                    new Date().toISOString(),
                    mediaUrl
                ]
            );
        }

        res.json({ message: 'Fájl sikeresen elküldve ✅' });
    } catch (error) {
        console.error('❌ Média küldési hiba:', error.response?.data || error.message);
        res.status(500).json({ message: 'Hiba a fájl küldésekor' });
    } finally {
        // Fájl törlése a szerverről
        if (file && file.path) {
            fs.unlink(file.path, () => {});
        }
    }
});

// Webhook POST - üzenet és kontakt mentése
fs.mkdirSync(path.join(__dirname, 'public/uploads'), { recursive: true });   // Biztos, hogy létezik a mappa

app.post('/webhook', async (req, res) => {
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
        const messageType = message.type;
        const wa_message_id = message.id;
        const timestamp = new Date().toISOString();

        let messageBody = '';

        // --- 🎯 KEZELÉS: Kép vagy dokumentum ---
        if (messageType === 'image' || messageType === 'document') {
            const mediaId = message[messageType]?.id;
            const accessToken = process.env.ACCESS_TOKEN;

            try {
                const mediaInfo = await axios.get(`https://graph.facebook.com/v19.0/${mediaId}`, {
                    headers: { Authorization: `Bearer ${accessToken}` }
                });

                const mediaUrl = mediaInfo.data.url;
                const mediaResponse = await axios.get(mediaUrl, {
                    responseType: 'stream',
                    headers: { Authorization: `Bearer ${accessToken}` }
                });

                const ext = messageType === 'image' ? '.jpg' : path.extname(message.document?.filename || '.bin');
                const fileName = `${messageType}_${Date.now()}${ext}`;
                const filePath = path.join(__dirname, 'public/uploads', fileName);
                const fileUrl = `/uploads/${fileName}`;
                const writer = fs.createWriteStream(filePath);
                mediaResponse.data.pipe(writer);

                messageBody = fileUrl;

                console.log(`📁 ${messageType} fájl mentve: ${fileUrl}`);
            } catch (err) {
                console.error(`❌ Hiba a(z) ${messageType} letöltésénél:`, err.response?.data || err.message);
                messageBody = '(media letöltési hiba)';
            }
        }

        // --- 📝 Szöveges üzenet ---
        if (messageType === 'text') {
            messageBody = message.text?.body || '';
        }

        // --- 🔽 Mentés adatbázisba ---
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

    // --- 🔁 Státuszok mentése ---
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

app.get('/sent-messages', (req, res) => {
    db.all(`SELECT * FROM sent_messages ORDER BY timestamp DESC`, [], (err, rows) => {
        if (err) {
            console.error('❌ Hiba az üzenetek lekérdezésénél:', err.message);
            return res.status(500).json({ message: 'Adatbázis hiba' });
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
