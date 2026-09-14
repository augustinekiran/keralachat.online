const fs = require('fs');
const path = require('path');

// Ensure db directory exists
const dbDir = path.join(__dirname, 'db');
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const dbFilePath = path.join(dbDir, 'messages.json');

// In-memory messages cache backed by JSON file persistence
let messagesCache = [];

try {
  if (fs.existsSync(dbFilePath)) {
    const rawData = fs.readFileSync(dbFilePath, 'utf8');
    messagesCache = JSON.parse(rawData || '[]');
  } else {
    fs.writeFileSync(dbFilePath, '[]', 'utf8');
  }
  console.log(`[Storage] Initialized persistent JSON storage (${messagesCache.length} public messages loaded).`);
} catch (err) {
  console.error('[Storage] Error loading messages from disk, initializing clean cache:', err);
  messagesCache = [];
}

let writeTimeout = null;
function persistToDisk() {
  clearTimeout(writeTimeout);
  writeTimeout = setTimeout(async () => {
    try {
      // Keep up to 2000 latest public messages on disk
      const dataToSave = messagesCache.slice(-2000);
      await fs.promises.writeFile(dbFilePath, JSON.stringify(dataToSave, null, 2), 'utf8');
    } catch (err) {
      console.error('[Storage] Error persisting messages to disk:', err);
    }
  }, 100);
}

/**
 * Insert a public chat message (Promise API)
 */
async function savePublicMessage(msg) {
  const formatted = {
    id: msg.id,
    senderId: msg.senderId || null,
    senderName: msg.senderName || 'System',
    senderGender: msg.senderGender || null,
    text: msg.text,
    timestamp: msg.timestamp || Date.now(),
    isSystem: Boolean(msg.isSystem),
    isPrivate: false
  };

  messagesCache.push(formatted);
  persistToDisk();
  return formatted;
}

/**
 * Retrieve the last N public messages in chronological order (Promise API)
 */
async function getLastPublicMessages(limit = 10) {
  const count = Math.max(1, limit);
  const recent = messagesCache.slice(-count);
  return recent.map(m => ({ ...m }));
}

module.exports = {
  savePublicMessage,
  getLastPublicMessages
};
