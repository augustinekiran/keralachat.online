const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const cors = require('cors');
const { savePublicMessage, getLastPublicMessages } = require('./db');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

// Health check endpoints for Render, monitoring & ping services (GET and HEAD)
const healthHandler = (req, res) => {
  res.status(200);
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('X-Online-Users', users.size);
  if (req.method === 'HEAD') {
    return res.end();
  }
  return res.json({
    status: 'ok',
    onlineUsers: users.size,
    timestamp: new Date().toISOString()
  });
};

app.get('/health', healthHandler);
app.head('/health', healthHandler);

/**
 * In-memory active online users state
 * - Users map: socket.id -> { id, username, gender, joinedAt }
 */
const users = new Map();

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).substring(2, 8);
}

function sanitizeText(text) {
  if (typeof text !== 'string') return '';
  return text.trim();
}

function broadcastUserList() {
  const userList = Array.from(users.values()).map(u => ({
    id: u.id,
    username: u.username,
    gender: u.gender,
    joinedAt: u.joinedAt
  }));
  io.emit('user_list', userList);
}

io.on('connection', (socket) => {
  // Guest Login / Reconnect Event
  socket.on('login', async (data, callback) => {
    try {
      const rawUsername = data?.username || '';
      const rawGender = data?.gender || '';

      const username = sanitizeText(rawUsername);
      const gender = (rawGender || '').toLowerCase().trim();

      // Validation
      if (!username || username.length < 2 || username.length > 20) {
        return callback?.({
          success: false,
          message: 'Username must be between 2 and 20 characters.'
        });
      }

      if (!/^[a-zA-Z0-9_ -]+$/.test(username)) {
        return callback?.({
          success: false,
          message: 'Username can only contain letters, numbers, spaces, underscores, and hyphens.'
        });
      }

      if (gender !== 'male' && gender !== 'female') {
        return callback?.({
          success: false,
          message: 'Please select a valid gender (Male or Female).'
        });
      }

      // Check if username is taken by ANOTHER active socket
      const existingUserEntry = Array.from(users.entries()).find(
        ([sockId, u]) => u.username.toLowerCase() === username.toLowerCase() && sockId !== socket.id
      );

      if (existingUserEntry) {
        const [existingSockId] = existingUserEntry;
        const existingSocket = io.sockets.sockets.get(existingSockId);
        // If the other socket is disconnected/dead, remove it so the refreshed user can reclaim it
        if (!existingSocket || !existingSocket.connected) {
          users.delete(existingSockId);
        } else {
          return callback?.({
            success: false,
            message: 'This username is currently active in another session. Please choose another.'
          });
        }
      }

      const userData = {
        id: socket.id,
        username,
        gender,
        joinedAt: Date.now()
      };

      users.set(socket.id, userData);

      // System join notification for public chat
      const joinNotice = {
        id: generateId(),
        isSystem: true,
        text: `${username} joined the chat.`,
        timestamp: Date.now()
      };

      // Save system join notice to DB
      savePublicMessage(joinNotice).catch(err => console.error('DB save error:', err));

      // Broadcast system notice to other users
      socket.broadcast.emit('public_message', joinNotice);

      // Load last 10 public messages from SQLite database
      const publicHistory = await getLastPublicMessages(10);
      const onlineUsers = Array.from(users.values());

      callback?.({
        success: true,
        user: userData,
        publicHistory,
        users: onlineUsers
      });

      // Broadcast updated user list to all connected clients
      broadcastUserList();
    } catch (err) {
      console.error('Error during login:', err);
      callback?.({ success: false, message: 'Server error during login.' });
    }
  });

  // Public Message Event
  socket.on('public_message', async (data) => {
    const user = users.get(socket.id);
    if (!user) return;

    const rawText = data?.text || '';
    const text = sanitizeText(rawText);

    if (!text || text.length === 0 || text.length > 1000) return;

    const message = {
      id: generateId(),
      senderId: user.id,
      senderName: user.username,
      senderGender: user.gender,
      text,
      timestamp: Date.now(),
      isSystem: false,
      isPrivate: false
    };

    // Save message to SQLite database
    try {
      await savePublicMessage(message);
    } catch (err) {
      console.error('Error saving public message to DB:', err);
    }

    // Broadcast to everyone including sender
    io.emit('public_message', message);
  });

  // Private Direct Message Event
  socket.on('private_message', (data, callback) => {
    const sender = users.get(socket.id);
    if (!sender) {
      return callback?.({ success: false, message: 'You are not logged in.' });
    }

    const recipientId = data?.recipientId;
    const recipientUsername = data?.recipientUsername;

    // Find recipient either by socket ID or by username (in case reconnected)
    let recipient = null;
    if (recipientId) {
      recipient = users.get(recipientId);
    }
    if (!recipient && recipientUsername) {
      recipient = Array.from(users.values()).find(
        u => u.username.toLowerCase() === recipientUsername.toLowerCase()
      );
    }

    if (!recipient) {
      return callback?.({ success: false, message: 'User is no longer online.' });
    }

    const text = sanitizeText(data?.text || '');
    if (!text || text.length === 0 || text.length > 1000) {
      return callback?.({ success: false, message: 'Invalid message.' });
    }

    const message = {
      id: generateId(),
      senderId: sender.id,
      senderName: sender.username,
      senderGender: sender.gender,
      recipientId: recipient.id,
      recipientName: recipient.username,
      recipientGender: recipient.gender,
      text,
      timestamp: Date.now(),
      isPrivate: true
    };

    // Send directly to recipient socket
    io.to(recipient.id).emit('private_message', message);

    // Send confirmation back to sender socket
    socket.emit('private_message', message);

    callback?.({ success: true, message });
  });

  // Typing Indicator Event
  socket.on('typing', (data) => {
    const user = users.get(socket.id);
    if (!user) return;

    const isTyping = Boolean(data?.isTyping);
    const recipientId = data?.recipientId;

    if (recipientId && recipientId !== 'public') {
      // Private typing notification
      io.to(recipientId).emit('user_typing', {
        senderId: user.id,
        senderName: user.username,
        isTyping,
        isPrivate: true
      });
    } else {
      // Public room typing notification to everyone else
      socket.broadcast.emit('user_typing', {
        senderId: user.id,
        senderName: user.username,
        isTyping,
        isPrivate: false
      });
    }
  });

  // Disconnection Event
  socket.on('disconnect', () => {
    const user = users.get(socket.id);
    if (user) {
      users.delete(socket.id);

      const leaveNotice = {
        id: generateId(),
        isSystem: true,
        text: `${user.username} left the chat.`,
        timestamp: Date.now()
      };

      savePublicMessage(leaveNotice).catch(err => console.error('DB save error on leave:', err));

      // Notify others in public room
      socket.broadcast.emit('public_message', leaveNotice);
      broadcastUserList();
    }
  });
});

server.listen(PORT, () => {
  console.log(`KeralaChat Server running at http://localhost:${PORT}`);
});
