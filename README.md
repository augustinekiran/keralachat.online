# KeralaChat Online 💬🌴

A fast, responsive real-time public & private chat web application built with **Node.js**, **Express**, and **Socket.IO**.

---

## 🌟 Key Features

1. **Guest Login System**:
   - Log in with **Username** and **Gender** (`Male` / `Female`).
   - Pure ephemeral in-memory sessions: refreshing the browser takes you straight back to the login screen without saving local data.

2. **Public & Private Real-Time Chat**:
   - **Static Public Chat**: Pinned at the top of the sidebar. Displays a rolling buffer of the **last 10 messages** only.
   - **Private 1-on-1 Chat**: Click any online user in the sidebar to open an exclusive private chat. Direct messages are kept in active memory and discarded when leaving/refreshing.

3. **Message Formatting & Rich UI**:
   - Shows sender username, male/female themed avatars, message text, and **12-hour AM/PM timestamps** (e.g. `10:14 PM`).
   - Clear visual indicators for your messages (aligned right) vs others' messages (aligned left).
   - Real-time "is typing..." indicators.
   - Built-in synthesized Web Audio chimes for incoming messages (with mute toggle).
   - Quick emoji reaction picker.

4. **Fully Responsive (Desktop & Mobile)**:
   - **Desktop**: 2-column layout with persistent sidebar and chat window.
   - **Mobile**: Sliding navigation drawer with hamburger menu button, backdrop overlay, and unread notification dots.

5. **Deployable to Render.com**:
   - Configured with `render.yaml`, standard `npm start` script, and `process.env.PORT` fallback.

---

## 🚀 Getting Started Locally

### Prerequisites
- [Node.js](https://nodejs.org/) (version 18 or newer recommended)
- npm

### Installation & Run
```bash
# 1. Install dependencies
npm install

# 2. Start the server
npm start
```

Open your browser and navigate to:
```
http://localhost:3000
```

---

## ☁️ Deploying to Render.com

1. Push this repository to **GitHub** / **GitLab**.
2. Go to [Render Dashboard](https://dashboard.render.com/) and click **New + > Web Service**.
3. Connect your repository.
4. Set the following build settings:
   - **Environment**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `node server.js`
5. Click **Create Web Service**. Your chat app will be live with full WebSocket support!
