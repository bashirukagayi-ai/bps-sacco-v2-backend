const cron = require('node-cron');
const db = require('../db');

// Runs every Saturday at 9:00 PM
function startCron() {
  cron.schedule('0 21 * * 6', async () => {
    console.log('[CRON] Running weekly fine check...');
    try {
      const settingsRes = await db.query("SELECT value FROM settings WHERE key = 'weekly_contribution_amount'");
      const minContrib = parseInt(settingsRes.rows[0]?.value || '10000');
      const fineAmountRes = await db.query("SELECT value FROM settings WHERE key = 'fine_amount'");
      const fineAmount = parseInt(fineAmountRes.rows[0]?.value || '1000');

      const now = new Date();
      const weekStart = new Date(now);
      weekStart.setDate(now.getDate() - 7);

      // Get all active members
      const { rows: members } = await db.query(
        "SELECT id, full_name FROM members WHERE role = 'member' AND status = 'active'"
      );

      let fined = 0;
      for (const member of members) {
        // Check their contributions this week
        const { rows: contribs } = await db.query(
          `SELECT COALESCE(SUM(amount), 0) AS total FROM transactions
           WHERE member_id = $1 AND type = 'contribution'
           AND created_at >= $2 AND created_at <= $3`,
          [member.id, weekStart, now]
        );

        const total = parseInt(contribs[0].total);
        if (total < minContrib) {
          await db.query(
            'INSERT INTO fines (member_id, amount, reason) VALUES ($1, $2, $3)',
            [member.id, fineAmount, `Weekly contribution shortfall (contributed UGX ${total.toLocaleString()}, required UGX ${minContrib.toLocaleString()})`]
          );
          await db.query(
            'INSERT INTO activity_logs (member_id, action, details) VALUES ($1, $2, $3)',
            [member.id, 'auto_fine', `Auto-fined UGX ${fineAmount}: contributed UGX ${total}`]
          );
          fined++;
        }
      }
      console.log(`[CRON] Weekly fine check complete. ${fined} member(s) fined.`);
    } catch (err) {
      console.error('[CRON] Error during weekly fine check:', err.message);
    }
  }, { timezone: 'Africa/Kampala' });

  console.log('[CRON] Weekly fine scheduler started (Saturdays 9PM EAT)');
}

module.exports = { startCron };
