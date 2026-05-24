const router = require('express').Router();
const db = require('../db');
const { auth, adminOnly } = require('../middleware/auth');

// Get my fines
router.get('/my', auth, async (req, res) => {
  try {
    const { rows } = await db.query(
      'SELECT * FROM fines WHERE member_id = $1 ORDER BY created_at DESC',
      [req.user.id]
    );
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Get all fines (admin)
router.get('/', auth, adminOnly, async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT f.*, m.full_name FROM fines f
       JOIN members m ON f.member_id = m.id
       ORDER BY f.created_at DESC`
    );
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Issue fine (admin) - deducts from balance immediately
router.post('/', auth, adminOnly, async (req, res) => {
  const { member_id, amount, reason } = req.body;
  if (!member_id || !amount || !reason) return res.status(400).json({ error: 'Member, amount and reason required' });
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      'INSERT INTO fines (member_id, amount, reason, status, issued_by) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [member_id, amount, reason, 'paid', req.user.id]
    );
    await client.query('UPDATE members SET balance = GREATEST(0, balance - $1) WHERE id = $2', [amount, member_id]);
    await client.query(
      'INSERT INTO transactions (member_id, type, amount, note, recorded_by) VALUES ($1, $2, $3, $4, $5)',
      [member_id, 'fine_payment', amount, `Fine: ${reason}`, req.user.id]
    );
    await client.query(
      'INSERT INTO activity_logs (member_id, action, details) VALUES ($1, $2, $3)',
      [req.user.id, 'fine_issued', `UGX ${amount} fine issued: ${reason}`]
    );
    await client.query('COMMIT');
    res.status(201).json(rows[0]);
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: e.message });
  } finally { client.release(); }
});

// Waive fine (admin)
router.post('/:id/waive', auth, adminOnly, async (req, res) => {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      "SELECT * FROM fines WHERE id = $1", [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Fine not found' });
    const fine = rows[0];
    await client.query("UPDATE fines SET status = 'waived' WHERE id = $1", [fine.id]);
    if (fine.status === 'paid') {
      await client.query('UPDATE members SET balance = balance + $1 WHERE id = $2', [fine.amount, fine.member_id]);
    }
    await client.query('COMMIT');
    res.json({ message: 'Fine waived' });
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: e.message });
  } finally { client.release(); }
});

// Delete fine (admin)
router.delete('/:id', auth, adminOnly, async (req, res) => {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query('SELECT * FROM fines WHERE id = $1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Fine not found' });
    const fine = rows[0];
    await client.query('DELETE FROM fines WHERE id = $1', [fine.id]);
    if (fine.status === 'paid') {
      await client.query('UPDATE members SET balance = balance + $1 WHERE id = $2', [fine.amount, fine.member_id]);
    }
    await client.query('COMMIT');
    res.json({ message: 'Fine deleted and balance refunded' });
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: e.message });
  } finally { client.release(); }
});

module.exports = router;
