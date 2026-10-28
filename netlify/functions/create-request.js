// F02 · POST { postId, toUid? } → creates a pending connection request and notifies the post author.
const { db, FieldValue, Timestamp } = require('./lib/firebaseAdmin');
const { handle, HttpError, requireActive } = require('./lib/auth');

const DAILY_LIMIT = 10;

exports.handler = handle(async ({ uid, body }) => {
  const { postId, toUid } = body;
  if (typeof postId !== 'string' || !postId) throw new HttpError(400, 'postId is required.');
  const me = await requireActive(db, uid);

  const postSnap = await db.collection('posts').doc(postId).get();
  if (!postSnap.exists) throw new HttpError(404, 'That post no longer exists.');
  const post = postSnap.data();
  if (post.status !== 'open') throw new HttpError(409, 'This post is no longer open.');
  if (post.authorId === uid) throw new HttpError(400, 'You cannot connect to your own post.');
  if (toUid && toUid !== post.authorId) throw new HttpError(400, 'toUid does not match the post author.');

  const authorSnap = await db.collection('users').doc(post.authorId).get();
  if (!authorSnap.exists || authorSnap.data().status !== 'active') throw new HttpError(409, 'This student is not available right now.');

  // No duplicate pending/accepted request for this pair + post (either direction).
  const same = await db.collection('requests').where('postId', '==', postId).get();
  const dup = same.docs.some(d => {
    const r = d.data();
    return ['pending', 'accepted'].includes(r.status) &&
      ((r.fromUid === uid && r.toUid === post.authorId) || (r.fromUid === post.authorId && r.toUid === uid));
  });
  if (dup) throw new HttpError(409, 'You already have a request for this post.');

  // Anti-spam: at most 10 requests per rolling 24 hours.
  const since = Timestamp.fromMillis(Date.now() - 24 * 3600 * 1000);
  const recent = await db.collection('requests').where('fromUid', '==', uid).where('createdAt', '>=', since).get();
  if (recent.size >= DAILY_LIMIT) throw new HttpError(429, 'Daily limit of 10 requests reached. Try again tomorrow.');

  // need post: the author is asking, the sender offers to help. offer post: the author helps, the sender receives.
  const isNeed = post.type === 'need';
  const ref = db.collection('requests').doc();
  const batch = db.batch();
  batch.set(ref, {
    postId, fromUid: uid, toUid: post.authorId,
    helperUid: isNeed ? uid : post.authorId,
    receiverUid: isNeed ? post.authorId : uid,
    status: 'pending', helpedConfirmed: false,
    topic: post.title, createdAt: FieldValue.serverTimestamp()
  });
  batch.set(db.collection('notifications').doc(), {
    uid: post.authorId, type: 'request_received', refId: ref.id, read: false,
    message: isNeed ? `${me.displayName} wants to help with “${post.title}”.` : `${me.displayName} would like your help: “${post.title}”.`,
    createdAt: FieldValue.serverTimestamp()
  });
  await batch.commit();
  return { id: ref.id, status: 'pending' };
});
