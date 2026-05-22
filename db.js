const { Pool } = require('pg');

const pool = new Pool({
  host: 'aws-1-eu-central-1.pooler.supabase.com',
  port: 6543,
  database: 'postgres',
  user: 'postgres.mkcfxvgevwrckbhpmqbd',
  password: 'BpsSaccoV2x2026',
  ssl: { rejectUnauthorized: false },
});

pool.query('SELECT 1').then(() => {
  console.log('Connected to Supabase database');
}).catch(err => {
  console.error('DB connection error:', err.message);
});

module.exports = {
  query: (text, params) => pool.query(text, params),
  connect: () => pool.connect(),
  end: () => pool.end(),
};
