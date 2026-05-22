const router = require('express').Router();
const db = require('../db');
const { requireAuth, requireAdmin } = require('../middleware/auth');

// Get transactions for current member
router.get('/my', requireAuth, async (req, res) => {
  try {
    const { rows } = await db.query(
      'SELECT * FROM transactions WHERE member_id = $1 ORDER BY created_at DESC LIMIT 100',
      [req.user.id]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get all transactions (admin)
router.get('/', requireAdmin, async (req, res) => {
  const { member_id, type, limit = 200 } = req.query;
  try {
    let q = `SELECT t.*, m.full_name FROM transactions t
             JOIN members m ON t.member_id = m.id WHERE 1=1`;
    const params = [];
    if (member_id) { params.push(member_id); q += ` AND t.member_id = $${params.length}`; }
    if (type) { params.push(type); q += ` AND t.type = $${params.length}`; }
    params.push(limit);
    q += ` ORDER BY t.created_at DESC LIMIT $${params.length}`;
    const { rows } = await db.query(q, params);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Add contribution (admin)
router.post('/contribute', requireAdmin, async (req, res) => {
  const { member_id, amount, note } = req.body;
  if (!member_id || !amount || amount <= 0) return res.status(400).json({ error: 'Member and amount required' });
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query('UPDATE members SET balance = balance + $1 WHERE id = $2', [amount, member_id]);
    const { rows } = await client.query(
      'INSERT INTO transactions (member_id, type, amount, note, recorded_by) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [member_id, 'contribution', amount, note || 'Weekly contribution', req.user.id]
    );
    // Update streak and score
    await client.query(
      'UPDATE members SET savings_streak = savings_streak + 1, score = score + 10 WHERE id = $1',
      [member_id]
    );
    await client.query(
      'INSERT INTO activity_logs (member_id, action, details) VALUES ($1, $2, $3)',
      [req.user.id, 'contribution_added', `UGX ${amount.toLocaleString()} for member ${member_id}`]
    );
    await client.query('COMMIT');
    res.status(201).json(rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// Manual credit/debit (admin)
router.post('/manual', requireAdmin, async (req, res) => {
  const { member_id, amount, type, note } = req.body;
  if (!member_id || !amount || !type) return res.status(400).json({ error: 'Member, amount and type required' });
  if (!['manual_credit', 'manual_debit'].includes(type)) return res.status(400).json({ error: 'Invalid type' });
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const delta = type === 'manual_credit' ? amount : -amount;
    const { rows: mem } = await client.query('SELECT balance FROM members WHERE id = $1', [member_id]);
    if (!mem.length) throw new Error('Member not found');
    if (delta < 0 && mem[0].balance + delta < 0) throw new Error('Insufficient balance');
    await client.query('UPDATE members SET balance = balance + $1 WHERE id = $2', [delta, member_id]);
    const { rows } = await client.query(
      'INSERT INTO transactions (member_id, type, amount, note, recorded_by) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [member_id, type, Math.abs(amount), note || '', req.user.id]
    );
    await client.query('COMMIT');
    res.status(201).json(rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(400).json({ error: err.message });
  } finally {
    client.release();
  }
});

// Withdraw (member requests, admin approves separately)
router.post('/withdraw', requireAdmin, async (req, res) => {
  const { member_id, amount, note } = req.body;
  if (!member_id || !amount || amount <= 0) return res.status(400).json({ error: 'Member and amount required' });
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const { rows: mem } = await client.query('SELECT balance FROM members WHERE id = $1', [member_id]);
    if (!mem.length) throw new Error('Member not found');
    if (mem[0].balance < amount) throw new Error('Insufficient balance');
    await client.query('UPDATE members SET balance = balance - $1 WHERE id = $2', [amount, member_id]);
    const { rows } = await client.query(
      'INSERT INTO transactions (member_id, type, amount, note, recorded_by) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [member_id, 'withdrawal', amount, note || 'Withdrawal', req.user.id]
    );
    await client.query(
      'INSERT INTO activity_logs (member_id, action, details) VALUES ($1, $2, $3)',
      [req.user.id, 'withdrawal', `UGX ${amount.toLocaleString()} withdrawn for member ${member_id}`]
    );
    await client.query('COMMIT');
    res.status(201).json(rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(400).json({ error: err.message });
  } finally {
    client.release();
  }
});

module.exports = router;
