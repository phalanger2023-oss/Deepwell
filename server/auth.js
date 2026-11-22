import crypto from 'node:crypto';
import express from 'express';
import { db, uid, now, getSetting } from './db.js';

const SESSION_MS = 30 * 24 * 3600 * 1000;
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

export function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  return `scrypt$${salt.toString('hex')}$${crypto.scryptSync(pw, salt, 64).toString('hex')}`;
}
export function verifyPassword(pw, stored) {
  const [, s, h] = String(stored).split('$');
  if (!s || !h) return false;
  const a = crypto.scryptSync(pw, Buffer.from(s, 'hex'), 64), b = Buffer.from(h, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function cookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export function createSession(res, req, userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  db.prepare('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)').run(sha(token), userId, now() + SESSION_MS);
  const secure = req.secure || process.env.COOKIE_SECURE === '1';
  res.append('Set-Cookie', `dw_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_MS / 1000}${secure ? '; Secure' : ''}`);
}

/** Middleware : renseigne req.user si une session valide existe. */
export function sessionMiddleware(req, _res, next) {
  req.user = null;
  const t = cookies(req).dw_session;
  if (t) {
    const row = db.prepare(`SELECT u.id,u.email,u.name,u.role,s.expires_at FROM sessions s
      JOIN users u ON u.id=s.user_id WHERE s.token_hash=?`).get(sha(t));
    if (row && row.expires_at > now()) req.user = { id: row.id, email: row.email, name: row.name, role: row.role };
  }
  next();
}

export const requireAuth = (req, res, next) => req.user ? next() : res.status(401).json({ error: 'Non connecté' });
export const requireAdmin = (req, res, next) =>
  req.user?.role === 'admin' ? next() : res.status(403).json({ error: 'Réservé aux administrateurs' });

const attempts = new Map();
function throttled(key) {
  const a = (attempts.get(key) || []).filter((t) => t > now() - 15 * 60 * 1000);
  attempts.set(key, a);
  return a.length >= 10;
}

const validEmail = (e) => typeof e === 'string' && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e) && e.length < 200;
const publicUser = (u) => ({ id: u.id, email: u.email, name: u.name, role: u.role });

export const authRouter = express.Router();

authRouter.get('/me', (req, res) => {
  const first = db.prepare('SELECT COUNT(*) c FROM users').get().c === 0;
  res.json({ user: req.user, needsSetup: first, allowSignup: first || getSetting('allow_signup') === '1' });
});

authRouter.post('/register', (req, res) => {
  const { email, name = '', password } = req.body || {};
  const count = db.prepare('SELECT COUNT(*) c FROM users').get().c;
  if (count > 0 && getSetting('allow_signup') !== '1') return res.status(403).json({ error: "Les inscriptions sont fermées. Demandez un compte à l'administrateur." });
  if (!validEmail(email)) return res.status(400).json({ error: 'E-mail invalide' });
  if (typeof password !== 'string' || password.length < 8) return res.status(400).json({ error: 'Mot de passe : 8 caractères minimum' });
  const mail = email.trim().toLowerCase();
  if (db.prepare('SELECT 1 FROM users WHERE email=?').get(mail)) return res.status(409).json({ error: 'Cet e-mail est déjà utilisé' });
  const id = uid();
  db.prepare('INSERT INTO users(id,email,name,password_hash,role,created_at) VALUES(?,?,?,?,?,?)')
    .run(id, mail, String(name).slice(0, 100), hashPassword(password), count === 0 ? 'admin' : 'member', now());
  createSession(res, req, id);
  res.json({ user: publicUser(db.prepare('SELECT * FROM users WHERE id=?').get(id)) });
});

authRouter.post('/login', (req, res) => {
  const { email, password } = req.body || {};
  const key = `${req.ip}|${String(email).toLowerCase()}`;
  if (throttled(key)) return res.status(429).json({ error: 'Trop de tentatives, réessayez dans 15 minutes' });
  const u = validEmail(email) && db.prepare('SELECT * FROM users WHERE email=?').get(email.trim().toLowerCase());
  if (!u || typeof password !== 'string' || !verifyPassword(password, u.password_hash)) {
    attempts.get(key).push(now());
    return res.status(401).json({ error: 'E-mail ou mot de passe incorrect' });
  }
  createSession(res, req, u.id);
  res.json({ user: publicUser(u) });
});

authRouter.post('/logout', (req, res) => {
  const t = cookies(req).dw_session;
  if (t) db.prepare('DELETE FROM sessions WHERE token_hash=?').run(sha(t));
  res.append('Set-Cookie', 'dw_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
  res.json({ ok: true });
});

authRouter.put('/me', requireAuth, (req, res) => {
  const { name, password, currentPassword } = req.body || {};
  if (typeof name === 'string') db.prepare('UPDATE users SET name=? WHERE id=?').run(name.slice(0, 100), req.user.id);
  if (password) {
    const u = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
    if (!verifyPassword(String(currentPassword || ''), u.password_hash)) return res.status(403).json({ error: 'Mot de passe actuel incorrect' });
    if (String(password).length < 8) return res.status(400).json({ error: 'Mot de passe : 8 caractères minimum' });
    db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(hashPassword(password), req.user.id);
    db.prepare('DELETE FROM sessions WHERE user_id=?').run(req.user.id);
    createSession(res, req, req.user.id);
  }
  res.json({ user: publicUser(db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id)) });
});

// --- Administration des utilisateurs ---
export const adminUsersRouter = express.Router();
adminUsersRouter.get('/', (_req, res) =>
  res.json(db.prepare('SELECT id,email,name,role,created_at FROM users ORDER BY created_at').all()));
adminUsersRouter.post('/', (req, res) => {
  const { email, name = '', password, role = 'member' } = req.body || {};
  if (!validEmail(email) || String(password || '').length < 8) return res.status(400).json({ error: 'E-mail valide et mot de passe de 8 caractères minimum requis' });
  const mail = email.trim().toLowerCase();
  if (db.prepare('SELECT 1 FROM users WHERE email=?').get(mail)) return res.status(409).json({ error: 'E-mail déjà utilisé' });
  const id = uid();
  db.prepare('INSERT INTO users(id,email,name,password_hash,role,created_at) VALUES(?,?,?,?,?,?)')
    .run(id, mail, String(name).slice(0, 100), hashPassword(password), role === 'admin' ? 'admin' : 'member', now());
  res.json({ id });
});
adminUsersRouter.delete('/:id', (req, res) => {
  if (req.params.id === req.user.id) return res.status(400).json({ error: 'Vous ne pouvez pas supprimer votre propre compte' });
  db.prepare('DELETE FROM users WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});
