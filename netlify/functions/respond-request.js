// F03 · POST { requestId, action: 'accept'|'decline'|'cancel' }
// accept → request accepted + connections/{pairId} + chats/{requestId} + first-time karma + notification.
const { db, FieldValue } = require('./lib/firebaseAdmin');
const { handle, HttpError, requireActive } = require('./lib/auth');
const { getConfig, badgeFor, pairId } = require('./lib/config');

exports.handler = handle(async ({ uid, body }) => {
  const { requestId, action } = body;
  if (typeof requestId !== 'string' || !requestId) throw new HttpError(400, 'requestId is required.');
  if (!['accept', 'decline', 'cancel'].includes(action)) throw new HttpError(400, 'action must be accept, decline or cancel.');
  await requireActive(db, uid);
  const cfg = await getConfig(db);

  return db.runTransaction(async (tx) => {
    const reqRef = db.collection('requests').doc(requestId);
    const reqSnap = await tx.get(reqRef);
    if (!reqSnap.exists) throw new HttpError(404, 'Request not found.');
    const r = reqSnap.data();
    if (r.status !== 'pending') throw new HttpError(409, `This request is already ${r.status}.`);

    if (action === 'cancel') {
      if (r.fromUid !== uid) throw new HttpError(403, 'Only the sender can cancel.');
      tx.update(reqRef, { status: 'cancelled', respondedAt: FieldValue.serverTimestamp() });
      return { status: 'cancelled' };
    }
    if (r.toUid !== uid) throw new HttpError(403, 'Only the recipient can respond.');
    if (action === 'decline') {
      tx.update(reqRef, { status: 'declined', respondedAt: FieldValue.serverTimestamp() });
      return { status: 'declined' };
    }

    // accept: do all reads first, then all writes.
    const pid = pairId(r.fromUid, r.toUid);
    const connRef = db.collection('connections').doc(pid);
    const chatRef = db.collection('chats').doc(requestId);
    const meRef = db.collection('users').doc(uid);
    const [connSnap, meSnap] = await Promise.all([tx.get(connRef), tx.get(meRef)]);
    const firstTime = !connSnap.exists;

    tx.update(reqRef, { status: 'accepted', respondedAt: FieldValue.serverTimestamp() });
    if (firstTime) tx.set(connRef, { members: [r.fromUid, r.toUid], requestId, createdAt: FieldValue.serverTimestamp() });
    tx.set(chatRef, { members: [r.fromUid, r.toUid], lastMessage: '', lastMessageAt: FieldValue.serverTimestamp(), createdAt: FieldValue.serverTimestamp() });

    // Karma for accepting is awarded only the first time two students connect (blocks karma farming).
    if (firstTime && cfg.karmaRules.requestAccepted > 0) {
      const pts = cfg.karmaRules.requestAccepted;
      const oldKarma = meSnap.data().karma || 0, newKarma = oldKarma + pts;
      const newBadge = badgeFor(newKarma, cfg.badgeThresholds);
      tx.update(meRef, { karma: newKarma, badge: newBadge });
      tx.set(db.collection('karmaEvents').doc(), { uid, points: pts, reason: 'request_accepted', requestId, createdAt: FieldValue.serverTimestamp() });
      if (newBadge !== (meSnap.data().badge || 'Newcomer')) {
        tx.set(db.collection('notifications').doc(), { uid, type: 'badge_earned', refId: newBadge, read: false, message: `You earned the ${newBadge} badge. Keep being you.`, createdAt: FieldValue.serverTimestamp() });
      }
    }
    tx.set(db.collection('notifications').doc(), {
      uid: r.fromUid, type: 'request_accepted', refId: requestId, read: false,
      message: `${meSnap.data().displayName} accepted your connection. You can now chat.`, createdAt: FieldValue.serverTimestamp()
    });
    return { status: 'accepted', chatId: requestId };
  });
});
