// F04 · POST { requestId } → the receiver says "this helped". Awards the helper karma, recomputes the badge.
const { db, FieldValue, Timestamp } = require('./lib/firebaseAdmin');
const { handle, HttpError, requireActive } = require('./lib/auth');
const { getConfig, badgeFor, pairId } = require('./lib/config');

exports.handler = handle(async ({ uid, body }) => {
  const { requestId } = body;
  if (typeof requestId !== 'string' || !requestId) throw new HttpError(400, 'requestId is required.');
  await requireActive(db, uid);
  const cfg = await getConfig(db);

  return db.runTransaction(async (tx) => {
    const reqRef = db.collection('requests').doc(requestId);
    const reqSnap = await tx.get(reqRef);
    if (!reqSnap.exists) throw new HttpError(404, 'Request not found.');
    const r = reqSnap.data();
    if (r.receiverUid !== uid) throw new HttpError(403, 'Only the student who received help can confirm it.');
    if (r.status !== 'accepted') throw new HttpError(409, 'This connection is not active.');
    if (r.helpedConfirmed === true) throw new HttpError(409, 'You already said thanks for this connection.');

    const connRef = db.collection('connections').doc(pairId(r.fromUid, r.toUid));
    const helperRef = db.collection('users').doc(r.helperUid);
    const [connSnap, helperSnap] = await Promise.all([tx.get(connRef), tx.get(helperRef)]);
    if (!helperSnap.exists) throw new HttpError(404, 'Helper not found.');

    // One confirmation per pair per 24 hours.
    const last = connSnap.exists ? connSnap.data().lastHelpedAt : null;
    if (last && Date.now() - last.toMillis() < 24 * 3600 * 1000) throw new HttpError(429, 'You can confirm help from the same person once a day.');

    const pts = cfg.karmaRules.helpedConfirmed, h = helperSnap.data();
    const newKarma = (h.karma || 0) + pts;
    const newBadge = badgeFor(newKarma, cfg.badgeThresholds);

    tx.update(reqRef, { helpedConfirmed: true, helpedConfirmedAt: FieldValue.serverTimestamp() });
    if (connSnap.exists) tx.update(connRef, { lastHelpedAt: Timestamp.now() });
    tx.update(helperRef, { karma: newKarma, badge: newBadge, helpedCount: (h.helpedCount || 0) + 1 });
    tx.set(db.collection('karmaEvents').doc(), { uid: r.helperUid, points: pts, reason: 'helped_confirmed', requestId, createdAt: FieldValue.serverTimestamp() });
    tx.set(db.collection('notifications').doc(), {
      uid: r.helperUid, type: 'help_confirmed', refId: requestId, read: false,
      message: `Someone marked you as helped for “${r.topic}”. +${pts} karma.`, createdAt: FieldValue.serverTimestamp()
    });
    if (newBadge !== (h.badge || 'Newcomer')) {
      tx.set(db.collection('notifications').doc(), { uid: r.helperUid, type: 'badge_earned', refId: newBadge, read: false, message: `You earned the ${newBadge} badge. Keep being you.`, createdAt: FieldValue.serverTimestamp() });
    }
    return { helperUid: r.helperUid, points: pts, badge: newBadge };
  });
});
