// Tiny .env loader (no dependency) – used by the admin scripts.
const fs = require('fs'), path = require('path');
const file = path.join(__dirname, '..', '.env');
if (fs.existsSync(file)) {
  fs.readFileSync(file, 'utf8').split(/\r?\n/).forEach(line => {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!m || line.trim().startsWith('#')) return;
    let v = m[2]; if (/^".*"$/.test(v) || /^'.*'$/.test(v)) v = v.slice(1, -1);
    if (!(m[1] in process.env)) process.env[m[1]] = v;
  });
}
module.exports = { root: path.join(__dirname, '..') };
