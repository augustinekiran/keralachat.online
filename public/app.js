/**
 * KeralaChat - Real-time Public & Private Chat Client
 * Clean & Simplified Architecture:
 * - SQLite-backed Public chat with last 10 messages on login
 * - Private chat history saved to tab sessionStorage
 * - Scrollable Online Users list
 * - 12-hour AM/PM timestamps, Male/Female avatar badges, and mobile drawer
 */

(() => {
  // Tab-level storage keys
  const SESSION_STORAGE_KEY = 'kc_tab_session';
  const PRIVATE_CHATS_STORAGE_KEY = 'kc_tab_private_chats';

  // DOM Elements - Login & Resume
  const loginScreen = document.getElementById('login-screen');
  const chatScreen = document.getElementById('chat-screen');
  const loginForm = document.getElementById('login-form');
  const usernameInput = document.getElementById('username-input');
  const loginError = document.getElementById('login-error');
  const loginBtn = document.getElementById('login-btn');

  const resumeSessionCard = document.getElementById('resume-session-card');
  const resumeAvatar = document.getElementById('resume-avatar');
  const resumeUsername = document.getElementById('resume-username');
  const resumeGender = document.getElementById('resume-gender');
  const resumeBtn = document.getElementById('resume-btn');
  const resumeBtnText = document.getElementById('resume-btn-text');
  const newGuestBtn = document.getElementById('new-guest-btn');

  // DOM Elements - Sidebar
  const chatSidebar = document.getElementById('chat-sidebar');
  const sidebarBackdrop = document.getElementById('sidebar-backdrop');
  const sidebarToggleBtn = document.getElementById('sidebar-toggle-btn');
  const sidebarCloseBtn = document.getElementById('sidebar-close-btn');
  const mobileUnreadDot = document.getElementById('mobile-unread-dot');
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
  const soundToggleBtn = document.getElementById('sound-toggle-btn');
  const soundIconOn = document.getElementById('sound-icon-on');
  const soundIconOff = document.getElementById('sound-icon-off');

  const messagesContainer = document.getElementById('messages-container');
  const messagesList = document.getElementById('messages-list');
  const typingIndicator = document.getElementById('typing-indicator');
  const typingText = document.getElementById('typing-text');
  const scrollBottomBtn = document.getElementById('scroll-bottom-btn');
  const scrollUnreadCount = document.getElementById('scroll-unread-count');

  const messageForm = document.getElementById('message-form');
  const messageInput = document.getElementById('message-input');
  const quickEmojiBar = document.getElementById('quick-emoji-bar');

  // State Management
  let socket = null;
  let currentUser = null;
  let activeChat = 'public'; // 'public' or 'private'
  let activeRecipientUser = null; // { id, username, gender } when in private
  let onlineUsers = [];
  let publicHistory = []; // last 10 messages
  let privateChats = new Map(); // partnerUsername -> Array<Message>
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
        osc.frequency.setValueAtTime(587.33, now); // D5
        osc.frequency.setValueAtTime(880, now + 0.08); // A5
        gain.gain.setValueAtTime(0.08, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start(now);
        osc.stop(now + 0.25);
      } else {
        osc.frequency.setValueAtTime(440, now); // A4
        gain.gain.setValueAtTime(0.05, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start(now);
        osc.stop(now + 0.18);
      }
    } catch (e) {}
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
    hours = hours ? hours : 12;
    minutes = minutes < 10 ? '0' + minutes : minutes;
    return `${hours}:${minutes} ${ampm}`;
  }

  /**
   * Helper: Male / Female Avatar SVG markup
   */
  function getAvatarSvg(gender) {
    if (gender === 'female') {
      return `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="12" cy="9" r="5"></circle>
        <line x1="12" y1="14" x2="12" y2="21"></line>
        <line x1="9" y1="18" x2="15" y2="18"></line>
      </svg>`;
    }
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
  // TAB SESSION STORAGE HELPERS
  // =========================================================================
  function saveTabSession(user) {
    try {
      sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(user));
    } catch (e) {}
  }

  function getTabSession() {
    try {
      const data = sessionStorage.getItem(SESSION_STORAGE_KEY);
      return data ? JSON.parse(data) : null;
    } catch (e) {
      return null;
    }
  }

  function clearTabSession() {
    try {
      sessionStorage.removeItem(SESSION_STORAGE_KEY);
      sessionStorage.removeItem(PRIVATE_CHATS_STORAGE_KEY);
    } catch (e) {}
  }

  function savePrivateChatsToStorage() {
    try {
      const obj = {};
      for (const [key, val] of privateChats.entries()) {
        obj[key] = val;
      }
      sessionStorage.setItem(PRIVATE_CHATS_STORAGE_KEY, JSON.stringify(obj));
    } catch (e) {}
  }

  function loadPrivateChatsFromStorage() {
    try {
      const data = sessionStorage.getItem(PRIVATE_CHATS_STORAGE_KEY);
      if (data) {
        const obj = JSON.parse(data);
        privateChats = new Map(Object.entries(obj));
      } else {
        privateChats = new Map();
      }
    } catch (e) {
      privateChats = new Map();
    }
  }

  // =========================================================================
  // INITIALIZATION ON PAGE LOAD / REFRESH
  // =========================================================================
  function checkSavedTabSession() {
    const saved = getTabSession();
    if (saved && saved.username && saved.gender) {
      // Show Resume Session Card on same-tab refresh
      loginForm.classList.add('hidden');
      resumeSessionCard.classList.remove('hidden');

      resumeUsername.textContent = saved.username;
      resumeGender.textContent = saved.gender;
      resumeGender.className = `resume-gender ${saved.gender}`;
      resumeAvatar.className = `resume-avatar ${saved.gender}`;
      resumeAvatar.innerHTML = getAvatarSvg(saved.gender);
      resumeBtnText.textContent = `Reconnect as ${saved.username}`;

      resumeBtn.onclick = () => {
        executeLogin(saved.username, saved.gender, true);
      };

      newGuestBtn.onclick = () => {
        clearTabSession();
        resumeSessionCard.classList.add('hidden');
        loginForm.classList.remove('hidden');
        usernameInput.value = '';
        loginError.classList.add('hidden');
        usernameInput.focus();
      };
    } else {
      resumeSessionCard.classList.add('hidden');
      loginForm.classList.remove('hidden');
    }
  }

  checkSavedTabSession();

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

    executeLogin(username, gender, false);
  });

  function executeLogin(username, gender, isResume = false) {
    initAudio();
    loginError.classList.add('hidden');

    const targetBtn = isResume ? resumeBtn : loginBtn;
    const origHtml = targetBtn.innerHTML;
    targetBtn.disabled = true;
    targetBtn.innerHTML = `<span>Connecting...</span>`;

    if (!socket || !socket.connected) {
      socket = io();
      setupSocketListeners();
    }

    socket.emit('login', { username, gender }, (response) => {
      targetBtn.disabled = false;
      targetBtn.innerHTML = origHtml;

      if (response && response.success) {
        currentUser = response.user;
        publicHistory = response.publicHistory || [];
        onlineUsers = response.users || [];

        saveTabSession(currentUser);
        loadPrivateChatsFromStorage();

        loginScreen.classList.add('hidden');
        chatScreen.classList.remove('hidden');

        renderUsersList();
        switchToPublicChat();
        messageInput.focus();
      } else {
        if (isResume) {
          alert(response?.message || 'Could not resume session. Please choose another username.');
          clearTabSession();
          resumeSessionCard.classList.add('hidden');
          loginForm.classList.remove('hidden');
          usernameInput.focus();
        } else {
          showLoginError(response?.message || 'Failed to join chat. Please try again.');
        }
      }
    });
  }

  function showLoginError(msg) {
    loginError.textContent = msg;
    loginError.classList.remove('hidden');
  }

  // Logout / Leave
  logoutBtn.addEventListener('click', () => {
    if (confirm('Leave KeralaChat? Your active session in this tab will be cleared.')) {
      performLogout();
    }
  });

  function performLogout() {
    clearTabSession();
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
    resumeSessionCard.classList.add('hidden');
    loginForm.classList.remove('hidden');
    usernameInput.value = '';
    loginError.classList.add('hidden');
    closeSidebar();
  }

  // =========================================================================
  // SOCKET LISTENERS
  // =========================================================================
  function setupSocketListeners() {
    socket.on('disconnect', () => {});

    socket.on('connect_error', (err) => {
      console.error('Connection error:', err);
    });

    socket.on('user_list', (users) => {
      onlineUsers = users;
      if (activeRecipientUser) {
        const found = onlineUsers.find(
          u => u.username.toLowerCase() === activeRecipientUser.username.toLowerCase()
        );
        if (found) {
          activeRecipientUser = found;
          activeTargetStatus.textContent = 'Online';
        } else {
          activeTargetStatus.textContent = 'Offline';
        }
      }
      renderUsersList();
    });

    socket.on('public_message', (message) => {
      publicHistory.push(message);
      if (publicHistory.length > 10) {
        publicHistory.shift();
      }

      if (activeChat === 'public') {
        appendMessageElement(message);
        checkScrollAndNotify();
      } else {
        unreadCounts.public = (unreadCounts.public || 0) + 1;
        updatePublicUnreadBadge();
        updateMobileUnreadDot();
        playChime(false);
      }
    });

    socket.on('private_message', (message) => {
      if (!currentUser) return;
      const isMine = message.senderId === currentUser.id || message.senderName.toLowerCase() === currentUser.username.toLowerCase();
      const partnerName = isMine ? message.recipientName : message.senderName;

      if (!privateChats.has(partnerName)) {
        privateChats.set(partnerName, []);
      }
      privateChats.get(partnerName).push(message);
      savePrivateChatsToStorage();

      const isCurrentActive = activeRecipientUser && activeRecipientUser.username.toLowerCase() === partnerName.toLowerCase();

      if (isCurrentActive) {
        appendMessageElement(message);
        checkScrollAndNotify();
      } else if (!isMine) {
        unreadCounts[partnerName] = (unreadCounts[partnerName] || 0) + 1;
        renderUsersList();
        updateMobileUnreadDot();
        playChime(true);
      }
    });

    socket.on('user_typing', (data) => {
      const { senderName, isTyping: typing, isPrivate } = data;

      if (isPrivate) {
        if (activeRecipientUser && activeRecipientUser.username.toLowerCase() === senderName.toLowerCase() && typing) {
          showTypingIndicator(`${senderName} is typing...`);
        } else if (activeRecipientUser && activeRecipientUser.username.toLowerCase() === senderName.toLowerCase() && !typing) {
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
    const otherUsers = onlineUsers.filter(u => !currentUser || u.id !== currentUser.id && u.username.toLowerCase() !== currentUser.username.toLowerCase());
    onlineCount.textContent = otherUsers.length;

    const filtered = otherUsers.filter(u => u.username.toLowerCase().includes(filter));

    usersList.innerHTML = '';

    if (filtered.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'empty-users-state';
      empty.textContent = otherUsers.length === 0 ? 'No other users online.' : 'No users found.';
      usersList.appendChild(empty);
      return;
    }

    filtered.forEach(user => {
      const item = document.createElement('div');
      const isSelected = activeRecipientUser && activeRecipientUser.username.toLowerCase() === user.username.toLowerCase();
      item.className = `user-item ${isSelected ? 'active' : ''}`;
      item.dataset.username = user.username;

      const unread = unreadCounts[user.username] || 0;

      item.innerHTML = `
        <div class="user-item-avatar ${user.gender}">
          ${getAvatarSvg(user.gender)}
          <span class="user-item-dot"></span>
        </div>
        <div class="user-item-info">
          <span class="user-item-name">${escapeHtml(user.username)}</span>
          <span class="user-item-meta">
            <span class="user-gender-tag ${user.gender}">${user.gender}</span>
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

  publicChatNav.addEventListener('click', () => {
    switchToPublicChat();
  });

  function switchToPublicChat() {
    activeChat = 'public';
    activeRecipientUser = null;
    unreadCounts.public = 0;
    updatePublicUnreadBadge();
    updateMobileUnreadDot();

    publicChatNav.classList.add('active');

    activeTargetAvatar.className = 'active-avatar public';
    activeTargetAvatar.innerHTML = getPublicIconSvg();
    activeTargetName.textContent = 'Public Chat';
    activeTargetStatus.textContent = 'All online members';
    messageInput.placeholder = 'Type a message to public chat...';

    renderUsersList();
    renderPublicFeed();
    closeSidebar();
    hideTypingIndicator();
  }

  function switchToPrivateChat(user) {
    activeChat = 'private';
    activeRecipientUser = user;
    unreadCounts[user.username] = 0;
    updateMobileUnreadDot();

    publicChatNav.classList.remove('active');

    activeTargetAvatar.className = `active-avatar ${user.gender}`;
    activeTargetAvatar.innerHTML = getAvatarSvg(user.gender);
    activeTargetName.textContent = user.username;
    activeTargetStatus.textContent = 'Online';
    messageInput.placeholder = `Message @${user.username}...`;

    renderUsersList();
    renderPrivateFeed(user.username);
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

  function renderPrivateFeed(partnerUsername) {
    messagesList.innerHTML = '';
    const messages = privateChats.get(partnerUsername) || [];
    messages.forEach(msg => {
      appendMessageElement(msg);
    });
    scrollToBottom(true);
  }

  function appendMessageElement(msg) {
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

    const isMine = currentUser && (
      msg.senderId === currentUser.id ||
      (msg.senderName && msg.senderName.toLowerCase() === currentUser.username.toLowerCase())
    );
    const timeStr = formatTimeAMPM(msg.timestamp);

    const row = document.createElement('div');
    row.className = `message-row ${isMine ? 'outgoing' : 'incoming'}`;

    row.innerHTML = `
      <div class="msg-avatar ${msg.senderGender || 'male'}">
        ${getAvatarSvg(msg.senderGender || 'male')}
      </div>
      <div class="msg-body-wrapper">
        ${!isMine ? `
          <div class="msg-meta">
            <span class="msg-sender-name ${msg.senderGender || 'male'}">${escapeHtml(msg.senderName)}</span>
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
    } else if (activeRecipientUser) {
      socket.emit('private_message', {
        recipientId: activeRecipientUser.id,
        recipientUsername: activeRecipientUser.username,
        text
      }, (res) => {
        if (res && !res.success) {
          alert(res.message || 'Could not send message. User might be offline.');
        }
      });
    }

    messageInput.value = '';
    stopTyping();
    messageInput.focus();
  }

  quickEmojiBar.querySelectorAll('.quick-emoji').forEach(btn => {
    btn.addEventListener('click', () => {
      messageInput.value += btn.textContent;
      messageInput.focus();
      handleTyping();
    });
  });

  messageInput.addEventListener('input', () => {
    handleTyping();
  });

  function handleTyping() {
    if (!socket || !currentUser) return;
    if (!isTyping) {
      isTyping = true;
      const targetRecipientId = activeRecipientUser ? activeRecipientUser.id : 'public';
      socket.emit('typing', { isTyping: true, recipientId: targetRecipientId });
    }
    clearTimeout(typingTimeout);
    typingTimeout = setTimeout(() => {
      stopTyping();
    }, 2000);
  }

  function stopTyping() {
    if (isTyping && socket) {
      isTyping = false;
      const targetRecipientId = activeRecipientUser ? activeRecipientUser.id : 'public';
      socket.emit('typing', { isTyping: false, recipientId: targetRecipientId });
    }
  }

  function showTypingIndicator(text) {
    typingText.textContent = text;
    typingIndicator.classList.remove('hidden');
  }

  function hideTypingIndicator() {
    typingIndicator.classList.add('hidden');
  }

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

  function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }
})();
