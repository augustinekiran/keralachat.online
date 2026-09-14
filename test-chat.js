const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { io: Client } = require('socket.io-client');
const path = require('path');

// Test runner with in-process server test
async function runTests() {
  console.log('--- Starting In-Process Test Suite ---');
  
  // Set up test server
  const app = express();
  const server = http.createServer(app);
  const io = new Server(server, { cors: { origin: '*' } });
  
  const users = new Map();
  const MAX_PUBLIC_HISTORY = 10;
  const publicMessages = [];

  function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substring(2, 8);
  }

  function broadcastUserList() {
    const userList = Array.from(users.values());
    io.emit('user_list', userList);
  }

  io.on('connection', (socket) => {
    socket.on('login', (data, callback) => {
      const username = (data?.username || '').trim();
      const gender = (data?.gender || '').toLowerCase().trim();

      const isTaken = Array.from(users.values()).some(
        u => u.username.toLowerCase() === username.toLowerCase()
      );

      if (isTaken) {
        return callback?.({ success: false, message: 'Username taken' });
      }

      const userData = { id: socket.id, username, gender, joinedAt: Date.now() };
      users.set(socket.id, userData);

      const joinNotice = { id: generateId(), isSystem: true, text: `${username} joined.`, timestamp: Date.now() };
      publicMessages.push(joinNotice);
      if (publicMessages.length > MAX_PUBLIC_HISTORY) publicMessages.shift();

      callback?.({
        success: true,
        user: userData,
        publicHistory: [...publicMessages],
        users: Array.from(users.values())
      });
      broadcastUserList();
    });

    socket.on('public_message', (data) => {
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
      publicMessages.push(message);
      if (publicMessages.length > MAX_PUBLIC_HISTORY) publicMessages.shift();
      io.emit('public_message', message);
    });

    socket.on('private_message', (data, callback) => {
      const sender = users.get(socket.id);
      const recipient = users.get(data.recipientId);
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

  const TEST_PORT = 3999;
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
          console.log('User 1 login successful:', user1.username, user1.gender);
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
          console.log('User 2 login successful:', user2.username, user2.gender);
          resolve();
        });
      });
    });

    // 3. Test Public Messages & Cap of 10 messages
    console.log('\n[Test 3] Sending 15 public messages to verify 10-message max buffer...');
    for (let i = 1; i <= 15; i++) {
      socket1.emit('public_message', { text: `Public test message #${i}` });
      await new Promise(r => setTimeout(r, 20));
    }

    // 4. Connect User 3 (Vijay) to check public history limit
    console.log('\n[Test 4] Connecting User 3 (Vijay) to check public history length...');
    const socket3 = Client(SERVER_URL);
    let user3History = [];
    await new Promise((resolve) => {
      socket3.on('connect', () => {
        socket3.emit('login', { username: 'Vijay', gender: 'male' }, (res) => {
          user3History = res.publicHistory;
          console.log(`User 3 received ${user3History.length} history messages (Max allowed: 10).`);
          resolve();
        });
      });
    });

    if (user3History.length !== 10) {
      throw new Error(`Expected exactly 10 messages in public history buffer, got ${user3History.length}`);
    }
    console.log('✅ 10-message limit verified successfully!');

    // 5. Test Private Chat routing
    console.log('\n[Test 5] Sending private message from Anjali to Rahul...');
    let user1ReceivedPrivate = null;
    let user3ReceivedPrivate = false;

    socket1.on('private_message', (msg) => {
      user1ReceivedPrivate = msg;
    });

    socket3.on('private_message', () => {
      user3ReceivedPrivate = true;
    });

    await new Promise((resolve) => {
      socket2.emit('private_message', { recipientId: user1.id, text: 'Hello Rahul, secret direct chat!' }, (res) => {
        setTimeout(resolve, 200);
      });
    });

    if (!user1ReceivedPrivate || user1ReceivedPrivate.text !== 'Hello Rahul, secret direct chat!') {
      throw new Error('User 1 did not receive the expected private message');
    }
    if (user3ReceivedPrivate) {
      throw new Error('User 3 unexpectedly received private message meant for User 1!');
    }
    console.log('✅ Private message properly delivered ONLY to recipient!');

    // 6. Test duplicate username rejection
    console.log('\n[Test 6] Testing duplicate username rejection...');
    const socket4 = Client(SERVER_URL);
    await new Promise((resolve, reject) => {
      socket4.on('connect', () => {
        socket4.emit('login', { username: 'rahul', gender: 'male' }, (res) => {
          if (!res.success) {
            console.log('✅ Duplicate username correctly rejected:', res.message);
            resolve();
          } else {
            reject(new Error('Duplicate username was incorrectly allowed'));
          }
        });
      });
    });

    socket1.disconnect();
    socket2.disconnect();
    socket3.disconnect();
    socket4.disconnect();

    console.log('\n🎉 ALL 6 TEST CASES PASSED PERFECTLY! 🎉\n');
  } catch (err) {
    console.error('❌ Test failed:', err);
    process.exitCode = 1;
  } finally {
    server.close();
  }
}

runTests();
