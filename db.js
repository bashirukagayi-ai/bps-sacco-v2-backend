const { Pool } = require('pg');

const pool = new Pool({
  connectionString: 'postgresql://neondb_owner:npg_FnEV8HU7AfWh@ep-late-breeze-alhhge3x.c-3.eu-central-1.aws.neon.tech/neondb?sslmode=require',
  ssl: { rejectUnauthorized: false },
});

pool.query('SELECT 1').then(() => {
  console.log('Connected to Neon database');
}).catch(err => {
  console.error('DB connection error:', err.message);
});

module.exports = {
  query: (text, params) => pool.query(text, params),
  connect: () => pool.connect(),
  end: () => pool.end(),
};
