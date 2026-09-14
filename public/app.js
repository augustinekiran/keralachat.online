const socket = io();
const authScreen = document.getElementById('authScreen');
const chatScreen = document.getElementById('chatScreen');
const registerForm = document.getElementById('registerForm');
const authMessage = document.getElementById('authMessage');
const chatForm = document.getElementById('chatForm');
const onlineUsersList = document.getElementById('onlineUsersList');
const roomTitle = document.getElementById('roomTitle');
const publicRoomBtn = document.getElementById('publicRoomBtn');
const messagesList = document.getElementById('messages');
const messageInput = document.getElementById('messageInput');
const sidebar = document.querySelector('.sidebar');
const sidebarToggle = document.getElementById('sidebarToggle');
const sidebarBackdrop = document.getElementById('sidebarBackdrop');

let currentUser = null;
let activeRoom = 'public';
let activePrivateUserId = null;
let sidebarOpen = true;
let currentOnlineUsers = [];
let unreadByRoom = { public: 0 };
let unreadByUser = {};
let publicMessageOffset = 0;
let publicHasMore = true;
let publicMessagesCache = [];
let isLoadingMorePublic = false;

function showAuthScreen() {
  authScreen.classList.remove('hidden');
  chatScreen.classList.add('hidden');
}

function showChatScreen() {
  authScreen.classList.add('hidden');
  chatScreen.classList.remove('hidden');
}

function setRoomTitle(title) {
  roomTitle.textContent = title;
}

function renderSystemMessage(message) {
  const row = document.createElement('div');
  row.className = 'message-system';
  row.textContent = message;
  messagesList.appendChild(row);
  scrollToBottom();
}

function scrollToBottom() {
  messagesList.scrollTop = messagesList.scrollHeight;
}

function formatIstTimestamp(value) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) {
    return '';
  }

  return new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(date);
}

function addMessageToChat(messageData) {
  if (!messageData || !currentUser) return;

  const row = document.createElement('div');
  const isMine = Number(messageData.senderId) === Number(currentUser.id);
  row.className = `message-row ${isMine ? 'mine' : 'other'}`;

  const bubble = document.createElement('div');
  bubble.className = 'message-bubble';

  const meta = document.createElement('span');
  meta.className = 'message-meta';
  if (messageData.roomType === 'public') {
    meta.textContent = messageData.senderName;
  } else {
    meta.textContent = isMine ? 'You' : messageData.senderName;
  }

  const text = document.createElement('div');
  text.textContent = messageData.message;

  const time = document.createElement('span');
  time.className = 'message-time';
  time.textContent = formatIstTimestamp(messageData.createdAt || new Date().toISOString());

  bubble.appendChild(meta);
  bubble.appendChild(text);
  bubble.appendChild(time);
  row.appendChild(bubble);
  messagesList.appendChild(row);
  scrollToBottom();
}

function renderMessages(messages, prepend = false) {
  if (!prepend) {
    messagesList.innerHTML = '';
  }

  messages.forEach((message) => {
    const row = document.createElement('div');
    const isMine = Number(message.senderId) === Number(currentUser?.id);
    row.className = `message-row ${isMine ? 'mine' : 'other'}`;

    const bubble = document.createElement('div');
    bubble.className = 'message-bubble';

    const meta = document.createElement('span');
    meta.className = 'message-meta';
    if (message.roomType === 'public') {
      meta.textContent = message.senderName;
    } else {
      meta.textContent = isMine ? 'You' : message.senderName;
    }

    const text = document.createElement('div');
    text.textContent = message.message;

    const time = document.createElement('span');
    time.className = 'message-time';
    time.textContent = formatIstTimestamp(message.createdAt || new Date().toISOString());

    bubble.appendChild(meta);
    bubble.appendChild(text);
    bubble.appendChild(time);
    row.appendChild(bubble);

    if (prepend) {
      const firstChild = messagesList.firstChild;
      if (firstChild) {
        messagesList.insertBefore(row, firstChild);
      } else {
        messagesList.appendChild(row);
      }
    } else {
      messagesList.appendChild(row);
    }
  });

  scrollToBottom();
}

function loadMorePublicMessages() {
  if (activeRoom !== 'public' || !publicHasMore || isLoadingMorePublic) {
    return;
  }

  isLoadingMorePublic = true;
  socket.emit('load-more-public', { offset: publicMessageOffset });
}

messagesList.addEventListener('scroll', () => {
  if (activeRoom !== 'public') return;
  if (messagesList.scrollTop <= 80) {
    loadMorePublicMessages();
  }
});

function renderOnlineUsers(users) {
  currentOnlineUsers = users || [];
  onlineUsersList.innerHTML = '';

  const currentUsers = currentOnlineUsers.filter((user) => Number(user.id) !== Number(currentUser?.id));

  if (!currentUsers.length) {
    const emptyItem = document.createElement('li');
    emptyItem.textContent = 'No other users online';
    emptyItem.style.color = '#9ca3af';
    emptyItem.style.padding = '10px 8px';
    onlineUsersList.appendChild(emptyItem);
    refreshUnreadBadges();
    return;
  }

  currentUsers.forEach((user) => {
    const item = document.createElement('li');
    item.className = 'user-item';
    item.dataset.userId = user.id;

    const labelWrap = document.createElement('div');
    labelWrap.className = 'user-main';

    const dot = document.createElement('span');
    dot.className = 'chat-dot';

    const userText = document.createElement('div');
    userText.className = 'user-text';
    userText.innerHTML = `
      <div class="user-name">${user.username}</div>
      <div class="user-gender">${user.gender}</div>
    `;

    labelWrap.appendChild(dot);
    labelWrap.appendChild(userText);
    item.appendChild(labelWrap);
    item.addEventListener('click', () => {
      activeRoom = 'private';
      activePrivateUserId = user.id;
      clearUnreadForUser(user.id);
      publicRoomBtn.classList.remove('active');
      setRoomTitle(`Private Chat: ${user.username}`);
      toggleSidebar(false);
      refreshUnreadBadges();
      socket.emit('load-room', { roomType: 'private', targetUserId: user.id });
    });

    const notification = document.createElement('span');
    notification.className = 'user-notification';
    if ((unreadByUser[user.id] || 0) > 0) {
      notification.textContent = unreadByUser[user.id] > 9 ? '9+' : unreadByUser[user.id];
    } else {
      notification.style.display = 'none';
    }
    item.appendChild(notification);
    onlineUsersList.appendChild(item);
  });

  refreshUnreadBadges();
}

registerForm.addEventListener('submit', (event) => {
  event.preventDefault();

  const username = document.getElementById('username').value.trim();
  const gender = document.getElementById('gender').value;

  if (!username || !gender) {
    authMessage.textContent = 'Please enter a username and select a gender.';
    authMessage.classList.add('error');
    return;
  }

  authMessage.classList.remove('error');
  authMessage.textContent = 'Connecting...';

  if (!socket.connected) {
    socket.connect();
  }

  socket.emit('register', { username, gender });
});

socket.on('connect', () => {
  if (authMessage && authMessage.textContent === 'Connecting...') {
    authMessage.textContent = '';
  }
});

socket.on('connect_error', () => {
  authMessage.textContent = 'Unable to reach the chat server. Please refresh and try again.';
  authMessage.classList.add('error');
});

chatForm.addEventListener('submit', (event) => {
  event.preventDefault();

  if (!currentUser) return;

  const message = messageInput.value.trim();
  if (!message) return;

  socket.emit('send-message', {
    message,
    roomType: activeRoom,
    targetUserId: activeRoom === 'private' ? activePrivateUserId : null,
  });

  messageInput.value = '';
  messageInput.focus();
});

publicRoomBtn.addEventListener('click', () => {
  activeRoom = 'public';
  activePrivateUserId = null;
  clearUnreadForRoom('public');
  publicRoomBtn.classList.add('active');
  setRoomTitle('Public Room');
  toggleSidebar(false);
  refreshUnreadBadges();
  socket.emit('load-room', { roomType: 'public', targetUserId: null });
});

function setNotificationBadge(element, count, className = 'unread-badge') {
  if (!element) return;

  let badge = element.querySelector(`.${className}`);
  if (count > 0) {
    if (!badge) {
      badge = document.createElement('span');
      badge.className = className;
      element.appendChild(badge);
    }
    badge.textContent = count > 9 ? '9+' : count;
  } else if (badge) {
    badge.remove();
  }
}

function refreshUnreadBadges() {
  setNotificationBadge(publicRoomBtn, unreadByRoom.public || 0);

  currentOnlineUsers.forEach((user) => {
    const userItem = document.querySelector(`.user-item[data-user-id="${user.id}"]`);
    if (!userItem) return;
    const count = unreadByUser[user.id] || 0;
    setNotificationBadge(userItem, count, 'user-notification');
  });
}

function clearUnreadForRoom(roomType) {
  if (roomType === 'public') {
    unreadByRoom.public = 0;
  }
}

function clearUnreadForUser(userId) {
  unreadByUser[userId] = 0;
}

function updateSidebarState() {
  const mobile = window.innerWidth <= 760;

  if (!mobile) {
    sidebar.classList.remove('sidebar-collapsed');
    sidebarBackdrop?.classList.remove('visible');
    sidebarOpen = true;
    return;
  }

  sidebar.classList.toggle('sidebar-collapsed', !sidebarOpen);
  sidebarBackdrop?.classList.toggle('visible', sidebarOpen);
}

function toggleSidebar(forceState) {
  if (window.innerWidth > 760) {
    return;
  }

  const nextState = typeof forceState === 'boolean' ? forceState : !sidebarOpen;
  sidebarOpen = nextState;
  updateSidebarState();
}

window.addEventListener('resize', updateSidebarState);
sidebarToggle.addEventListener('click', () => toggleSidebar());
sidebarBackdrop?.addEventListener('click', () => toggleSidebar(false));

document.addEventListener('click', (event) => {
  if (window.innerWidth > 760 || !sidebarOpen) return;

  const clickedSidebar = sidebar.contains(event.target) || sidebarToggle.contains(event.target);
  const clickedRoomButton = event.target.closest('.room-button');
  const clickedUserItem = event.target.closest('.user-item');

  if (!clickedSidebar && !clickedRoomButton && !clickedUserItem && !event.target.closest('.sidebar-backdrop')) {
    toggleSidebar(false);
  }
});

socket.on('register-error', (message) => {
  authMessage.textContent = message;
  authMessage.classList.add('error');
});

socket.on('joined', ({ user }) => {
  currentUser = user;
  authMessage.textContent = '';
  showChatScreen();
  setRoomTitle('Public Room');
  publicRoomBtn.classList.add('active');
  activeRoom = 'public';
  activePrivateUserId = null;
  toggleSidebar(true);
  updateSidebarState();
});

socket.on('room-history', ({ roomType, targetUserId, messages }) => {
  activeRoom = roomType;
  activePrivateUserId = roomType === 'private' ? targetUserId : null;

  if (roomType === 'public') {
    publicMessagesCache = messages || [];
    publicMessageOffset = publicMessagesCache.length;
    publicHasMore = publicMessagesCache.length >= 10;
    clearUnreadForRoom('public');
    publicRoomBtn.classList.add('active');
    setRoomTitle('Public Room');
  } else {
    clearUnreadForUser(targetUserId);
    publicRoomBtn.classList.remove('active');
    const userName = document.querySelector(`[data-user-id="${targetUserId}"] .user-name`);
    setRoomTitle(`Private Chat: ${userName ? userName.textContent : 'User'}`);
  }

  refreshUnreadBadges();
  renderMessages(messages || []);
});

socket.on('more-public-messages', ({ messages, offset }) => {
  isLoadingMorePublic = false;

  if (!messages || !messages.length) {
    publicHasMore = false;
    return;
  }

  publicMessagesCache = [...messages, ...publicMessagesCache];
  publicMessageOffset = Number(offset) + messages.length;
  publicHasMore = messages.length === 10;

  renderMessages(messages, true);
});

socket.on('online-users', (users) => {
  renderOnlineUsers(users || []);
});

socket.on('new-message', (messageData) => {
  const senderId = Number(messageData.senderId);
  const isPublicRoom = activeRoom === 'public' && messageData.roomType === 'public';
  const isPrivateRoom =
    activeRoom === 'private' &&
    messageData.roomType === 'private' &&
    senderId === Number(activePrivateUserId);

  const isOwnMessage = senderId === Number(currentUser?.id);

  if (messageData.roomType === 'public' && activeRoom === 'public') {
    publicMessagesCache.push(messageData);
    publicMessageOffset = publicMessagesCache.length;
    publicHasMore = publicMessagesCache.length >= 10;
    renderMessages(publicMessagesCache);
  } else if (isPublicRoom || isPrivateRoom || isOwnMessage) {
    addMessageToChat(messageData);
  }

  if (!isOwnMessage && messageData.roomType === 'public' && activeRoom !== 'public') {
    unreadByRoom.public = (unreadByRoom.public || 0) + 1;
  }

  if (!isOwnMessage && messageData.roomType === 'private' && !(activeRoom === 'private' && senderId === Number(activePrivateUserId))) {
    unreadByUser[senderId] = (unreadByUser[senderId] || 0) + 1;
  }

  refreshUnreadBadges();
});

socket.on('system-message', ({ message }) => {
  renderSystemMessage(message);
});

socket.on('account-reconnected', ({ message }) => {
  authMessage.textContent = message;
  authMessage.classList.add('error');
});

showAuthScreen();
