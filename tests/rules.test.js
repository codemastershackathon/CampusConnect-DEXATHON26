// Firestore rules tests.  Needs the emulator:  npm run test:rules   (firebase-tools + @firebase/rules-unit-testing)
const { initializeTestEnvironment, assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
const { doc, getDoc, setDoc, updateDoc, deleteDoc, addDoc, collection, getDocs, query, where, serverTimestamp } = require('firebase/firestore');
const test = require('node:test'), fs = require('fs'), path = require('path');

let env;
const DOMAIN = 'sathyabama.ac.in';
const as = (uid, extra = {}) => env.authenticatedContext(uid, { email: `${uid}@${DOMAIN}`, email_verified: true, ...extra }).firestore();
const user = (over = {}) => ({ displayName: 'Maya', year: 1, department: 'CS', skills: [], lendItems: [], onboarded: false, karma: 0, badge: 'Newcomer', helpedCount: 0, role: 'student', status: 'active', createdAt: serverTimestamp(), ...over });
const post = (uid, over = {}) => ({ authorId: uid, type: 'need', category: 'academic', title: 'Data Structures help', description: 'linked lists', tags: ['c++'], status: 'open', reportCount: 0, createdAt: serverTimestamp(), updatedAt: serverTimestamp(), ...over });

test.before(async () => {
  env = await initializeTestEnvironment({ projectId: 'campusconnect-test', firestore: { rules: fs.readFileSync(path.join(__dirname, '..', 'firestore.rules'), 'utf8'), host: '127.0.0.1', port: 8080 } });
});
test.after(async () => env.cleanup());
test.beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async ctx => {
    const db = ctx.firestore();
    for (const u of ['maya', 'aarav', 'nia']) await setDoc(doc(db, 'users', u), { ...user(), displayName: u, createdAt: new Date() });
    await setDoc(doc(db, 'users/maya/private/contact'), { email: `maya@${DOMAIN}`, phone: '999', updatedAt: new Date() });
    await setDoc(doc(db, 'posts/p1'), { ...post('maya'), createdAt: new Date(), updatedAt: new Date() });
    await setDoc(doc(db, 'posts/hid'), { ...post('maya', { status: 'hidden' }), createdAt: new Date(), updatedAt: new Date() });
    await setDoc(doc(db, 'connections/aarav_maya'), { members: ['aarav', 'maya'] });
    await setDoc(doc(db, 'chats/c1'), { members: ['aarav', 'maya'], lastMessage: '', lastMessageAt: new Date() });
  });
});

test('signed-out, unverified and wrong-domain users are locked out', async () => {
  await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), 'posts/p1')));
  await assertFails(getDoc(doc(env.authenticatedContext('x', { email: `x@${DOMAIN}`, email_verified: false }).firestore(), 'posts/p1')));
  await assertFails(getDoc(doc(env.authenticatedContext('x', { email: 'x@gmail.com', email_verified: true }).firestore(), 'posts/p1')));
  await assertSucceeds(getDoc(doc(as('aarav'), 'posts/p1')));
});
test('users: create own profile with forced defaults; cannot self-award karma/role/status', async () => {
  await assertSucceeds(setDoc(doc(as('newbie'), 'users/newbie'), user()));
  await assertFails(setDoc(doc(as('newbie2'), 'users/newbie2'), user({ karma: 50 })));
  await assertFails(setDoc(doc(as('newbie3'), 'users/newbie3'), user({ role: 'admin' })));
  await assertFails(setDoc(doc(as('newbie4'), 'users/other'), user()));
  await assertSucceeds(updateDoc(doc(as('maya'), 'users/maya'), { displayName: 'Maya P' }));
  await assertFails(updateDoc(doc(as('maya'), 'users/maya'), { karma: 999 }));
  await assertFails(updateDoc(doc(as('maya'), 'users/maya'), { badge: 'Top Mentor' }));
  await assertFails(updateDoc(doc(as('maya'), 'users/maya'), { role: 'admin' }));
  await assertFails(updateDoc(doc(as('aarav'), 'users/maya'), { displayName: 'hax' }));
  await assertFails(updateDoc(doc(as('maya', { role: 'admin' }), 'users/maya'), { status: 'suspended' }));
});
test('private contact: owner and accepted connection only', async () => {
  await assertSucceeds(getDoc(doc(as('maya'), 'users/maya/private/contact')));
  await assertSucceeds(getDoc(doc(as('aarav'), 'users/maya/private/contact')));   // connected
  await assertFails(getDoc(doc(as('nia'), 'users/maya/private/contact')));         // not connected
  await assertFails(setDoc(doc(as('aarav'), 'users/maya/private/contact'), { email: `maya@${DOMAIN}`, updatedAt: serverTimestamp() }));
});
test('posts: create/edit/close/delete rules and hidden visibility', async () => {
  await assertSucceeds(setDoc(doc(as('maya'), 'posts/new1'), post('maya')));
  await assertFails(setDoc(doc(as('maya'), 'posts/new2'), post('aarav')));                       // spoofed author
  await assertFails(setDoc(doc(as('maya'), 'posts/new3'), post('maya', { title: 'abc' })));      // too short
  await assertFails(setDoc(doc(as('maya'), 'posts/new4'), post('maya', { tags: [] })));          // no tags
  await assertFails(setDoc(doc(as('maya'), 'posts/new5'), post('maya', { reportCount: 5 })));
  await assertSucceeds(updateDoc(doc(as('maya'), 'posts/p1'), { title: 'Edited title ok', updatedAt: serverTimestamp() }));
  await assertSucceeds(updateDoc(doc(as('maya'), 'posts/p1'), { status: 'closed', updatedAt: serverTimestamp() }));
  await assertFails(updateDoc(doc(as('maya'), 'posts/p1'), { authorId: 'aarav', updatedAt: serverTimestamp() }));
  await assertFails(updateDoc(doc(as('maya'), 'posts/p1'), { reportCount: 0, updatedAt: serverTimestamp() }));
  await assertFails(updateDoc(doc(as('maya'), 'posts/hid'), { status: 'open', updatedAt: serverTimestamp() })); // cannot un-hide
  await assertFails(updateDoc(doc(as('aarav'), 'posts/p1'), { title: 'Not your post', updatedAt: serverTimestamp() }));
  await assertFails(getDoc(doc(as('aarav'), 'posts/hid')));                    // hidden: author/admin only
  await assertSucceeds(getDoc(doc(as('maya'), 'posts/hid')));
  await assertSucceeds(getDoc(doc(as('alex', { role: 'admin' }), 'posts/hid')));
  await assertFails(deleteDoc(doc(as('aarav'), 'posts/p1')));
  await assertSucceeds(deleteDoc(doc(as('maya'), 'posts/p1')));
});
test('suspended users cannot post or message', async () => {
  await env.withSecurityRulesDisabled(async ctx => { await setDoc(doc(ctx.firestore(), 'users/maya'), { ...user(), status: 'suspended', createdAt: new Date() }); });
  await assertFails(setDoc(doc(as('maya'), 'posts/sus'), post('maya')));
  await assertFails(addDoc(collection(as('maya'), 'chats/c1/messages'), { senderId: 'maya', text: 'hi', createdAt: serverTimestamp() }));
});
test('chat: only members read/write; sender must be self; no edits or deletes', async () => {
  const msg = (s) => ({ senderId: s, text: 'hello', createdAt: serverTimestamp() });
  await assertSucceeds(addDoc(collection(as('aarav'), 'chats/c1/messages'), msg('aarav')));
  await assertFails(addDoc(collection(as('aarav'), 'chats/c1/messages'), msg('maya')));
  await assertFails(addDoc(collection(as('nia'), 'chats/c1/messages'), msg('nia')));
  await assertFails(getDocs(collection(as('nia'), 'chats/c1/messages')));
  await assertSucceeds(getDocs(collection(as('maya'), 'chats/c1/messages')));
  await assertSucceeds(updateDoc(doc(as('maya'), 'chats/c1'), { lastMessage: 'hello', lastMessageAt: serverTimestamp() }));
  await assertFails(updateDoc(doc(as('maya'), 'chats/c1'), { members: ['maya', 'nia'] }));
  await assertFails(setDoc(doc(as('maya'), 'chats/new'), { members: ['maya', 'nia'] }));
});
test('function-only collections cannot be written by clients; reports are admin-readable only', async () => {
  for (const p of ['requests/r1', 'connections/x_y', 'karmaEvents/k1', 'reports/rep1', 'tagStats/t', 'config/app', 'notifications/n1']) await assertFails(setDoc(doc(as('maya'), p), { uid: 'maya', a: 1 }));
  await env.withSecurityRulesDisabled(async ctx => { await setDoc(doc(ctx.firestore(), 'reports/rep1'), { reporterId: 'nia', status: 'open' }); await setDoc(doc(ctx.firestore(), 'tagStats/python'), { needCount: 1 }); });
  await assertFails(getDoc(doc(as('maya'), 'reports/rep1')));
  await assertFails(getDoc(doc(as('fac', { role: 'faculty' }), 'reports/rep1')));
  await assertSucceeds(getDoc(doc(as('alex', { role: 'admin' }), 'reports/rep1')));
  await assertFails(getDoc(doc(as('maya'), 'tagStats/python')));
  await assertSucceeds(getDoc(doc(as('fac', { role: 'faculty' }), 'tagStats/python')));
});
test('notifications and requests: owner-scoped; may only mark own notification read', async () => {
  await env.withSecurityRulesDisabled(async ctx => {
    await setDoc(doc(ctx.firestore(), 'notifications/n1'), { uid: 'maya', read: false, message: 'x', type: 'request_received' });
    await setDoc(doc(ctx.firestore(), 'requests/r1'), { fromUid: 'aarav', toUid: 'maya', status: 'pending' });
  });
  await assertSucceeds(updateDoc(doc(as('maya'), 'notifications/n1'), { read: true }));
  await assertFails(updateDoc(doc(as('maya'), 'notifications/n1'), { read: true, message: 'edited' }));
  await assertFails(getDoc(doc(as('aarav'), 'notifications/n1')));
  await assertSucceeds(getDoc(doc(as('aarav'), 'requests/r1')));
  await assertFails(getDoc(doc(as('nia'), 'requests/r1')));
  await assertSucceeds(getDocs(query(collection(as('maya'), 'requests'), where('toUid', '==', 'maya'))));
});
