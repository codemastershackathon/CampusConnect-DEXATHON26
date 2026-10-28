// F01 · Shared helpers: verify the Firebase ID token, enforce email_verified + college domain, CORS, JSON errors.
const { db, auth } = require('./firebaseAdmin');

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const allowedDomains = () => (process.env.ALLOWED_EMAIL_DOMAINS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
const allowedOrigins = () => (process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);

function domainAllowed(email) {
  const d = String(email || '').toLowerCase().split('@')[1];
  return !!d && allowedDomains().includes(d);
}

function corsHeaders(event) {
  const h = event.headers || {};
  const origin = h.origin || h.Origin || '';
  const base = { 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Vary': 'Origin', 'Content-Type': 'application/json' };
  if (origin && allowedOrigins().includes(origin)) base['Access-Control-Allow-Origin'] = origin;
  return base;
}

const reply = (event, status, body) => ({ statusCode: status, headers: corsHeaders(event), body: JSON.stringify(body) });

// Token check #1 of 3 (client guard, these functions, Firestore rules).
async function verifyRequest(event) {
  const h = event.headers || {};
  const raw = h.authorization || h.Authorization || '';
  const m = /^Bearer (.+)$/.exec(raw);
  if (!m) throw new HttpError(401, 'Please sign in again.');
  let decoded;
  try { decoded = await auth.verifyIdToken(m[1]); }
  catch (e) { throw new HttpError(401, 'Your session has expired. Please sign in again.'); }
  if (decoded.email_verified !== true) throw new HttpError(403, 'Please verify your email first.');
  if (!domainAllowed(decoded.email)) throw new HttpError(403, 'Use your college email.');
  return decoded;
}

// Loads the caller's profile and blocks suspended accounts.
async function requireActive(database, uid) {
  const snap = await database.collection('users').doc(uid).get();
  if (!snap.exists) throw new HttpError(403, 'Finish setting up your profile first.');
  const u = snap.data();
  if (u.status !== 'active') throw new HttpError(403, 'Your account is restricted.');
  return u;
}

function handle(fn, opts = {}) {
  return async (event) => {
    if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: corsHeaders(event), body: '' };
    if (event.httpMethod !== 'POST') return reply(event, 405, { ok: false, error: 'Use POST.' });
    try {
      const token = await verifyRequest(event);
      if (opts.role && token.role !== opts.role) throw new HttpError(403, 'Not allowed.');
      let body = {};
      if (event.body) {
        if (event.body.length > 10000) throw new HttpError(413, 'Request too large.');
        try { body = JSON.parse(event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString() : event.body); }
        catch (e) { throw new HttpError(400, 'Invalid JSON.'); }
      }
      const out = await fn({ uid: token.uid, email: token.email, token, body });
      return reply(event, 200, { ok: true, ...(out || {}) });
    } catch (e) {
      if (e instanceof HttpError) return reply(event, e.status, { ok: false, error: e.message });
      console.error('function error', e);
      return reply(event, 500, { ok: false, error: 'Something went wrong. Please try again.' });
    }
  };
}

module.exports = { HttpError, handle, verifyRequest, requireActive, domainAllowed, corsHeaders };
