const router = require('express').Router();
const db = require('../db');
const { auth, adminOnly } = require('../middleware/auth');
const { Expo } = require('expo-server-sdk');

const expo = new Expo();

async function sendPush(token, title, body) {
  if (!token || !Expo.isExpoPushToken(token)) return;
  try {
    await expo.sendPushNotificationsAsync([{ to: token, title, body, sound: 'default' }]);
  } catch (e) { console.error('Push error:', e.message); }
}

// Send reminders to all members with unpaid fines
router.post('/remind-fines', auth, adminOnly, async (req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT m.full_name, m.expo_push_token, SUM(f.amount) as total
      FROM fines f JOIN members m ON f.member_id = m.id
      WHERE f.status = 'unpaid'
      GROUP BY m.id, m.full_name, m.expo_push_token
    `);
    let sent = 0;
    for (const m of rows) {
      await sendPush(m.expo_push_token, 'Payment Reminder', 
        `Hi ${m.full_name}, you have UGX ${Number(m.total).toLocaleString()} in unpaid fines.`);
      sent++;
    }
    res.json({ message: `Reminders sent to ${sent} member(s)` });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Send general announcement to all members
router.post('/announce', auth, adminOnly, async (req, res) => {
  const { title, body } = req.body;
  if (!title || !body) return res.status(400).json({ error: 'Title and body required' });
  try {
    const { rows } = await db.query("SELECT expo_push_token FROM members WHERE role = 'member' AND status = 'active'");
    let sent = 0;
    for (const m of rows) {
      await sendPush(m.expo_push_token, title, body);
      sent++;
    }
    res.json({ message: `Announcement sent to ${sent} member(s)` });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
