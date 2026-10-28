// Local e2e server: static public/ + fake Firestore bridge + fake Auth + the REAL Netlify function handlers.  TEST ONLY.
process.env.ALLOWED_EMAIL_DOMAINS = 'sathyabama.ac.in';
process.env.ALLOWED_ORIGINS = '*';
const http = require('http'), fs = require('fs'), path = require('path');
const { makeEnv } = require('../fake/admin');
const { encode, decode, FieldValue } = require('../fake/store');
const env = makeEnv(), { store } = env;
const libPath = require.resolve('../../netlify/functions/lib/firebaseAdmin');
require.cache[libPath] = { id: libPath, filename: libPath, loaded: true, exports: env };
const fns = {}; for (const f of fs.readdirSync(path.join(__dirname, '../../netlify/functions'))) if (f.endsWith('.js')) fns[f.slice(0, -3)] = require('../../netlify/functions/' + f);
const PUB = path.join(__dirname, '../../public'), PORT = +process.argv[2] || 8790;

const users = new Map(), roles = new Map(), links = new Map(); // email -> record
const rec = (email) => {
  let u = users.get(email);
  if (!u) { const uid = email.split('@')[0].replace(/[^a-z0-9]/gi, ''); u = { uid, email, emailVerified: true, displayName: '', created: String(Date.now()), last: String(Date.now()) }; users.set(email, u); }
  u.role = roles.get(email) || undefined; u.last = String(Date.now()); return u;
};
const claims = (t) => { try { return JSON.parse(Buffer.from((t || '').slice(5), 'base64url').toString()); } catch (e) { return null; } };
const err = (code, message) => ({ error: { code, message } });
const clientDenied = ['requests', 'connections', 'karmaEvents', 'reports', 'tagStats', 'config'];

// "rules-lite": a few of firestore.rules re-implemented so the UI error paths get exercised (the real rules have their own test file)
function readAllowed(p, c, data) {
  if (!c) return false; const s = p.split('/');
  if (s[0] === 'posts' && s.length === 2 && data && data.status !== 'open') return data.authorId === c.uid || c.role === 'admin';
  if (s[0] === 'users' && s[2] === 'private') { if (s[1] === c.uid) return true; return !!store.getDoc('connections/' + (c.uid < s[1] ? c.uid + '_' + s[1] : s[1] + '_' + c.uid)); }
  return true;
}
function writeAllowed(op, p, c, data) {
  if (!c) return false; const s = p.split('/');
  if (clientDenied.includes(s[0])) return false;
  if (s[0] === 'notifications') return op === 'update' && Object.keys(data).join() === 'read' && (store.getDoc(p) || {}).uid === c.uid;
  if (s[0] === 'chats' && s.length === 2) return op === 'update' && (store.getDoc(p).members || []).includes(c.uid);
  if (s[0] === 'chats' && s[2] === 'messages') return op === 'set' || op === 'add' ? (data.senderId === c.uid && (store.getDoc('chats/' + s[1]) || { members: [] }).members.includes(c.uid) && (store.getDoc('users/' + c.uid) || {}).status !== 'suspended') : false;
  if (s[0] === 'posts') { if (op === 'add') return data.authorId === c.uid && (store.getDoc('users/' + c.uid) || {}).status === 'active'; const cur = store.getDoc(p); return !!cur && cur.authorId === c.uid; }
  if (s[0] === 'users') { if (s[2] === 'private') return s[1] === c.uid; if (s[1] !== c.uid) return false; if (op === 'update') return Object.keys(data).every(k => ['displayName', 'photoURL', 'year', 'department', 'skills', 'lendItems', 'onboarded', 'lastActiveAt'].includes(k)); return op === 'set' && data.karma === 0 && data.role === 'student'; }
  return false;
}
const send = (res, code, body, type) => { res.writeHead(code, { 'content-type': type || 'application/json', 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' }); res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body)); };
const readBody = (req) => new Promise(r => { let b = ''; req.on('data', d => (b += d)); req.on('end', () => r(b)); });
const mime = { '.html': 'text/html', '.jpg': 'image/jpeg', '.js': 'application/javascript', '.css': 'text/css' };

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x'), p = url.pathname;
  if (req.method === 'OPTIONS') return send(res, 204, '');
  try {
    if (p.startsWith('/.netlify/functions/')) {
      const f = fns[p.split('/').pop()]; if (!f) return send(res, 404, { ok: false, error: 'no such function' });
      const body = await readBody(req), out = await f.handler({ httpMethod: req.method, headers: req.headers, body });
      res.writeHead(out.statusCode, { ...(out.headers || {}), 'access-control-allow-origin': '*' }); return res.end(out.body);
    }
    if (p.startsWith('/__fake/')) { const n = p.split('/').pop(); const file = path.join(__dirname, n === 'core.js' ? 'fake-core.js' : 'fake-' + n.replace('.js', '') + '.js'); return send(res, 200, fs.readFileSync(file), 'application/javascript'); }
    if (p === '/__fs') {
      const b = JSON.parse(await readBody(req)), c = claims(req.headers['x-token']);
      const c2 = c && { uid: c.uid, role: c.role };
      if (b.op === 'get') { const d = store.getDoc(b.path); if (d !== undefined && !readAllowed(b.path, c2, d)) return send(res, 200, err('permission-denied', 'Missing or insufficient permissions.')); if (!c2) return send(res, 200, err('permission-denied', 'sign in')); return send(res, 200, { data: d === undefined ? undefined : encode(d) }); }
      if (b.op === 'query') {
        if (!c2) return send(res, 200, err('permission-denied', 'sign in'));
        const q = { filters: b.q.filters.map(f => ({ ...f, value: decode(f.value) })), orders: b.q.orders, limit: b.q.limit };
        const col = b.path.split('/')[0];
        if (['reports'].includes(col) && c2.role !== 'admin') return send(res, 200, err('permission-denied', 'admin only'));
        if (col === 'tagStats' && !['admin', 'faculty'].includes(c2.role)) return send(res, 200, err('permission-denied', 'staff only'));
        if (col === 'posts' && !q.filters.some(f => f.field === 'status' && f.op === '==') && !q.filters.some(f => f.field === 'authorId' && f.value === c2.uid)) return send(res, 200, err('permission-denied', 'query not allowed by rules'));
        if (['requests'].includes(col) && !q.filters.some(f => (f.field === 'toUid' || f.field === 'fromUid') && f.value === c2.uid)) return send(res, 200, err('permission-denied', 'query not allowed by rules'));
        if (col === 'notifications' && !q.filters.some(f => f.field === 'uid' && f.value === c2.uid)) return send(res, 200, err('permission-denied', 'query not allowed by rules'));
        const rows = store.query(b.path, q).map(r => ({ path: r.path, data: encode(r.data) })); return send(res, 200, { rows });
      }
      const data = b.data ? decode(b.data) : undefined;
      if (!writeAllowed(b.op, b.op === 'add' ? b.path + '/new' : b.path, c2, data || {})) return send(res, 200, err('permission-denied', 'Missing or insufficient permissions.'));
      if (b.op === 'set') store.setDoc(b.path, data, b.merge); else if (b.op === 'update') store.updateDoc(b.path, data); else if (b.op === 'delete') store.deleteDoc(b.path);
      else if (b.op === 'add') return send(res, 200, { id: store.add(b.path, data) });
      return send(res, 200, {});
    }
    if (p.startsWith('/__auth/')) {
      const b = req.method === 'POST' ? JSON.parse(await readBody(req) || '{}') : {}; const act = p.split('/').pop();
      if (act === 'link') { const code = Math.random().toString(36).slice(2); links.set(code, { email: b.email, url: b.url, used: false }); links.set('last:' + b.email, code); return send(res, 200, {}); }
      if (act === 'redeem') { const l = links.get(b.code); if (!l || l.used) return send(res, 200, err('auth/invalid-action-code', 'bad link')); if (l.expired) return send(res, 200, err('auth/expired-action-code', 'expired')); if (l.email.toLowerCase() !== b.email.toLowerCase()) return send(res, 200, err('auth/invalid-email', 'mismatch')); l.used = true; return send(res, 200, rec(b.email)); }
      if (act === 'google') return send(res, 200, rec(b.email));
      if (act === 'get') { const u = [...users.values()].find(x => x.uid === b.uid); if (u) u.role = roles.get(u.email) || undefined; return send(res, 200, u || {}); }
      if (act === 'delete') { for (const [e, u] of users) if (u.uid === b.uid) users.delete(e); return send(res, 200, {}); }
      if (act === 'verify-email') return send(res, 200, {});
    }
    if (p.startsWith('/__test/')) {
      const act = p.split('/').pop(), b = req.method === 'POST' ? JSON.parse(await readBody(req) || '{}') : {};
      if (act === 'last-link') { const code = links.get('last:' + url.searchParams.get('email')); return send(res, 200, { url: `${links.get(code).url}?mode=signIn&oobCode=${code}` }); }
      if (act === 'expire-link') { links.get(b.code).expired = true; return send(res, 200, {}); }
      if (act === 'set-role') { roles.set(b.email, b.role); const u = users.get(b.email); if (u) { u.role = b.role; const d = store.getDoc('users/' + u.uid); if (d) store.updateDoc('users/' + u.uid, { role: b.role }); } return send(res, 200, {}); }
      if (act === 'unverify') { rec(b.email).emailVerified = false; return send(res, 200, {}); }
      if (act === 'verify') { rec(b.email).emailVerified = true; return send(res, 200, {}); }
      if (act === 'aggregate') return send(res, 200, await fns['aggregate-tags'].run());
      if (act === 'doc') return send(res, 200, { data: encode(store.getDoc(url.searchParams.get('path')) || null) });
      if (act === 'poke') { store.updateDoc(b.path, decode(b.data)); return send(res, 200, {}); }
      if (act === 'reset') { store.docs.clear(); users.clear(); roles.clear(); links.clear(); return send(res, 200, {}); }
    }
    let f = path.join(PUB, p === '/' ? 'index.html' : p); if (!fs.existsSync(f) && fs.existsSync(f + '.html')) f += '.html';
    if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404, { 'content-type': 'text/html' }); return res.end(fs.readFileSync(path.join(PUB, '404.html'))); }
    send(res, 200, fs.readFileSync(f), mime[path.extname(f)] || 'application/octet-stream');
  } catch (e) { console.error(e); send(res, 500, { error: { code: 'internal', message: String(e) } }); }
}).listen(PORT, () => console.log('e2e server on', PORT));
