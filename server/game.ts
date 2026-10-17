import { WebSocketServer, type WebSocket } from 'ws';
import type { IncomingMessage, Server } from 'node:http';
import crypto from 'node:crypto';
import { FISH, ROOMS, RTP, WHALE_AVG, WHALE_MULTS, WORLD_W, WORLD_H, type FishKind, type SpawnFish, type ClientMsg, type ServerMsg, type Vec } from '../shared/config.js';
import { store, getBalance } from './db.js';
import { parseCookie, userFromToken, SESSION_COOKIE } from './auth.js';

const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const rint = (a: number, b: number) => Math.floor(rnd(a, b + 1));
const secureRoll = () => crypto.randomInt(0, 1_000_000_000) / 1_000_000_000;

interface LiveFish { kind: FishKind; aliveFrom: number; aliveUntil: number; dead: boolean }
interface Bullet { bet: number; at: number }

function makePath(kind: FishKind): [Vec, Vec, Vec, Vec] {
  const m = FISH[kind].size * 0.75 + 230; // start well off-screen (phones are wider than 16:9)
  const big = kind === 'whale' || kind === 'shark' || kind === 'turtle';
  const side = Math.random() * (big ? 0.84 : 1); // big creatures only cross horizontally
  let a: Vec, d: Vec;
  if (side < 0.42) { a = [-m, rnd(120, 720)]; d = [WORLD_W + m, rnd(120, 720)]; }
  else if (side < 0.84) { a = [WORLD_W + m, rnd(120, 720)]; d = [-m, rnd(120, 720)]; }
  else if (side < 0.92) { a = [rnd(200, 1400), -m]; d = [rnd(200, 1400), WORLD_H + m]; }
  else { a = [rnd(200, 1400), WORLD_H + m]; d = [rnd(200, 1400), -m]; }
  const b: Vec = [a[0] + (d[0] - a[0]) * 0.33 + rnd(-260, 260), rnd(60, 760)];
  const c: Vec = [a[0] + (d[0] - a[0]) * 0.66 + rnd(-260, 260), rnd(60, 760)];
  return [a, b, c, d];
}

const EVENTS: { w: number; make: () => { kind: FishKind; n: number; style: 'school' | 'line' | 'single' } }[] = [
  { w: 20, make: () => ({ kind: 'sardine', n: rint(6, 11), style: 'school' }) },
  { w: 10, make: () => ({ kind: 'seahorse', n: rint(3, 5), style: 'line' }) },
  { w: 14, make: () => ({ kind: 'clownfish', n: rint(3, 6), style: 'line' }) },
  { w: 12, make: () => ({ kind: 'puffer', n: rint(1, 3), style: 'line' }) },
  { w: 9, make: () => ({ kind: 'crab', n: rint(1, 2), style: 'line' }) },
  { w: 7, make: () => ({ kind: 'jelly', n: rint(1, 3), style: 'school' }) },
  { w: 5, make: () => ({ kind: 'turtle', n: 1, style: 'single' }) },
  { w: 4, make: () => ({ kind: 'octopus', n: 1, style: 'single' }) },
  { w: 3, make: () => ({ kind: 'shark', n: 1, style: 'single' }) },
  { w: 1.6, make: () => ({ kind: 'lobster', n: 1, style: 'single' }) },
];
const EVENT_W = EVENTS.reduce((s, e) => s + e.w, 0);
const KIND_CAP: Partial<Record<FishKind, number>> = { turtle: 2, octopus: 2, shark: 2, lobster: 1, whale: 1, jelly: 6, crab: 5 };

class Table {
  fish = new Map<number, LiveFish>();
  bullets = new Map<number, Bullet>();
  nextFid = 1; nextBid = 1;
  nextBossAt = Date.now() + (Number(process.env.BOSS_FIRST_MS) || rnd(25000, 40000));
  lastEvent = 0;
  tokens = 15; lastRefill = Date.now();
  timer: NodeJS.Timeout;
  room = ROOMS[0];

  constructor(private ws: WebSocket, private userId: number) {
    this.timer = setInterval(() => this.tick(), 350);
  }

  send(m: ServerMsg) { if (this.ws.readyState === this.ws.OPEN) this.ws.send(JSON.stringify(m)); }

  alive(now = Date.now()) { let n = 0; const k: Record<string, number> = {}; for (const f of this.fish.values()) if (!f.dead && f.aliveUntil > now) { n++; k[f.kind] = (k[f.kind] || 0) + 1; } return { n, k }; }

  spawnGroup(kind: FishKind, n: number, style: 'school' | 'line' | 'single', age = 0): SpawnFish[] {
    const def = FISH[kind];
    const p = makePath(kind);
    const dur = rnd(def.speed[0], def.speed[1]);
    const out: SpawnFish[] = [];
    const now = Date.now();
    for (let i = 0; i < n; i++) {
      let off: Vec = [0, 0], delay = 0;
      if (style === 'school') { const ang = i * 2.4, r = 18 * Math.sqrt(i) * (def.size / 60); off = [Math.cos(ang) * r, Math.sin(ang) * r]; delay = rnd(0, 500); }
      else if (style === 'line') { delay = i * (def.size * 13); off = [rnd(-10, 10), rnd(-10, 10)]; }
      const sf: SpawnFish = { id: this.nextFid++, kind, p, off, dur, delay };
      const start = now - age + delay;
      this.fish.set(sf.id, { kind, aliveFrom: start - 300, aliveUntil: start + dur + 1500, dead: false });
      out.push(sf);
    }
    return out;
  }

  pickEvent() {
    const { k } = this.alive();
    for (let tries = 0; tries < 8; tries++) {
      let r = Math.random() * EVENT_W;
      for (const e of EVENTS) { r -= e.w; if (r <= 0) { const ev = e.make(); const cap = KIND_CAP[ev.kind]; if (cap && (k[ev.kind] || 0) + ev.n > cap) break; return ev; } }
    }
    return { kind: 'clownfish' as FishKind, n: 3, style: 'line' as const };
  }

  async join(roomId: string) {
    const room = ROOMS.find(r => r.id === roomId);
    if (!room) return this.send({ t: "error", reason: "Unknown room" });
    if ((await getBalance(this.userId)) < room.minBalance) return this.send({ t: 'error', reason: `You need at least ${room.minBalance.toLocaleString()} coins for ${room.name}` });
    this.room = room;
    await this.refundAll();
    this.fish.clear();
    this.nextBossAt = Date.now() + (Number(process.env.BOSS_FIRST_MS) || rnd(25000, 40000));
    // prefill the ocean so the table looks busy immediately
    const fish: (SpawnFish & { age: number })[] = [];
    for (let i = 0; i < 16; i++) {
      const ev = this.pickEvent();
      const age = rnd(1000, FISH[ev.kind].speed[0] * 0.8);
      for (const f of this.spawnGroup(ev.kind, ev.n, ev.style, age)) fish.push({ ...f, age });
    }
    this.send({ t: 'joined', room: room.id, balance: await getBalance(this.userId), fish });
  }

  tick() {
    const now = Date.now();
    for (const [id, f] of this.fish) if (f.aliveUntil < now - 5000) this.fish.delete(id);
    for (const [id, b] of this.bullets) if (b.at < now - 120000) this.bullets.delete(id); // stale, never hit
    if (now >= this.nextBossAt && !(this.alive().k.whale)) {
      this.nextBossAt = now + rnd(80000, 110000);
      return this.send({ t: 'spawn', fish: this.spawnGroup('whale', 1, 'single'), boss: true });
    }
    const { n } = this.alive();
    if (n < 75 && now - this.lastEvent > (n < 45 ? 300 : 700)) {
      this.lastEvent = now;
      const ev = this.pickEvent();
      this.send({ t: 'spawn', fish: this.spawnGroup(ev.kind, ev.n, ev.style) });
    }
  }

  inflight = 0;
  async fire(bet: number, cid: number) {
    const now = Date.now();
    this.tokens = Math.min(15, this.tokens + (now - this.lastRefill) / 1000 * 10); this.lastRefill = now;
    const reject = async (reason: string) => this.send({ t: 'reject', cid, reason, balance: await getBalance(this.userId) });
    if (this.tokens < 1) return reject('rate');
    if (!this.room.bets.includes(bet)) return reject('bad bet');
    if (this.bullets.size + this.inflight >= 40) return reject('too many bullets');
    this.tokens -= 1; this.inflight++;
    let balance: number | null;
    try { balance = await store.debit(this.userId, bet); } finally { this.inflight--; }
    if (balance === null) return reject('coins');
    const bid = this.nextBid++;
    this.bullets.set(bid, { bet, at: now });
    this.send({ t: 'fired', cid, bid, balance });
  }

  async hit(bid: number, fid: number) {
    const b = this.bullets.get(bid);
    if (!b) return; // unknown or already used
    const f = this.fish.get(fid);
    const now = Date.now();
    if (!f || f.dead || now < f.aliveFrom || now > f.aliveUntil) return; // keep the bullet; client will keep bouncing it
    this.bullets.delete(bid);
    const isWhale = f.kind === 'whale';
    const pKill = RTP / (isWhale ? WHALE_AVG : FISH[f.kind].mult);
    const killed = secureRoll() < pKill;
    let mult = 0, payout = 0, balance: number;
    if (killed) {
      f.dead = true; // marked before any await so a fish can only die once
      mult = isWhale ? pickWhaleMult() : FISH[f.kind].mult;
      payout = b.bet * mult;
      balance = await store.add(this.userId, payout, 'win');
    } else balance = await getBalance(this.userId);
    this.send({ t: 'hit', bid, fid, killed, mult, payout, balance });
  }

  async refundAll() {
    let sum = 0; for (const b of this.bullets.values()) sum += b.bet;
    this.bullets.clear();
    if (sum > 0) await store.add(this.userId, sum, 'refund');
  }

  close() { clearInterval(this.timer); this.refundAll().catch(e => console.error('[game] refund failed', e)); }
}

function pickWhaleMult() {
  const total = WHALE_MULTS.reduce((s, m) => s + m.weight, 0);
  let r = secureRoll() * total;
  for (const m of WHALE_MULTS) { r -= m.weight; if (r <= 0) return m.mult; }
  return WHALE_MULTS[0].mult;
}

export function attachGame(server: Server) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 4096 });
  const active = new Map<number, WebSocket>();
  server.on('upgrade', (req: IncomingMessage, socket, head) => {
    if (!req.url?.startsWith('/ws')) return;
    const origin = req.headers.origin; const host = req.headers.host;
    if (origin && host && new URL(origin).host !== host && !(process.env.ALLOWED_ORIGINS || '').split(',').includes(origin)) { socket.destroy(); return; }
    userFromToken(parseCookie(req.headers.cookie, SESSION_COOKIE)).then(uid => {
    if (!uid) { socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n'); socket.destroy(); return; }
    wss.handleUpgrade(req, socket, head, ws => {
      active.get(uid)?.close(4000, 'opened elsewhere'); // one table per account
      active.set(uid, ws);
      const table = new Table(ws, uid);
      ws.on('message', raw => {
        let m: ClientMsg; try { m = JSON.parse(String(raw)); } catch { return; }
        const p = m.t === 'join' && typeof m.room === 'string' ? table.join(m.room)
          : m.t === 'fire' && Number.isInteger(m.bet) && Number.isInteger(m.cid) ? table.fire(m.bet, m.cid)
          : m.t === 'hit' && Number.isInteger(m.bid) && Number.isInteger(m.fid) ? table.hit(m.bid, m.fid) : null;
        p?.catch(e => { console.error('[game]', e); table.send({ t: 'error', reason: 'Server hiccup, please rejoin' }); });
      });
      ws.on('close', () => { table.close(); if (active.get(uid) === ws) active.delete(uid); });
    });
    }).catch(() => socket.destroy());
  });
}
