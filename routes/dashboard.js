const router = require('express').Router();
const db = require('../db');
const { requireAdmin, requireAuth } = require('../middleware/auth');

// Admin dashboard stats
router.get('/admin', requireAdmin, async (req, res) => {
  try {
    const [pool, members, loans, fines, recentTx] = await Promise.all([
      db.query("SELECT SUM(balance) AS total FROM members WHERE role = 'member'"),
      db.query("SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE status = 'active') AS active FROM members WHERE role = 'member'"),
      db.query("SELECT COUNT(*) FILTER (WHERE status = 'active') AS active, COUNT(*) FILTER (WHERE status = 'pending') AS pending, SUM(total_due - amount_paid) FILTER (WHERE status = 'active') AS outstanding FROM loans"),
      db.query("SELECT COUNT(*) FILTER (WHERE status = 'unpaid') AS unpaid, SUM(amount) FILTER (WHERE status = 'unpaid') AS unpaid_amount FROM fines"),
      db.query("SELECT t.*, m.full_name FROM transactions t JOIN members m ON t.member_id = m.id ORDER BY t.created_at DESC LIMIT 10"),
    ]);

    res.json({
      pool_total: parseInt(pool.rows[0].total) || 0,
      members: {
        total: parseInt(members.rows[0].total),
        active: parseInt(members.rows[0].active),
      },
      loans: {
        active: parseInt(loans.rows[0].active),
        pending: parseInt(loans.rows[0].pending),
        outstanding: parseInt(loans.rows[0].outstanding) || 0,
      },
      fines: {
        unpaid: parseInt(fines.rows[0].unpaid),
        unpaid_amount: parseInt(fines.rows[0].unpaid_amount) || 0,
      },
      recent_transactions: recentTx.rows,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Member dashboard
router.get('/member', requireAuth, async (req, res) => {
  try {
    const [member, recentTx, activeLoan, unpaidFines] = await Promise.all([
      db.query('SELECT id, full_name, balance, score, savings_streak FROM members WHERE id = $1', [req.user.id]),
      db.query('SELECT * FROM transactions WHERE member_id = $1 ORDER BY created_at DESC LIMIT 5', [req.user.id]),
      db.query("SELECT * FROM loans WHERE member_id = $1 AND status = 'active' LIMIT 1", [req.user.id]),
      db.query("SELECT COUNT(*) AS count, SUM(amount) AS total FROM fines WHERE member_id = $1 AND status = 'unpaid'", [req.user.id]),
    ]);

    res.json({
      member: member.rows[0],
      recent_transactions: recentTx.rows,
      active_loan: activeLoan.rows[0] || null,
      unpaid_fines: {
        count: parseInt(unpaidFines.rows[0].count),
        total: parseInt(unpaidFines.rows[0].total) || 0,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Monthly report (admin)
router.get('/monthly', requireAdmin, async (req, res) => {
  const { month, year } = req.query;
  const m = month || new Date().getMonth() + 1;
  const y = year || new Date().getFullYear();
  try {
    const [contributions, fines, loans, topContributor, topBalance] = await Promise.all([
      db.query(
        `SELECT SUM(amount) AS total, COUNT(*) AS count FROM transactions
         WHERE type = 'contribution' AND EXTRACT(MONTH FROM created_at) = $1 AND EXTRACT(YEAR FROM created_at) = $2`,
        [m, y]
      ),
      db.query(
        `SELECT SUM(amount) AS total, COUNT(*) AS count FROM fines
         WHERE EXTRACT(MONTH FROM created_at) = $1 AND EXTRACT(YEAR FROM created_at) = $2`,
        [m, y]
      ),
      db.query(
        `SELECT SUM(amount) AS total, COUNT(*) AS count FROM loans
         WHERE EXTRACT(MONTH FROM created_at) = $1 AND EXTRACT(YEAR FROM created_at) = $2`,
        [m, y]
      ),
      db.query(
        `SELECT m.full_name, SUM(t.amount) AS contributed
         FROM transactions t JOIN members m ON t.member_id = m.id
         WHERE t.type = 'contribution' AND EXTRACT(MONTH FROM t.created_at) = $1 AND EXTRACT(YEAR FROM t.created_at) = $2
         GROUP BY m.id, m.full_name ORDER BY contributed DESC LIMIT 1`,
        [m, y]
      ),
      db.query("SELECT full_name, balance FROM members WHERE role = 'member' ORDER BY balance DESC LIMIT 1"),
    ]);

    res.json({
      month: m, year: y,
      contributions: { total: parseInt(contributions.rows[0].total) || 0, count: parseInt(contributions.rows[0].count) },
      fines: { total: parseInt(fines.rows[0].total) || 0, count: parseInt(fines.rows[0].count) },
      loans: { total: parseInt(loans.rows[0].total) || 0, count: parseInt(loans.rows[0].count) },
      top_contributor: topContributor.rows[0] || null,
      top_balance: topBalance.rows[0] || null,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Activity logs (admin)
router.get('/activity', requireAdmin, async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT a.*, m.full_name FROM activity_logs a
       LEFT JOIN members m ON a.member_id = m.id
       ORDER BY a.created_at DESC LIMIT 100`
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Settings (admin)
router.get('/settings', requireAdmin, async (req, res) => {
  try {
    const { rows } = await db.query('SELECT * FROM settings');
    const settings = {};
    rows.forEach(r => settings[r.key] = r.value);
    res.json(settings);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/settings', requireAdmin, async (req, res) => {
  const updates = req.body;
  try {
    for (const [key, value] of Object.entries(updates)) {
      await db.query(
        'INSERT INTO settings (key, value, updated_at) VALUES ($1, $2, NOW()) ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()',
        [key, String(value)]
      );
    }
    res.json({ message: 'Settings updated' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
