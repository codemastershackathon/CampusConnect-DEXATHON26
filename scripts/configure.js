// Writes your Firebase web config + college domain into every public/*.html page AND firestore.rules.
//   1) copy .env.example → .env and fill it in   2) node scripts/configure.js
const fs = require('fs'), path = require('path');
const { root } = require('./_env');
const e = process.env;
const need = ['FIREBASE_API_KEY', 'FIREBASE_AUTH_DOMAIN', 'FIREBASE_PROJECT_ID', 'FIREBASE_APP_ID', 'ALLOWED_EMAIL_DOMAINS', 'FUNCTIONS_BASE_URL'];
const missing = need.filter(k => !e[k] || /your-|^$/.test(e[k]));
if (missing.length) { console.error('✖ Fill these in .env first:', missing.join(', ')); process.exit(1); }
const domains = e.ALLOWED_EMAIL_DOMAINS.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
const block = `/* @cc-config:start */
const FIREBASE_CONFIG = ${JSON.stringify({ apiKey: e.FIREBASE_API_KEY, authDomain: e.FIREBASE_AUTH_DOMAIN, projectId: e.FIREBASE_PROJECT_ID, storageBucket: e.FIREBASE_STORAGE_BUCKET || '', messagingSenderId: e.FIREBASE_MESSAGING_SENDER_ID || '', appId: e.FIREBASE_APP_ID })};
const ALLOWED_EMAIL_DOMAINS = ${JSON.stringify(domains)};
const FUNCTIONS_BASE_URL = ${JSON.stringify(e.FUNCTIONS_BASE_URL.replace(/\/$/, ''))};
const USE_EMULATORS = false;
/* @cc-config:end */`;
const dir = path.join(root, 'public'); let n = 0;
for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.html'))) {
  const p = path.join(dir, f), s = fs.readFileSync(p, 'utf8');
  if (!s.includes('@cc-config:start')) continue;
  fs.writeFileSync(p, s.replace(/\/\* @cc-config:start \*\/[\s\S]*?\/\* @cc-config:end \*\//, () => block)); n++;
}
const rp = path.join(root, 'firestore.rules'), rules = fs.readFileSync(rp, 'utf8');
const rx = domains.map(d => d.replace(/\./g, '\\\\.')).join('|');
fs.writeFileSync(rp, rules.replace(/(function collegeEmail\(\) \{ return request\.auth\.token\.email\.matches\(')[^']*('\); \})/, (m, a, b) => `${a}.*@(${rx})${b}`));
console.log(`✔ configured ${n} pages and firestore.rules for: ${domains.join(', ')}`);
