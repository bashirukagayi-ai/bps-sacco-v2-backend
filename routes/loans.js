const router = require('express').Router();
const db = require('../db');
const { requireAuth, requireAdmin } = require('../middleware/auth');

// Get my loans
router.get('/my', requireAuth, async (req, res) => {
  try {
    const { rows } = await db.query(
      'SELECT * FROM loans WHERE member_id = $1 ORDER BY created_at DESC',
      [req.user.id]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get all loans (admin)
router.get('/', requireAdmin, async (req, res) => {
  const { status } = req.query;
  try {
    let q = `SELECT l.*, m.full_name FROM loans l JOIN members m ON l.member_id = m.id`;
    const params = [];
    if (status) { params.push(status); q += ` WHERE l.status = $1`; }
    q += ' ORDER BY l.created_at DESC';
    const { rows } = await db.query(q, params);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Apply for loan (member)
router.post('/apply', requireAuth, async (req, res) => {
  const { amount, guarantor_id } = req.body;
  if (!amount || amount <= 0) return res.status(400).json({ error: 'Amount required' });
  try {
    // Check existing active/pending loan
    const { rows: existing } = await db.query(
      "SELECT id FROM loans WHERE member_id = $1 AND status IN ('pending', 'active')",
      [req.user.id]
    );
    if (existing.length) return res.status(400).json({ error: 'You already have an active or pending loan' });

    // Check balance eligibility
    const { rows: mem } = await db.query('SELECT balance FROM members WHERE id = $1', [req.user.id]);
    const minBalance = 250000;
    if (mem[0].balance < minBalance) return res.status(400).json({ error: `Minimum balance of UGX ${minBalance.toLocaleString()} required` });

    const maxLoan = mem[0].balance * 3;
    if (amount > maxLoan) return res.status(400).json({ error: `Maximum loan is UGX ${maxLoan.toLocaleString()} (3× your balance)` });

    // Check guarantor
    if (guarantor_id) {
      const { rows: g } = await db.query(
        "SELECT id FROM loans WHERE member_id = $1 AND status IN ('pending', 'active')",
        [guarantor_id]
      );
      if (g.length) return res.status(400).json({ error: 'Guarantor has an active loan and cannot guarantee' });
    }

    const interest = Math.round(amount * 0.05);
    const total_due = amount + interest;

    const { rows } = await db.query(
      'INSERT INTO loans (member_id, amount, interest_amount, total_due) VALUES ($1, $2, $3, $4) RETURNING *',
      [req.user.id, amount, interest, total_due]
    );

    if (guarantor_id) {
      await db.query(
        'INSERT INTO loan_guarantors (loan_id, member_id) VALUES ($1, $2)',
        [rows[0].id, guarantor_id]
      );
    }

    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Issue loan directly (admin)
router.post('/', requireAdmin, async (req, res) => {
  const { member_id, amount, guarantor_id } = req.body;
  if (!member_id || !amount || amount <= 0) return res.status(400).json({ error: 'Member and amount required' });
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const interest = Math.round(amount * 0.05);
    const total_due = amount + interest;
    const due_date = new Date();
    due_date.setMonth(due_date.getMonth() + 3);

    const { rows } = await client.query(
      `INSERT INTO loans (member_id, amount, interest_amount, total_due, status, due_date, approved_by)
       VALUES ($1, $2, $3, $4, 'active', $5, $6) RETURNING *`,
      [member_id, amount, interest, total_due, due_date, req.user.id]
    );

    // Disburse to member balance
    await client.query('UPDATE members SET balance = balance + $1 WHERE id = $2', [amount, member_id]);
    await client.query(
      'INSERT INTO transactions (member_id, type, amount, note, recorded_by) VALUES ($1, $2, $3, $4, $5)',
      [member_id, 'loan_disbursement', amount, `Loan disbursed`, req.user.id]
    );

    if (guarantor_id) {
      await client.query('INSERT INTO loan_guarantors (loan_id, member_id) VALUES ($1, $2)', [rows[0].id, guarantor_id]);
    }

    await client.query(
      'INSERT INTO activity_logs (member_id, action, details) VALUES ($1, $2, $3)',
      [req.user.id, 'loan_issued', `UGX ${amount.toLocaleString()} to member ${member_id}`]
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

// Approve loan (admin)
router.post('/:id/approve', requireAdmin, async (req, res) => {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query("SELECT * FROM loans WHERE id = $1 AND status = 'pending'", [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Pending loan not found' });
    const loan = rows[0];
    const due_date = new Date();
    due_date.setMonth(due_date.getMonth() + 3);

    await client.query(
      "UPDATE loans SET status = 'active', due_date = $1, approved_by = $2 WHERE id = $3",
      [due_date, req.user.id, loan.id]
    );
    await client.query('UPDATE members SET balance = balance + $1 WHERE id = $2', [loan.amount, loan.member_id]);
    await client.query(
      'INSERT INTO transactions (member_id, type, amount, note, recorded_by) VALUES ($1, $2, $3, $4, $5)',
      [loan.member_id, 'loan_disbursement', loan.amount, 'Loan approved and disbursed', req.user.id]
    );
    await client.query('COMMIT');
    res.json({ message: 'Loan approved and disbursed' });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// Reject loan (admin)
router.post('/:id/reject', requireAdmin, async (req, res) => {
  try {
    const { rows } = await db.query(
      "UPDATE loans SET status = 'rejected' WHERE id = $1 AND status = 'pending' RETURNING *",
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Pending loan not found' });
    res.json({ message: 'Loan rejected' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Repay loan (admin)
router.post('/:id/repay', requireAdmin, async (req, res) => {
  const { amount } = req.body;
  if (!amount || amount <= 0) return res.status(400).json({ error: 'Amount required' });
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query("SELECT * FROM loans WHERE id = $1 AND status = 'active'", [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Active loan not found' });
    const loan = rows[0];

    const newPaid = loan.amount_paid + amount;
    const newInstallments = loan.installments_paid + 1;
    const isFullyPaid = newPaid >= loan.total_due;

    await client.query(
      `UPDATE loans SET amount_paid = $1, installments_paid = $2, status = $3 WHERE id = $4`,
      [newPaid, newInstallments, isFullyPaid ? 'repaid' : 'active', loan.id]
    );

    await client.query('UPDATE members SET balance = balance - $1 WHERE id = $2', [amount, loan.member_id]);
    await client.query(
      'INSERT INTO transactions (member_id, type, amount, note, recorded_by) VALUES ($1, $2, $3, $4, $5)',
      [loan.member_id, 'loan_repayment', amount, `Loan repayment (installment ${newInstallments})`, req.user.id]
    );
    await client.query(
      'INSERT INTO loan_repayments (loan_id, amount, recorded_by) VALUES ($1, $2, $3)',
      [loan.id, amount, req.user.id]
    );

    if (isFullyPaid) {
      await client.query('UPDATE members SET score = score + 50 WHERE id = $1', [loan.member_id]);
    }

    await client.query('COMMIT');
    res.json({ message: isFullyPaid ? 'Loan fully repaid' : 'Repayment recorded', fully_paid: isFullyPaid });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

module.exports = router;
