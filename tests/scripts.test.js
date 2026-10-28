// Runs seed.js and set-role.js against the fake.  node --test tests/scripts.test.js
process.env.ALLOWED_EMAIL_DOMAINS = 'sathyabama.ac.in';
const test = require('node:test'), assert = require('node:assert/strict');
const { makeEnv } = require('./fake/admin');
const env = makeEnv();
const libPath = require.resolve('../netlify/functions/lib/firebaseAdmin');
require.cache[libPath] = { id: libPath, filename: libPath, loaded: true, exports: env };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const runScript = async (name, args) => { process.argv = ['node', name, ...args]; const p = require.resolve('../scripts/' + name); delete require.cache[p]; require(p); await sleep(150); };

test('seed creates demo students/posts, the --for story, and --clean removes them', async () => {
  await env.auth.createUser({ uid: 'realuid', email: 'student@sathyabama.ac.in', emailVerified: true });
  await runScript('seed.js', ['--for', 'student@sathyabama.ac.in']);
  assert.equal(env.store.query('users').length, 8);
  assert.equal(env.store.getDoc('users/demo_nia').badge, 'Top Mentor');
  assert.equal(env.store.getDoc('users/demo_aarav/private/contact').email, 'demo_aarav@sathyabama.ac.in');
  assert.equal(env.store.query('posts').length, 10);
  const reqs = env.store.query('requests'); assert.equal(reqs.length, 2); assert.ok(reqs.every(r => r.data.toUid === 'realuid' && r.data.status === 'pending'));
  assert.equal(env.store.query('notifications').length, 2);
  await runScript('seed.js', ['--clean']);
  assert.equal(env.store.query('users').length, 0); assert.equal(env.store.query('posts').length, 0); assert.equal(env.store.query('requests').length, 0);
});

test('set-role sets the claim and syncs the profile', async () => {
  await env.auth.createUser({ uid: 'u9', email: 'boss@sathyabama.ac.in', emailVerified: true });
  env.store.setDoc('users/u9', { role: 'student', displayName: 'Boss' });
  await runScript('set-role.js', ['boss@sathyabama.ac.in', 'admin']);
  assert.equal(env.auth.users.get('u9').customClaims.role, 'admin'); assert.equal(env.store.getDoc('users/u9').role, 'admin');
});
