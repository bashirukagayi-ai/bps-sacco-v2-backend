require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { auth, adminOnly } = require('./middleware/auth');

const app = express();
app.use(cors());
app.use(express.json());

app.get('/api/health', (req, res) => res.json({ status: 'ok', time: new Date() }));
app.use('/api/auth', require('./routes/auth'));
app.use('/api/admin', auth, adminOnly, require('./routes/admin'));
app.use('/api/member', auth, require('./routes/member'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('BPS Sacco v2 backend running on port ' + PORT));
