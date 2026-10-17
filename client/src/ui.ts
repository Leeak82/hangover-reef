import { api, type User } from './api';
import { FISH, ROOMS, WHALE_MULTS, PACKS, type FishKind } from '../../shared/config';
import { sfx } from './audio';

const root = document.getElementById('ui')!;
export const fmt = (n: number) => Math.floor(n).toLocaleString('en-US');
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, any> = {}, ...kids: (Node | string | null | undefined | false)[]) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') el.className = v; else if (k.startsWith('on')) el.addEventListener(k.slice(2), v); else if (k === 'html') el.innerHTML = v; else if (v !== false && v != null) el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids) if (c) el.append(c);
  return el;
}
export const icons = {
  back: '<svg viewBox="0 0 24 24" fill="#fff"><path d="M6 3l14 9-14 9z"/></svg>',
  shop: '<svg viewBox="0 0 24 24" fill="#fff"><path d="M7 4h10l1 4h3l-2 12H5L3 8h3zM8.5 8h7l-.6-2H9.1z"/></svg>',
  info: '<svg viewBox="0 0 24 24" fill="#fff"><path d="M11 10h2v8h-2zm0-4h2v2h-2z"/><circle cx="12" cy="12" r="10" fill="none" stroke="#fff" stroke-width="2"/></svg>',
  sound: '<svg viewBox="0 0 24 24" fill="#fff"><path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M16 8a5 5 0 010 8M18.5 5.5a8.5 8.5 0 010 13" stroke="#fff" stroke-width="2" fill="none"/></svg>',
  mute: '<svg viewBox="0 0 24 24" fill="#fff"><path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M16 9l6 6m0-6l-6 6" stroke="#fff" stroke-width="2"/></svg>',
  logout: '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.4"><path d="M14 4h5v16h-5M10 8l-4 4 4 4M6 12h10"/></svg>',
  auto: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M20 12a8 8 0 11-3-6.3"/><path d="M20 3v5h-5" /></svg>',
  lock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="12" cy="12" r="7"/><path d="M12 2v5M12 17v5M2 12h5M17 12h5"/><circle cx="12" cy="12" r="1.8" fill="currentColor"/></svg>',
  wifi: '<svg viewBox="0 0 24 24" fill="none" stroke="#ffd34d" stroke-width="2.4"><path d="M2 9a15 15 0 0120 0M5 12.5a10 10 0 0114 0M8.5 16a5 5 0 017 0"/><circle cx="12" cy="19.5" r="1.3" fill="#ffd34d"/></svg>',
};

export function toast(msg: string) { const t = h('div', { class: 'toast' }, msg); root.append(t); setTimeout(() => t.remove(), 2700); }

export function modal(title: string, body: HTMLElement, wide = true) {
  const m = h('div', { class: 'modal', onpointerdown: (e: Event) => { if (e.target === m) close(); } });
  const close = () => { sfx.click(); m.remove(); };
  const panel = h('div', { class: 'panel', style: wide ? 'width: min(980px, 96vw)' : '' }, h('button', { class: 'close', onclick: close }, '✕'), h('h2', {}, title), body);
  m.append(panel); root.append(m);
  return { el: m, close };
}

const DISCLAIMER = 'Coins are virtual and for entertainment only. They have no cash value and can never be cashed out, withdrawn, redeemed, or exchanged for money, prizes or anything of value. Winning coins in game does not imply future success at real-money gambling.';

export function openTerms() {
  modal('House Rules', h('div', { class: 'terms', html: `
    <p>Hangover Reef is a <b>17+ amusement game</b> with cartoon violence against party animals and cheeky adult humor. No actual fish were over-served.</p>
    <h4>Coins</h4><p>${DISCLAIMER}</p>
    <h4>Purchases</h4><p>Coin packs are a purchase of a limited, non-transferable license to use virtual coins inside Hangover Reef. All sales are final except where required by law. Coins cannot be transferred between accounts.</p>
    <h4>No cash-out, ever</h4><p>There is no withdrawal, redemption, prize or sweepstakes feature. If anyone offers to "buy" your coins or pay out winnings, it is a scam.</p>
    <h4>Free coins</h4><p>New accounts get free starter coins, and you can claim a free refill every 24 hours. No purchase is ever necessary to play.</p>
    <h4>Play responsibly</h4><p>Set limits. Take breaks. Drink water. The whale learned the hard way.</p>` }), false);
}

export function openPaytable() {
  const grid = h('div', { class: 'paytable' });
  const kinds = Object.keys(FISH) as FishKind[];
  for (const k of kinds) {
    const f = FISH[k];
    const m = k === 'whale' ? `${WHALE_MULTS[0].mult}x – ${WHALE_MULTS[WHALE_MULTS.length - 1].mult}x` : `${f.mult}x`;
    grid.append(h('div', { class: 'pt' + (k === 'whale' ? ' boss' : '') }, h('img', { src: `/assets/${k}.png`, alt: f.name }), h('div', { class: 'm' }, m), h('div', { class: 'n' }, f.name), h('div', { class: 'q' }, f.quip)));
  }
  modal('Paytable', h('div', {}, grid, h('div', { class: 'notice', html: 'Payout = your bet × the creature’s multiplier. Bigger creatures soak up more shots. The Hangover Whale pays a random 150x–500x when it finally passes out. Every shot result is decided by the server.' })));
}

export async function openShop(onUser: (u: User) => void) {
  const cfg = await api.shopConfig().catch(() => ({ packs: PACKS, stripe: false, testMode: false, devPurchases: false }));
  const art = ['sardine', 'puffer', 'crab', 'octopus', 'whale'];
  const grid = h('div', { class: 'packs' });
  cfg.packs.forEach((p, i) => {
    const btn = h('button', { class: 'gold-btn green' }, cfg.stripe ? `$${(p.priceCents / 100).toFixed(2)}` : `$${(p.priceCents / 100).toFixed(2)}`) as HTMLButtonElement;
    btn.onclick = async () => {
      sfx.click(); btn.disabled = true;
      try {
        if (cfg.stripe) { const { url } = await api.checkout(p.id); location.href = url; return; }
        const r = await api.testPurchase(p.id); onUser(r.user); sfx.kill(30); toast(`+${fmt(r.granted)} coins (test purchase)`);
      } catch (e) { toast((e as Error).message); }
      btn.disabled = false;
    };
    grid.append(h('div', { class: 'pack' }, p.badge ? h('div', { class: 'ribbon' }, p.badge) : null, h('div', { class: 'stack' }, h('img', { src: `/assets/${art[i] || 'crab'}.png`, alt: '' })), h('div', { class: 'amt' }, fmt(p.coins)), h('div', { class: 'bonus' }, p.bonus ? `+${fmt(p.bonus)} BONUS` : ''), h('div', { class: 'nm' }, p.label), btn));
  });
  const head = cfg.stripe
    ? (cfg.testMode ? h('div', { class: 'devtag' }, 'STRIPE TEST MODE: use card 4242 4242 4242 4242') : null)
    : cfg.devPurchases ? h('div', { class: 'devtag' }, 'DEV MODE: Stripe not configured. Buttons credit test coins instantly, no money is charged.') : h('div', { class: 'devtag' }, 'Purchases are currently unavailable.');
  modal('Ammo Shop', h('div', {}, h('div', { style: 'text-align:center' }, head), grid, h('div', { class: 'notice', html: `<b>Entertainment only.</b> ${DISCLAIMER} <button class="link" id="termslink">House rules</button>` })));
  document.getElementById('termslink')!.onclick = openTerms;
}

export function clear() { root.innerHTML = ''; }
export { root as uiRoot, ROOMS };
