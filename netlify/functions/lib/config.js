// Shared rules read from the config/app document (edited in the Firebase console).
const DEFAULTS = {
  karmaRules: { requestAccepted: 3, helpedConfirmed: 10 },
  badgeThresholds: { helper: 10, risingMentor: 25, topMentor: 40 },
  reportAutoHideAt: 3,
  maxTagsPerPost: 8
};
let cache = null, cachedAt = 0;

async function getConfig(db) {
  if (cache && Date.now() - cachedAt < 60000) return cache;
  const snap = await db.collection('config').doc('app').get();
  const d = snap.exists ? snap.data() : {};
  cache = {
    karmaRules: { ...DEFAULTS.karmaRules, ...(d.karmaRules || {}) },
    badgeThresholds: { ...DEFAULTS.badgeThresholds, ...(d.badgeThresholds || {}) },
    reportAutoHideAt: Number(d.reportAutoHideAt) || DEFAULTS.reportAutoHideAt,
    maxTagsPerPost: Number(d.maxTagsPerPost) || DEFAULTS.maxTagsPerPost
  };
  cachedAt = Date.now();
  return cache;
}
function resetConfigCache() { cache = null; cachedAt = 0; }

function badgeFor(karma, t) {
  if (karma >= t.topMentor) return 'Top Mentor';
  if (karma >= t.risingMentor) return 'Rising Mentor';
  if (karma >= t.helper) return 'Helper';
  return 'Newcomer';
}
// Same id for (a,b) and (b,a): the two uids sorted alphabetically and joined with an underscore.
const pairId = (a, b) => (a < b ? a + '_' + b : b + '_' + a);

module.exports = { DEFAULTS, getConfig, resetConfigCache, badgeFor, pairId };
