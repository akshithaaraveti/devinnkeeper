import jwt from 'jsonwebtoken';

const COOKIE_NAME = 'innkeeper_session';

export function verifyJwtToken(token) {
  const secrets = [
    process.env.JWT_SECRET,
    'innkeeper-super-secret-key-change-in-production',
    'change-me'
  ].filter(Boolean);

  let lastErr = null;
  for (const secret of secrets) {
    try {
      return jwt.verify(token, secret);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error('Invalid token');
}

export function authenticateToken(req, res, next) {
  const authHeader = req.headers.authorization;
  let token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token && req.cookies?.[COOKIE_NAME]) {
    token = req.cookies[COOKIE_NAME];
  }

  if (!token) {
    return res.status(401).json({ error: 'Unauthorized: Authentication token required' });
  }

  try {
    const payload = verifyJwtToken(token);
    req.user = {
      id: payload.id,
      email: payload.email,
      role: payload.role || 'staff',
    };
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Unauthorized: Invalid or expired token' });
  }
}
