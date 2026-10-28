// In-memory Firestore used ONLY by tests and the local e2e harness (not shipped to production).
class FakeTimestamp {
  constructor(ms) { this.ms = ms; this.seconds = Math.floor(ms / 1000); }
  toMillis() { return this.ms; } toDate() { return new Date(this.ms); }
  static now() { return new FakeTimestamp(Date.now()); } static fromMillis(ms) { return new FakeTimestamp(ms); }
}
class Sentinel { constructor(kind, v) { this.kind = kind; this.v = v; } }
const FieldValue = {
  serverTimestamp: () => new Sentinel('ts'), increment: (n) => new Sentinel('inc', n),
  arrayUnion: (...v) => new Sentinel('union', v), arrayRemove: (...v) => new Sentinel('remove', v), delete: () => new Sentinel('del')
};
const isTs = (v) => v instanceof FakeTimestamp;
function clone(v) {
  if (v === null || typeof v !== 'object') return v;
  if (isTs(v)) return new FakeTimestamp(v.ms);
  if (v instanceof Sentinel) return v;
  if (Array.isArray(v)) return v.map(clone);
  const o = {}; for (const k of Object.keys(v)) o[k] = clone(v[k]); return o;
}
// JSON bridge (browser fake <-> node store)
function encode(v) {
  if (v === null || typeof v !== 'object') return v;
  if (isTs(v)) return { __ts: v.ms };
  if (v instanceof Sentinel) return { __fv: v.kind, v: v.v };
  if (Array.isArray(v)) return v.map(encode);
  const o = {}; for (const k of Object.keys(v)) o[k] = encode(v[k]); return o;
}
function decode(v) {
  if (v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map(decode);
  if ('__ts' in v) return new FakeTimestamp(v.__ts);
  if ('__fv' in v) return new Sentinel(v.__fv, v.v);
  const o = {}; for (const k of Object.keys(v)) o[k] = decode(v[k]); return o;
}
function resolve(val, existing) {
  if (!(val instanceof Sentinel)) return clone(val);
  switch (val.kind) {
    case 'ts': return FakeTimestamp.now();
    case 'inc': return (typeof existing === 'number' ? existing : 0) + val.v;
    case 'union': { const a = Array.isArray(existing) ? existing.slice() : []; val.v.forEach(x => { if (!a.some(y => JSON.stringify(y) === JSON.stringify(x))) a.push(x); }); return a; }
    case 'remove': return (Array.isArray(existing) ? existing : []).filter(y => !val.v.some(x => JSON.stringify(x) === JSON.stringify(y)));
    default: return undefined;
  }
}
const norm = (p) => p.replace(/^\/+|\/+$/g, '');
const key = (v) => (isTs(v) ? v.ms : v);
function cmp(a, b) { a = key(a); b = key(b); return a < b ? -1 : a > b ? 1 : 0; }
const eq = (a, b) => JSON.stringify(encode(a)) === JSON.stringify(encode(b));

class Store {
  constructor() { this.docs = new Map(); this.rev = 0; }
  getDoc(path) { const d = this.docs.get(norm(path)); return d === undefined ? undefined : clone(d); }
  _apply(base, data) { const out = clone(base || {}); for (const k of Object.keys(data)) { const r = resolve(data[k], out[k]); if (r === undefined) delete out[k]; else out[k] = r; } return out; }
  setDoc(path, data, merge) { path = norm(path); const prev = merge ? this.docs.get(path) : undefined; this.docs.set(path, this._apply(prev, data)); this.rev++; }
  updateDoc(path, patch) {
    path = norm(path); const prev = this.docs.get(path);
    if (!prev) { const e = new Error('No document to update: ' + path); e.code = 'not-found'; throw e; }
    this.docs.set(path, this._apply(prev, patch)); this.rev++;
  }
  deleteDoc(path) { this.docs.delete(norm(path)); this.rev++; }
  newId() { return 'id' + Math.random().toString(36).slice(2, 12); }
  add(col, data) { const id = this.newId(); this.setDoc(norm(col) + '/' + id, data); return id; }
  query(col, q = {}) {
    col = norm(col); const depth = col.split('/').length + 1; let rows = [];
    for (const [p, d] of this.docs) if (p.startsWith(col + '/') && p.split('/').length === depth) rows.push({ id: p.split('/').pop(), path: p, data: clone(d) });
    for (const f of (q.filters || [])) {
      rows = rows.filter(({ data }) => {
        const v = data[f.field], t = f.value;
        switch (f.op) {
          case '==': return v !== undefined && eq(v, t);
          case '!=': return v !== undefined && !eq(v, t);
          case '<': return v !== undefined && cmp(v, t) < 0; case '<=': return v !== undefined && cmp(v, t) <= 0;
          case '>': return v !== undefined && cmp(v, t) > 0; case '>=': return v !== undefined && cmp(v, t) >= 0;
          case 'in': return t.some(x => eq(v, x)); case 'not-in': return !t.some(x => eq(v, x));
          case 'array-contains': return Array.isArray(v) && v.some(x => eq(x, t));
          case 'array-contains-any': return Array.isArray(v) && v.some(x => t.some(y => eq(x, y)));
          default: throw new Error('unsupported op ' + f.op);
        }
      });
    }
    const orders = q.orders || [];
    rows = rows.filter(r => orders.every(o => r.data[o.field] !== undefined));
    rows.sort((a, b) => { for (const o of orders) { const c = cmp(a.data[o.field], b.data[o.field]); if (c) return o.dir === 'desc' ? -c : c; } return 0; });
    if (q.limit) rows = rows.slice(0, q.limit);
    return rows;
  }
}
module.exports = { Store, FakeTimestamp, FieldValue, Sentinel, encode, decode, clone };
