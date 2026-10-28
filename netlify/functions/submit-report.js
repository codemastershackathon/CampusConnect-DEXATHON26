// F05 · POST { targetType: 'post'|'user', targetId, reason, details? } → creates a report; auto-hides a post at N reports.
const { db, FieldValue } = require('./lib/firebaseAdmin');
const { handle, HttpError, requireActive } = require('./lib/auth');
const { getConfig } = require('./lib/config');

const REASONS = ['spam', 'harassment', 'inappropriate', 'other'];

exports.handler = handle(async ({ uid, body }) => {
  const { targetType, targetId } = body;
  const reason = String(body.reason || '').toLowerCase();
  const details = String(body.details || '').slice(0, 300);
  if (!['post', 'user'].includes(targetType)) throw new HttpError(400, 'targetType must be post or user.');
  if (typeof targetId !== 'string' || !targetId) throw new HttpError(400, 'targetId is required.');
  if (!REASONS.includes(reason)) throw new HttpError(400, 'Choose a valid reason.');
  await requireActive(db, uid);
  const cfg = await getConfig(db);

  // One report per reporter per target: deterministic id makes the check atomic.
  const reportRef = db.collection('reports').doc(`${uid}_${targetType}_${targetId}`);

  return db.runTransaction(async (tx) => {
    const dup = await tx.get(reportRef);
    if (dup.exists) throw new HttpError(409, 'You already reported this.');
    let postRef = null, postData = null;
    if (targetType === 'post') {
      postRef = db.collection('posts').doc(targetId);
      const p = await tx.get(postRef);
      if (!p.exists) throw new HttpError(404, 'Post not found.');
      postData = p.data();
      if (postData.authorId === uid) throw new HttpError(400, 'You cannot report your own post.');
    } else {
      if (targetId === uid) throw new HttpError(400, 'You cannot report yourself.');
      const u = await tx.get(db.collection('users').doc(targetId));
      if (!u.exists) throw new HttpError(404, 'User not found.');
    }
    tx.set(reportRef, { reporterId: uid, targetType, targetId, reason, details, status: 'open', createdAt: FieldValue.serverTimestamp() });
    let autoHidden = false;
    if (postRef) {
      const count = (postData.reportCount || 0) + 1;
      const patch = { reportCount: count };
      if (count >= cfg.reportAutoHideAt && postData.status === 'open') { patch.status = 'hidden'; autoHidden = true; }
      tx.update(postRef, patch);
    }
    return { autoHidden };
  });
});
