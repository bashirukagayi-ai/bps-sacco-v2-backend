const router = require('express').Router();
const bcrypt = require('bcryptjs');
const db = require('../db');

router.get('/dashboard', async (req, res) => {
  try {
    const { rows } = await db.query('SELECT balance,score,savings_streak FROM members WHERE id=$1', [req.user.id]);
    const loans = await db.query("SELECT COUNT(*) as count FROM loans WHERE member_id=$1 AND status='active'", [req.user.id]);
    const txs = await db.query('SELECT * FROM transactions WHERE member_id=$1 ORDER BY created_at DESC LIMIT 10', [req.user.id]);
    res.json({ ...rows[0], activeLoans: loans.rows[0].count, recentTransactions: txs.rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/loans', async (req, res) => {
  try {
    const { rows } = await db.query('SELECT * FROM loans WHERE member_id=$1 ORDER BY created_at DESC', [req.user.id]);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/loan-eligibility', async (req, res) => {
  try {
    const { rows } = await db.query('SELECT balance FROM members WHERE id=$1', [req.user.id]);
    const balance = Number(rows[0].balance);
    const settings = await db.query("SELECT value FROM settings WHERE key='min_balance_for_loan'");
    const minBal = Number(settings.rows[0]?.value || 250000);
    const activeLoans = await db.query("SELECT COUNT(*) as c FROM loans WHERE member_id=$1 AND status='active'", [req.user.id]);
    if (Number(activeLoans.rows[0].c) > 0) return res.json({ eligible: false, reason: 'You have an active loan' });
    if (balance < minBal) return res.json({ eligible: false, reason: `Minimum balance required: UGX ${minBal.toLocaleString()}` });
    const mult = await db.query("SELECT value FROM settings WHERE key='max_loan_multiplier'");
    const maxAmount = balance * Number(mult.rows[0]?.value || 3);
    res.json({ eligible: true, maxAmount });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/loans', async (req, res) => {
  const { amount } = req.body;
  if (!amount) return res.status(400).json({ error: 'Amount required' });
  try {
    const rate = await db.query("SELECT value FROM settings WHERE key='loan_interest_rate'");
    const interest = Math.round(amount * Number(rate.rows[0]?.value || 5) / 100);
    const total_due = Number(amount) + interest;
    await db.query('INSERT INTO loans (member_id,amount,interest_amount,total_due) VALUES ($1,$2,$3,$4)', [req.user.id, amount, interest, total_due]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/fines', async (req, res) => {
  try {
    const { rows } = await db.query('SELECT * FROM fines WHERE member_id=$1 ORDER BY created_at DESC', [req.user.id]);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/change-pin', async (req, res) => {
  const { current_pin, new_pin } = req.body;
  if (!current_pin || !new_pin) return res.status(400).json({ error: 'All fields required' });
  if (String(new_pin).length !== 4) return res.status(400).json({ error: 'PIN must be 4 digits' });
  try {
    const { rows } = await db.query('SELECT pin_hash FROM members WHERE id=$1', [req.user.id]);
    const valid = await bcrypt.compare(String(current_pin), rows[0].pin_hash);
    if (!valid) return res.status(401).json({ error: 'Current PIN is incorrect' });
    const pin_hash = await bcrypt.hash(String(new_pin), 10);
    await db.query('UPDATE members SET pin_hash=$1 WHERE id=$2', [pin_hash, req.user.id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
