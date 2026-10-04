const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

const views = require('./views');
const i18n = require('./i18n');
const { esc, layout } = views;

function parseCredFile(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const out = {};
  for (const line of raw.split(/\r?\n/)) {
    if (!line || !line.includes('=')) continue;
    const [k, ...rest] = line.split('=');
    out[k.trim()] = rest.join('=').trim();
  }
  return out;
}

// Zugangsdaten: DATABASE_URL (z. B. für lokale Entwicklung) oder die Credentials-Datei auf dem Server.
function createPool() {
  if (process.env.DATABASE_URL) {
    return new Pool({ connectionString: process.env.DATABASE_URL, max: 10 });
  }
  const creds = parseCredFile(process.env.PLAYCOLLECT_CRED_FILE || '/root/postgresql-project-admin.txt');
  return new Pool({
    host: creds.POSTGRES_HOST || '127.0.0.1',
    port: Number(creds.POSTGRES_PORT || 5432),
    user: creds.POSTGRES_ADMIN_USER,
    password: creds.POSTGRES_ADMIN_PASSWORD,
    database: 'playcollect',
    max: 10,
  });
}

const pool = createPool();

const SESSION_COOKIE_NAME = 'playcollect_session';
const PREVIEW_GATE_COOKIE_NAME = 'playcollect_preview_gate';
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;
const LOGIN_ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_ATTEMPT_MAX = 5;
// Testzugang: nur aktiv, wenn PLAYCOLLECT_PREVIEW_PASSWORD gesetzt ist (kein Klartext-Default im Repo).
const PREVIEW_GATE_PASSWORD = String(process.env.PLAYCOLLECT_PREVIEW_PASSWORD || process.env.PLAYCOLLECT_PREVIEW_GATE_PASSWORD || '');
const loginAttempts = new Map();

const app = express();
app.set('trust proxy', 'loopback');
app.disable('x-powered-by');
// Solange die Bildrechte nicht geklärt sind, ist alles noindex (auch Bilder). Wieder freigeben mit PLAYCOLLECT_INDEXING=on.
const INDEXING_ENABLED = String(process.env.PLAYCOLLECT_INDEXING || '').toLowerCase() === 'on';
app.use((req, res, next) => {
  if (!INDEXING_ENABLED) res.setHeader('X-Robots-Tag', 'noindex, nofollow, noimageindex');
  next();
});
app.use(express.urlencoded({ extended: false }));
app.use(express.json({ limit: '25mb' }));
app.use('/static', express.static(path.join(__dirname, 'public'), { maxAge: '1h' }));
app.use(i18n.localeMiddleware);

function parseCookies(cookieHeader = '') {
  const cookies = {};
  for (const part of String(cookieHeader || '').split(';')) {
    const [rawKey, ...rest] = part.trim().split('=');
    if (!rawKey) continue;
    try {
      cookies[rawKey] = decodeURIComponent(rest.join('=') || '');
    } catch {
      cookies[rawKey] = '';
    }
  }
  return cookies;
}

function appendSetCookie(res, cookieValue) {
  const current = res.getHeader('Set-Cookie');
  if (!current) {
    res.setHeader('Set-Cookie', cookieValue);
    return;
  }
  if (Array.isArray(current)) {
    res.setHeader('Set-Cookie', [...current, cookieValue]);
    return;
  }
  res.setHeader('Set-Cookie', [current, cookieValue]);
}

function isSecureRequest(req) {
  return req.secure || req.headers['x-forwarded-proto'] === 'https';
}

function buildCookie(req, name, value, extra = []) {
  const parts = [`${name}=${encodeURIComponent(value)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', ...extra];
  if (isSecureRequest(req)) parts.push('Secure');
  return parts.join('; ');
}

const createSessionCookie = (req, token) => buildCookie(req, SESSION_COOKIE_NAME, token, [`Max-Age=${SESSION_MAX_AGE_SECONDS}`]);
const clearSessionCookie = (req) => buildCookie(req, SESSION_COOKIE_NAME, '', ['Max-Age=0']);
const clearPreviewGateCookie = (req) => buildCookie(req, PREVIEW_GATE_COOKIE_NAME, '', ['Max-Age=0']);

function previewGateToken() {
  return crypto.createHash('sha256').update(`${PREVIEW_GATE_PASSWORD}:preview-ok`).digest('hex');
}

const createPreviewGateCookie = (req) => buildCookie(req, PREVIEW_GATE_COOKIE_NAME, previewGateToken());

function hasPreviewGateAccess(req) {
  const token = req.cookies?.[PREVIEW_GATE_COOKIE_NAME];
  return Boolean(token) && token === previewGateToken();
}

function hashSessionToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

function randomSessionToken() {
  return crypto.randomBytes(32).toString('hex');
}

function getClientIp(req) {
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return forwarded || req.socket?.remoteAddress || '';
}

function isLoginRateLimited(req) {
  const key = getClientIp(req);
  const entry = loginAttempts.get(key);
  if (!entry) return false;
  if (Date.now() - entry.firstAt > LOGIN_ATTEMPT_WINDOW_MS) {
    loginAttempts.delete(key);
    return false;
  }
  return entry.count >= LOGIN_ATTEMPT_MAX;
}

function recordLoginFailure(req) {
  const key = getClientIp(req);
  const now = Date.now();
  const entry = loginAttempts.get(key);
  if (!entry || now - entry.firstAt > LOGIN_ATTEMPT_WINDOW_MS) {
    loginAttempts.set(key, { count: 1, firstAt: now });
    return;
  }
  entry.count += 1;
}

function clearLoginFailures(req) {
  loginAttempts.delete(getClientIp(req));
}

async function createUserSession(req, res, userId) {
  const token = randomSessionToken();
  const tokenHash = hashSessionToken(token);
  await pool.query(
    `INSERT INTO app_user_sessions (user_id, session_token_hash, user_agent, ip_address, expires_at)
     VALUES ($1, $2, $3, $4, NOW() + INTERVAL '30 days')`,
    [userId, tokenHash, String(req.headers['user-agent'] || '').slice(0, 500), getClientIp(req)]
  );
  appendSetCookie(res, createSessionCookie(req, token));
}

async function revokeCurrentSession(req, res) {
  if (req.currentSessionId) {
    await pool.query(`UPDATE app_user_sessions SET revoked_at = NOW() WHERE id = $1`, [req.currentSessionId]);
  }
  appendSetCookie(res, clearSessionCookie(req));
}

async function loadCurrentUser(req, res, next) {
  try {
    req.cookies = parseCookies(req.headers.cookie || '');
    req.currentUser = null;
    req.currentSessionId = null;
    const sessionToken = req.cookies[SESSION_COOKIE_NAME];
    if (!sessionToken) return next();
    const tokenHash = hashSessionToken(sessionToken);
    const result = await pool.query(
      `SELECT s.id AS session_id, u.id, u.username, u.display_name, u.email, u.created_at
       FROM app_user_sessions s
       JOIN app_users u ON u.id = s.user_id
       WHERE s.session_token_hash = $1
         AND s.revoked_at IS NULL
         AND s.expires_at > NOW()
         AND u.account_status = 'active'
       LIMIT 1`,
      [tokenHash]
    );
    if (!result.rowCount) {
      appendSetCookie(res, clearSessionCookie(req));
      return next();
    }
    req.currentUser = result.rows[0];
    req.currentSessionId = result.rows[0].session_id;
    // last_seen nur gelegentlich schreiben, nicht bei jedem Request
    pool.query(
      `UPDATE app_user_sessions SET last_seen_at = NOW() WHERE id = $1 AND last_seen_at < NOW() - INTERVAL '5 minutes'`,
      [req.currentSessionId]
    ).catch(() => {});
    next();
  } catch (err) {
    next(err);
  }
}

app.use(loadCurrentUser);

function sanitizeNextPath(rawValue, fallback = '/konto') {
  const value = String(rawValue || '').trim();
  if (!value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) return fallback;
  return value;
}

function renderPreviewGatePage({ nextPath = '/', error = '' }) {
  const safeError = error ? `<div class="form-alert form-error">${esc(error)}</div>` : '';
  return layout({
    title: 'Playcollect – Testzugang',
    noindex: true,
    body: `
      <section class="auth-page">
        <div class="container auth-wrap auth-wrap-narrow">
          <div class="auth-card">
            <span class="eyebrow">Testbetrieb</span>
            <h1>Kurz freischalten</h1>
            <p class="muted">Playcollect läuft gerade im Testbetrieb. Nach der Eingabe bist du in diesem Browser freigeschaltet.</p>
            ${safeError}
            <form class="form-stack" method="post" action="/zugang">
              <input type="hidden" name="next" value="${esc(nextPath)}">
              <label class="field"><span>Passwort</span><input name="password" type="password" required placeholder="Testzugang eingeben" autofocus></label>
              <button class="btn btn-primary btn-lg" type="submit">Zugang öffnen</button>
            </form>
          </div>
        </div>
      </section>`,
  });
}

app.get('/zugang', (req, res) => {
  if (!PREVIEW_GATE_PASSWORD || hasPreviewGateAccess(req)) {
    res.redirect(sanitizeNextPath(req.query.next, '/'));
    return;
  }
  res.send(renderPreviewGatePage({ nextPath: sanitizeNextPath(req.query.next, '/'), error: req.query.error || '' }));
});

app.post('/zugang', (req, res) => {
  const nextPath = sanitizeNextPath(req.body.next, '/');
  const password = String(req.body.password || '');
  if (PREVIEW_GATE_PASSWORD && password !== PREVIEW_GATE_PASSWORD) {
    appendSetCookie(res, clearPreviewGateCookie(req));
    res.redirect(`/zugang?next=${encodeURIComponent(nextPath)}&error=${encodeURIComponent('Zugang fehlgeschlagen. Bitte Passwort prüfen.')}`);
    return;
  }
  if (PREVIEW_GATE_PASSWORD) appendSetCookie(res, createPreviewGateCookie(req));
  res.redirect(nextPath);
});

app.use((req, res, next) => {
  const requestPath = String(req.path || '/');
  if (!PREVIEW_GATE_PASSWORD) return next();
  if (requestPath === '/zugang') return next();
  if (requestPath.startsWith('/static/')) return next();
  if (requestPath.startsWith('/.well-known/')) return next();
  if (hasPreviewGateAccess(req)) return next();

  const nextPath = sanitizeNextPath(req.originalUrl || req.url || '/', '/');
  if (req.method === 'GET' || req.method === 'HEAD') {
    res.redirect(`/zugang?next=${encodeURIComponent(nextPath)}`);
    return;
  }
  res.status(403).send(renderPreviewGatePage({
    nextPath,
    error: 'Bitte Oberfläche zuerst über den Testzugang freischalten.',
  }));
});

// ---------------------------------------------------------------- Routen
const ctx = {
  app,
  pool,
  views,
  sanitizeNextPath,
  createUserSession,
  revokeCurrentSession,
  isLoginRateLimited,
  recordLoginFailure,
  clearLoginFailures,
  bcrypt,
};

require('./routes/discover')(ctx);
require('./routes/seo')(ctx);
require('./routes/collect')(ctx);
require('./routes/account')(ctx);

app.use((req, res) => {
  res.status(404).send(layout({
    title: `${req.L.t('notFoundTitle')} – Playcollect`,
    currentUser: req.currentUser,
    L: req.L,
    seo: { canonical: '', robots: 'noindex,follow', alternates: [] },
    body: `<section class="section"><div class="container">${views.renderEmpty({
      title: req.L.t('notFoundTitle'),
      text: esc(req.L.t('notFoundText')),
      actions: `<a class="btn btn-primary" href="/entdecken">${esc(req.L.t('discoverSets'))}</a><a class="btn btn-secondary" href="/">${esc(req.L.t('toHome'))}</a>`,
    })}</div></section>`,
  }));
});

app.use((err, req, res, next) => {
  console.error(err);
  if (req.path.startsWith('/api/')) {
    res.status(500).json({ ok: false, error: 'Interner Fehler. Bitte versuche es gleich noch einmal.' });
    return;
  }
  res.status(500).send(layout({
    title: 'Fehler – Playcollect',
    currentUser: req.currentUser,
    noindex: true,
    body: `<section class="section"><div class="container">${views.renderEmpty({
      title: 'Das hat nicht geklappt',
      text: 'Da ist etwas schiefgelaufen. Bitte versuche es gleich noch einmal.',
      actions: '<a class="btn btn-primary" href="/">Zur Startseite</a>',
    })}</div></section>`,
  }));
});

const port = Number(process.env.PORT || 3012);
const host = process.env.HOST || '0.0.0.0';
app.listen(port, host, () => {
  console.log(`Playcollect UI listening on http://${host}:${port}`);
});
