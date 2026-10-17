import { Application, Assets, Container, Sprite, MeshPlane, Text, Texture, TilingSprite, Graphics, BlurFilter, type TextStyleOptions } from 'pixi.js';
import { FISH, WORLD_W, WORLD_H, bezier, type FishKind, type RoomDef, type ServerMsg, type SpawnFish, type Vec } from '../../shared/config';
import { makeTextures, type Tex } from './textures';
import { sfx } from './audio';
import { h, icons, fmt, uiRoot, toast } from './ui';

interface Hooks { onBalance(c: number): void; onExit(): void; onShop(): void; onPaytable(): void; onError(msg: string): void }

const WAVY: Partial<Record<FishKind, { amp: number; freq: number; k: number }>> = {
  sardine: { amp: 0.09, freq: 11, k: 5 }, clownfish: { amp: 0.08, freq: 9, k: 4.5 }, shark: { amp: 0.06, freq: 5, k: 4 },
  whale: { amp: 0.045, freq: 2.6, k: 3.2 }, puffer: { amp: 0.035, freq: 7, k: 3 }, turtle: { amp: 0.03, freq: 3, k: 3 },
};
const FLIP_X: FishKind[] = ['lobster', 'seahorse'];
const SPECIAL: Partial<Record<FishKind, number>> = { octopus: 0x66ffcc, shark: 0x66ccff, lobster: 0xff5577, whale: 0xffd34d, jelly: 0xff66ff };
const BULLET_TINT: Record<string, number> = { happy: 0x8ff3ff, bottle: 0xff9ae0, vip: 0xffe27a };
const QUIPS = ['CUT OFF!', 'LAST CALL!', 'BLACKOUT!', 'TAB CLOSED!', 'HYDRATE!', 'NO REGRETS!', 'SHOTS!', 'WASTED!'];
const BIG_QUIPS: Partial<Record<FishKind, string>> = { whale: 'SOBER AT LAST!', lobster: 'BEAT DROPPED!', shark: 'SPRING BROKE!' };

interface Fish {
  id: number; kind: FishKind; p: [Vec, Vec, Vec, Vec]; off: Vec; dur: number; start: number;
  node: Container; body: Sprite | MeshPlane; shadow: Sprite; aura?: Sprite; rays?: Sprite; base?: Float32Array;
  x: number; y: number; ang: number; scale: number; phase: number; flash: number; dying: number; visible: boolean;
}
interface Bullet { cid: number; bid?: number; bet: number; x: number; y: number; vx: number; vy: number; s: Sprite; lock?: number; age: number; done?: boolean }
interface Fx { update(dt: number): boolean }

const textStyle = (size: number, fill = '#ffe066', stroke = '#5a1d00'): TextStyleOptions => ({
  fontFamily: 'Lilita One', fontSize: size, fill, stroke: { color: stroke, width: Math.max(4, size / 7), join: 'round' },
  dropShadow: { color: '#000000', alpha: 0.55, blur: 4, distance: Math.max(3, size / 14), angle: Math.PI / 2 }, align: 'center',
});

export class Game {
  app = new Application();
  tex!: Tex; fishTex = {} as Record<FishKind, Texture>;
  world = new Container(); shake = new Container();
  bg = new Container(); shadowLayer = new Container(); fishLayer = new Container(); bulletLayer = new Container();
  fxLayer = new Container(); uiLayer = new Container(); topLayer = new Container();
  bgSprite!: Sprite; water!: Sprite; vignette!: Sprite; caustics: TilingSprite[] = []; beams: Sprite[] = []; bubbles: { s: Sprite; v: number; w: number }[] = [];
  cannon = new Container(); cannonGun!: Sprite; muzzle!: Sprite; betText!: Text; reticle!: Sprite; lockLine = new Graphics(); flash!: Sprite;
  fish = new Map<number, Fish>(); bullets: Bullet[] = []; fx: Fx[] = [];
  view = { x0: 0, y0: 0, x1: WORLD_W, y1: WORLD_H }; scale = 1;
  ws: WebSocket | null = null; room!: RoomDef; hooks!: Hooks;
  betIdx = 0; serverBalance = 0; pending = 0; shownBalance = 0;
  auto = false; lockMode = false; lockId: number | null = null; holding = false; aim: Vec = [800, 400];
  lastShot = 0; cid = 1; sentAt = new Map<number, number>(); ping = 0; pendingHits = new Map<number, number>();
  shakeT = 0; shakeAmp = 0; time = 0; running = false; recoil = 0;
  hud: HTMLElement | null = null; el: Record<string, HTMLElement> = {};

  async init(parent: HTMLElement) {
    await this.app.init({ resizeTo: window, antialias: false, backgroundColor: 0x031629, resolution: Math.min(window.devicePixelRatio || 1, 2), autoDensity: true, powerPreference: 'high-performance' });
    parent.appendChild(this.app.canvas);
    await document.fonts.load('40px "Lilita One"').catch(() => {});
    const kinds = Object.keys(FISH) as FishKind[];
    const loaded = await Assets.load([...kinds.map(k => `/assets/${k}.png`), '/assets/bg.jpg', '/assets/cannon.png']);
    for (const k of kinds) this.fishTex[k] = loaded[`/assets/${k}.png`];
    this.tex = makeTextures();

    this.app.stage.addChild(this.world);
    this.world.addChild(this.shake);
    this.shake.addChild(this.bg, this.shadowLayer, this.fishLayer, this.bulletLayer, this.fxLayer, this.uiLayer, this.topLayer);
    this.fishLayer.sortableChildren = true;
    this.shadowLayer.filters = [new BlurFilter({ strength: 5, quality: 2, resolution: 0.5 })];
    this.shadowLayer.alpha = 0.5;

    // ---- background ----
    this.bgSprite = new Sprite(loaded['/assets/bg.jpg']); this.bgSprite.anchor.set(0.5); this.bgSprite.tint = 0x9fbfdc;
    this.water = new Sprite(this.tex.water);
    for (let i = 0; i < 2; i++) { const c = new TilingSprite({ texture: this.tex.caustic, width: 2400, height: 1400 }); c.blendMode = 'add'; c.alpha = i ? 0.10 : 0.14; c.tileScale.set(i ? 1.6 : 1.1); c.tint = 0xbfffff; this.caustics.push(c); }
    this.bg.addChild(this.bgSprite, ...this.caustics, this.water);
    for (let i = 0; i < 5; i++) { const b = new Sprite(this.tex.beam); b.anchor.set(0.5, 0); b.blendMode = 'add'; b.alpha = 0.18; b.scale.set(2.2 + Math.random() * 1.5, 2.2); b.x = 150 + i * 330; b.y = -80; b.rotation = 0.25 - i * 0.1; this.beams.push(b); this.bg.addChild(b); }
    for (let i = 0; i < 34; i++) { const s = new Sprite(this.tex.bubble); s.anchor.set(0.5); s.scale.set(0.12 + Math.random() * 0.35); s.alpha = 0.6; s.x = Math.random() * WORLD_W; s.y = Math.random() * WORLD_H; this.bubbles.push({ s, v: 30 + Math.random() * 60, w: Math.random() * 6 }); this.bg.addChild(s); }
    this.vignette = new Sprite(this.tex.vignette);
    this.topLayer.addChild(this.vignette);

    // ---- cannon ----
    const base = new Graphics();
    base.ellipse(0, 26, 150, 52).fill({ color: 0x2a1200 }).ellipse(0, 22, 142, 46).fill({ color: 0xb8730f }).ellipse(0, 18, 132, 40).fill({ color: 0xffd34d }).ellipse(0, 18, 118, 33).fill({ color: 0x0b2b66 }).ellipse(0, 16, 110, 28).fill({ color: 0x154a9a });
    const baseGlow = new Sprite(this.tex.glow); baseGlow.anchor.set(0.5); baseGlow.scale.set(1.6, 0.5); baseGlow.y = 10; baseGlow.tint = 0x33ccff; baseGlow.blendMode = 'add'; baseGlow.alpha = 0.6;
    this.cannonGun = new Sprite(loaded['/assets/cannon.png']); this.cannonGun.anchor.set(0.5, 0.7);
    this.cannonGun.scale.set(210 / this.cannonGun.texture.height);
    this.muzzle = new Sprite(this.tex.glow); this.muzzle.anchor.set(0.5); this.muzzle.blendMode = 'add'; this.muzzle.alpha = 0; this.muzzle.tint = 0xffdd66;
    const plate = new Graphics().roundRect(-46, 36, 92, 34, 12).fill({ color: 0x3a1a00 }).roundRect(-43, 38, 86, 29, 10).fill({ color: 0xffd34d }).roundRect(-40, 40, 80, 25, 9).fill({ color: 0x0a2050 });
    this.betText = new Text({ text: '1', style: textStyle(24, '#ffe066', '#3a1a00') }); this.betText.anchor.set(0.5); this.betText.y = 52;
    this.cannon.addChild(baseGlow, base, this.cannonGun, this.muzzle, plate, this.betText);
    this.reticle = new Sprite(this.tex.reticle); this.reticle.anchor.set(0.5); this.reticle.visible = false;
    this.flash = new Sprite(Texture.WHITE); this.flash.alpha = 0; this.flash.blendMode = 'add';
    this.uiLayer.addChild(this.lockLine, this.reticle, this.cannon);
    this.topLayer.addChild(this.flash);

    window.addEventListener('resize', () => this.layout());
    this.layout();
    const cvs = this.app.canvas;
    cvs.addEventListener('pointerdown', e => this.onDown(e));
    cvs.addEventListener('pointermove', e => { this.aim = this.toWorld(e); });
    window.addEventListener('pointerup', () => { this.holding = false; });
    window.addEventListener('pointercancel', () => { this.holding = false; });
    this.app.ticker.add(t => this.update(Math.min(t.deltaMS, 50) / 1000));
    this.app.ticker.stop();
  }

  layout() {
    const sw = this.app.screen.width, sh = this.app.screen.height;
    this.scale = Math.min(sw / WORLD_W, sh / WORLD_H);
    this.world.scale.set(this.scale);
    this.world.x = (sw - WORLD_W * this.scale) / 2; this.world.y = (sh - WORLD_H * this.scale) / 2;
    const v = this.view = { x0: -this.world.x / this.scale, y0: -this.world.y / this.scale, x1: (sw - this.world.x) / this.scale, y1: (sh - this.world.y) / this.scale };
    const vw = v.x1 - v.x0, vh = v.y1 - v.y0;
    const bs = Math.max(vw / this.bgSprite.texture.width, vh / this.bgSprite.texture.height) * 1.04;
    this.bgSprite.scale.set(bs); this.bgSprite.position.set((v.x0 + v.x1) / 2, (v.y0 + v.y1) / 2);
    this.water.position.set(v.x0, v.y0); this.water.width = vw; this.water.height = vh;
    this.vignette.position.set(v.x0, v.y0); this.vignette.width = vw; this.vignette.height = vh;
    this.flash.position.set(v.x0, v.y0); this.flash.width = vw; this.flash.height = vh;
    for (const c of this.caustics) { c.position.set(v.x0 - 200, v.y0 - 200); c.width = vw + 400; c.height = vh + 400; }
    this.cannon.position.set(WORLD_W / 2, v.y1 - 72);
    document.documentElement.style.setProperty('--hs', String(Math.max(0.62, Math.min(1.15, sh / 760))));
  }

  toWorld(e: PointerEvent): Vec {
    const r = this.app.canvas.getBoundingClientRect();
    return [(e.clientX - r.left - this.world.x) / this.scale, (e.clientY - r.top - this.world.y) / this.scale];
  }

  // ---------------- lifecycle ----------------
  enter(room: RoomDef, balance: number, hooks: Hooks) {
    this.room = room; this.hooks = hooks; this.betIdx = 0; this.serverBalance = this.shownBalance = balance; this.pending = 0;
    this.auto = false; this.lockMode = false; this.lockId = null;
    this.clearAll();
    this.buildHud();
    this.app.canvas.style.visibility = 'visible';
    this.running = true; this.app.ticker.start();
    sfx.startMusic();
    this.connect();
  }

  leave(): Promise<void> {
    if (!this.running) return Promise.resolve();
    const ws = this.ws;
    const closed = new Promise<void>(res => { if (!ws || ws.readyState === WebSocket.CLOSED) return res(); ws.addEventListener('close', () => res()); setTimeout(res, 1200); });
    this.running = false; ws?.close(); this.ws = null; this.app.ticker.stop(); sfx.stopMusic();
    this.hud?.remove(); this.hud = null; this.app.canvas.style.visibility = 'hidden';
    return closed;
  }

  connect() {
    const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
    this.ws = ws;
    ws.onopen = () => ws.send(JSON.stringify({ t: 'join', room: this.room.id }));
    ws.onmessage = ev => this.onMsg(JSON.parse(ev.data));
    ws.onclose = e => {
      if (this.ws !== ws || !this.running) return;
      this.hooks.onError(e.code === 4000 ? 'Opened in another tab' : 'Connection lost. Back to the lobby.');
      this.leave(); this.hooks.onExit();
    };
  }
  send(m: object) { if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m)); }

  setBalance(c: number) { this.serverBalance = c; }
  get balance() { return this.serverBalance - this.pending; }
  get bet() { return this.room.bets[this.betIdx]; }

  onMsg(m: ServerMsg) {
    const now = performance.now();
    switch (m.t) {
      case 'joined':
        this.clearAll(); this.serverBalance = m.balance; this.shownBalance = m.balance;
        for (const f of m.fish) this.addFish(f, now - f.age);
        break;
      case 'spawn':
        for (const f of m.fish) this.addFish(f, now);
        if (m.boss) this.bossWarning();
        break;
      case 'fired': {
        const b = this.bullets.find(x => x.cid === m.cid);
        this.pending -= this.pendingBetFor(m.cid);
        this.serverBalance = m.balance;
        const t0 = this.sentAt.get(m.cid); if (t0) { const p = now - t0; this.ping = this.ping ? this.ping * 0.8 + p * 0.2 : p; this.sentAt.delete(m.cid); }
        this.cidBets.delete(m.cid);
        if (b) b.bid = m.bid;
        const fid = this.pendingHits.get(m.cid);
        if (fid !== undefined) { this.pendingHits.delete(m.cid); this.send({ t: 'hit', bid: m.bid, fid }); }
        break;
      }
      case 'reject': {
        if (m.cid !== undefined) {
          this.pending -= this.pendingBetFor(m.cid); this.cidBets.delete(m.cid); this.pendingHits.delete(m.cid);
          const b = this.bullets.find(x => x.cid === m.cid); if (b) b.done = true;
        }
        this.serverBalance = m.balance;
        if (m.reason === 'coins') this.outOfCoins();
        break;
      }
      case 'hit': {
        this.serverBalance = m.balance;
        const f = this.fish.get(m.fid);
        if (m.killed && f) this.killFish(f, m.mult, m.payout);
        break;
      }
      case 'error': this.hooks.onError(m.reason); this.leave(); this.hooks.onExit(); break;
    }
  }
  cidBets = new Map<number, number>();
  pendingBetFor(cid: number) { return this.cidBets.get(cid) ?? 0; }

  clearAll() {
    for (const f of this.fish.values()) this.removeFish(f);
    this.fish.clear();
    for (const b of this.bullets) b.s.destroy(); this.bullets = [];
    this.fxLayer.removeChildren().forEach(c => c.destroy()); this.fx = [];
    this.pendingHits.clear(); this.cidBets.clear(); this.pending = 0;
  }

  // ---------------- HUD (DOM) ----------------
  buildHud() {
    this.hud?.remove();
    const btn = (cls: string, html: string, label: string, on: () => void) => { const b = h('button', { class: cls, html: html + (label ? `<span>${label}</span>` : ''), onclick: (e: Event) => { e.stopPropagation(); sfx.click(); on(); } }); return b; };
    const autoB = btn('hbtn', icons.auto, 'AUTO', () => { this.auto = !this.auto; autoB.classList.toggle('on', this.auto); });
    const lockB = btn('hbtn', icons.lock, 'LOCK', () => { this.lockMode = !this.lockMode; lockB.classList.toggle('on', this.lockMode); if (!this.lockMode) this.lockId = null; else this.autoLock(); });
    const coinsVal = h('span', { class: 'val' }, fmt(this.balance));
    const betVal = h('span', { class: 'val' }, fmt(this.bet));
    const ping = h('span', {}, '--ms');
    const sound = btn('iconbtn', sfx.muted ? icons.mute : icons.sound, '', () => { sfx.setMuted(!sfx.muted); sound.innerHTML = sfx.muted ? icons.mute : icons.sound; });
    this.el = { coinsVal, betVal, ping };
    this.hud = h('div', { class: 'hud' },
      btn('back', icons.back, '', async () => { await this.leave(); this.hooks.onExit(); }),
      h('div', { class: 'topl' }, h('div', { class: 'ping', html: icons.wifi }, ping), h('div', { class: 'ping' }, this.room.name.toUpperCase())),
      h('div', { class: 'topr' }, btn('iconbtn', icons.info, '', () => this.hooks.onPaytable()), sound),
      h('div', { class: 'right' }, autoB, lockB, btn('hbtn small', '+', '', () => this.changeBet(1)), btn('hbtn small', '−', '', () => this.changeBet(-1))),
      h('div', { class: 'seatbox coins' }, h('div', { class: 'coin' }), h('span', { class: 'lbl' }, 'COINS'), coinsVal, btn('plus', '+', '', () => this.hooks.onShop())),
      h('div', { class: 'seatbox bet' }, btn('betbtn', '−', '', () => this.changeBet(-1)), h('span', { class: 'lbl' }, 'BET'), betVal, btn('betbtn', '+', '', () => this.changeBet(1))));
    uiRoot.append(this.hud);
    this.betText.text = fmt(this.bet);
  }

  changeBet(d: number) {
    this.betIdx = (this.betIdx + d + this.room.bets.length) % this.room.bets.length;
    this.el.betVal.textContent = fmt(this.bet); this.betText.text = fmt(this.bet);
    this.cannonGun.scale.set((210 + this.betIdx * 6) / this.cannonGun.texture.height);
  }

  outOfCoins() {
    this.auto = false; this.hud?.querySelector('.hbtn')?.classList.remove('on');
    if (this.hud?.querySelector('.broke')) return;
    const box = h('div', { class: 'broke panel' }, h('h2', {}, "You're cut off!"), h('p', { style: 'margin:0 0 16px;color:#cfe6ff' }, `Not enough coins for a ${fmt(this.bet)} shot.`),
      h('div', { style: 'display:flex;gap:16px;justify-content:center;flex-wrap:wrap' },
        h('button', { class: 'gold-btn pink', onclick: () => { box.remove(); this.hooks.onShop(); } }, 'AMMO SHOP'),
        this.betIdx > 0 ? h('button', { class: 'gold-btn', onclick: () => { box.remove(); this.betIdx = 0; this.changeBet(0); } }, 'LOWER BET') : null,
        h('button', { class: 'gold-btn green', onclick: async () => { box.remove(); await this.leave(); this.hooks.onExit(); } }, 'DAILY REFILL')));
    this.hud?.append(box);
  }

  // ---------------- input & firing ----------------
  onDown(e: PointerEvent) {
    sfx.unlock();
    const p = this.toWorld(e); this.aim = p;
    if (this.lockMode) { const f = this.fishAt(p); if (f) { this.lockId = f.id; sfx.click(); return; } }
    this.holding = true;
    this.tryFire(performance.now());
  }
  fishAt(p: Vec) {
    let best: Fish | null = null;
    for (const f of this.fish.values()) if (f.visible && !f.dying && Math.hypot(f.x - p[0], f.y - p[1]) < FISH[f.kind].radius * 1.3) if (!best || FISH[f.kind].mult > FISH[best.kind].mult) best = f;
    return best;
  }
  autoLock() {
    let best: Fish | null = null;
    for (const f of this.fish.values()) if (this.onScreen(f, 60) && !f.dying && f.y < this.cannon.y - 120) if (!best || FISH[f.kind].mult > FISH[best.kind].mult) best = f;
    this.lockId = best?.id ?? null;
  }
  onScreen(f: Fish, pad = 0) { return f.visible && f.x > this.view.x0 + pad && f.x < this.view.x1 - pad && f.y > this.view.y0 + pad && f.y < this.view.y1 - pad; }

  tryFire(now: number) {
    if (now - this.lastShot < 145 || this.bullets.length >= 25) return;
    if (this.balance < this.bet) { if (this.pending === 0) this.outOfCoins(); return; }
    let target = this.aim;
    const lf = this.lockId != null ? this.fish.get(this.lockId) : undefined;
    if (lf) target = [lf.x, lf.y];
    const cx = this.cannon.x, cy = this.cannon.y;
    let ang = Math.atan2(target[1] - cy, target[0] - cx);
    if (ang > -0.08 && ang < Math.PI / 2) ang = -0.08; else if (ang >= Math.PI / 2 || ang < -Math.PI + 0.08) ang = -Math.PI + 0.08;
    this.cannonGun.rotation = ang + Math.PI / 2;
    this.lastShot = now;
    const len = 140, speed = 1450;
    const s = new Sprite(this.tex.bullet); s.anchor.set(0.5); s.blendMode = 'add'; s.tint = BULLET_TINT[this.room.id] ?? 0xffffff; s.scale.set(0.55 + this.betIdx * 0.04);
    const b: Bullet = { cid: this.cid++, bet: this.bet, x: cx + Math.cos(ang) * len, y: cy + Math.sin(ang) * len, vx: Math.cos(ang) * speed, vy: Math.sin(ang) * speed, s, lock: lf?.id, age: 0 };
    this.bulletLayer.addChild(s); this.bullets.push(b);
    this.pending += b.bet; this.cidBets.set(b.cid, b.bet); this.sentAt.set(b.cid, now);
    this.send({ t: 'fire', bet: b.bet, cid: b.cid });
    this.recoil = 1; this.muzzle.alpha = 1;
    sfx.shoot();
  }

  // ---------------- fish ----------------
  addFish(sf: SpawnFish, t0: number) {
    const def = FISH[sf.kind]; const tex = this.fishTex[sf.kind];
    const node = new Container();
    const wavy = WAVY[sf.kind];
    let body: Sprite | MeshPlane, base: Float32Array | undefined;
    if (wavy) {
      const m = new MeshPlane({ texture: tex, verticesX: 10, verticesY: 3 });
      m.pivot.set(tex.width / 2, tex.height / 2);
      base = new Float32Array(m.geometry.buffers[0].data as Float32Array);
      body = m;
    } else { body = new Sprite(tex); body.anchor.set(0.5); }
    const scale = def.size / tex.width;
    const special = SPECIAL[sf.kind];
    let aura: Sprite | undefined, rays: Sprite | undefined;
    if (special !== undefined) {
      if (sf.kind === 'whale') { rays = new Sprite(this.tex.rays); rays.anchor.set(0.5); rays.blendMode = 'add'; rays.alpha = 0.55; rays.scale.set(def.size / 360); node.addChild(rays); }
      aura = new Sprite(this.tex.glow); aura.anchor.set(0.5); aura.tint = special; aura.blendMode = 'add'; aura.alpha = 0.55; aura.scale.set(def.size / 170, def.size / 230); node.addChild(aura);
    }
    node.addChild(body);
    body.scale.set(scale);
    const shadow = new Sprite(tex); shadow.anchor.set(0.5); shadow.tint = 0x001226; shadow.scale.set(scale * 0.94);
    node.zIndex = -def.size + Math.random();
    node.visible = false; shadow.visible = false;
    this.fishLayer.addChild(node); this.shadowLayer.addChild(shadow);
    const f: Fish = { id: sf.id, kind: sf.kind, p: sf.p, off: sf.off, dur: sf.dur, start: t0 + sf.delay, node, body, shadow, aura, rays, base, x: -999, y: -999, ang: 0, scale, phase: Math.random() * 10, flash: 0, dying: 0, visible: false };
    this.fish.set(f.id, f);
  }
  removeFish(f: Fish) { f.node.destroy({ children: true }); f.shadow.destroy(); this.fish.delete(f.id); if (this.lockId === f.id) this.lockId = null; }

  updateFish(f: Fish, now: number, dt: number) {
    const def = FISH[f.kind];
    if (f.dying) {
      f.dying += dt;
      const k = f.dying / 0.9;
      f.node.rotation += dt * (f.kind === 'whale' ? 2 : 9) * (1 - k);
      const s = 1 + Math.sin(Math.min(k, 1) * Math.PI) * 0.25;
      f.node.scale.set(s * (1 - Math.max(0, k - 0.6) * 2.2));
      f.node.alpha = 1 - Math.max(0, k - 0.55) * 2.2;
      f.body.tint = (Math.floor(f.dying * 18) % 2) ? 0xffffff : 0xffe680;
      f.node.x = f.x + (Math.random() - 0.5) * 8; f.node.y = f.y + (Math.random() - 0.5) * 8;
      f.shadow.alpha = f.node.alpha;
      if (k >= 1) this.removeFish(f);
      return;
    }
    const t = (now - f.start) / f.dur;
    if (t > 1) { this.removeFish(f); return; }
    if (t < 0) { f.visible = false; f.node.visible = f.shadow.visible = false; return; }
    f.visible = true; f.node.visible = f.shadow.visible = true;
    const p = bezier(f.p, t), q = bezier(f.p, Math.min(1, t + 0.004));
    f.x = p[0] + f.off[0]; f.y = p[1] + f.off[1];
    const dx = q[0] - p[0], dy = q[1] - p[1];
    const ang = Math.atan2(dy, dx);
    f.phase += dt;
    const left = dx < 0;
    f.node.position.set(f.x, f.y);
    if (def.facing === 'side') {
      f.ang = ang;
      f.node.rotation = ang;
      f.body.scale.y = left ? -f.scale : f.scale;
      f.shadow.rotation = ang; f.shadow.scale.y = (left ? -f.scale : f.scale) * 0.94;
    } else {
      const sway = Math.sin(f.phase * 2.2) * 0.07;
      f.node.rotation = sway; f.shadow.rotation = sway;
      const fx = FLIP_X.includes(f.kind) && left ? -1 : 1;
      let sx = f.scale, sy = f.scale;
      if (f.kind === 'jelly') { const pulse = Math.sin(f.phase * 3.5); sx *= 1 + pulse * 0.06; sy *= 1 - pulse * 0.06; f.node.y += Math.sin(f.phase * 3.5) * 6; }
      else if (f.kind === 'crab') { f.node.rotation = Math.sin(f.phase * 6) * 0.06; }
      else f.node.y += Math.sin(f.phase * 2.6) * 5;
      f.body.scale.set(sx * fx, sy); f.shadow.scale.set(sx * fx * 0.94, sy * 0.94);
    }
    if (f.base) {
      const w = WAVY[f.kind]!; const buf = (f.body as MeshPlane).geometry.buffers[0]; const d = buf.data as Float32Array;
      const tw = f.body.texture.width, th = f.body.texture.height;
      for (let i = 0; i < d.length; i += 2) {
        const u = f.base[i] / tw; const tail = Math.pow(1 - u, 1.6);
        d[i + 1] = f.base[i + 1] + Math.sin(f.phase * w.freq - u * w.k) * th * w.amp * (0.25 + tail);
        d[i] = f.base[i] + Math.cos(f.phase * w.freq - u * w.k) * tw * 0.006;
      }
      buf.update();
    }
    f.shadow.position.set(f.node.x + 16, f.node.y + 30);
    if (f.aura) f.aura.alpha = 0.4 + Math.sin(f.phase * 4) * 0.15;
    if (f.rays) { f.rays.rotation = f.phase * 0.4 - f.node.rotation; }
    if (f.flash > 0) { f.flash -= dt; f.body.tint = f.flash > 0 ? 0xffa0a0 : 0xffffff; }
  }

  killFish(f: Fish, mult: number, payout: number) {
    if (f.dying) return;
    f.dying = 0.0001; f.body.tint = 0xffffff;
    if (this.lockId === f.id) this.lockId = null;
    const big = mult >= 100, mid = mult >= 25;
    sfx.kill(mult); if (big) sfx.bigWin();
    this.burst(f.x, f.y, mult);
    this.coins(f.x, f.y, Math.min(40, 3 + Math.round(mult / 3)), big);
    this.floatText(`+${fmt(payout)}`, f.x, f.y - 20, big ? 64 : mid ? 46 : 34);
    if (mid && !big) this.floatText(QUIPS[Math.floor(Math.random() * QUIPS.length)], f.x, f.y - 70, 34, '#ff7ad1', '#4a0030', 0.15);
    if (big) { this.shakeT = 0.9; this.shakeAmp = f.kind === 'whale' ? 20 : 13; this.flash.alpha = 0.55; this.bigWin(f.kind, mult, payout); }
    else if (mid) { this.shakeT = 0.25; this.shakeAmp = 5; }
  }

  // ---------------- FX ----------------
  burst(x: number, y: number, mult: number) {
    const n = Math.min(30, 8 + mult / 4);
    for (let i = 0; i < n; i++) {
      const s = new Sprite(this.tex.spark); s.anchor.set(0.5); s.blendMode = 'add'; s.tint = [0xffe680, 0xffffff, 0xff9ad5, 0x7af0ff][i % 4];
      const a = Math.random() * Math.PI * 2, v = 200 + Math.random() * 500; let vx = Math.cos(a) * v, vy = Math.sin(a) * v, life = 0.5 + Math.random() * 0.4; const L = life;
      s.position.set(x, y); s.scale.set(0.4 + Math.random() * 0.6); this.fxLayer.addChild(s);
      this.fx.push({ update: dt => { life -= dt; s.x += vx * dt; s.y += vy * dt; vx *= 0.92; vy *= 0.92; s.alpha = life / L; s.rotation += dt * 6; if (life <= 0) { s.destroy(); return false; } return true; } });
    }
    const ring = new Sprite(this.tex.glow); ring.anchor.set(0.5); ring.blendMode = 'add'; ring.position.set(x, y); ring.tint = 0xffe680; this.fxLayer.addChild(ring);
    let t = 0; this.fx.push({ update: dt => { t += dt; ring.scale.set(0.3 + t * 5); ring.alpha = 1 - t / 0.35; if (t > 0.35) { ring.destroy(); return false; } return true; } });
  }

  coins(x: number, y: number, n: number, big: boolean) {
    const target = this.coinTarget();
    for (let i = 0; i < n; i++) {
      const s = new Sprite(this.tex.coin); s.anchor.set(0.5); const sc = big ? 0.55 : 0.42; s.scale.set(sc); this.fxLayer.addChild(s);
      const a = Math.random() * Math.PI * 2, v = 120 + Math.random() * (big ? 520 : 260);
      let px = x, py = y, vx = Math.cos(a) * v, vy = Math.sin(a) * v - 120, t = -i * 0.018; const hold = 0.45 + Math.random() * 0.25; let sx = 0, sy = 0; let coinSfx = false;
      this.fx.push({ update: dt => {
        t += dt; if (t < 0) { s.visible = false; return true; } s.visible = true;
        if (t < hold) { px += vx * dt; py += vy * dt; vx *= 0.9; vy = vy * 0.9 + 600 * dt; sx = px; sy = py; }
        else { const k = Math.min(1, (t - hold) / 0.5); const e = k * k * (3 - 2 * k); px = sx + (target[0] - sx) * e; py = sy + (target[1] - sy) * e - Math.sin(k * Math.PI) * 120; s.scale.y = sc * (1 - k * 0.4); if (k >= 1) { if (!coinSfx && i % 4 === 0) sfx.coin(); s.destroy(); this.bumpCoins(); return false; } }
        s.position.set(px, py); s.scale.x = Math.abs(Math.cos(t * 9 + i)) * sc + 0.05; return true;
      } });
    }
  }
  coinTarget(): Vec {
    const el = this.hud?.querySelector('.seatbox.coins .coin') as HTMLElement | null;
    if (!el) return [this.cannon.x - 300, this.cannon.y + 40];
    const r = el.getBoundingClientRect(); const c = this.app.canvas.getBoundingClientRect();
    return [(r.left + r.width / 2 - c.left - this.world.x) / this.scale, (r.top + r.height / 2 - c.top - this.world.y) / this.scale];
  }
  bumpCoins() { const el = this.el.coinsVal?.parentElement; if (el) { el.animate([{ transform: 'scale(1.08)' }, { transform: 'scale(1)' }], { duration: 160 }); } }

  floatText(str: string, x: number, y: number, size: number, fill = '#ffe066', stroke = '#5a1d00', delay = 0) {
    const t = new Text({ text: str, style: textStyle(size, fill, stroke) }); t.anchor.set(0.5); t.position.set(x, y); t.scale.set(0); this.fxLayer.addChild(t);
    let a = -delay;
    this.fx.push({ update: dt => { a += dt; if (a < 0) return true; const pop = a < 0.18 ? (a / 0.18) * 1.25 : a < 0.3 ? 1.25 - (a - 0.18) / 0.12 * 0.25 : 1; t.scale.set(pop); t.y -= dt * 40; t.alpha = a > 1.1 ? 1 - (a - 1.1) / 0.4 : 1; if (a > 1.5) { t.destroy(); return false; } return true; } });
  }

  net(x: number, y: number) {
    const s = new Sprite(this.tex.net); s.anchor.set(0.5); s.position.set(x, y); s.blendMode = 'add'; this.fxLayer.addChild(s);
    const max = 0.55 + this.betIdx * 0.05; let t = 0;
    this.fx.push({ update: dt => { t += dt; const k = t / 0.32; s.scale.set(max * (0.35 + Math.min(1, k * 2) * 0.65)); s.rotation += dt * 2; s.alpha = k < 0.5 ? 1 : 1 - (k - 0.5) * 2; if (k >= 1) { s.destroy(); return false; } return true; } });
  }

  bigWin(kind: FishKind, mult: number, payout: number) {
    const v = this.view; const cx = (v.x0 + v.x1) / 2, cy = WORLD_H * 0.42;
    this.bigWinUntil = performance.now() + 3400;
    const c = new Container(); c.position.set(cx, cy); this.topLayer.addChild(c);
    const rays = new Sprite(this.tex.rays); rays.anchor.set(0.5); rays.blendMode = 'add'; rays.scale.set(1.6); rays.tint = 0xffd34d;
    const glow = new Sprite(this.tex.glow); glow.anchor.set(0.5); glow.blendMode = 'add'; glow.scale.set(3.4, 1.8); glow.tint = 0xff9a2a; glow.alpha = 0.8;
    const pic = new Sprite(this.fishTex[kind]); pic.anchor.set(0.5); pic.scale.set(Math.min(300 / pic.texture.width, 200 / pic.texture.height)); pic.y = -150;
    const title = new Text({ text: BIG_QUIPS[kind] || 'MEGA HANGOVER!', style: textStyle(84, '#ffe066', '#6b1200') }); title.anchor.set(0.5); title.y = 0;
    const amount = new Text({ text: '0', style: textStyle(96, '#ffffff', '#0a3a8a') }); amount.anchor.set(0.5); amount.y = 100;
    const multT = new Text({ text: `${mult}x`, style: textStyle(46, '#ff7ad1', '#4a0030') }); multT.anchor.set(0.5); multT.y = 175;
    c.addChild(glow, rays, pic, title, amount, multT);
    let t = 0;
    this.fx.push({ update: dt => {
      t += dt; const inK = Math.min(1, t / 0.35); const s = inK < 1 ? inK * 1.15 : 1 + Math.sin(t * 5) * 0.02;
      c.scale.set(t > 3.0 ? Math.max(0, 1 - (t - 3) / 0.35) : s); rays.rotation += dt * 0.8;
      amount.text = fmt(payout * Math.min(1, t / 1.8)); pic.y = -150 + Math.sin(t * 4) * 8;
      if (t < 2 && Math.random() < 0.5) this.coins(cx + (Math.random() - 0.5) * 700, cy - 60 + (Math.random() - 0.5) * 200, 1, true);
      if (t > 3.35) { c.destroy({ children: true }); return false; } return true;
    } });
  }

  bigWinUntil = 0;
  bossWarning() {
    const wait = this.bigWinUntil - performance.now();
    if (wait > 0) { setTimeout(() => this.running && this.bossWarning(), wait); return; }
    sfx.boss();
    const v = this.view; const c = new Container(); c.position.set((v.x0 + v.x1) / 2, WORLD_H * 0.42); this.topLayer.addChild(c);
    const band = new Graphics().rect(-1200, -70, 2400, 140).fill({ color: 0x8a0018, alpha: 0.75 }).rect(-1200, -78, 2400, 8).fill({ color: 0xffd34d }).rect(-1200, 70, 2400, 8).fill({ color: 0xffd34d });
    const t1 = new Text({ text: '⚠ WARNING ⚠', style: textStyle(40, '#ffd34d', '#3a0008') }); t1.anchor.set(0.5); t1.y = -32;
    const t2 = new Text({ text: 'THE HANGOVER WHALE IS COMING', style: textStyle(56, '#ffffff', '#3a0008') }); t2.anchor.set(0.5); t2.y = 22;
    c.addChild(band, t1, t2);
    let t = 0;
    this.fx.push({ update: dt => { t += dt; c.alpha = t < 0.2 ? t / 0.2 : t > 2.6 ? Math.max(0, 1 - (t - 2.6) / 0.4) : 0.85 + Math.sin(t * 14) * 0.15; c.scale.y = Math.min(1, t / 0.2); if (t > 3) { c.destroy({ children: true }); return false; } return true; } });
  }

  // ---------------- main loop ----------------
  update(dt: number) {
    if (!this.running) return;
    const now = performance.now(); this.time += dt;
    // background life
    this.caustics[0].tilePosition.x += dt * 14; this.caustics[0].tilePosition.y += dt * 9;
    this.caustics[1].tilePosition.x -= dt * 10; this.caustics[1].tilePosition.y += dt * 6;
    this.beams.forEach((b, i) => { b.alpha = 0.12 + Math.sin(this.time * 0.6 + i * 1.7) * 0.07; b.rotation = 0.25 - i * 0.1 + Math.sin(this.time * 0.3 + i) * 0.05; });
    for (const b of this.bubbles) { b.s.y -= b.v * dt; b.s.x += Math.sin(this.time * 2 + b.w) * 0.4; if (b.s.y < this.view.y0 - 20) { b.s.y = this.view.y1 + 20; b.s.x = this.view.x0 + Math.random() * (this.view.x1 - this.view.x0); } }

    for (const f of [...this.fish.values()]) this.updateFish(f, now, dt);

    // lock target
    if (this.lockMode) { const lf = this.lockId != null ? this.fish.get(this.lockId) : undefined; if (!lf || lf.dying || !this.onScreen(lf, 20)) this.autoLock(); }
    const lf = this.lockId != null ? this.fish.get(this.lockId) : undefined;
    this.lockLine.clear();
    if (lf && this.lockMode) {
      this.reticle.visible = true; this.reticle.position.set(lf.x, lf.y); this.reticle.rotation += dt * 2; this.reticle.scale.set(Math.min(1.5, Math.max(0.6, FISH[lf.kind].radius / 55)) * (1 + Math.sin(this.time * 8) * 0.05));
      const sx = this.cannon.x, sy = this.cannon.y, d = Math.hypot(lf.x - sx, lf.y - sy); const n = Math.floor(d / 34);
      for (let i = 2; i < n; i++) { const k = i / n; this.lockLine.circle(sx + (lf.x - sx) * k, sy + (lf.y - sy) * k, 4).fill({ color: 0xff4d6a, alpha: 0.8 }); }
    } else this.reticle.visible = false;

    // aim cannon
    const tgt: Vec = lf && this.lockMode ? [lf.x, lf.y] : this.aim;
    let ang = Math.atan2(tgt[1] - this.cannon.y, tgt[0] - this.cannon.x);
    if (ang > -0.08 && ang < Math.PI / 2) ang = -0.08; else if (ang >= Math.PI / 2 || ang < -Math.PI + 0.08) ang = -Math.PI + 0.08;
    this.cannonGun.rotation += ((ang + Math.PI / 2) - this.cannonGun.rotation) * Math.min(1, dt * 20);
    this.recoil = Math.max(0, this.recoil - dt * 9);
    const r = this.cannonGun.rotation - Math.PI / 2;
    this.cannonGun.position.set(-Math.cos(r) * this.recoil * 12, -Math.sin(r) * this.recoil * 12);
    this.muzzle.position.set(Math.cos(r) * 142, Math.sin(r) * 142); this.muzzle.alpha = Math.max(0, this.muzzle.alpha - dt * 10); this.muzzle.scale.set(0.5 + this.muzzle.alpha * 0.4);

    if (this.holding || this.auto) this.tryFire(now);

    // bullets
    const v = this.view; const pad = 12;
    for (const b of this.bullets) {
      if (b.done) continue;
      b.age += dt;
      if (b.lock != null) { const t = this.fish.get(b.lock); if (t && !t.dying && t.visible) { const a = Math.atan2(t.y - b.y, t.x - b.x); const sp = Math.hypot(b.vx, b.vy); b.vx = Math.cos(a) * sp; b.vy = Math.sin(a) * sp; } else b.lock = undefined; }
      b.x += b.vx * dt; b.y += b.vy * dt;
      if (b.x < v.x0 + pad) { b.x = v.x0 + pad; b.vx = Math.abs(b.vx); } else if (b.x > v.x1 - pad) { b.x = v.x1 - pad; b.vx = -Math.abs(b.vx); }
      if (b.y < v.y0 + pad) { b.y = v.y0 + pad; b.vy = Math.abs(b.vy); } else if (b.y > v.y1 - pad) { b.y = v.y1 - pad; b.vy = -Math.abs(b.vy); }
      b.s.position.set(b.x, b.y); b.s.rotation = Math.atan2(b.vy, b.vx) + Math.PI / 2;
      const hit = this.collide(b);
      if (hit) {
        b.done = true; this.net(b.x, b.y); sfx.hit(); hit.flash = 0.07;
        if (b.bid !== undefined) this.send({ t: 'hit', bid: b.bid, fid: hit.id }); else this.pendingHits.set(b.cid, hit.id);
      }
    }
    this.bullets = this.bullets.filter(b => { if (b.done) { b.s.destroy(); return false; } return true; });

    this.fx = this.fx.filter(f => f.update(dt));

    // camera shake + flash
    if (this.shakeT > 0) { this.shakeT -= dt; const a = this.shakeAmp * Math.max(0, this.shakeT); this.shake.position.set((Math.random() - 0.5) * a * 2, (Math.random() - 0.5) * a * 2); } else this.shake.position.set(0, 0);
    this.flash.alpha = Math.max(0, this.flash.alpha - dt * 2);

    // HUD numbers
    const target = this.balance; this.shownBalance += (target - this.shownBalance) * Math.min(1, dt * 8); if (Math.abs(target - this.shownBalance) < 1) this.shownBalance = target;
    if (this.el.coinsVal) this.el.coinsVal.textContent = fmt(this.shownBalance);
    if (this.el.ping && Math.floor(this.time * 2) !== Math.floor((this.time - dt) * 2)) this.el.ping.textContent = this.ping ? `${Math.round(this.ping)}ms` : '--ms';
    this.hooks.onBalance(this.serverBalance);
  }

  collide(b: Bullet): Fish | null {
    const check = (f: Fish) => {
      if (!f.visible || f.dying) return false;
      const def = FISH[f.kind]; const r = def.radius;
      if (def.facing === 'side' && (f.kind === 'shark' || f.kind === 'whale' || f.kind === 'sardine' || f.kind === 'clownfish' || f.kind === 'turtle')) {
        const ca = Math.cos(f.ang), sa = Math.sin(f.ang), o = def.size * 0.28;
        for (const k of [-1, 0, 1]) if (Math.hypot(b.x - (f.x + ca * o * k), b.y - (f.y + sa * o * k)) < r * 0.8) return true;
        return false;
      }
      return Math.hypot(b.x - f.x, b.y - f.y) < r;
    };
    if (b.lock != null) { const f = this.fish.get(b.lock); return f && check(f) ? f : null; }
    let best: Fish | null = null;
    for (const f of this.fish.values()) if (check(f) && (!best || f.node.zIndex > best.node.zIndex)) best = f;
    return best;
  }
}
// silence unused import warning for toast in some builds
void toast;
