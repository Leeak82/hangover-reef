import { Router, type Request, type Response, type NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { store, getUser, grant } from './db.js';
import { STARTER_COINS, DAILY_COINS, DAILY_MS } from '../shared/config.js';

const COOKIE = 'hr_session';
const SESSION_MS = 30 * 24 * 3600 * 1000;
// Session tokens are random; only an HMAC of them is stored. SESSION_SECRET keys that HMAC
// (rotating it logs everyone out). Falls back to plain SHA-256 locally.
const SECRET = process.env.SESSION_SECRET || '';
if (!SECRET && process.env.NODE_ENV === 'production') console.warn('[auth] SESSION_SECRET is not set');
const sha = (s: string) => (SECRET ? crypto.createHmac('sha256', SECRET) : crypto.createHash('sha256')).update(s).digest('hex');

export async function userFromToken(token: string | undefined): Promise<number | null> {
  if (!token) return null;
  return store.sessionUser(sha(token), Date.now());
}

export function parseCookie(header: string | undefined, name: string) {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return undefined;
}

export interface AuthedRequest extends Request { userId?: number }
export function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  (async () => {
    const uid = await userFromToken(req.cookies?.[COOKIE]);
    if (!uid || !(await getUser(uid))) return res.status(401).json({ error: 'Not logged in' });
    req.userId = uid; next();
  })().catch(next);
}
export const SESSION_COOKIE = COOKIE;

async function startSession(res: Response, userId: number) {
  const token = crypto.randomBytes(32).toString('base64url');
  await store.createSession(sha(token), userId, Date.now() + SESSION_MS);
  res.cookie(COOKIE, token, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production' && process.env.INSECURE_COOKIES !== '1', maxAge: SESSION_MS, path: '/' });
}

export async function publicUser(id: number) {
  const u = (await getUser(id))!;
  const nextDailyAt = u.last_daily_at + DAILY_MS;
  return { id: u.id, email: u.email, coins: u.coins, dailyAvailable: Date.now() >= nextDailyAt, nextDailyAt, dailyCoins: DAILY_COINS };
}

// naive in-memory rate limiter for auth endpoints
const attempts = new Map<string, { n: number; reset: number }>();
function limited(key: string, max = 10, windowMs = 10 * 60 * 1000) {
  const now = Date.now(); const a = attempts.get(key);
  if (!a || a.reset < now) { attempts.set(key, { n: 1, reset: now + windowMs }); return false; }
  a.n++; return a.n > max;
}

const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 12);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export const authRouter = Router();

authRouter.post('/signup', async (req, res) => {
  const { email, password, ageConfirmed } = req.body ?? {};
  if (limited('su:' + req.ip, 20)) return res.status(429).json({ error: 'Too many attempts, try again later' });
  if (typeof email !== 'string' || !EMAIL_RE.test(email) || email.length > 200) return res.status(400).json({ error: 'Enter a valid email' });
  if (typeof password !== 'string' || password.length < 8 || password.length > 200) return res.status(400).json({ error: 'Password must be at least 8 characters' });
  if (ageConfirmed !== true) return res.status(400).json({ error: 'You must confirm you are 17 or older' });
  const norm = email.trim().toLowerCase();
  if (await store.findByEmail(norm)) return res.status(409).json({ error: 'That email already has an account' });
  const hash = await bcrypt.hash(password, 12);
  const id = await store.createUser(norm, hash, Date.now());
  if (!id) return res.status(409).json({ error: 'That email already has an account' });
  await grant(id, 'starter', STARTER_COINS);
  await startSession(res, id);
  res.json({ user: await publicUser(id), starter: STARTER_COINS });
});

authRouter.post('/login', async (req, res) => {
  const { email, password } = req.body ?? {};
  if (typeof email !== 'string' || typeof password !== 'string') return res.status(400).json({ error: 'Email and password required' });
  if (limited('li:' + req.ip + ':' + email.toLowerCase())) return res.status(429).json({ error: 'Too many attempts, try again later' });
  const u = await store.findByEmail(email.trim().toLowerCase());
  const ok = u ? await bcrypt.compare(password, u.pass_hash) : (await bcrypt.compare(password, DUMMY_HASH), false);
  if (!u || !ok) return res.status(401).json({ error: 'Wrong email or password' });
  await startSession(res, u.id);
  res.json({ user: await publicUser(u.id) });
});

authRouter.post('/logout', async (req, res) => {
  const t = req.cookies?.[COOKIE];
  if (t) await store.deleteSession(sha(t));
  res.clearCookie(COOKIE, { path: '/' });
  res.json({ ok: true });
});

authRouter.get('/me', requireAuth, async (req: AuthedRequest, res) => res.json({ user: await publicUser(req.userId!) }));

authRouter.post('/daily', requireAuth, async (req: AuthedRequest, res) => {
  const id = req.userId!;
  if (!(await store.claimDaily(id, DAILY_COINS, DAILY_MS))) return res.status(400).json({ error: 'Daily refill not ready yet', user: await publicUser(id) });
  res.json({ user: await publicUser(id), granted: DAILY_COINS });
});
