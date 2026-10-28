// Fake `firebase-admin` surface (just what the Netlify functions + scripts use), backed by Store.
const { Store, FakeTimestamp, FieldValue, clone } = require('./store');

function makeEnv(store = new Store()) {
  class DocSnap { constructor(ref, data) { this.ref = ref; this.id = ref.id; this._d = data; this.exists = data !== undefined; } data() { return this._d === undefined ? undefined : clone(this._d); } }
  class DocRef {
    constructor(path) { this.path = path.replace(/^\/+|\/+$/g, ''); this.id = this.path.split('/').pop(); }
    async get() { return new DocSnap(this, store.getDoc(this.path)); }
    async set(d, o) { store.setDoc(this.path, d, o && o.merge); }
    async update(p) { store.updateDoc(this.path, p); }
    async delete() { store.deleteDoc(this.path); }
    collection(n) { return new CollRef(this.path + '/' + n); }
  }
  class Query {
    constructor(path, q) { this.path = path; this.q = q || { filters: [], orders: [] }; }
    where(field, op, value) { return new Query(this.path, { ...this.q, filters: [...this.q.filters, { field, op, value }] }); }
    orderBy(field, dir = 'asc') { return new Query(this.path, { ...this.q, orders: [...this.q.orders, { field, dir }] }); }
    limit(n) { return new Query(this.path, { ...this.q, limit: n }); }
    async get() { const rows = store.query(this.path, this.q).map(r => new DocSnap(new DocRef(r.path), r.data)); return { docs: rows, size: rows.length, empty: !rows.length, forEach: (f) => rows.forEach(f) }; }
  }
  class CollRef extends Query {
    constructor(path) { super(path.replace(/^\/+|\/+$/g, '')); }
    doc(id) { return new DocRef(this.path + '/' + (id || store.newId())); }
    async add(d) { const id = store.add(this.path, d); return new DocRef(this.path + '/' + id); }
  }
  const run = (ops) => ops.forEach(o => { if (o.t === 'set') store.setDoc(o.ref.path, o.d, o.m); else if (o.t === 'upd') store.updateDoc(o.ref.path, o.d); else store.deleteDoc(o.ref.path); });
  const writer = (ops) => ({
    set(ref, d, o) { ops.push({ t: 'set', ref, d, m: o && o.merge }); return this; },
    create(ref, d) { ops.push({ t: 'set', ref, d }); return this; },
    update(ref, d) { ops.push({ t: 'upd', ref, d }); return this; },
    delete(ref) { ops.push({ t: 'del', ref }); return this; }
  });
  const db = {
    collection: (p) => new CollRef(p), doc: (p) => new DocRef(p),
    batch() { const ops = []; return { ...writer(ops), commit: async () => run(ops) }; },
    async runTransaction(fn) {
      const ops = []; const tx = { ...writer(ops), get: (x) => x.get() };
      const out = await fn(tx); run(ops); return out;   // writes apply only if fn did not throw
    }
  };
  const auth = {
    async verifyIdToken(t) {
      if (!t || !t.startsWith('fake.')) throw new Error('bad token');
      const c = JSON.parse(Buffer.from(t.slice(5), 'base64url').toString());
      return { uid: c.uid, email: c.email, email_verified: c.email_verified !== false, ...(c.role ? { role: c.role } : {}) };
    },
    users: new Map(),
    async getUser(uid) { const u = this.users.get(uid); if (!u) { const e = new Error('no user'); e.code = 'auth/user-not-found'; throw e; } return u; },
    async deleteUser(uid) { this.users.delete(uid); },
    async getUserByEmail(email) { const u = [...this.users.values()].find(x => x.email === email); if (!u) { const e = new Error('no user'); e.code = 'auth/user-not-found'; throw e; } return u; },
    async createUser(p) { const u = { uid: p.uid || store.newId(), email: p.email, displayName: p.displayName, emailVerified: !!p.emailVerified, customClaims: {} }; this.users.set(u.uid, u); return u; },
    async setCustomUserClaims(uid, claims) { this.users.get(uid).customClaims = claims; }
  };
  const Timestamp = FakeTimestamp;
  return { store, db, auth, FieldValue, Timestamp, admin: { firestore: { FieldValue, Timestamp } } };
}
const token = (c) => 'fake.' + Buffer.from(JSON.stringify(c)).toString('base64url');
module.exports = { makeEnv, token };
