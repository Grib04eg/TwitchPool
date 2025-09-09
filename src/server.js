require('dotenv').config();
const path = require('path');
const express = require('express');
const session = require('express-session');
const passport = require('passport');
const TwitchStrategy = require('passport-twitch-new').Strategy;
const helmet = require('helmet');
const morgan = require('morgan');
const http = require('http');
const https = require('https');
const fs = require('fs');
const { Server } = require('socket.io');
const Database = require('better-sqlite3');
const { v4: uuidv4 } = require('uuid');

const app = express();
let server; // will be assigned after SSL detection
let io;     // will be attached to the chosen server

// --- Config
const PORT = process.env.PORT || 3000; // HTTP port when SSL off, or redirect port when SSL on
const HTTPS_PORT = process.env.HTTPS_PORT || 443;
const SESSION_SECRET = process.env.SESSION_SECRET || 'change_me_in_.env';
const TWITCH_CLIENT_ID = process.env.TWITCH_CLIENT_ID || '';
const TWITCH_CLIENT_SECRET = process.env.TWITCH_CLIENT_SECRET || '';
const AUTH_READY = Boolean(TWITCH_CLIENT_ID && TWITCH_CLIENT_SECRET);
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;
const SSL_KEY_PATH = process.env.SSL_KEY_PATH || '';
const SSL_CERT_PATH = process.env.SSL_CERT_PATH || '';
const SSL_CA_PATH = process.env.SSL_CA_PATH || '';

// --- DB setup
const db = new Database(path.join(__dirname, '..', 'data.db'));
db.pragma('journal_mode = WAL');
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  twitch_id TEXT UNIQUE,
  display_name TEXT,
  access_token TEXT,
  refresh_token TEXT,
  widget_token TEXT,
  created_at INTEGER,
  updated_at INTEGER
);

CREATE TABLE IF NOT EXISTS polls (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  twitch_poll_id TEXT,
  title TEXT,
  choices_json TEXT,
  duration_sec INTEGER,
  status TEXT,
  created_at INTEGER,
  updated_at INTEGER
);

CREATE TABLE IF NOT EXISTS templates (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  title TEXT,
  choices_json TEXT,
  created_at INTEGER
);
`);

// --- Views and static
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '..', 'views'));
app.use('/static', express.static(path.join(__dirname, '..', 'public')));

// --- Security & logging
app.use(helmet());
app.use(helmet.contentSecurityPolicy({
  useDefaults: true,
  directives: {
    defaultSrc: ["'self'"],
    scriptSrc: ["'self'", 'https://cdn.jsdelivr.net'],
    styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
    fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
    imgSrc: ["'self'", 'data:'],
    connectSrc: ["'self'", 'wss:'],
    frameAncestors: ["'self'"],
  },
}));
app.use(morgan('dev'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// --- Session & Passport
// trust proxy if deployed behind one
if (process.env.TRUST_PROXY === '1') {
  app.set('trust proxy', 1);
}

app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 1000 * 60 * 60 * 24 * 30, // 30 days
  },
}));

passport.serializeUser((user, done) => {
  done(null, user.id);
});

passport.deserializeUser((id, done) => {
  try {
    const row = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    done(null, row || null);
  } catch (e) {
    done(e);
  }
});

if (AUTH_READY) {
  passport.use(new TwitchStrategy({
    clientID: TWITCH_CLIENT_ID,
    clientSecret: TWITCH_CLIENT_SECRET,
    callbackURL: `${BASE_URL}/auth/twitch/callback`,
    scope: ['user:read:email', 'channel:manage:polls', 'channel:read:polls'],
    state: true,
  }, (accessToken, refreshToken, profile, done) => {
    try {
      const now = Date.now();
      const existing = db.prepare('SELECT * FROM users WHERE twitch_id = ?').get(profile.id);
      if (existing) {
        const widgetToken = existing.widget_token || uuidv4();
        db.prepare('UPDATE users SET display_name = ?, access_token = ?, refresh_token = ?, widget_token = ?, updated_at = ? WHERE id = ?')
          .run(profile.display_name, accessToken, refreshToken, widgetToken, now, existing.id);
        return done(null, { ...existing, display_name: profile.display_name, access_token: accessToken, refresh_token: refreshToken, widget_token: widgetToken });
      } else {
        const id = uuidv4();
        const widgetToken = uuidv4();
        db.prepare('INSERT INTO users (id, twitch_id, display_name, access_token, refresh_token, widget_token, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)')
          .run(id, profile.id, profile.display_name, accessToken, refreshToken, widgetToken, now, now);
        return done(null, { id, twitch_id: profile.id, display_name: profile.display_name, access_token: accessToken, refresh_token: refreshToken, widget_token: widgetToken });
      }
    } catch (e) {
      return done(e);
    }
  }));
}

app.use(passport.initialize());
app.use(passport.session());

function ensureAuth(req, res, next) {
  if (req.isAuthenticated && req.isAuthenticated()) return next();
  res.redirect('/');
}

// --- Routes
app.get('/', (req, res) => {
  if (req.isAuthenticated && req.isAuthenticated()) {
    return res.redirect('/dashboard');
  }
  res.render('index', { loginUrl: AUTH_READY ? '/auth/twitch' : null });
});

if (AUTH_READY) {
  app.get('/auth/twitch', passport.authenticate('twitch', { forceVerify: true }));
  app.get('/auth/twitch/callback',
    passport.authenticate('twitch', { failureRedirect: '/' }),
    (req, res) => {
      res.redirect('/dashboard');
    }
  );
} else {
  app.get('/auth/twitch', (req, res) => res.status(500).send('Set TWITCH_CLIENT_ID and TWITCH_CLIENT_SECRET in .env'));
  app.get('/auth/twitch/callback', (req, res) => res.redirect('/'));
}

app.post('/logout', (req, res) => {
  req.logout(() => {
    res.redirect('/');
  });
});

app.get('/dashboard', ensureAuth, (req, res) => {
  const user = req.user;
  const widgetUrl = `${BASE_URL}/widget/${user.widget_token}`;
  const latestPoll = db.prepare('SELECT * FROM polls WHERE user_id = ? ORDER BY created_at DESC LIMIT 1').get(user.id);
  res.render('dashboard', {
    user,
    widgetUrl,
    latestPoll,
  });
});

app.post('/dashboard/widget/regenerate', ensureAuth, (req, res) => {
  const user = req.user;
  const newToken = uuidv4();
  db.prepare('UPDATE users SET widget_token = ?, updated_at = ? WHERE id = ?').run(newToken, Date.now(), user.id);
  res.json({ widgetUrl: `${BASE_URL}/widget/${newToken}` });
});

// Save list of options on dashboard
app.post('/dashboard/options', ensureAuth, (req, res) => {
  const { options, title, durationSec } = req.body;
  if (!Array.isArray(options) || options.length < 2) {
    return res.status(400).json({ error: 'Need at least 2 options' });
  }
  const id = uuidv4();
  const now = Date.now();
  db.prepare('INSERT INTO polls (id, user_id, twitch_poll_id, title, choices_json, duration_sec, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?, ?, ?)')
    .run(id, req.user.id, null, title || 'Poll', JSON.stringify(options), Number(durationSec) || 60, 'draft', now, now);
  res.json({ pollId: id });
});

// Create poll on Twitch
const axios = require('axios');

async function refreshAccessTokenIfNeeded(user) {
  // Try a lightweight call to validate; if unauthorized, refresh
  try {
    await axios.get('https://api.twitch.tv/helix/users', {
      headers: { 'Client-ID': TWITCH_CLIENT_ID, 'Authorization': `Bearer ${user.access_token}` }
    });
    return user; // token OK
  } catch (err) {
    const status = err.response?.status;
    if (status !== 401 && status !== 403) return user;
    if (!user.refresh_token) return user;
    try {
      const tokenResp = await axios.post('https://id.twitch.tv/oauth2/token', null, {
        params: {
          grant_type: 'refresh_token',
          refresh_token: user.refresh_token,
          client_id: TWITCH_CLIENT_ID,
          client_secret: TWITCH_CLIENT_SECRET,
        }
      });
      const newAccess = tokenResp.data.access_token;
      const newRefresh = tokenResp.data.refresh_token || user.refresh_token;
      db.prepare('UPDATE users SET access_token = ?, refresh_token = ?, updated_at = ? WHERE id = ?')
        .run(newAccess, newRefresh, Date.now(), user.id);
      return { ...user, access_token: newAccess, refresh_token: newRefresh };
    } catch (_) {
      return user; // keep old; API calls may fail until reauth
    }
  }
}

async function twitchApiRequest(user, method, url, { params, data } = {}) {
  const ensuredUser = await refreshAccessTokenIfNeeded(user);
  return axios({
    method,
    url,
    params,
    data,
    headers: {
      'Client-ID': TWITCH_CLIENT_ID,
      'Authorization': `Bearer ${ensuredUser.access_token}`,
      'Content-Type': 'application/json',
    }
  });
}
app.post('/dashboard/polls', ensureAuth, async (req, res) => {
  try {
    // Accept either existing pollId, or raw options to auto-save a draft first
    let { pollId, options, title, durationSec } = req.body;
    let poll;
    if (pollId) {
      poll = db.prepare('SELECT * FROM polls WHERE id = ? AND user_id = ?').get(pollId, req.user.id);
    } else if (Array.isArray(options) && options.length >= 2) {
      const id = uuidv4();
      const now = Date.now();
      db.prepare('INSERT INTO polls (id, user_id, twitch_poll_id, title, choices_json, duration_sec, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?, ?, ?)')
        .run(id, req.user.id, null, title || 'Poll', JSON.stringify(options), Number(durationSec) || 60, 'draft', now, now);
      pollId = id;
      poll = db.prepare('SELECT * FROM polls WHERE id = ? AND user_id = ?').get(pollId, req.user.id);
    }
    if (!poll) return res.status(404).json({ error: 'Poll not found or options missing' });

    // Get broadcaster id from user twitch id
    const broadcasterId = req.user.twitch_id;
    const accessToken = req.user.access_token;

    const createResp = await twitchApiRequest(req.user, 'post', 'https://api.twitch.tv/helix/polls', {
      data: {
        broadcaster_id: broadcasterId,
        title: poll.title || 'Poll',
        choices: JSON.parse(poll.choices_json).map((c) => ({ title: String(c).slice(0, 25) })),
        duration: poll.duration_sec || 60,
      }
    });

    const created = createResp.data && createResp.data.data && createResp.data.data[0];
    const twitchPollId = created ? created.id : null;
    db.prepare('UPDATE polls SET twitch_poll_id = ?, status = ?, updated_at = ? WHERE id = ?')
      .run(twitchPollId, created ? created.status : 'unknown', Date.now(), poll.id);

    res.json({ ok: true, twitchPollId, poll: created });
  } catch (e) {
    res.status(500).json({ error: 'Failed to create poll', details: e.response?.data || e.message });
  }
});

// Templates API
app.get('/api/templates', ensureAuth, (req, res) => {
  const rows = db.prepare('SELECT id, title, choices_json, created_at FROM templates WHERE user_id = ? ORDER BY created_at DESC LIMIT 50').all(req.user.id);
  res.json({ templates: rows.map(r => ({ id: r.id, title: r.title, options: JSON.parse(r.choices_json), created_at: r.created_at })) });
});

app.post('/api/templates', ensureAuth, (req, res) => {
  const { title, options } = req.body;
  if (!Array.isArray(options) || options.length < 2) return res.status(400).json({ error: 'Need at least 2 options' });
  const id = uuidv4();
  const now = Date.now();
  db.prepare('INSERT INTO templates (id, user_id, title, choices_json, created_at) VALUES (?,?,?,?,?)')
    .run(id, req.user.id, title || 'Template', JSON.stringify(options), now);
  res.json({ ok: true, id });
});

app.delete('/api/templates/:id', ensureAuth, (req, res) => {
  const id = req.params.id;
  db.prepare('DELETE FROM templates WHERE id = ? AND user_id = ?').run(id, req.user.id);
  res.json({ ok: true });
});

// Fetch current poll live details (for dashboard)
app.get('/api/current-poll', ensureAuth, async (req, res) => {
  try {
    const latest = db.prepare('SELECT * FROM polls WHERE user_id = ? AND twitch_poll_id IS NOT NULL ORDER BY created_at DESC LIMIT 1').get(req.user.id);
    if (!latest) return res.json({ poll: null });
    const resp = await twitchApiRequest(req.user, 'get', 'https://api.twitch.tv/helix/polls', {
      params: { broadcaster_id: req.user.twitch_id, id: latest.twitch_poll_id }
    });
    const poll = resp.data && resp.data.data && resp.data.data[0];
    return res.json({ poll: poll || null });
  } catch (e) {
    return res.status(500).json({ error: 'Failed to get current poll', details: e.response?.data || e.message });
  }
});

// End current poll (terminate early)
app.post('/api/end-poll', ensureAuth, async (req, res) => {
  try {
    const latest = db.prepare('SELECT * FROM polls WHERE user_id = ? AND twitch_poll_id IS NOT NULL ORDER BY created_at DESC LIMIT 1').get(req.user.id);
    if (!latest) return res.status(404).json({ error: 'No active poll' });
    const resp = await twitchApiRequest(req.user, 'patch', 'https://api.twitch.tv/helix/polls', {
      data: { broadcaster_id: req.user.twitch_id, id: latest.twitch_poll_id, status: 'TERMINATED' }
    });
    const poll = resp.data && resp.data.data && resp.data.data[0];
    if (poll) {
      db.prepare('UPDATE polls SET status = ?, updated_at = ? WHERE id = ?').run(poll.status || 'terminated', Date.now(), latest.id);
      io && io.to(`widget:${req.user.widget_token}`).emit('poll:update', poll);
    }
    return res.json({ ok: true, poll: poll || null });
  } catch (e) {
    return res.status(500).json({ error: 'Failed to end poll', details: e.response?.data || e.message });
  }
});

// Widget page
app.get('/widget/:token', (req, res) => {
  const token = req.params.token;
  const user = db.prepare('SELECT * FROM users WHERE widget_token = ?').get(token);
  if (!user) return res.status(404).send('Invalid widget');
  res.render('widget', { token });
});

// Widget data stream via Socket.IO namespaces per widget token
function attachIoHandlers() {
  if (!io) return;
  io.on('connection', (socket) => {
    // Client should emit 'join' with widget token
    socket.on('join', (token) => {
      socket.join(`widget:${token}`);
    });
  });
}

async function fetchAndBroadcastPolls() {
  try {
    const users = db.prepare('SELECT * FROM users').all();
    for (const user of users) {
      const latest = db.prepare('SELECT * FROM polls WHERE user_id = ? AND twitch_poll_id IS NOT NULL ORDER BY created_at DESC LIMIT 1').get(user.id);
      if (!latest) continue;
      try {
        const resp = await twitchApiRequest(user, 'get', 'https://api.twitch.tv/helix/polls', {
          params: { broadcaster_id: user.twitch_id, id: latest.twitch_poll_id }
        });
        const poll = resp.data && resp.data.data && resp.data.data[0];
        if (poll) {
          db.prepare('UPDATE polls SET status = ?, updated_at = ? WHERE id = ?').run(poll.status, Date.now(), latest.id);
          io.to(`widget:${user.widget_token}`).emit('poll:update', poll);
        }
      } catch (err) {
        // ignore per-user errors to keep loop running
      }
    }
  } catch (e) {
    // ignore scheduler errors
  }
}

setInterval(fetchAndBroadcastPolls, 4000);

// --- HTTPS enablement (Certbot)
function fileExists(p) {
  try { return p && fs.existsSync(p); } catch { return false; }
}

const SSL_ENABLED = fileExists(SSL_KEY_PATH) && fileExists(SSL_CERT_PATH);

if (SSL_ENABLED) {
  const httpsOptions = {
    key: fs.readFileSync(SSL_KEY_PATH),
    cert: fs.readFileSync(SSL_CERT_PATH),
    ca: fileExists(SSL_CA_PATH) ? fs.readFileSync(SSL_CA_PATH) : undefined,
  };
  server = https.createServer(httpsOptions, app);
  io = new Server(server);
  attachIoHandlers();

  // Start HTTPS
  server.listen(HTTPS_PORT, () => {
    const url = BASE_URL.startsWith('http') ? BASE_URL.replace('http://', 'https://') : `https://localhost:${HTTPS_PORT}`;
    console.log(`HTTPS server listening on ${url}`);
  });

  // Optional HTTP -> HTTPS redirect
  const redirectApp = express();
  redirectApp.use((req, res) => {
    const host = req.headers.host ? req.headers.host.split(':')[0] : 'localhost';
    return res.redirect(301, `https://${host}${req.url}`);
  });
  http.createServer(redirectApp).listen(PORT, () => {
    console.log(`HTTP redirect listening on http://localhost:${PORT} -> HTTPS`);
  });
} else {
  // HTTP only
  server = http.createServer(app);
  io = new Server(server);
  attachIoHandlers();
  server.listen(PORT, () => {
    console.log(`Server listening on ${BASE_URL}`);
  });
}


