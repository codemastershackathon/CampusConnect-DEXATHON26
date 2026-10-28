// F08 · Give an existing user a role.   node scripts/set-role.js someone@college.edu admin|faculty|student
require('./_env');
const { auth, db } = require('../netlify/functions/lib/firebaseAdmin');
(async () => {
  const [email, role] = process.argv.slice(2);
  if (!email || !['admin', 'faculty', 'student'].includes(role)) { console.error('Usage: node scripts/set-role.js <email> <admin|faculty|student>'); process.exit(1); }
  const user = await auth.getUserByEmail(email);                    // they must have signed in once
  await auth.setCustomUserClaims(user.uid, { role });               // token claim used by rules + functions
  const ref = db.collection('users').doc(user.uid);
  if ((await ref.get()).exists) await ref.update({ role });         // keep the profile in sync for display
  console.log(`✔ ${email} is now "${role}". They must sign out and back in (or refresh the ID token) to pick it up.`);
})().catch(e => { console.error('✖', e.message); process.exit(1); });
