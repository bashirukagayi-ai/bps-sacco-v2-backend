const router = require('express').Router();
const bcrypt = require('bcryptjs');
const db = require('../db');
const { signToken } = require('../utils/tokens');
const { requireAuth } = require('../middleware/auth');

// Login by name (step 1 - find member)
router.post('/find', async (req, res) => {
  const { full_name } = req.body;
  if (!full_name) return res.status(400).json({ error: 'Name required' });
  try {
    const { rows } = await db.query(
      'SELECT id, full_name, role, pin_set, status, pin_locked_until FROM members WHERE LOWER(full_name) = LOWER($1)',
      [full_name.trim()]
    );
    if (!rows.length) return res.status(404).json({ error: 'Member not found' });
    const member = rows[0];
    if (member.status === 'suspended') return res.status(403).json({ error: 'Account suspended' });
    res.json({ id: member.id, full_name: member.full_name, role: member.role, pin_set: member.pin_set });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Login with PIN (step 2)
router.post('/login', async (req, res) => {
  const { member_id, pin } = req.body;
  if (!member_id || !pin) return res.status(400).json({ error: 'Member ID and PIN required' });
  try {
    const { rows } = await db.query(
      'SELECT * FROM members WHERE id = $1',
      [member_id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Member not found' });
    const member = rows[0];

    if (member.status === 'suspended') return res.status(403).json({ error: 'Account suspended' });

    // Check PIN lockout
    if (member.pin_locked_until && new Date() < new Date(member.pin_locked_until)) {
      const mins = Math.ceil((new Date(member.pin_locked_until) - new Date()) / 60000);
      return res.status(429).json({ error: `Too many attempts. Try again in ${mins} minute(s)` });
    }

    if (!member.pin_set || !member.pin_hash) {
      return res.status(400).json({ error: 'PIN not set. Please set your PIN first.' });
    }

    const valid = await bcrypt.compare(pin, member.pin_hash);
    if (!valid) {
      const attempts = member.pin_attempts + 1;
      if (attempts >= 5) {
        const lockUntil = new Date(Date.now() + 15 * 60 * 1000);
        await db.query('UPDATE members SET pin_attempts = $1, pin_locked_until = $2 WHERE id = $3', [0, lockUntil, member.id]);
        return res.status(429).json({ error: 'Too many attempts. Account locked for 15 minutes.' });
      }
      await db.query('UPDATE members SET pin_attempts = $1 WHERE id = $2', [attempts, member.id]);
      return res.status(401).json({ error: `Invalid PIN. ${5 - attempts} attempt(s) remaining.` });
    }

    // Reset attempts on success
    await db.query('UPDATE members SET pin_attempts = 0, pin_locked_until = NULL WHERE id = $1', [member.id]);

    const token = signToken(member);
    res.json({
      token,
      member: {
        id: member.id,
        full_name: member.full_name,
        role: member.role,
        balance: member.balance,
        score: member.score,
        savings_streak: member.savings_streak,
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Set PIN (first time)
router.post('/set-pin', requireAuth, async (req, res) => {
  const { pin } = req.body;
  if (!pin || pin.length !== 4 || !/^\d+$/.test(pin)) {
    return res.status(400).json({ error: 'PIN must be exactly 4 digits' });
  }
  try {
    const hash = await bcrypt.hash(pin, 10);
    await db.query('UPDATE members SET pin_hash = $1, pin_set = TRUE WHERE id = $2', [hash, req.user.id]);
    res.json({ message: 'PIN set successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Change PIN
router.post('/change-pin', requireAuth, async (req, res) => {
  const { old_pin, new_pin } = req.body;
  if (!old_pin || !new_pin || new_pin.length !== 4 || !/^\d+$/.test(new_pin)) {
    return res.status(400).json({ error: 'Invalid PIN format' });
  }
  try {
    const { rows } = await db.query('SELECT pin_hash FROM members WHERE id = $1', [req.user.id]);
    const valid = await bcrypt.compare(old_pin, rows[0].pin_hash);
    if (!valid) return res.status(401).json({ error: 'Current PIN incorrect' });
    const hash = await bcrypt.hash(new_pin, 10);
    await db.query('UPDATE members SET pin_hash = $1 WHERE id = $2', [hash, req.user.id]);
    res.json({ message: 'PIN changed successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get current user profile
router.get('/me', requireAuth, async (req, res) => {
  try {
    const { rows } = await db.query(
      'SELECT id, full_name, phone, role, balance, score, savings_streak, status, pin_set, created_at FROM members WHERE id = $1',
      [req.user.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Member not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
