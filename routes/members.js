const router = require('express').Router();
const db = require('../db');
const { requireAuth, requireAdmin } = require('../middleware/auth');

// Get all members (admin)
router.get('/', requireAdmin, async (req, res) => {
  try {
    const { rows } = await db.query(
      'SELECT id, full_name, phone, role, balance, score, savings_streak, status, pin_set, created_at FROM members ORDER BY balance DESC'
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get single member
router.get('/:id', requireAuth, async (req, res) => {
  if (req.user.role !== 'admin' && req.user.id !== req.params.id) {
    return res.status(403).json({ error: 'Access denied' });
  }
  try {
    const { rows } = await db.query(
      'SELECT id, full_name, phone, role, balance, score, savings_streak, status, pin_set, created_at FROM members WHERE id = $1',
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Member not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Add new member (admin)
router.post('/', requireAdmin, async (req, res) => {
  const { full_name, phone, role = 'member' } = req.body;
  if (!full_name) return res.status(400).json({ error: 'Name required' });
  try {
    const { rows } = await db.query(
      'INSERT INTO members (full_name, phone, role) VALUES ($1, $2, $3) RETURNING id, full_name, phone, role, balance, pin_set, created_at',
      [full_name.trim(), phone || null, role]
    );
    await db.query(
      'INSERT INTO activity_logs (member_id, action, details) VALUES ($1, $2, $3)',
      [req.user.id, 'member_added', `Added member: ${full_name}`]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(400).json({ error: 'Phone number already exists' });
    res.status(500).json({ error: err.message });
  }
});

// Update member (admin)
router.patch('/:id', requireAdmin, async (req, res) => {
  const { full_name, phone, status } = req.body;
  try {
    const { rows } = await db.query(
      `UPDATE members SET
        full_name = COALESCE($1, full_name),
        phone = COALESCE($2, phone),
        status = COALESCE($3, status)
       WHERE id = $4
       RETURNING id, full_name, phone, role, balance, status`,
      [full_name, phone, status, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Member not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update own profile
router.patch('/me/profile', requireAuth, async (req, res) => {
  const { phone } = req.body;
  try {
    const { rows } = await db.query(
      'UPDATE members SET phone = COALESCE($1, phone) WHERE id = $2 RETURNING id, full_name, phone',
      [phone, req.user.id]
    );
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update push token
router.post('/push-token', requireAuth, async (req, res) => {
  const { token } = req.body;
  try {
    await db.query('UPDATE members SET expo_push_token = $1 WHERE id = $2', [token, req.user.id]);
    res.json({ message: 'Token updated' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Leaderboard
router.get('/insights/leaderboard', requireAuth, async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT id, full_name, balance, score, savings_streak,
        RANK() OVER (ORDER BY balance DESC) AS rank
       FROM members WHERE role = 'member' AND status = 'active'
       ORDER BY balance DESC`
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
