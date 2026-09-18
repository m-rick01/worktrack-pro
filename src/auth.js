// Password hashing (scrypt, built into node:crypto) and session helpers.
const crypto = require('node:crypto');
const db = require('./db');

const SESSION_DAYS = 7;

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const check = crypto.scryptSync(password, salt, 64).toString('hex');
  const a = Buffer.from(hash, 'hex');
  const b = Buffer.from(check, 'hex');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function generateTempPassword() {
  // Readable-ish random password: 10 chars from a safe alphabet.
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  let out = '';
  const bytes = crypto.randomBytes(10);
  for (let i = 0; i < 10; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

// ---------- Password reset tokens ----------

const RESET_MINUTES = 60;

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

// Returns the plain token to email; only its hash is stored.
function createPasswordReset(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + RESET_MINUTES * 60 * 1000).toISOString();
  db.prepare('INSERT INTO password_resets (userId, tokenHash, expiresAt) VALUES (?, ?, ?)').run(
    userId,
    hashToken(token),
    expiresAt
  );
  return { token, expiresAt };
}

// The row for an unused, unexpired token, or null.
// Expiry is compared in JS on purpose: expiresAt is an ISO string, and comparing
// it to SQLite's datetime('now') in SQL compares 'T' against ' ', which makes any
// same-day expiry look like the future.
function findPasswordReset(token) {
  if (!token) return null;
  const row = db
    .prepare('SELECT * FROM password_resets WHERE tokenHash = ? AND usedAt IS NULL')
    .get(hashToken(token));
  if (!row) return null;
  if (new Date(row.expiresAt).getTime() <= Date.now()) return null;
  return row;
}

function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  db.prepare('INSERT INTO sessions (token, userId, expiresAt) VALUES (?, ?, ?)').run(token, userId, expiresAt);
  return { token, expiresAt };
}

function destroySession(token) {
  db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
}

function getUserBySession(token) {
  if (!token) return null;
  const row = db
    .prepare(
      `SELECT u.* FROM sessions s JOIN users u ON u.id = s.userId
       WHERE s.token = ? AND s.expiresAt > datetime('now')`
    )
    .get(token);
  return row || null;
}

function parseCookies(req) {
  const header = req.headers.cookie;
  const out = {};
  if (!header) return out;
  header.split(';').forEach((pair) => {
    const idx = pair.indexOf('=');
    if (idx === -1) return;
    const key = pair.slice(0, idx).trim();
    const val = decodeURIComponent(pair.slice(idx + 1).trim());
    out[key] = val;
  });
  return out;
}

module.exports = {
  hashPassword,
  verifyPassword,
  generateTempPassword,
  createPasswordReset,
  findPasswordReset,
  RESET_MINUTES,
  createSession,
  destroySession,
  getUserBySession,
  parseCookies,
  SESSION_DAYS,
};
