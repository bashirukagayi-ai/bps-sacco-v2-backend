const router = require('express').Router();
const bcrypt = require('bcryptjs');
const db = require('../db');

// Dashboard
router.get('/dashboard', async (req, res) => {
  try {
    const [pool, loans, fines, members, txs] = await Promise.all([
      db.query('SELECT COALESCE(SUM(balance),0) as total FROM members'),
      db.query("SELECT COUNT(*) as count FROM loans WHERE status='active'"),
      db.query("SELECT COUNT(*) as count FROM fines WHERE status='unpaid'"),
      db.query('SELECT COUNT(*) as count FROM members'),
      db.query('SELECT t.*, m.full_name as member_name FROM transactions t JOIN members m ON m.id=t.member_id ORDER BY t.created_at DESC LIMIT 10'),
    ]);
    res.json({
      totalPool: pool.rows[0].total,
      activeLoans: loans.rows[0].count,
      unpaidFines: fines.rows[0].count,
      totalMembers: members.rows[0].count,
      recentTransactions: txs.rows,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Members
router.get('/members', async (req, res) => {
  try {
    const { rows } = await db.query('SELECT id,full_name,phone,role,balance,score,savings_streak,status FROM members ORDER BY full_name');
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/members', async (req, res) => {
  const { full_name, phone, pin, role } = req.body;
  if (!full_name || !phone || !pin) return res.status(400).json({ error: 'All fields required' });
  try {
    const pin_hash = await bcrypt.hash(String(pin), 10);
    const { rows } = await db.query(
      'INSERT INTO members (full_name,phone,pin_hash,role,pin_set) VALUES ($1,$2,$3,$4,true) RETURNING id,full_name,phone,role',
      [full_name, phone, pin_hash, role || 'member']
    );
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Transactions
router.post('/transactions', async (req, res) => {
  const { member_id, type, amount, note } = req.body;
  if (!member_id || !type || !amount) return res.status(400).json({ error: 'Missing fields' });
  try {
    const delta = ['withdrawal','manual_debit','fine_payment'].includes(type) ? -Math.abs(amount) : Math.abs(amount);
    await db.query('BEGIN');
    await db.query('INSERT INTO transactions (member_id,type,amount,note,recorded_by) VALUES ($1,$2,$3,$4,$5)', [member_id, type, delta, note, req.user.id]);
    await db.query('UPDATE members SET balance=balance+$1 WHERE id=$2', [delta, member_id]);
    await db.query('COMMIT');
    res.json({ success: true });
  } catch (e) { await db.query('ROLLBACK'); res.status(500).json({ error: e.message }); }
});

// Loans
router.get('/loans', async (req, res) => {
  try {
    const { rows } = await db.query('SELECT l.*,m.full_name as member_name FROM loans l JOIN members m ON m.id=l.member_id ORDER BY l.created_at DESC');
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/loans/:id/approve', async (req, res) => {
  try {
    const { rows } = await db.query("SELECT * FROM loans WHERE id=$1 AND status='pending'", [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Loan not found or not pending' });
    const loan = rows[0];
    await db.query('BEGIN');
    await db.query("UPDATE loans SET status='active',approved_by=$1,due_date=NOW()+INTERVAL '90 days' WHERE id=$2", [req.user.id, loan.id]);
    await db.query('INSERT INTO transactions (member_id,type,amount,note,recorded_by) VALUES ($1,$2,$3,$4,$5)', [loan.member_id,'loan_disbursement',loan.amount,'Loan approved',req.user.id]);
    await db.query('UPDATE members SET balance=balance+$1 WHERE id=$2', [loan.amount, loan.member_id]);
    await db.query('COMMIT');
    res.json({ success: true });
  } catch (e) { await db.query('ROLLBACK'); res.status(500).json({ error: e.message }); }
});

router.post('/loans/:id/reject', async (req, res) => {
  try {
    await db.query("UPDATE loans SET status='rejected' WHERE id=$1 AND status='pending'", [req.params.id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/loans/:id/repay', async (req, res) => {
  const { amount } = req.body;
  if (!amount) return res.status(400).json({ error: 'Amount required' });
  try {
    const { rows } = await db.query("SELECT * FROM loans WHERE id=$1 AND status='active'", [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Active loan not found' });
    const loan = rows[0];
    const newPaid = Number(loan.amount_paid) + Number(amount);
    const newStatus = newPaid >= loan.total_due ? 'repaid' : 'active';
    await db.query('BEGIN');
    await db.query('UPDATE loans SET amount_paid=$1,status=$2 WHERE id=$3', [newPaid, newStatus, loan.id]);
    await db.query('INSERT INTO loan_repayments (loan_id,amount,recorded_by) VALUES ($1,$2,$3)', [loan.id, amount, req.user.id]);
    await db.query('INSERT INTO transactions (member_id,type,amount,note,recorded_by) VALUES ($1,$2,$3,$4,$5)', [loan.member_id,'loan_repayment',-Math.abs(amount),'Loan repayment',req.user.id]);
    await db.query('UPDATE members SET balance=balance-$1 WHERE id=$2', [Math.abs(amount), loan.member_id]);
    await db.query('COMMIT');
    res.json({ success: true });
  } catch (e) { await db.query('ROLLBACK'); res.status(500).json({ error: e.message }); }
});

// Fines
router.get('/fines', async (req, res) => {
  try {
    const { rows } = await db.query('SELECT f.*,m.full_name as member_name FROM fines f JOIN members m ON m.id=f.member_id ORDER BY f.created_at DESC');
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/fines', async (req, res) => {
  const { member_id, amount, reason } = req.body;
  if (!member_id || !amount || !reason) return res.status(400).json({ error: 'All fields required' });
  try {
    await db.query('INSERT INTO fines (member_id,amount,reason,issued_by) VALUES ($1,$2,$3,$4)', [member_id, amount, reason, req.user.id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/fines/:id/waive', async (req, res) => {
  try {
    await db.query("UPDATE fines SET status='waived' WHERE id=$1", [req.params.id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Reports
router.get('/reports', async (req, res) => {
  try {
    const [pool, contrib, withdraw, loanBook, finesCol, finesOut, balances] = await Promise.all([
      db.query('SELECT COALESCE(SUM(balance),0) as v FROM members'),
      db.query("SELECT COALESCE(SUM(amount),0) as v FROM transactions WHERE type='contribution'"),
      db.query("SELECT COALESCE(SUM(ABS(amount)),0) as v FROM transactions WHERE type='withdrawal'"),
      db.query("SELECT COALESCE(SUM(total_due-amount_paid),0) as v FROM loans WHERE status='active'"),
      db.query("SELECT COALESCE(SUM(amount),0) as v FROM fines WHERE status='paid'"),
      db.query("SELECT COALESCE(SUM(amount),0) as v FROM fines WHERE status='unpaid'"),
      db.query('SELECT full_name,balance FROM members ORDER BY balance DESC'),
    ]);
    res.json({
      totalPool: pool.rows[0].v,
      totalContributions: contrib.rows[0].v,
      totalWithdrawals: withdraw.rows[0].v,
      activeLoanBook: loanBook.rows[0].v,
      finesCollected: finesCol.rows[0].v,
      outstandingFines: finesOut.rows[0].v,
      memberBalances: balances.rows,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
