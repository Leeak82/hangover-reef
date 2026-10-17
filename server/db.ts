// Storage layer. Uses Postgres when DATABASE_URL is set (production on Render), otherwise a local SQLite file.
// Every function is async so both backends share one interface.
import path from 'node:path';
import fs from 'node:fs';
import { createRequire } from 'node:module';

export interface UserRow { id: number; email: string; pass_hash: string; coins: number; last_daily_at: number; total_bet: number; total_won: number }

interface Store {
  getUser(id: number): Promise<UserRow | undefined>;
  findByEmail(email: string): Promise<{ id: number; pass_hash: string } | undefined>;
  createUser(email: string, hash: string, now: number): Promise<number | null>; // null = email taken
  createSession(tokenHash: string, userId: number, expiresAt: number): Promise<void>;
  sessionUser(tokenHash: string, now: number): Promise<number | null>;
  deleteSession(tokenHash: string): Promise<void>;
  /** Atomic debit; returns the new balance, or null if the user can't afford it. */
  debit(userId: number, amount: number): Promise<number | null>;
  /** Adds coins (win=true also counts it as winnings; refund=true reverses a bet). Returns new balance. */
  add(userId: number, amount: number, kind: 'win' | 'refund' | 'plain'): Promise<number>;
  /** Credit with a ledger row. Idempotent on ref. Returns false if ref was already credited. */
  grant(userId: number, kind: string, coins: number, ref: string | null, amountCents: number | null): Promise<boolean>;
  /** Claims the daily refill if 24h passed. */
  claimDaily(userId: number, coins: number, intervalMs: number): Promise<boolean>;
  kind: string;
}

const SCHEMA = (pg: boolean) => `
CREATE TABLE IF NOT EXISTS users (
  id ${pg ? 'BIGSERIAL PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT'},
  email TEXT NOT NULL UNIQUE,
  pass_hash TEXT NOT NULL,
  coins BIGINT NOT NULL DEFAULT 0 CHECK (coins >= 0),
  age_confirmed_at BIGINT NOT NULL,
  last_daily_at BIGINT NOT NULL DEFAULT 0,
  total_bet BIGINT NOT NULL DEFAULT 0,
  total_won BIGINT NOT NULL DEFAULT 0,
  created_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS ledger (
  id ${pg ? 'BIGSERIAL PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT'},
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  coins BIGINT NOT NULL,
  ref TEXT UNIQUE,
  amount_cents BIGINT,
  created_at BIGINT NOT NULL
);`;

const num = (v: unknown) => (v == null ? v : Number(v)) as number;
const normUser = (r: any): UserRow | undefined => r && { ...r, id: num(r.id), coins: num(r.coins), last_daily_at: num(r.last_daily_at), total_bet: num(r.total_bet), total_won: num(r.total_won) };

async function pgStore(url: string): Promise<Store> {
  const { default: pg } = await import('pg');
  const local = /@(localhost|127\.0\.0\.1|[a-z0-9-]+)(:\d+)?\//.test(url) && !url.includes('.render.com');
  const pool = new pg.Pool({ connectionString: url, max: 8, ssl: local ? undefined : { rejectUnauthorized: false } });
  await pool.query(SCHEMA(true));
  const one = async (sql: string, args: unknown[]) => (await pool.query(sql, args)).rows[0];
  return {
    kind: 'postgres',
    getUser: async id => normUser(await one('SELECT * FROM users WHERE id = $1', [id])),
    findByEmail: async email => { const r = await one('SELECT id, pass_hash FROM users WHERE email = $1', [email]); return r && { id: num(r.id), pass_hash: r.pass_hash }; },
    createUser: async (email, hash, now) => { const r = await one('INSERT INTO users (email, pass_hash, coins, age_confirmed_at, last_daily_at, created_at) VALUES ($1,$2,0,$3,$3,$3) ON CONFLICT (email) DO NOTHING RETURNING id', [email, hash, now]); return r ? num(r.id) : null; },
    createSession: async (h, uid, exp) => { await pool.query('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1,$2,$3)', [h, uid, exp]); },
    sessionUser: async (h, now) => { const r = await one('SELECT user_id FROM sessions WHERE token_hash = $1 AND expires_at > $2', [h, now]); return r ? num(r.user_id) : null; },
    deleteSession: async h => { await pool.query('DELETE FROM sessions WHERE token_hash = $1', [h]); },
    debit: async (uid, amt) => { const r = await one('UPDATE users SET coins = coins - $1, total_bet = total_bet + $1 WHERE id = $2 AND coins >= $1 RETURNING coins', [amt, uid]); return r ? num(r.coins) : null; },
    add: async (uid, amt, kind) => num((await one(`UPDATE users SET coins = coins + $1${kind === 'win' ? ', total_won = total_won + $1' : kind === 'refund' ? ', total_bet = total_bet - $1' : ''} WHERE id = $2 RETURNING coins`, [amt, uid])).coins),
    grant: async (uid, kind, coins, ref, cents) => {
      const c = await pool.connect();
      try {
        await c.query('BEGIN');
        const ins = await c.query('INSERT INTO ledger (user_id, kind, coins, ref, amount_cents, created_at) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (ref) DO NOTHING RETURNING id', [uid, kind, coins, ref, cents, Date.now()]);
        if (!ins.rowCount) { await c.query('ROLLBACK'); return false; }
        await c.query('UPDATE users SET coins = coins + $1 WHERE id = $2', [coins, uid]);
        await c.query('COMMIT'); return true;
      } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
    },
    claimDaily: async (uid, coins, interval) => {
      const c = await pool.connect();
      try {
        await c.query('BEGIN');
        const now = Date.now();
        const upd = await c.query('UPDATE users SET last_daily_at = $1, coins = coins + $2 WHERE id = $3 AND last_daily_at <= $4', [now, coins, uid, now - interval]);
        if (!upd.rowCount) { await c.query('ROLLBACK'); return false; }
        await c.query('INSERT INTO ledger (user_id, kind, coins, created_at) VALUES ($1,$2,$3,$4)', [uid, 'daily', coins, now]);
        await c.query('COMMIT'); return true;
      } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
    },
  };
}

function sqliteStore(): Store {
  const Database = createRequire(import.meta.url)('better-sqlite3');
  const file = process.env.DB_PATH || path.resolve('data/hangover-reef.sqlite');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma('journal_mode = WAL'); db.pragma('foreign_keys = ON');
  db.exec(SCHEMA(false));
  const ins = db.prepare('INSERT INTO ledger (user_id, kind, coins, ref, amount_cents, created_at) VALUES (?, ?, ?, ?, ?, ?)');
  const credit = db.prepare('UPDATE users SET coins = coins + ? WHERE id = ?');
  const grantTx = db.transaction((uid: number, kind: string, coins: number, ref: string | null, cents: number | null) => {
    if (ref && db.prepare('SELECT 1 FROM ledger WHERE ref = ?').get(ref)) return false;
    ins.run(uid, kind, coins, ref, cents, Date.now()); credit.run(coins, uid); return true;
  });
  const dailyTx = db.transaction((uid: number, coins: number, interval: number) => {
    const now = Date.now();
    const r = db.prepare('UPDATE users SET last_daily_at = ?, coins = coins + ? WHERE id = ? AND last_daily_at <= ?').run(now, coins, uid, now - interval);
    if (!r.changes) return false;
    ins.run(uid, 'daily', coins, null, null, now); return true;
  });
  return {
    kind: 'sqlite',
    getUser: async id => normUser(db.prepare('SELECT * FROM users WHERE id = ?').get(id)),
    findByEmail: async email => db.prepare('SELECT id, pass_hash FROM users WHERE email = ?').get(email),
    createUser: async (email, hash, now) => { const r = db.prepare('INSERT OR IGNORE INTO users (email, pass_hash, coins, age_confirmed_at, last_daily_at, created_at) VALUES (?, ?, 0, ?, ?, ?)').run(email, hash, now, now, now); return r.changes ? Number(r.lastInsertRowid) : null; },
    createSession: async (h, uid, exp) => { db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)').run(h, uid, exp); },
    sessionUser: async (h, now) => db.prepare('SELECT user_id FROM sessions WHERE token_hash = ? AND expires_at > ?').get(h, now)?.user_id ?? null,
    deleteSession: async h => { db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(h); },
    debit: async (uid, amt) => db.prepare('UPDATE users SET coins = coins - ?, total_bet = total_bet + ? WHERE id = ? AND coins >= ? RETURNING coins').get(amt, amt, uid, amt)?.coins ?? null,
    add: async (uid, amt, kind) => db.prepare(`UPDATE users SET coins = coins + ?${kind === 'win' ? ', total_won = total_won + ?' : kind === 'refund' ? ', total_bet = total_bet - ?' : ''} WHERE id = ? RETURNING coins`).get(...(kind === 'plain' ? [amt, uid] : [amt, amt, uid])).coins,
    grant: async (uid, kind, coins, ref, cents) => grantTx(uid, kind, coins, ref, cents),
    claimDaily: async (uid, coins, interval) => dailyTx(uid, coins, interval),
  };
}

export const store: Store = process.env.DATABASE_URL ? await pgStore(process.env.DATABASE_URL) : sqliteStore();
console.log(`[db] using ${store.kind}`);

export const getUser = (id: number) => store.getUser(id);
export const getBalance = async (id: number) => (await store.getUser(id))?.coins ?? 0;
export const grant = (userId: number, kind: string, coins: number, ref: string | null = null, amountCents: number | null = null) => store.grant(userId, kind, coins, ref, amountCents);
