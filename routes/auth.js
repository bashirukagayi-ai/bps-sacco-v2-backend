const router = require('express').Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../db');

// Find member by name (step 1)
router.post('/find', async (req, res) => {
  const { full_name } = req.body;
  if (!full_name) return res.status(400).json({ error: 'Name required' });
  try {
    const { rows } = await db.query(
      'SELECT id, full_name, role, pin_set, status FROM members WHERE LOWER(full_name) = LOWER($1)',
      [full_name.trim()]
    );
    if (!rows.length) return res.status(404).json({ error: 'Member not found' });
    const member = rows[0];
    if (member.status === 'suspended') return res.status(403).json({ error: 'Account suspended' });
    res.json({ id: member.id, full_name: member.full_name, role: member.role, pin_set: member.pin_set });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Login with PIN (step 2)
router.post('/login', async (req, res) => {
  const { member_id, pin } = req.body;
  if (!member_id || !pin) return res.status(400).json({ error: 'Member ID and PIN required' });
  try {
    const { rows } = await db.query('SELECT * FROM members WHERE id = $1', [member_id]);
    if (!rows.length) return res.status(404).json({ error: 'Member not found' });
    const member = rows[0];
    if (member.status === 'suspended') return res.status(403).json({ error: 'Account suspended' });
    if (member.pin_locked_until && new Date() < new Date(member.pin_locked_until))
      return res.status(403).json({ error: 'PIN locked. Try later.' });
    const valid = await bcrypt.compare(String(pin), member.pin_hash);
    if (!valid) {
      const attempts = (member.pin_attempts || 0) + 1;
      const lockUntil = attempts >= 5 ? new Date(Date.now() + 15 * 60000) : null;
      await db.query('UPDATE members SET pin_attempts=$1, pin_locked_until=$2 WHERE id=$3', [attempts, lockUntil, member.id]);
      return res.status(401).json({ error: `Invalid PIN. ${5 - attempts} attempt(s) remaining.` });
    }
    await db.query('UPDATE members SET pin_attempts=0, pin_locked_until=NULL WHERE id=$1', [member.id]);
    const token = jwt.sign({ id: member.id, role: member.role }, process.env.JWT_SECRET || 'bps_secret', { expiresIn: '30d' });
    res.json({
      token,
      member: { id: member.id, full_name: member.full_name, phone: member.phone, role: member.role, balance: member.balance, score: member.score, savings_streak: member.savings_streak }
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
