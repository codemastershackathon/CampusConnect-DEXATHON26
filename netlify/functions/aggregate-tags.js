// F07 · Scheduled nightly (see netlify.toml). Rebuilds tagStats/{tag} + tagStats/_summary for the faculty Insights page.
const { db, Timestamp } = require('./lib/firebaseAdmin');

const weekStart = (ms) => { const d = new Date(ms); d.setUTCHours(0, 0, 0, 0); const dow = (d.getUTCDay() + 6) % 7; d.setUTCDate(d.getUTCDate() - dow); return d.getTime(); };
const idFor = (tag) => encodeURIComponent(tag).slice(0, 150);

async function run() {
  const snap = await db.collection('posts').get();
  const tags = new Map();
  const summary = { totalPosts: 0, open: 0, closed: 0, hidden: 0, byCategory: {}, weekly: [] };
  const weeks = new Map();
  const thisWeek = weekStart(Date.now());
  for (let i = 5; i >= 0; i--) weeks.set(thisWeek - i * 7 * 864e5, 0);

  snap.docs.forEach(doc => {
    const p = doc.data();
    summary.totalPosts++;
    summary[p.status] = (summary[p.status] || 0) + 1;
    if (p.createdAt) { const w = weekStart(p.createdAt.toMillis()); if (weeks.has(w)) weeks.set(w, weeks.get(w) + 1); }
    if (p.status === 'open') summary.byCategory[p.category] = (summary.byCategory[p.category] || 0) + 1;
    if (p.status !== 'open') return; // tag counts reflect what is open right now
    (p.tags || []).forEach(t => {
      const e = tags.get(t) || { needCount: 0, offerCount: 0 };
      if (p.type === 'need') e.needCount++; else e.offerCount++;
      tags.set(t, e);
    });
  });
  summary.weekly = [...weeks.entries()].map(([w, count]) => ({ weekStart: w, count }));

  const existing = await db.collection('tagStats').get();
  const keep = new Set(['_summary']);
  let batch = db.batch(), n = 0;
  const flush = async () => { if (n) { await batch.commit(); batch = db.batch(); n = 0; } };
  const now = Timestamp.now();

  for (const [tag, c] of tags) {
    const id = idFor(tag); keep.add(id);
    batch.set(db.collection('tagStats').doc(id), { tag, needCount: c.needCount, offerCount: c.offerCount, updatedAt: now }); n++;
    if (n >= 400) await flush();
  }
  batch.set(db.collection('tagStats').doc('_summary'), { ...summary, updatedAt: now }); n++;
  for (const d of existing.docs) { if (!keep.has(d.id)) { batch.delete(d.ref); n++; if (n >= 400) await flush(); } }
  await flush();
  return { tags: tags.size, posts: summary.totalPosts };
}

exports.run = run;
exports.handler = async () => {
  try { const out = await run(); console.log('aggregate-tags', out); return { statusCode: 200, body: JSON.stringify(out) }; }
  catch (e) { console.error('aggregate-tags failed', e); return { statusCode: 500, body: 'failed' }; }
};
