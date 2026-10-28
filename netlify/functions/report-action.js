// F06 · POST { reportId, action: 'hide_post'|'suspend_user'|'dismiss', note } → admin only (custom claim role = admin).
const { db, FieldValue } = require('./lib/firebaseAdmin');
const { handle, HttpError } = require('./lib/auth');

exports.handler = handle(async ({ uid, body }) => {
  const { reportId, action } = body;
  const note = String(body.note || '').trim().slice(0, 500);
  if (typeof reportId !== 'string' || !reportId) throw new HttpError(400, 'reportId is required.');
  if (!['hide_post', 'suspend_user', 'dismiss'].includes(action)) throw new HttpError(400, 'Unknown action.');
  if (action !== 'dismiss' && !note) throw new HttpError(400, 'A moderator note is required for this action.');

  return db.runTransaction(async (tx) => {
    const reportRef = db.collection('reports').doc(reportId);
    const rs = await tx.get(reportRef);
    if (!rs.exists) throw new HttpError(404, 'Report not found.');
    const rep = rs.data();
    if (rep.status !== 'open') throw new HttpError(409, 'This report was already handled.');

    let postRef = null, userRef = null, post = null, target = null;
    if (rep.targetType === 'post') { postRef = db.collection('posts').doc(rep.targetId); post = await tx.get(postRef); }
    if (action === 'hide_post' && rep.targetType !== 'post') throw new HttpError(400, 'Only posts can be hidden.');
    if (action === 'suspend_user') {
      const userId = rep.targetType === 'user' ? rep.targetId : (post && post.exists ? post.data().authorId : null);
      if (!userId) throw new HttpError(404, 'The reported content no longer exists.');
      if (userId === uid) throw new HttpError(400, 'You cannot suspend yourself.');
      userRef = db.collection('users').doc(userId);
      target = await tx.get(userRef);
      if (!target.exists) throw new HttpError(404, 'User not found.');
      if (target.data().role !== 'student') throw new HttpError(403, 'Staff accounts cannot be suspended here.');
    }

    if (action === 'hide_post') {
      if (post.exists) tx.update(postRef, { status: 'hidden' });
    } else if (action === 'suspend_user') {
      tx.update(userRef, { status: 'suspended' });
    }
    tx.update(reportRef, {
      status: action === 'dismiss' ? 'dismissed' : 'actioned', action,
      moderatorNote: note, reviewedBy: uid, reviewedAt: FieldValue.serverTimestamp()
    });
    return { status: action === 'dismiss' ? 'dismissed' : 'actioned' };
  });
}, { role: 'admin' });
