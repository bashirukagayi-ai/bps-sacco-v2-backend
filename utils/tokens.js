const jwt = require('jsonwebtoken');

const SECRET = process.env.JWT_SECRET || 'bps_local_dev_only';

function signToken(member) {
  return jwt.sign(
    { id: member.id, role: member.role, type: 'access' },
    SECRET,
    { expiresIn: '7d' }
  );
}

function verifyToken(token) {
  return jwt.verify(token, SECRET);
}

module.exports = { signToken, verifyToken };
