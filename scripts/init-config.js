// Creates/updates config/app (karma points, badge thresholds, limits). Safe to re-run. Edit values in the Firebase console later.
require('./_env');
const { db } = require('../netlify/functions/lib/firebaseAdmin');
(async () => {
  const domains = (process.env.ALLOWED_EMAIL_DOMAINS || '').split(',').map(s => s.trim()).filter(Boolean);
  await db.collection('config').doc('app').set({
    allowedEmailDomains: domains,
    karmaRules: { requestAccepted: 3, helpedConfirmed: 10 },
    badgeThresholds: { helper: 10, risingMentor: 25, topMentor: 40 },
    reportAutoHideAt: 3, maxTagsPerPost: 8
  }, { merge: true });
  console.log('✔ config/app written for domains:', domains.join(', ') || '(none set)');
})().catch(e => { console.error('✖', e.message); process.exit(1); });
