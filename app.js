app.post('/webhook', (req, res) => {
  console.log('Webhook kérés érkezett:', JSON.stringify(req.body, null, 2));

  try {
    const body = req.body;
    const entry = body.entry && body.entry[0];
    const changes = entry && entry.changes && entry.changes[0];
    const value = changes && changes.value;
    const messages = value && value.messages;

    if (!messages || messages.length === 0) {
      return res.sendStatus(200); // nincs új üzenet
    }

    const message = messages[0];
    const from = message.from;
    const messageBody = message.text?.body || '';
    const messageType = message.type || 'unknown';

    // Kontakt keresése vagy létrehozása
    db.get(`SELECT id FROM contacts WHERE wa_id = ?`, [from], (err, row) => {
      if (err) {
        console.error('Kontakt lekérdezési hiba:', err);
        return res.sendStatus(500);
      }

      if (row) {
        saveMessage(row.id);
      } else {
        db.run(`INSERT INTO contacts (wa_id) VALUES (?)`, [from], function(err) {
          if (err) {
            console.error('Kontakt beszúrási hiba:', err);
            return res.sendStatus(500);
          }
          saveMessage(this.lastID);
        });
      }
    });

    function saveMessage(contactId) {
      db.run(
        `INSERT INTO messages (contact_id, message_body, message_type) VALUES (?, ?, ?)`,
        [contactId, messageBody, messageType],
        function(err) {
          if (err) {
            console.error('Üzenet beszúrási hiba:', err);
            return res.sendStatus(500);
          }
          console.log(`✅ Üzenet elmentve, ID: ${this.lastID}`);
          res.sendStatus(200);
        }
      );
    }
  } catch (e) {
    console.error('Webhook feldolgozási hiba:', e);
    res.sendStatus(400);
  }
});
