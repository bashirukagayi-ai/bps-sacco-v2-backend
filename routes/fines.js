const router = require('express').Router();
const db = require('../db');
const { requireAuth, requireAdmin } = require('../middleware/auth');

// Get my fines
router.get('/my', requireAuth, async (req, res) => {
  try {
    const { rows } = await db.query(
      'SELECT * FROM fines WHERE member_id = $1 ORDER BY created_at DESC',
      [req.user.id]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get all fines (admin)
router.get('/', requireAdmin, async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT f.*, m.full_name FROM fines f
       JOIN members m ON f.member_id = m.id
       ORDER BY f.created_at DESC`
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Issue fine (admin)
router.post('/', requireAdmin, async (req, res) => {
  const { member_id, amount, reason } = req.body;
  if (!member_id || !amount || !reason) return res.status(400).json({ error: 'Member, amount and reason required' });
  try {
    const { rows } = await db.query(
      'INSERT INTO fines (member_id, amount, reason, issued_by) VALUES ($1, $2, $3, $4) RETURNING *',
      [member_id, amount, reason, req.user.id]
    );
    await db.query(
      'UPDATE members SET score = GREATEST(0, score - 5) WHERE id = $1',
      [member_id]
    );
    await db.query(
      'INSERT INTO activity_logs (member_id, action, details) VALUES ($1, $2, $3)',
      [req.user.id, 'fine_issued', `UGX ${amount.toLocaleString()} fine: ${reason}`]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Pay fine (admin)
router.post('/:id/pay', requireAdmin, async (req, res) => {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query("SELECT * FROM fines WHERE id = $1 AND status = 'unpaid'", [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Unpaid fine not found' });
    const fine = rows[0];

    await client.query(
      "UPDATE fines SET status = 'paid', paid_at = NOW() WHERE id = $1",
      [fine.id]
    );
    await client.query('UPDATE members SET balance = balance - $1 WHERE id = $2', [fine.amount, fine.member_id]);
    await client.query(
      'INSERT INTO transactions (member_id, type, amount, note, recorded_by) VALUES ($1, $2, $3, $4, $5)',
      [fine.member_id, 'fine_payment', fine.amount, `Fine paid: ${fine.reason}`, req.user.id]
    );
    await client.query('COMMIT');
    res.json({ message: 'Fine marked as paid' });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// Waive fine (admin)
router.post('/:id/waive', requireAdmin, async (req, res) => {
  try {
    const { rows } = await db.query(
      "UPDATE fines SET status = 'waived' WHERE id = $1 AND status = 'unpaid' RETURNING *",
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Unpaid fine not found' });
    res.json({ message: 'Fine waived' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete fine (admin)
router.delete('/:id', requireAdmin, async (req, res) => {
  try {
    await db.query('DELETE FROM fines WHERE id = $1', [req.params.id]);
    res.json({ message: 'Fine deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
