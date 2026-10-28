// Browser-side fake of the Firebase JS SDK (auth + firestore) that talks to tests/e2e/server.js. TEST ONLY.
const J = async (path, body, token) => {
  const r = await fetch(location.origin + path, { method: 'POST', headers: { 'content-type': 'application/json', 'x-token': token || '' }, body: JSON.stringify(body || {}) });
  const d = await r.json(); if (d.error) { const e = new Error(d.error.message); e.code = d.error.code; throw e; } return d;
};
class FakeTimestamp { constructor(ms) { this.ms = ms; this.seconds = Math.floor(ms / 1000); } toMillis() { return this.ms; } toDate() { return new Date(this.ms); } }
export const Timestamp = FakeTimestamp;
const dec = (v) => { if (v === null || typeof v !== 'object') return v; if (Array.isArray(v)) return v.map(dec); if ('__ts' in v) return new FakeTimestamp(v.__ts); const o = {}; for (const k in v) o[k] = dec(v[k]); return o; };
const enc = (v) => { if (v === null || typeof v !== 'object') return v; if (v instanceof FakeTimestamp) return { __ts: v.ms }; if (v && v.__fv) return v; if (Array.isArray(v)) return v.map(enc); const o = {}; for (const k in v) o[k] = enc(v[k]); return o; };
export const serverTimestamp = () => ({ __fv: 'ts' });

/* ---------------- app + auth ---------------- */
export const initializeApp = (cfg) => ({ cfg });
const KEY = 'fake_auth';
const authObj = { currentUser: null, _l: [] };
const b64 = (o) => btoa(unescape(encodeURIComponent(JSON.stringify(o)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const tokenFor = (rec) => 'fake.' + b64({ uid: rec.uid, email: rec.email, email_verified: rec.emailVerified, ...(rec.role ? { role: rec.role } : {}) });
function mk(rec) {
  if (!rec) return null;
  const u = { uid: rec.uid, email: rec.email, emailVerified: rec.emailVerified, displayName: rec.displayName || '', photoURL: '', metadata: { creationTime: rec.created, lastSignInTime: rec.last } };
  u.getIdToken = async () => tokenFor(rec);
  u.getIdTokenResult = async (force) => { if (force) { const f = await J('/__auth/get', { uid: rec.uid }); Object.assign(rec, f); u.emailVerified = rec.emailVerified; save(rec); } return { claims: rec.role ? { role: rec.role } : {}, token: tokenFor(rec) }; };
  u.reload = async () => { const f = await J('/__auth/get', { uid: rec.uid }); Object.assign(rec, f); u.emailVerified = rec.emailVerified; save(rec); };
  u.delete = async () => { await J('/__auth/delete', { uid: rec.uid }); save(null); set(null); };
  return u;
}
const save = (rec) => { if (rec) localStorage.setItem(KEY, JSON.stringify(rec)); else localStorage.removeItem(KEY); };
function set(user) { authObj.currentUser = user; authObj._l.forEach(cb => setTimeout(() => cb(user), 0)); }
try { const r = JSON.parse(localStorage.getItem(KEY) || 'null'); authObj.currentUser = mk(r); } catch (e) {}
export const getAuth = () => authObj;
export const connectAuthEmulator = () => {};
export const onAuthStateChanged = (a, cb) => { authObj._l.push(cb); setTimeout(() => cb(authObj.currentUser), 0); return () => { authObj._l = authObj._l.filter(x => x !== cb); }; };
export class GoogleAuthProvider { setCustomParameters(p) { this.p = p; } }
const login = (rec) => { save(rec); const u = mk(rec); set(u); return { user: u }; };
export const signInWithPopup = async () => { const email = localStorage.getItem('fake_google_email'); if (!email) { const e = new Error('closed'); e.code = 'auth/popup-closed-by-user'; throw e; } return login(await J('/__auth/google', { email })); };
export const sendSignInLinkToEmail = async (a, email, s) => { await J('/__auth/link', { email, url: s.url }); };
export const isSignInWithEmailLink = (a, href) => /oobCode=/.test(href);
export const signInWithEmailLink = async (a, email, href) => login(await J('/__auth/redeem', { email, code: new URL(href).searchParams.get('oobCode') }));
export const sendEmailVerification = async (u) => { await J('/__auth/verify-email', { uid: u.uid }); };
export const signOut = async () => { save(null); set(null); };

/* ---------------- firestore ---------------- */
export const getFirestore = () => ({});
export const connectFirestoreEmulator = () => {};
const tok = () => (authObj.currentUser ? tokenFor(JSON.parse(localStorage.getItem(KEY))) : '');
const segs = (a) => a.filter(x => typeof x === 'string').join('/').replace(/\/+/g, '/');
export const collection = (db, ...p) => ({ type: 'col', path: segs(p) });
export const doc = (base, ...p) => ({ type: 'doc', path: base.type === 'col' ? base.path + '/' + p[0] : segs(p) });
export const where = (field, op, value) => ({ k: 'where', field, op, value });
export const orderBy = (field, dir) => ({ k: 'order', field, dir: dir || 'asc' });
export const limit = (n) => ({ k: 'limit', n });
export const query = (base, ...cs) => { const q = { type: 'query', path: base.path, filters: [], orders: [] }; cs.forEach(c => { if (c.k === 'where') q.filters.push(c); else if (c.k === 'order') q.orders.push(c); else q.limit = c.n; }); return q; };
class DocSnap { constructor(path, d) { this.id = path.split('/').pop(); this.ref = { path }; this._d = d === undefined ? undefined : dec(d); } exists() { return this._d !== undefined; } data() { return this._d; } }
class QSnap { constructor(rows) { this.docs = rows.map(r => new DocSnap(r.path, r.data)); this.size = this.docs.length; this.empty = !this.size; } forEach(f) { this.docs.forEach(f); } }
const fs = (op, body) => J('/__fs', { op, ...body }, tok());
export const getDoc = async (ref) => new DocSnap(ref.path, (await fs('get', { path: ref.path })).data);
export const getDocs = async (q) => new QSnap((await fs('query', { path: q.path, q: { filters: (q.filters || []).map(f => ({ ...f, value: enc(f.value) })), orders: q.orders || [], limit: q.limit } })).rows);
export const setDoc = async (ref, data, o) => { await fs('set', { path: ref.path, data: enc(data), merge: !!(o && o.merge) }); };
export const updateDoc = async (ref, data) => { await fs('update', { path: ref.path, data: enc(data) }); };
export const deleteDoc = async (ref) => { await fs('delete', { path: ref.path }); };
export const addDoc = async (col, data) => { const r = await fs('add', { path: col.path, data: enc(data) }); return { id: r.id, path: col.path + '/' + r.id }; };
export const onSnapshot = (target, next, error) => {
  let last = null, dead = false;
  const run = async () => {
    if (dead) return;
    try {
      let snap, key;
      if (target.type === 'doc') { const r = await fs('get', { path: target.path }); key = JSON.stringify(r.data); snap = new DocSnap(target.path, r.data); }
      else { const r = await fs('query', { path: target.path, q: { filters: (target.filters || []).map(f => ({ ...f, value: enc(f.value) })), orders: target.orders || [], limit: target.limit } }); key = JSON.stringify(r.rows); snap = new QSnap(r.rows); }
      if (key !== last) { last = key; next(snap); }
    } catch (e) { if (error) error(e); dead = true; return; }
    setTimeout(run, 250);
  };
  run(); return () => { dead = true; };
};
