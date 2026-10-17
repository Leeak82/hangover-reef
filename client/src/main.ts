import '@fontsource/lilita-one/400.css';
import '@fontsource/nunito/600.css';
import '@fontsource/nunito/800.css';
import '@fontsource/nunito/900.css';
import './style.css';
import { api, type User } from './api';
import { h, clear, toast, openShop, openPaytable, openTerms, fmt, icons, uiRoot } from './ui';
import { ROOMS } from '../../shared/config';
import { sfx } from './audio';
import { Game } from './game';

let user: User | null = null;
let game: Game | null = null;
const coinEls = new Set<HTMLElement>();
function setUser(u: User) { user = u; for (const el of coinEls) el.textContent = fmt(u.coins); }

document.addEventListener('pointerdown', () => sfx.unlock(), { capture: true });

function authScreen(mode: 'signup' | 'login' = 'signup') {
  clear(); coinEls.clear();
  const err = h('div', { class: 'err' });
  const email = h('input', { type: 'email', autocomplete: 'email', placeholder: 'you@example.com', required: true }) as HTMLInputElement;
  const pass = h('input', { type: 'password', autocomplete: mode === 'signup' ? 'new-password' : 'current-password', placeholder: mode === 'signup' ? 'At least 8 characters' : '••••••••', required: true }) as HTMLInputElement;
  const age = h('input', { type: 'checkbox', id: 'age' }) as HTMLInputElement;
  const submit = h('button', { class: 'gold-btn pink', type: 'submit' }, mode === 'signup' ? 'GET 2,000 FREE COINS' : 'LET ME IN') as HTMLButtonElement;
  const form = h('form', { onsubmit: async (e: Event) => {
    e.preventDefault(); err.textContent = ''; submit.disabled = true;
    try {
      if (mode === 'signup') {
        if (!age.checked) throw new Error('Please confirm you are 17 or older');
        const r = await api.signup(email.value, pass.value, true); setUser(r.user); lobby(); toast(`Welcome! +${fmt(r.starter)} starter coins`); sfx.kill(20);
      } else { const r = await api.login(email.value, pass.value); setUser(r.user); lobby(); }
    } catch (e2) { err.textContent = (e2 as Error).message; sfx.reject(); }
    submit.disabled = false;
  } },
    h('label', { class: 'field' }, h('span', {}, 'Email'), email),
    h('label', { class: 'field' }, h('span', {}, 'Password'), pass),
    mode === 'signup' ? h('label', { class: 'check', for: 'age' }, age, h('span', {}, 'I confirm I am 17 or older and I get that coins are for fun only: no cash value, no cash-out.')) : null,
    err, h('div', { class: 'row' }, submit));
  const swap = h('div', { class: 'switch' }, mode === 'signup' ? 'Already partying with us? ' : 'New here? ', h('button', { class: 'link', type: 'button', onclick: () => authScreen(mode === 'signup' ? 'login' : 'signup') }, mode === 'signup' ? 'Log in' : 'Create an account'));
  uiRoot.append(h('div', { class: 'screen auth' },
    h('img', { class: 'logo', src: '/assets/logo.png', alt: 'Hangover Reef' }),
    h('div', { class: 'panel' }, h('h2', {}, mode === 'signup' ? 'Join the Party' : 'Welcome Back'), form, swap),
    h('div', { class: 'fineprint' }, '17+ only. Cheeky cartoon humor. Virtual coins have no cash value and cannot be redeemed. ', h('button', { class: 'link', type: 'button', onclick: openTerms }, 'House rules'))));
}

function coinPill() {
  const val = h('span', {}, fmt(user!.coins)); coinEls.add(val);
  return h('div', { class: 'pill' }, h('div', { class: 'coin' }, '$'), val, h('button', { class: 'plus', title: 'Buy coins', onclick: () => { sfx.click(); openShop(setUser); } }, '+'));
}

function lobby() {
  clear(); coinEls.clear();
  const u = user!;
  const soundBtn = h('button', { class: 'iconbtn', title: 'Sound', html: sfx.muted ? icons.mute : icons.sound, onclick: () => { sfx.setMuted(!sfx.muted); soundBtn.innerHTML = sfx.muted ? icons.mute : icons.sound; } });
  const dailyBtn = h('button', { class: 'gold-btn green', onclick: async () => {
    sfx.click();
    try { const r = await api.daily(); setUser(r.user); toast(`Free refill! +${fmt(r.granted)} coins`); sfx.kill(25); lobby(); }
    catch (e) { const d = (e as any).data?.user as User | undefined; const hrs = d ? Math.ceil((d.nextDailyAt - Date.now()) / 3600000) : 24; toast(`Next free refill in ~${hrs}h`); }
  } }, u.dailyAvailable ? `FREE ${fmt(u.dailyCoins)} COINS` : 'DAILY REFILL', u.dailyAvailable ? h('span', { class: 'badge-dot' }, '!') : null);
  const art: Record<string, string[]> = { happy: ['clownfish', 'crab'], bottle: ['octopus', 'jelly'], vip: ['whale', 'lobster'] };
  const rooms = h('div', { class: 'rooms' }, ...ROOMS.map(r => {
    const locked = u.coins < r.minBalance;
    return h('div', { class: `room ${r.id}${locked ? ' locked' : ''}`, onclick: () => enter(r.id) },
      h('div', { class: 'art' }, ...art[r.id].map(a => h('img', { src: `/assets/${a}.png`, alt: '' }))),
      h('h3', {}, r.name), h('div', { class: 'tag' }, r.tagline),
      h('div', { class: 'bets' }, `BET ${fmt(r.bets[0])} – ${fmt(r.bets[r.bets.length - 1])}`),
      h('div', { class: 'req' }, r.minBalance ? `${locked ? '🔒 ' : ''}Needs ${fmt(r.minBalance)} coins` : 'Open to everyone'),
      h('button', { class: 'gold-btn' }, 'PLAY'));
  }));
  uiRoot.append(h('div', { class: 'screen lobby' },
    h('div', { class: 'topbar' },
      h('div', { class: 'tb-left' }, coinPill(), h('span', { class: 'user' }, u.email)),
      h('div', { class: 'tb-right' },
        h('button', { class: 'iconbtn', title: 'Paytable', html: icons.info, onclick: () => { sfx.click(); openPaytable(); } }),
        soundBtn,
        h('button', { class: 'iconbtn', title: 'Log out', html: icons.logout, onclick: async () => { await api.logout(); user = null; authScreen('login'); } }))),
    h('div', { class: 'mid' }, h('img', { class: 'logo', src: '/assets/logo.png', alt: 'Hangover Reef' }),
    rooms,
    h('div', { class: 'lobby-actions' }, dailyBtn, h('button', { class: 'gold-btn pink', onclick: () => { sfx.click(); openShop(setUser); } }, 'AMMO SHOP'), h('button', { class: 'gold-btn', onclick: () => { sfx.click(); openPaytable(); } }, 'PAYTABLE'))),
    h('div', { class: 'fineprint' }, '17+ · For entertainment only · Coins have no cash value and can never be cashed out. ', h('button', { class: 'link', onclick: openTerms }, 'House rules'))));
}

async function enter(roomId: string) {
  const room = ROOMS.find(r => r.id === roomId)!;
  if (user!.coins < room.minBalance) { sfx.reject(); toast(`${room.name} needs ${fmt(room.minBalance)} coins`); return; }
  sfx.unlock(); sfx.click();
  clear(); coinEls.clear();
  if (!game) { game = new Game(); await game.init(document.getElementById('game')!); }
  game.enter(room, user!.coins, {
    onBalance: c => { if (user) user.coins = c; },
    onExit: async () => { try { setUser((await api.me()).user); } catch {} lobby(); },
    onShop: () => openShop(u => { setUser(u); game?.setBalance(u.coins); }),
    onPaytable: openPaytable,
    onError: (msg: string) => { toast(msg); },
  });
}

async function boot() {
  const qs = new URLSearchParams(location.search);
  try { setUser((await api.me()).user); } catch { authScreen(qs.has('login') ? 'login' : 'signup'); return; }
  lobby();
  if (qs.get('checkout') === 'success' && qs.get('session_id')) {
    history.replaceState(null, '', '/');
    try { const r = await api.verify(qs.get('session_id')!); setUser(r.user); lobby(); toast(r.ok ? 'Purchase complete! Coins added.' : 'Payment still processing...'); } catch (e) { toast((e as Error).message); }
  } else if (qs.get('checkout') === 'cancel') { history.replaceState(null, '', '/'); toast('Purchase cancelled'); }
  const auto = qs.get('room'); if (auto) enter(auto);
}
boot();
(window as any).__hr = { get game() { return game; } };
