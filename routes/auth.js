const router = require('express').Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../db');

router.post('/login', async (req, res) => {
  const { phone, pin } = req.body;
  if (!phone || !pin) return res.status(400).json({ error: 'Phone and PIN required' });
  try {
    const { rows } = await db.query('SELECT * FROM members WHERE phone = $1', [phone]);
    if (!rows.length) return res.status(401).json({ error: 'Invalid credentials' });
    const member = rows[0];
    if (member.status === 'suspended') return res.status(403).json({ error: 'Account suspended' });
    if (member.pin_locked_until && new Date() < new Date(member.pin_locked_until))
      return res.status(403).json({ error: 'PIN locked. Try later.' });
    const valid = await bcrypt.compare(String(pin), member.pin_hash);
    if (!valid) {
      const attempts = (member.pin_attempts || 0) + 1;
      const lockUntil = attempts >= 5 ? new Date(Date.now() + 15 * 60000) : null;
      await db.query('UPDATE members SET pin_attempts=$1, pin_locked_until=$2 WHERE id=$3', [attempts, lockUntil, member.id]);
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    await db.query('UPDATE members SET pin_attempts=0, pin_locked_until=NULL WHERE id=$1', [member.id]);
    const token = jwt.sign({ id: member.id, role: member.role }, process.env.JWT_SECRET || 'bps_secret', { expiresIn: '30d' });
    res.json({ token, member: { id: member.id, full_name: member.full_name, phone: member.phone, role: member.role, balance: member.balance } });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
