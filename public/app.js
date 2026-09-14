/**
 * KeralaChat - Real-time Public & Private Chat Client
 * Pure In-Memory Ephemeral Guest Mode
 */

(() => {
  // DOM Elements - Login
  const loginScreen = document.getElementById('login-screen');
  const chatScreen = document.getElementById('chat-screen');
  const loginForm = document.getElementById('login-form');
  const usernameInput = document.getElementById('username-input');
  const loginError = document.getElementById('login-error');
  const loginBtn = document.getElementById('login-btn');

  // DOM Elements - Sidebar
  const chatSidebar = document.getElementById('chat-sidebar');
  const sidebarBackdrop = document.getElementById('sidebar-backdrop');
  const sidebarToggleBtn = document.getElementById('sidebar-toggle-btn');
  const sidebarCloseBtn = document.getElementById('sidebar-close-btn');
  const mobileUnreadDot = document.getElementById('mobile-unread-dot');
  const myAvatar = document.getElementById('my-avatar');
  const myUsernameDisplay = document.getElementById('my-username-display');
  const myGenderDisplay = document.getElementById('my-gender-display');
  const logoutBtn = document.getElementById('logout-btn');
  const publicChatNav = document.getElementById('public-chat-nav');
  const publicUnreadBadge = document.getElementById('public-unread-badge');
  const onlineCount = document.getElementById('online-count');
  const userSearchInput = document.getElementById('user-search-input');
  const usersList = document.getElementById('users-list');

  // DOM Elements - Chat Area
  const activeTargetAvatar = document.getElementById('active-target-avatar');
  const activeTargetName = document.getElementById('active-target-name');
  const activeTargetStatus = document.getElementById('active-target-status');
  const switchToPublicBtn = document.getElementById('switch-to-public-btn');
  const soundToggleBtn = document.getElementById('sound-toggle-btn');
  const soundIconOn = document.getElementById('sound-icon-on');
  const soundIconOff = document.getElementById('sound-icon-off');

  const messagesContainer = document.getElementById('messages-container');
  const messagesList = document.getElementById('messages-list');
  const roomNotice = document.getElementById('room-notice');
  const noticeText = document.getElementById('notice-text');
  const typingIndicator = document.getElementById('typing-indicator');
  const typingText = document.getElementById('typing-text');
  const scrollBottomBtn = document.getElementById('scroll-bottom-btn');
  const scrollUnreadCount = document.getElementById('scroll-unread-count');

  const messageForm = document.getElementById('message-form');
  const messageInput = document.getElementById('message-input');
  const quickEmojiBar = document.getElementById('quick-emoji-bar');

  // Application In-Memory State
  let socket = null;
  let currentUser = null;
  let activeChat = 'public'; // 'public' or recipient socket ID
  let activeRecipientUser = null; // object if private
  let onlineUsers = [];
  let publicHistory = []; // max 10 messages
  let privateChats = new Map(); // socketId -> message[]
  let unreadCounts = { public: 0 };
  let soundEnabled = true;
  let typingTimeout = null;
  let isTyping = false;
  let unreadBelowCount = 0;

  // Audio Context for subtle notification chimes
  let audioCtx = null;
  function initAudio() {
    if (!audioCtx) {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (AudioContext) {
        audioCtx = new AudioContext();
      }
    }
  }

  function playChime(isPrivate = false) {
    if (!soundEnabled) return;
    try {
      initAudio();
      if (!audioCtx) return;
      if (audioCtx.state === 'suspended') {
        audioCtx.resume();
      }
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sine';

      const now = audioCtx.currentTime;
      if (isPrivate) {
        // Higher pitch two-tone for private messages
        osc.frequency.setValueAtTime(587.33, now); // D5
        osc.frequency.setValueAtTime(880, now + 0.08); // A5
        gain.gain.setValueAtTime(0.08, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start(now);
        osc.stop(now + 0.25);
      } else {
        // Gentle soft pop for public messages
        osc.frequency.setValueAtTime(440, now); // A4
        gain.gain.setValueAtTime(0.05, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start(now);
        osc.stop(now + 0.18);
      }
    } catch (e) {
      // Audio playback might be restricted if no user interaction yet
    }
  }

  /**
   * Format timestamp in 12-hour AM/PM format (e.g., '10:14 PM')
   */
  function formatTimeAMPM(timestamp) {
    const date = new Date(timestamp);
    let hours = date.getHours();
    let minutes = date.getMinutes();
    const ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12;
    hours = hours ? hours : 12; // '0' becomes '12'
    minutes = minutes < 10 ? '0' + minutes : minutes;
    return `${hours}:${minutes} ${ampm}`;
  }

  /**
   * Helper: Return Male / Female Avatar SVG markup
   */
  function getAvatarSvg(gender) {
    if (gender === 'female') {
      return `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="12" cy="9" r="5"></circle>
        <line x1="12" y1="14" x2="12" y2="21"></line>
        <line x1="9" y1="18" x2="15" y2="18"></line>
      </svg>`;
    }
    // Male avatar
    return `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2">
      <circle cx="10" cy="14" r="5"></circle>
      <line x1="19" y1="5" x2="13.6" y2="10.4"></line>
      <polyline points="15 5 19 5 19 9"></polyline>
    </svg>`;
  }

  function getPublicIconSvg() {
    return `<svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="2" fill="none">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
      <circle cx="9" cy="7" r="4"></circle>
      <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
      <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
    </svg>`;
  }

  // =========================================================================
  // LOGIN FLOW
  // =========================================================================
  loginForm.addEventListener('submit', (e) => {
    e.preventDefault();
    initAudio();

    const username = usernameInput.value.trim();
    const genderInput = document.querySelector('input[name="gender"]:checked');
    const gender = genderInput ? genderInput.value : 'male';

    if (!username || username.length < 2 || username.length > 20) {
      showLoginError('Username must be between 2 and 20 characters.');
      return;
    }

    loginBtn.disabled = true;
    loginBtn.innerHTML = `<span>Joining...</span>`;
    loginError.classList.add('hidden');

    // Connect to Socket.IO
    if (!socket || !socket.connected) {
      socket = io();
      setupSocketListeners();
    }

    socket.emit('login', { username, gender }, (response) => {
      loginBtn.disabled = false;
      loginBtn.innerHTML = `
        <span>Join Chat Room</span>
        <svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" stroke-width="2" fill="none">
          <line x1="5" y1="12" x2="19" y2="12"></line>
          <polyline points="12 5 19 12 12 19"></polyline>
        </svg>
      `;

      if (response && response.success) {
        currentUser = response.user;
        publicHistory = response.publicHistory || [];
        onlineUsers = response.users || [];

        // Transition from Login to Chat
        loginScreen.classList.add('hidden');
        chatScreen.classList.remove('hidden');

        // Render Current User in Sidebar
        myAvatar.className = `avatar-wrapper ${currentUser.gender}`;
        myAvatar.innerHTML = getAvatarSvg(currentUser.gender);
        myUsernameDisplay.textContent = currentUser.username;
        myGenderDisplay.textContent = currentUser.gender;
        myGenderDisplay.className = `my-tag ${currentUser.gender}`;

        // Initialize User List & Public Room
        renderUsersList();
        switchToPublicChat();
        messageInput.focus();
      } else {
        showLoginError(response?.message || 'Failed to connect. Please try again.');
      }
    });
  });

  function showLoginError(msg) {
    loginError.textContent = msg;
    loginError.classList.remove('hidden');
  }

  // Logout / Leave
  logoutBtn.addEventListener('click', () => {
    if (confirm('Leave KeralaChat? Your active session and private chats will be cleared.')) {
      performLogout();
    }
  });

  function performLogout() {
    if (socket) {
      socket.disconnect();
      socket = null;
    }
    currentUser = null;
    activeChat = 'public';
    activeRecipientUser = null;
    onlineUsers = [];
    publicHistory = [];
    privateChats.clear();
    unreadCounts = { public: 0 };

    chatScreen.classList.add('hidden');
    loginScreen.classList.remove('hidden');
    usernameInput.value = '';
    loginError.classList.add('hidden');
    closeSidebar();
  }

  // =========================================================================
  // SOCKET LISTENERS
  // =========================================================================
  function setupSocketListeners() {
    socket.on('disconnect', () => {
      // Disconnected from server
    });

    socket.on('connect_error', (err) => {
      console.error('Connection error:', err);
    });

    // Updated Online User List
    socket.on('user_list', (users) => {
      onlineUsers = users;
      renderUsersList();
    });

    // Public Message
    socket.on('public_message', (message) => {
      // Append to public buffer (keep last 10)
      publicHistory.push(message);
      if (publicHistory.length > 10) {
        publicHistory.shift();
      }

      if (activeChat === 'public') {
        appendMessageElement(message);
        checkScrollAndNotify();
      } else {
        // User is currently in a private chat
        unreadCounts.public = (unreadCounts.public || 0) + 1;
        updatePublicUnreadBadge();
        updateMobileUnreadDot();
        playChime(false);
      }
    });

    // Private Message
    socket.on('private_message', (message) => {
      if (!currentUser) return;
      const isMine = message.senderId === currentUser.id;
      const partnerId = isMine ? message.recipientId : message.senderId;

      if (!privateChats.has(partnerId)) {
        privateChats.set(partnerId, []);
      }
      privateChats.get(partnerId).push(message);

      if (activeChat === partnerId) {
        appendMessageElement(message);
        checkScrollAndNotify();
      } else if (!isMine) {
        unreadCounts[partnerId] = (unreadCounts[partnerId] || 0) + 1;
        renderUsersList();
        updateMobileUnreadDot();
        playChime(true);
      }
    });

    // User Typing Indicator
    socket.on('user_typing', (data) => {
      const { senderId, senderName, isTyping: typing, isPrivate } = data;

      if (isPrivate) {
        if (activeChat === senderId && typing) {
          showTypingIndicator(`${senderName} is typing...`);
        } else if (activeChat === senderId && !typing) {
          hideTypingIndicator();
        }
      } else {
        if (activeChat === 'public' && typing) {
          showTypingIndicator(`${senderName} is typing...`);
        } else if (activeChat === 'public' && !typing) {
          hideTypingIndicator();
        }
      }
    });
  }

  // =========================================================================
  // SIDEBAR & ONLINE USER LIST
  // =========================================================================
  function renderUsersList() {
    const filter = (userSearchInput.value || '').toLowerCase().trim();
    // Exclude current user from private list
    const otherUsers = onlineUsers.filter(u => !currentUser || u.id !== currentUser.id);
    onlineCount.textContent = otherUsers.length;

    const filtered = otherUsers.filter(u => u.username.toLowerCase().includes(filter));

    usersList.innerHTML = '';

    if (filtered.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'empty-users-state';
      empty.textContent = otherUsers.length === 0 ? 'No other users online right now.' : 'No users found matching filter.';
      usersList.appendChild(empty);
      return;
    }

    filtered.forEach(user => {
      const item = document.createElement('div');
      item.className = `user-item ${activeChat === user.id ? 'active' : ''}`;
      item.dataset.userId = user.id;

      const unread = unreadCounts[user.id] || 0;

      item.innerHTML = `
        <div class="user-item-avatar ${user.gender}">
          ${getAvatarSvg(user.gender)}
          <span class="user-item-dot"></span>
        </div>
        <div class="user-item-info">
          <span class="user-item-name">${escapeHtml(user.username)}</span>
          <span class="user-item-meta">
            <span class="user-gender-tag ${user.gender}">${user.gender}</span>
            <span>• click to chat</span>
          </span>
        </div>
        ${unread > 0 ? `<span class="unread-badge">${unread}</span>` : ''}
      `;

      item.addEventListener('click', () => {
        switchToPrivateChat(user);
      });

      usersList.appendChild(item);
    });
  }

  userSearchInput.addEventListener('input', () => {
    renderUsersList();
  });

  // Static Public Chat Nav Click
  publicChatNav.addEventListener('click', () => {
    switchToPublicChat();
  });

  switchToPublicBtn.addEventListener('click', () => {
    switchToPublicChat();
  });

  function switchToPublicChat() {
    activeChat = 'public';
    activeRecipientUser = null;
    unreadCounts.public = 0;
    updatePublicUnreadBadge();
    updateMobileUnreadDot();

    // UI Updates
    publicChatNav.classList.add('active');
    switchToPublicBtn.classList.add('hidden');
    roomNotice.classList.remove('hidden');
    noticeText.textContent = 'Welcome to Public Chat! Only the latest 10 messages are retained. Click any user in the sidebar to start a private chat.';

    activeTargetAvatar.className = 'active-avatar public';
    activeTargetAvatar.innerHTML = getPublicIconSvg();
    activeTargetName.textContent = 'Public Chat';
    activeTargetStatus.textContent = 'All online members';
    messageInput.placeholder = 'Type a message to public chat...';

    // Render User items active class update
    renderUsersList();

    // Render Messages from public history
    renderPublicFeed();
    closeSidebar();
    hideTypingIndicator();
  }

  function switchToPrivateChat(user) {
    activeChat = user.id;
    activeRecipientUser = user;
    unreadCounts[user.id] = 0;
    updateMobileUnreadDot();

    // UI Updates
    publicChatNav.classList.remove('active');
    switchToPublicBtn.classList.remove('hidden');
    roomNotice.classList.remove('hidden');
    noticeText.textContent = `🔒 Direct 1-on-1 private chat with @${user.username}. Messages are in-memory and will be lost on refresh.`;

    activeTargetAvatar.className = `active-avatar ${user.gender}`;
    activeTargetAvatar.innerHTML = getAvatarSvg(user.gender);
    activeTargetName.textContent = user.username;
    activeTargetStatus.textContent = `Private Chat • ${user.gender.toUpperCase()} • Online`;
    messageInput.placeholder = `Send private message to @${user.username}...`;

    renderUsersList();
    renderPrivateFeed(user.id);
    closeSidebar();
    hideTypingIndicator();
    messageInput.focus();
  }

  function updatePublicUnreadBadge() {
    const unread = unreadCounts.public || 0;
    if (unread > 0) {
      publicUnreadBadge.textContent = unread > 99 ? '99+' : unread;
      publicUnreadBadge.classList.remove('hidden');
    } else {
      publicUnreadBadge.classList.add('hidden');
    }
  }

  function updateMobileUnreadDot() {
    const totalUnread = Object.values(unreadCounts).reduce((a, b) => a + b, 0);
    if (totalUnread > 0) {
      mobileUnreadDot.classList.remove('hidden');
    } else {
      mobileUnreadDot.classList.add('hidden');
    }
  }

  // =========================================================================
  // MESSAGE RENDERING
  // =========================================================================
  function renderPublicFeed() {
    messagesList.innerHTML = '';
    publicHistory.forEach(msg => {
      appendMessageElement(msg);
    });
    scrollToBottom(true);
  }

  function renderPrivateFeed(partnerId) {
    messagesList.innerHTML = '';
    const messages = privateChats.get(partnerId) || [];
    messages.forEach(msg => {
      appendMessageElement(msg);
    });
    scrollToBottom(true);
  }

  function appendMessageElement(msg) {
    // If system message
    if (msg.isSystem) {
      const sysEl = document.createElement('div');
      sysEl.className = 'system-message';
      sysEl.innerHTML = `
        <span>${escapeHtml(msg.text)}</span>
        <span class="time-str">${formatTimeAMPM(msg.timestamp)}</span>
      `;
      messagesList.appendChild(sysEl);
      return;
    }

    const isMine = currentUser && msg.senderId === currentUser.id;
    const timeStr = formatTimeAMPM(msg.timestamp);

    const row = document.createElement('div');
    row.className = `message-row ${isMine ? 'outgoing' : 'incoming'} ${msg.isPrivate ? 'is-private' : ''}`;

    row.innerHTML = `
      <div class="msg-avatar ${msg.senderGender || 'male'}">
        ${getAvatarSvg(msg.senderGender || 'male')}
      </div>
      <div class="msg-body-wrapper">
        ${!isMine ? `
          <div class="msg-meta">
            <span class="msg-sender-name ${msg.senderGender || 'male'}">${escapeHtml(msg.senderName)}</span>
            ${msg.isPrivate ? `<span class="private-tag-badge">🔒 Direct</span>` : ''}
          </div>
        ` : ''}
        <div class="msg-bubble">
          <div class="msg-text">${escapeHtml(msg.text)}</div>
          <span class="msg-time">${timeStr}</span>
        </div>
      </div>
    `;

    messagesList.appendChild(row);
  }

  function checkScrollAndNotify() {
    const isScrolledToBottom = messagesContainer.scrollHeight - messagesContainer.clientHeight <= messagesContainer.scrollTop + 120;
    if (isScrolledToBottom) {
      scrollToBottom();
    } else {
      unreadBelowCount++;
      scrollUnreadCount.textContent = unreadBelowCount;
      scrollUnreadCount.classList.remove('hidden');
      scrollBottomBtn.classList.remove('hidden');
    }
  }

  function scrollToBottom(force = false) {
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
    unreadBelowCount = 0;
    scrollBottomBtn.classList.add('hidden');
    scrollUnreadCount.classList.add('hidden');
  }

  messagesContainer.addEventListener('scroll', () => {
    const isAtBottom = messagesContainer.scrollHeight - messagesContainer.clientHeight <= messagesContainer.scrollTop + 60;
    if (isAtBottom) {
      unreadBelowCount = 0;
      scrollBottomBtn.classList.add('hidden');
      scrollUnreadCount.classList.add('hidden');
    } else {
      scrollBottomBtn.classList.remove('hidden');
    }
  });

  scrollBottomBtn.addEventListener('click', () => {
    scrollToBottom();
  });

  // =========================================================================
  // SEND MESSAGE & TYPING
  // =========================================================================
  messageForm.addEventListener('submit', (e) => {
    e.preventDefault();
    sendMessage();
  });

  function sendMessage() {
    const text = messageInput.value.trim();
    if (!text || !socket || !currentUser) return;

    if (activeChat === 'public') {
      socket.emit('public_message', { text });
    } else {
      // Private direct message
      const recipientId = activeChat;
      socket.emit('private_message', { recipientId, text }, (res) => {
        if (res && !res.success) {
          alert(res.message || 'Could not send message.');
        }
      });
    }

    messageInput.value = '';
    stopTyping();
    messageInput.focus();
  }

  // Quick Emoji Buttons
  quickEmojiBar.querySelectorAll('.quick-emoji').forEach(btn => {
    btn.addEventListener('click', () => {
      messageInput.value += btn.textContent;
      messageInput.focus();
      handleTyping();
    });
  });

  // Typing Throttling
  messageInput.addEventListener('input', () => {
    handleTyping();
  });

  function handleTyping() {
    if (!socket || !currentUser) return;
    if (!isTyping) {
      isTyping = true;
      socket.emit('typing', { isTyping: true, recipientId: activeChat });
    }
    clearTimeout(typingTimeout);
    typingTimeout = setTimeout(() => {
      stopTyping();
    }, 2000);
  }

  function stopTyping() {
    if (isTyping && socket) {
      isTyping = false;
      socket.emit('typing', { isTyping: false, recipientId: activeChat });
    }
  }

  function showTypingIndicator(text) {
    typingText.textContent = text;
    typingIndicator.classList.remove('hidden');
  }

  function hideTypingIndicator() {
    typingIndicator.classList.add('hidden');
  }

  // =========================================================================
  // SOUND TOGGLE
  // =========================================================================
  soundToggleBtn.addEventListener('click', () => {
    soundEnabled = !soundEnabled;
    if (soundEnabled) {
      soundIconOn.classList.remove('hidden');
      soundIconOff.classList.add('hidden');
      soundToggleBtn.title = 'Sound notifications ON';
      playChime(false);
    } else {
      soundIconOn.classList.add('hidden');
      soundIconOff.classList.remove('hidden');
      soundToggleBtn.title = 'Sound notifications MUTED';
    }
  });

  // =========================================================================
  // MOBILE DRAWER CONTROLS
  // =========================================================================
  function openSidebar() {
    chatSidebar.classList.add('open');
    sidebarBackdrop.classList.add('active');
  }

  function closeSidebar() {
    chatSidebar.classList.remove('open');
    sidebarBackdrop.classList.remove('active');
  }

  sidebarToggleBtn.addEventListener('click', openSidebar);
  sidebarCloseBtn.addEventListener('click', closeSidebar);
  sidebarBackdrop.addEventListener('click', closeSidebar);

  // Helper: XSS escape
  function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }
})();
