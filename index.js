require('dotenv').config();
const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');

const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 500 }));

// Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/members', require('./routes/members'));
app.use('/api/transactions', require('./routes/transactions'));
app.use('/api/loans', require('./routes/loans'));
app.use('/api/fines', require('./routes/fines'));
app.use('/api/dashboard', require('./routes/dashboard'));

// Health check
app.get('/', (req, res) => res.json({ status: 'BPS Sacco v2 API running' }));
app.get('/api/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

// Start cron
const { startCron } = require('./utils/cron');
startCron();

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
