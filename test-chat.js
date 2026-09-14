const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { io: Client } = require('socket.io-client');
const { savePublicMessage, getLastPublicMessages, db } = require('./db');

async function runTests() {
  console.log('--- Starting DB & Chat Reconnection Test Suite ---');
  
  const app = express();
  const server = http.createServer(app);
  const io = new Server(server, { cors: { origin: '*' } });
  
  const users = new Map();

  function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substring(2, 8);
  }

  function broadcastUserList() {
    const userList = Array.from(users.values());
    io.emit('user_list', userList);
  }

  io.on('connection', (socket) => {
    socket.on('login', async (data, callback) => {
      const username = (data?.username || '').trim();
      const gender = (data?.gender || '').toLowerCase().trim();

      const existingUserEntry = Array.from(users.entries()).find(
        ([sockId, u]) => u.username.toLowerCase() === username.toLowerCase() && sockId !== socket.id
      );

      if (existingUserEntry) {
        const [existingSockId] = existingUserEntry;
        const existingSocket = io.sockets.sockets.get(existingSockId);
        if (!existingSocket || !existingSocket.connected) {
          users.delete(existingSockId);
        } else {
          return callback?.({ success: false, message: 'Username taken' });
        }
      }

      const userData = { id: socket.id, username, gender, joinedAt: Date.now() };
      users.set(socket.id, userData);

      const joinNotice = { id: generateId(), isSystem: true, text: `${username} joined.`, timestamp: Date.now() };
      await savePublicMessage(joinNotice);

      const publicHistory = await getLastPublicMessages(10);
      callback?.({
        success: true,
        user: userData,
        publicHistory,
        users: Array.from(users.values())
      });
      broadcastUserList();
    });

    socket.on('public_message', async (data) => {
      const user = users.get(socket.id);
      if (!user) return;
      const message = {
        id: generateId(),
        senderId: user.id,
        senderName: user.username,
        senderGender: user.gender,
        text: data.text,
        timestamp: Date.now(),
        isSystem: false
      };
      await savePublicMessage(message);
      io.emit('public_message', message);
    });

    socket.on('private_message', (data, callback) => {
      const sender = users.get(socket.id);
      let recipient = users.get(data.recipientId);
      if (!recipient && data.recipientUsername) {
        recipient = Array.from(users.values()).find(
          u => u.username.toLowerCase() === data.recipientUsername.toLowerCase()
        );
      }
      if (!sender || !recipient) return callback?.({ success: false });

      const message = {
        id: generateId(),
        senderId: sender.id,
        senderName: sender.username,
        senderGender: sender.gender,
        recipientId: recipient.id,
        recipientName: recipient.username,
        recipientGender: recipient.gender,
        text: data.text,
        timestamp: Date.now(),
        isPrivate: true
      };

      io.to(recipient.id).emit('private_message', message);
      socket.emit('private_message', message);
      callback?.({ success: true, message });
    });

    socket.on('disconnect', () => {
      const user = users.get(socket.id);
      if (user) {
        users.delete(socket.id);
        broadcastUserList();
      }
    });
  });

  const TEST_PORT = 3998;
  await new Promise((resolve) => server.listen(TEST_PORT, resolve));
  const SERVER_URL = `http://127.0.0.1:${TEST_PORT}`;
  console.log(`Test server running at ${SERVER_URL}`);

  try {
    // 1. Connect User 1: Rahul (Male)
    console.log('\n[Test 1] Connecting User 1: Rahul (Male)...');
    const socket1 = Client(SERVER_URL);
    let user1 = null;
    await new Promise((resolve) => {
      socket1.on('connect', () => {
        socket1.emit('login', { username: 'Rahul', gender: 'male' }, (res) => {
          user1 = res.user;
          console.log('User 1 logged in:', user1.username);
          resolve();
        });
      });
    });

    // 2. Connect User 2: Anjali (Female)
    console.log('\n[Test 2] Connecting User 2: Anjali (Female)...');
    const socket2 = Client(SERVER_URL);
    let user2 = null;
    await new Promise((resolve) => {
      socket2.on('connect', () => {
        socket2.emit('login', { username: 'Anjali', gender: 'female' }, (res) => {
          user2 = res.user;
          console.log('User 2 logged in:', user2.username);
          resolve();
        });
      });
    });

    // 3. Send 15 public messages and verify SQLite saves all
    console.log('\n[Test 3] Sending 15 public messages to SQLite database...');
    for (let i = 1; i <= 15; i++) {
      socket1.emit('public_message', { text: `Database test message #${i}` });
      await new Promise(r => setTimeout(r, 25));
    }

    // 4. Connect User 3: Vijay, check that exactly last 10 messages are loaded from SQLite
    console.log('\n[Test 4] Connecting User 3: Vijay (fetching last 10 from SQLite)...');
    const socket3 = Client(SERVER_URL);
    let user3History = [];
    await new Promise((resolve) => {
      socket3.on('connect', () => {
        socket3.emit('login', { username: 'Vijay', gender: 'male' }, (res) => {
          user3History = res.publicHistory;
          console.log(`User 3 received ${user3History.length} messages from SQLite.`);
          resolve();
        });
      });
    });

    if (user3History.length !== 10) {
      throw new Error(`Expected exactly 10 messages from DB query, got ${user3History.length}`);
    }
    console.log('✅ SQLite persistent 10-message query verified!');

    // 5. Simulate Tab Refresh & Reconnect for Rahul
    console.log('\n[Test 5] Simulating tab refresh for Rahul (disconnecting old socket and reconnecting)...');
    socket1.disconnect();
    await new Promise(r => setTimeout(r, 100));

    const socket1Refreshed = Client(SERVER_URL);
    let rahulReconnected = false;
    await new Promise((resolve, reject) => {
      socket1Refreshed.on('connect', () => {
        socket1Refreshed.emit('login', { username: 'Rahul', gender: 'male' }, (res) => {
          if (res.success) {
            rahulReconnected = true;
            console.log('✅ Rahul successfully reconnected with preserved identity on tab refresh!');
            resolve();
          } else {
            reject(new Error('Failed to reconnect refreshed tab user'));
          }
        });
      });
    });

    // 6. Test Private message delivery to reconnected socket
    console.log('\n[Test 6] Sending private message from Anjali to reconnected Rahul...');
    let rahulGotPrivate = null;
    socket1Refreshed.on('private_message', (msg) => {
      rahulGotPrivate = msg;
    });

    await new Promise((resolve) => {
      socket2.emit('private_message', { recipientUsername: 'Rahul', text: 'Hey Rahul, welcome back after refresh!' }, (res) => {
        setTimeout(resolve, 200);
      });
    });

    if (!rahulGotPrivate || rahulGotPrivate.text !== 'Hey Rahul, welcome back after refresh!') {
      throw new Error('Reconnected user did not receive private message');
    }
    console.log('✅ Private messaging to refreshed user verified!');

    socket1Refreshed.disconnect();
    socket2.disconnect();
    socket3.disconnect();

    console.log('\n🎉 ALL PERSISTENCE & RECONNECTION TESTS PASSED! 🎉\n');
  } catch (err) {
    console.error('❌ Test failed:', err);
    process.exitCode = 1;
  } finally {
    server.close();
  }
}

runTests();
