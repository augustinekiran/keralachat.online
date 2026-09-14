const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

// Ensure db directory exists
const dbDir = path.join(__dirname, 'db');
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const dbPath = path.join(dbDir, 'chatapp.db');
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Failed to open SQLite database:', err.message);
  } else {
    console.log('Connected to SQLite database at:', dbPath);
  }
});

// Initialize Tables
db.serialize(() => {
  // Public Messages Table
  db.run(`
    CREATE TABLE IF NOT EXISTS public_messages (
      id TEXT PRIMARY KEY,
      sender_id TEXT,
      sender_name TEXT,
      sender_gender TEXT,
      text TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      is_system INTEGER DEFAULT 0
    )
  `);

  // Index on timestamp for rapid order & limit queries
  db.run(`
    CREATE INDEX IF NOT EXISTS idx_public_messages_timestamp 
    ON public_messages (timestamp DESC)
  `);
});

/**
 * Insert a public chat message
 */
function savePublicMessage(msg) {
  return new Promise((resolve, reject) => {
    const stmt = db.prepare(`
      INSERT INTO public_messages (id, sender_id, sender_name, sender_gender, text, timestamp, is_system)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      msg.id,
      msg.senderId || null,
      msg.senderName || 'System',
      msg.senderGender || null,
      msg.text,
      msg.timestamp || Date.now(),
      msg.isSystem ? 1 : 0,
      function (err) {
        if (err) {
          console.error('Error saving public message:', err);
          return reject(err);
        }
        resolve(this.lastID);
      }
    );
    stmt.finalize();
  });
}

/**
 * Retrieve the last N public messages in chronological order
 */
function getLastPublicMessages(limit = 10) {
  return new Promise((resolve, reject) => {
    db.all(
      `
      SELECT 
        id, 
        sender_id as senderId, 
        sender_name as senderName, 
        sender_gender as senderGender, 
        text, 
        timestamp, 
        is_system as isSystem
      FROM public_messages 
      ORDER BY timestamp DESC 
      LIMIT ?
      `,
      [limit],
      (err, rows) => {
        if (err) {
          console.error('Error fetching public messages:', err);
          return reject(err);
        }
        // Convert isSystem from 0/1 to boolean and reverse to chronological order
        const messages = (rows || []).map(r => ({
          ...r,
          isSystem: Boolean(r.isSystem),
          isPrivate: false
        })).reverse();
        resolve(messages);
      }
    );
  });
}

module.exports = {
  db,
  savePublicMessage,
  getLastPublicMessages
};
