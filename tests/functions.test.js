// Runs the REAL Netlify function code against the in-memory Firestore fake.  node --test tests/functions.test.js
process.env.ALLOWED_EMAIL_DOMAINS = 'sathyabama.ac.in';
process.env.ALLOWED_ORIGINS = 'http://localhost:5173';
const test = require('node:test'), assert = require('node:assert/strict');
const path = require('path');
const { makeEnv, token } = require('./fake/admin');
const env = makeEnv();
const libPath = require.resolve('../netlify/functions/lib/firebaseAdmin');
require.cache[libPath] = { id: libPath, filename: libPath, loaded: true, exports: env };
const F = (n) => require('../netlify/functions/' + n).handler;
const fns = { create: F('create-request'), respond: F('respond-request'), helped: F('confirm-helped'), report: F('submit-report'), action: F('report-action') };
const { run: aggregate } = require('../netlify/functions/aggregate-tags');
const { resetConfigCache } = require('../netlify/functions/lib/config');
const { store } = env, TS = env.Timestamp;

const D = 'sathyabama.ac.in';
const U = { maya: { uid: 'maya', email: `maya@${D}` }, aarav: { uid: 'aarav', email: `aarav@${D}` }, nia: { uid: 'nia', email: `nia@${D}` },
  kiran: { uid: 'kiran', email: `kiran@${D}` }, alex: { uid: 'alex', email: `alex@${D}`, role: 'admin' }, fac: { uid: 'fac', email: `fac@${D}`, role: 'faculty' } };
const call = async (fn, who, body, extra = {}) => {
  const t = who ? token(who) : '';
  const r = await fns[fn]({ httpMethod: 'POST', headers: { authorization: who === null ? '' : 'Bearer ' + t, origin: 'http://localhost:5173', ...extra }, body: JSON.stringify(body || {}) });
  return { ...JSON.parse(r.body || '{}'), status: r.statusCode, headers: r.headers };
};
const seedUser = (id, over = {}) => store.setDoc('users/' + id, { displayName: id[0].toUpperCase() + id.slice(1) + ' Test', year: 1, department: 'CS', skills: [], lendItems: [], onboarded: true, karma: 0, badge: 'Newcomer', helpedCount: 0, role: 'student', status: 'active', createdAt: TS.now(), ...over });
const seedPost = (id, authorId, over = {}) => store.setDoc('posts/' + id, { authorId, type: 'need', category: 'academic', title: 'Data Structures study help', description: 'x', tags: ['c++', 'python'], status: 'open', reportCount: 0, createdAt: TS.now(), updatedAt: TS.now(), ...over });
const notifs = (uid) => store.query('notifications', { filters: [{ field: 'uid', op: '==', value: uid }] }).map(r => r.data);
const reset = () => { store.docs.clear(); resetConfigCache(); ['maya', 'aarav', 'nia', 'kiran'].forEach(u => seedUser(u)); seedUser('alex', { role: 'admin' }); seedUser('fac', { role: 'faculty' }); };

test('auth gate: no token, unverified, wrong domain, wrong method, CORS preflight', async () => {
  reset();
  assert.equal((await call('create', null, { postId: 'p' })).status, 401);
  assert.equal((await call('create', { ...U.maya, email_verified: false }, { postId: 'p' })).status, 403);
  assert.equal((await call('create', { uid: 'x', email: 'x@gmail.com' }, { postId: 'p' })).status, 403);
  const get = await fns.create({ httpMethod: 'GET', headers: {}, body: '' }); assert.equal(get.statusCode, 405);
  const opt = await fns.create({ httpMethod: 'OPTIONS', headers: { origin: 'http://localhost:5173' } });
  assert.equal(opt.statusCode, 204); assert.equal(opt.headers['Access-Control-Allow-Origin'], 'http://localhost:5173');
  const bad = await fns.create({ httpMethod: 'OPTIONS', headers: { origin: 'https://evil.example' } });
  assert.equal(bad.headers['Access-Control-Allow-Origin'], undefined);
});

test('create-request: roles, duplicate, own post, closed post, notification, daily limit, suspended', async () => {
  reset(); seedPost('p1', 'maya'); seedPost('p2', 'aarav', { type: 'offer', title: 'Linked lists, made less scary.' }); seedPost('pc', 'maya', { status: 'closed' });
  const r = await call('create', U.aarav, { postId: 'p1' });
  assert.equal(r.status, 200); assert.equal(r.ok, true);
  const req = store.getDoc('requests/' + r.id);
  assert.deepEqual([req.fromUid, req.toUid, req.helperUid, req.receiverUid, req.status, req.helpedConfirmed], ['aarav', 'maya', 'aarav', 'maya', 'pending', false]);
  assert.equal(notifs('maya')[0].type, 'request_received');
  assert.equal((await call('create', U.aarav, { postId: 'p1' })).status, 409, 'duplicate');
  assert.equal((await call('create', U.maya, { postId: 'p1', toUid: 'x' })).status, 400, 'own post');
  assert.equal((await call('create', U.aarav, { postId: 'pc' })).status, 409, 'closed');
  assert.equal((await call('create', U.aarav, { postId: 'nope' })).status, 404);
  assert.equal((await call('create', U.aarav, { postId: 'p1', toUid: 'nia' })).status, 400, 'wrong toUid');
  const o = await call('create', U.maya, { postId: 'p2', toUid: 'aarav' });   // offer: the author helps
  const oreq = store.getDoc('requests/' + o.id); assert.deepEqual([oreq.helperUid, oreq.receiverUid], ['aarav', 'maya']);
  store.updateDoc('users/nia', { status: 'suspended' });
  assert.equal((await call('create', U.nia, { postId: 'p1' })).status, 403, 'suspended caller');
  store.updateDoc('users/nia', { status: 'active' });
  for (let i = 0; i < 10; i++) { seedPost('x' + i, 'kiran'); store.add('requests', { fromUid: 'nia', toUid: 'kiran', postId: 'x' + i, status: 'pending', createdAt: TS.now() }); }
  assert.equal((await call('create', U.nia, { postId: 'p1' })).status, 429, 'daily limit');
});

test('respond-request: accept creates connection+chat+first-time karma; replay blocked; permissions', async () => {
  reset(); seedPost('p1', 'maya'); seedPost('p3', 'maya', { title: 'Another ask here' });
  const a = (await call('create', U.aarav, { postId: 'p1' })).id;
  assert.equal((await call('respond', U.aarav, { requestId: a, action: 'accept' })).status, 403, 'sender cannot accept');
  assert.equal((await call('respond', U.nia, { requestId: a, action: 'accept' })).status, 403, 'stranger cannot');
  assert.equal((await call('respond', U.maya, { requestId: a, action: 'explode' })).status, 400);
  const ok = await call('respond', U.maya, { requestId: a, action: 'accept' });
  assert.equal(ok.status, 200); assert.equal(ok.chatId, a);
  assert.equal(store.getDoc('requests/' + a).status, 'accepted');
  assert.deepEqual(store.getDoc('connections/aarav_maya').members, ['aarav', 'maya']);
  assert.deepEqual(store.getDoc('chats/' + a).members, ['aarav', 'maya']);
  assert.equal(store.getDoc('users/maya').karma, 3);
  assert.equal(store.query('karmaEvents').length, 1);
  assert.equal(notifs('aarav').some(n => n.type === 'request_accepted' && n.refId === a), true);
  assert.equal((await call('respond', U.maya, { requestId: a, action: 'accept' })).status, 409, 'replay');
  const b = (await call('create', U.aarav, { postId: 'p3' })).id;       // same pair again: no new karma
  await call('respond', U.maya, { requestId: b, action: 'accept' });
  assert.equal(store.getDoc('users/maya').karma, 3, 'karma only the first time a pair connects');
});

test('respond-request: decline and cancel', async () => {
  reset(); seedPost('p1', 'maya');
  const a = (await call('create', U.aarav, { postId: 'p1' })).id;
  assert.equal((await call('respond', U.maya, { requestId: a, action: 'cancel' })).status, 403, 'only sender cancels');
  assert.equal((await call('respond', U.aarav, { requestId: a, action: 'cancel' })).status, 200);
  assert.equal(store.getDoc('requests/' + a).status, 'cancelled');
  const n = (await call('create', U.nia, { postId: 'p1' })).id;
  assert.equal((await call('respond', U.maya, { requestId: n, action: 'decline' })).status, 200);
  assert.equal(store.getDoc('requests/' + n).status, 'declined');
  assert.equal(store.getDoc('connections/maya_nia'), undefined);
});

test('confirm-helped: only the receiver; karma, helpedCount, badge, once per pair per day', async () => {
  reset(); seedPost('p1', 'maya'); seedPost('p3', 'maya', { title: 'Another ask here' });
  const a = (await call('create', U.aarav, { postId: 'p1' })).id;
  assert.equal((await call('helped', U.maya, { requestId: a })).status, 409, 'not accepted yet');
  await call('respond', U.maya, { requestId: a, action: 'accept' });
  assert.equal((await call('helped', U.aarav, { requestId: a })).status, 403, 'helper cannot self-confirm');
  const ok = await call('helped', U.maya, { requestId: a });
  assert.equal(ok.status, 200); assert.equal(ok.points, 10);
  const h = store.getDoc('users/aarav'); assert.equal(h.karma, 10); assert.equal(h.helpedCount, 1); assert.equal(h.badge, 'Helper');
  assert.equal(store.getDoc('requests/' + a).helpedConfirmed, true);
  assert.equal(notifs('aarav').some(n => n.type === 'badge_earned'), true);
  assert.equal(notifs('aarav').some(n => n.type === 'help_confirmed'), true);
  assert.equal((await call('helped', U.maya, { requestId: a })).status, 409, 'only once per connection');
  const b = (await call('create', U.aarav, { postId: 'p3' })).id; await call('respond', U.maya, { requestId: b, action: 'accept' });
  assert.equal((await call('helped', U.maya, { requestId: b })).status, 429, 'daily pair limit');
  assert.equal(store.getDoc('users/aarav').karma, 10);
});

test('submit-report: validation, duplicate, self, auto-hide at 3', async () => {
  reset(); seedPost('p1', 'kiran');
  assert.equal((await call('report', U.maya, { targetType: 'post', targetId: 'p1', reason: 'bogus' })).status, 400);
  assert.equal((await call('report', U.kiran, { targetType: 'post', targetId: 'p1', reason: 'spam' })).status, 400, 'own post');
  assert.equal((await call('report', U.maya, { targetType: 'user', targetId: 'maya', reason: 'spam' })).status, 400, 'self');
  assert.equal((await call('report', U.maya, { targetType: 'post', targetId: 'nope', reason: 'spam' })).status, 404);
  assert.equal((await call('report', U.maya, { targetType: 'post', targetId: 'p1', reason: 'spam', details: 'x' })).status, 200);
  assert.equal((await call('report', U.maya, { targetType: 'post', targetId: 'p1', reason: 'spam' })).status, 409, 'duplicate');
  assert.equal(store.getDoc('posts/p1').status, 'open');
  await call('report', U.aarav, { targetType: 'post', targetId: 'p1', reason: 'spam' });
  const third = await call('report', U.nia, { targetType: 'post', targetId: 'p1', reason: 'other' });
  assert.equal(third.autoHidden, true); assert.equal(store.getDoc('posts/p1').status, 'hidden'); assert.equal(store.getDoc('posts/p1').reportCount, 3);
  assert.equal((await call('report', U.maya, { targetType: 'user', targetId: 'kiran', reason: 'harassment' })).status, 200);
});

test('report-action: admin only, note required, hide/suspend/dismiss, staff protected, replay blocked', async () => {
  reset(); seedPost('p1', 'kiran');
  await call('report', U.maya, { targetType: 'post', targetId: 'p1', reason: 'spam' });
  const rid = `maya_post_p1`;
  assert.equal((await call('action', U.maya, { reportId: rid, action: 'dismiss' })).status, 403, 'student');
  assert.equal((await call('action', U.fac, { reportId: rid, action: 'dismiss' })).status, 403, 'faculty');
  assert.equal((await call('action', U.alex, { reportId: rid, action: 'hide_post', note: '' })).status, 400, 'note required');
  assert.equal((await call('action', U.alex, { reportId: rid, action: 'hide_post', note: 'Sells graded work.' })).status, 200);
  assert.equal(store.getDoc('posts/p1').status, 'hidden');
  const rep = store.getDoc('reports/' + rid); assert.deepEqual([rep.status, rep.reviewedBy, rep.moderatorNote], ['actioned', 'alex', 'Sells graded work.']);
  assert.equal((await call('action', U.alex, { reportId: rid, action: 'dismiss' })).status, 409, 'already handled');
  await call('report', U.aarav, { targetType: 'user', targetId: 'kiran', reason: 'harassment' });
  assert.equal((await call('action', U.alex, { reportId: 'aarav_user_kiran', action: 'suspend_user', note: 'Repeated unwanted contact.' })).status, 200);
  assert.equal(store.getDoc('users/kiran').status, 'suspended');
  await call('report', U.nia, { targetType: 'user', targetId: 'fac', reason: 'spam' });
  assert.equal((await call('action', U.alex, { reportId: 'nia_user_fac', action: 'suspend_user', note: 'x' })).status, 403, 'staff cannot be suspended');
  await call('report', U.nia, { targetType: 'user', targetId: 'aarav', reason: 'spam' });
  assert.equal((await call('action', U.alex, { reportId: 'nia_user_aarav', action: 'dismiss' })).status, 200);
  assert.equal(store.getDoc('users/aarav').status, 'active');
});

test('aggregate-tags: counts open posts per tag, summary, removes stale tags', async () => {
  reset(); store.setDoc('tagStats/stale', { tag: 'stale', needCount: 9, offerCount: 0 });
  seedPost('a', 'maya', { tags: ['python', 'c++'] }); seedPost('b', 'aarav', { type: 'offer', tags: ['python'] }); seedPost('c', 'nia', { status: 'closed', tags: ['python'] });
  const out = await aggregate(); assert.equal(out.posts, 3);
  const py = store.getDoc('tagStats/python'); assert.deepEqual([py.needCount, py.offerCount], [1, 1]);
  assert.equal(store.getDoc('tagStats/' + encodeURIComponent('c++')).needCount, 1);
  assert.equal(store.getDoc('tagStats/stale'), undefined);
  const s = store.getDoc('tagStats/_summary'); assert.deepEqual([s.totalPosts, s.open, s.closed], [3, 2, 1]);
  assert.equal(s.byCategory.academic, 2); assert.equal(s.weekly.length, 6); assert.equal(s.weekly[5].count, 3);
});
