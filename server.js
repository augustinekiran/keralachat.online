const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const Database = require('better-sqlite3');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const db = new Database(path.join(__dirname, 'db', 'chatapp.db'));
db.pragma('journal_mode = WAL');

const onlineUsers = new Map();

const validGenders = new Set(['male', 'female']);

function normalizeUsername(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function normalizeGender(value) {
  return String(value || '').trim().toLowerCase();
}

function getUserById(userId) {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
}

function getOnlineUsers() {
  return Array.from(onlineUsers.values())
    .map((user) => ({
      id: user.userId,
      username: user.username,
      gender: user.gender,
    }))
    .sort((a, b) => a.username.localeCompare(b.username));
}

function broadcastOnlineUsers() {
  io.emit('online-users', getOnlineUsers());
}

function getPublicMessages(limit = 10, offset = 0) {
  const queryLimit = Number(limit) || 10;
  const queryOffset = Number(offset) || 0;

  return db
    .prepare(`
      SELECT m.id, m.message, m.created_at, u.id AS sender_id, u.username AS sender_name
      FROM messages m
      JOIN users u ON u.id = m.sender_id
      WHERE m.room_type = 'public'
      ORDER BY m.created_at ASC
      LIMIT ? OFFSET ?
    `)
    .all(queryLimit, queryOffset)
    .map((row) => ({
      id: row.id,
      senderId: row.sender_id,
      senderName: row.sender_name,
      roomType: 'public',
      message: row.message,
      createdAt: row.created_at,
    }));
}

function getPrivateMessages(currentUserId, otherUserId) {
  return db
    .prepare(`
      SELECT m.id, m.message, m.created_at, sender.id AS sender_id, sender.username AS sender_name,
             receiver.id AS receiver_id, receiver.username AS receiver_name
      FROM messages m
      JOIN users sender ON sender.id = m.sender_id
      LEFT JOIN users receiver ON receiver.id = m.receiver_id
      WHERE (
        (m.room_type = 'private' AND m.sender_id = ? AND m.receiver_id = ?)
        OR
        (m.room_type = 'private' AND m.sender_id = ? AND m.receiver_id = ?)
      )
      ORDER BY m.created_at ASC
    `)
    .all(currentUserId, otherUserId, otherUserId, currentUserId)
    .map((row) => ({
      id: row.id,
      senderId: row.sender_id,
      senderName: row.sender_name,
      receiverId: row.receiver_id,
      roomType: 'private',
      message: row.message,
      createdAt: row.created_at,
    }));
}

function getSocketIdForUser(userId) {
  for (const [socketId, user] of onlineUsers.entries()) {
    if (Number(user.userId) === Number(userId)) {
      return socketId;
    }
  }
  return null;
}

function ensureDatabase() {
  db.prepare(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      gender TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `).run();

  db.prepare(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sender_id INTEGER NOT NULL,
      receiver_id INTEGER,
      room_type TEXT NOT NULL CHECK(room_type IN ('public', 'private')),
      message TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(sender_id) REFERENCES users(id),
      FOREIGN KEY(receiver_id) REFERENCES users(id)
    )
  `).run();
}

ensureDatabase();

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'Chat server is running' });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

io.on('connection', (socket) => {
  console.log('client connected', socket.id);
  socket.emit('online-users', getOnlineUsers());

  socket.on('register', ({ username, gender }) => {
    console.log('register event received', { username, gender, socketId: socket.id });
    const cleanUsername = normalizeUsername(username);
    const cleanGender = normalizeGender(gender);

    if (!cleanUsername) {
      return socket.emit('register-error', 'Username is required.');
    }

    if (!validGenders.has(cleanGender)) {
      return socket.emit('register-error', 'Please choose a valid gender.');
    }

    let user = db.prepare('SELECT * FROM users WHERE LOWER(username) = LOWER(?)').get(cleanUsername);

    if (!user) {
      const insert = db
        .prepare('INSERT INTO users (username, gender) VALUES (?, ?)')
        .run(cleanUsername, cleanGender);
      user = getUserById(insert.lastInsertRowid);
    } else {
      db.prepare('UPDATE users SET gender = ? WHERE id = ?').run(cleanGender, user.id);
      user = getUserById(user.id);
    }

    const previousSocket = getSocketIdForUser(user.id);
    if (previousSocket && previousSocket !== socket.id) {
      io.to(previousSocket).emit('account-reconnected', {
        message: 'You have connected from another browser tab and this session was replaced.',
      });
      onlineUsers.delete(previousSocket);
    }

    socket.data.user = user;
    onlineUsers.set(socket.id, {
      userId: user.id,
      username: user.username,
      gender: user.gender,
    });

    socket.emit('joined', {
      user,
      roomType: 'public',
      targetUserId: null,
    });

    socket.emit('room-history', {
      roomType: 'public',
      targetUserId: null,
      messages: getPublicMessages(10, 0),
    });

    broadcastOnlineUsers();
    socket.emit('system-message', {
      message: `Welcome to the public room, ${user.username}!`,
    });
    socket.broadcast.emit('system-message', {
      message: `${user.username} joined the public chat room.`,
    });
  });

  socket.on('load-room', ({ roomType, targetUserId }) => {
    const user = socket.data.user;
    if (!user) {
      return;
    }

    if (roomType === 'public') {
      const messages = getPublicMessages(10, 0);
      socket.emit('room-history', {
        roomType: 'public',
        targetUserId: null,
        messages,
      });
      return;
    }

    if (roomType === 'private' && targetUserId) {
      const messages = getPrivateMessages(user.id, targetUserId);
      socket.emit('room-history', {
        roomType: 'private',
        targetUserId,
        messages,
      });
    }
  });

  socket.on('load-more-public', ({ offset = 0 }) => {
    const user = socket.data.user;
    if (!user) {
      return;
    }

    const messages = getPublicMessages(10, Number(offset) || 0);
    socket.emit('more-public-messages', {
      messages,
      offset: Number(offset) || 0,
    });
  });

  socket.on('send-message', ({ message, roomType, targetUserId }) => {
    const user = socket.data.user;
    if (!user) {
      return;
    }

    const cleanMessage = String(message || '').trim();
    if (!cleanMessage) {
      return;
    }

    if (roomType === 'public') {
      const payload = {
        id: Date.now(),
        senderId: user.id,
        senderName: user.username,
        roomType: 'public',
        message: cleanMessage,
        createdAt: new Date().toISOString(),
      };

      db.prepare(
        'INSERT INTO messages (sender_id, receiver_id, room_type, message) VALUES (?, ?, ?, ?)'
      ).run(user.id, null, 'public', cleanMessage);

      io.emit('new-message', payload);
      return;
    }

    if (roomType === 'private') {
      const target = Number(targetUserId);
      if (!target || target === user.id) {
        return;
      }

      const timestamp = new Date().toISOString();
      const insert = db
        .prepare(
          'INSERT INTO messages (sender_id, receiver_id, room_type, message, created_at) VALUES (?, ?, ?, ?, ?)'
        )
        .run(user.id, target, 'private', cleanMessage, timestamp);

      const payload = {
        id: insert.lastInsertRowid,
        senderId: user.id,
        senderName: user.username,
        receiverId: target,
        roomType: 'private',
        message: cleanMessage,
        createdAt: timestamp,
      };

      const targetSocketId = getSocketIdForUser(target);
      socket.emit('new-message', payload);
      if (targetSocketId) {
        io.to(targetSocketId).emit('new-message', payload);
      }
    }
  });

  socket.on('disconnect', () => {
    const user = socket.data.user;
    if (!user) {
      return;
    }

    onlineUsers.delete(socket.id);
    broadcastOnlineUsers();
    socket.broadcast.emit('system-message', {
      message: `${user.username} left the chat.`,
    });
  });
});

const PORT = process.env.PORT || 3002;
server.listen(PORT, () => {
  console.log(`Chat app running on http://localhost:${PORT}`);
});
