// F09 · Demo data.  node scripts/seed.js [--for you@college.edu] [--clean]
//   (no flags)   creates 8 demo students + posts (all marked isDemo:true)
//   --for EMAIL  also gives that real account a "Data Structures study help" request and two incoming connection requests
//   --clean      deletes everything marked isDemo
require('./_env');
const { auth, db, Timestamp } = require('../netlify/functions/lib/firebaseAdmin');
const { getConfig, badgeFor } = require('../netlify/functions/lib/config');

const domain = (process.env.ALLOWED_EMAIL_DOMAINS || '').split(',')[0].trim();
const ago = (min) => Timestamp.fromMillis(Date.now() - min * 60000);
const D = (id, name, year, dept, skills, lend, karma, helped) => ({ id: 'demo_' + id, name, year, dept, skills, lend, karma, helped });
const STUDENTS = [
  D('aarav', 'Aarav Shah', 3, 'Computer Science', ['data structures', 'c++', 'python', 'git', 'web development'], ['data structures textbook', 'scientific calculator'], 250, 25),
  D('nia', 'Nia Roy', 2, 'Information Technology', ['web development', 'python'], [], 320, 32),
  D('isha', 'Isha Rao', 1, 'Computer Science', ['c++', 'pointers'], [], 190, 19),
  D('rohan', 'Rohan Mehta', 1, 'Mechanical Engineering', ['engineering drawing'], ['drawing kit'], 120, 12),
  D('leah', 'Leah Thomas', 1, 'Computer Science', ['python'], [], 80, 8),
  D('sam', 'Sam Wilson', 1, 'Electronics', ['coding club'], [], 60, 6),
  D('dev', 'Dev Kumar', 2, 'Information Technology', ['data structures'], [], 30, 3),
  D('maya', 'Maya Patel', 1, 'Computer Science', ['python', 'presentation design'], ['scientific calculator'], 20, 2)
];
const P = (id, by, type, category, title, description, tags, mins) => ({ id: 'demo_' + id, authorId: 'demo_' + by, type, category, title, description, tags, status: 'open', reportCount: 0, createdAt: ago(mins), updatedAt: ago(mins), isDemo: true });
const POSTS = [
  P('p_loops', 'leah', 'need', 'academic', 'Python loops are looping me in.', "Could someone explain nested loops before tomorrow's lab? Just 20 minutes would help.", ['python', 'beginner friendly'], 120),
  P('p_swap', 'nia', 'need', 'teammates', 'Build a campus swap app with us', 'Looking for a Python teammate for a weekend prototype. Beginners very welcome.', ['python', 'web development'], 130),
  P('p_kit', 'rohan', 'need', 'lend', "Drawing kit for Friday's lab?", "Need a drafter and set squares for one session. I'll return everything after class.", ['drawing kit', 'engineering drawing'], 140),
  P('p_club', 'sam', 'need', 'events', 'A friendly face at coding club?', 'First meetup on Wednesday. Anyone want to walk in together from the library?', ['coding club', 'meetup'], 150),
  P('p_ptr', 'isha', 'need', 'academic', 'C++ pointers, from the basics', 'Could use a quick explanation before our next programming lab.', ['c++', 'pointers'], 160),
  P('p_buddy', 'dev', 'need', 'academic', 'A study buddy for DS practice', "One problem a day, after classes. Let's keep each other going.", ['data structures'], 180),
  P('p_o1', 'aarav', 'offer', 'academic', 'Linked lists, made less scary.', "Happy to work through one example together. I'm usually at the library after 4. Bring your questions, not your confidence.", ['data structures', 'c++'], 100),
  P('p_o2', 'aarav', 'offer', 'lend', 'DS textbook for the semester', 'My second-year textbook is gathering dust. Happy to lend it to someone who needs it.', ['textbook', 'data structures'], 110),
  P('p_o3', 'nia', 'offer', 'academic', 'Web dev office hours', 'Saturday mornings: HTML, CSS and JavaScript questions welcome.', ['web development'], 200)
];

async function clean() {
  let n = 0;
  for (const col of ['posts', 'requests', 'users']) {
    const snap = await db.collection(col).where('isDemo', '==', true).get();
    for (const d of snap.docs) { if (col === 'users') { await d.ref.collection('private').doc('contact').delete(); try { await auth.deleteUser(d.id); } catch (e) {} } await d.ref.delete(); n++; }
  }
  console.log(`✔ removed ${n} demo documents`);
}

async function ensureAuthUser(uid, email, name) {
  try { await auth.getUser(uid); } catch (e) { await auth.createUser({ uid, email, displayName: name, emailVerified: true }); }
}

(async () => {
  if (!domain) throw new Error('Set ALLOWED_EMAIL_DOMAINS in .env first.');
  if (process.argv.includes('--clean')) return clean();
  const cfg = await getConfig(db);
  for (const s of STUDENTS) {
    const email = `${s.id}@${domain}`;
    await ensureAuthUser(s.id, email, s.name);
    await db.collection('users').doc(s.id).set({ displayName: s.name, photoURL: '', year: s.year, department: s.dept, skills: s.skills, lendItems: s.lend, onboarded: true,
      karma: s.karma, badge: badgeFor(s.karma, cfg.badgeThresholds), helpedCount: s.helped, role: 'student', status: 'active', createdAt: ago(60 * 24 * 30), isDemo: true });
    await db.collection('users').doc(s.id).collection('private').doc('contact').set({ email, phone: '', shareEmail: true, sharePhone: false, updatedAt: Timestamp.now() });
  }
  for (const p of POSTS) { const { id, ...data } = p; await db.collection('posts').doc(id).set(data); }
  console.log(`✔ ${STUDENTS.length} demo students and ${POSTS.length} posts created`);

  const forIdx = process.argv.indexOf('--for');
  if (forIdx > -1) {
    const email = process.argv[forIdx + 1];
    const u = await auth.getUserByEmail(email);        // the account must have signed in once
    const postRef = db.collection('posts').doc('demo_p_story_' + u.uid);
    await postRef.set({ authorId: u.uid, type: 'need', category: 'academic', title: 'Data Structures study help',
      description: "I'm a first-year CS student trying to understand linked lists in C++. Could someone walk through insertion and deletion with me?",
      tags: ['data structures', 'c++'], status: 'open', reportCount: 0, createdAt: ago(30), updatedAt: ago(30), isDemo: true });
    for (const by of ['aarav', 'nia']) {
      await db.collection('requests').doc(`demo_story_${by}_${u.uid}`).set({ postId: postRef.id, fromUid: 'demo_' + by, toUid: u.uid, helperUid: 'demo_' + by, receiverUid: u.uid,
        status: 'pending', helpedConfirmed: false, topic: 'Data Structures study help', createdAt: ago(by === 'aarav' ? 10 : 60), isDemo: true });
      await db.collection('notifications').add({ uid: u.uid, type: 'request_received', refId: `demo_story_${by}_${u.uid}`, read: false,
        message: `${by === 'aarav' ? 'Aarav Shah' : 'Nia Roy'} wants to help with “Data Structures study help”.`, createdAt: ago(by === 'aarav' ? 10 : 60), isDemo: true });
    }
    console.log(`✔ demo story created for ${email}: 1 open request + 2 incoming connection requests`);
  }
})().catch(e => { console.error('✖', e.message); process.exit(1); });
