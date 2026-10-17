// End-to-end smoke test + screenshots. Usage: node scripts/e2e.mjs [baseUrl]
import { chromium } from 'playwright-core';
const BASE = process.argv[2] || 'http://localhost:8787';
const OUT = new URL('../screenshots/', import.meta.url).pathname;
const exe = process.env.CHROME || '/usr/bin/google-chrome';
const browser = await chromium.launch({ executablePath: exe, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
const errors = [];
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', e => { errors.push(String(e)); console.log('PAGEERR', String(e)); }); page.on('console', m => { if (m.type()==='error'||m.type()==='warning') console.log('CONSOLE', m.text().slice(0,300)); });
const coins = async () => (await page.evaluate(() => fetch('/api/auth/me').then(r => r.json()))).user.coins;
const log = (...a) => console.log('[e2e]', ...a);

await page.goto(BASE); await page.waitForSelector('.auth');
await page.waitForTimeout(600);
await page.screenshot({ path: OUT + '01-signup.png' });
const email = `test${Date.now()}@example.com`;
await page.fill('input[type=email]', email); await page.fill('input[type=password]', 'partyhard123');
await page.click('button[type=submit]');
log('age gate error shown:', await page.textContent('.err'));
await page.check('#age'); await page.click('button[type=submit]');
await page.waitForSelector('.lobby');
const c0 = await coins(); log('signed up', email, 'coins', c0);
await page.click('text=AMMO SHOP'); await page.waitForSelector('.packs'); await page.waitForTimeout(400);
await page.screenshot({ path: OUT + '03-shop.png' });
await page.click('.pack:nth-child(3) .gold-btn');
await page.waitForTimeout(800);
const c1 = await coins(); log('after test purchase', c1, 'delta', c1 - c0);
await page.click('.modal .close'); await page.waitForTimeout(300);
await page.screenshot({ path: OUT + '02-lobby.png' });
await page.click('.room.happy');
await page.waitForSelector('.hud'); await page.waitForTimeout(2500);
// shoot manually, then auto + lock
for (let i = 0; i < 10; i++) { await page.mouse.move(400 + i * 80, 300 + (i % 3) * 80); await page.mouse.down(); await page.waitForTimeout(160); await page.mouse.up(); }
await page.click('.hbtn:has-text("AUTO")');
await page.mouse.move(800, 300);
await page.waitForTimeout(12000);
await page.screenshot({ path: OUT + '04-gameplay.png' });
await page.click('.hbtn:has-text("LOCK")');
await page.waitForTimeout(4000);
const st = await page.evaluate(() => { const g = window.__hr.game; return { fish: g.fish.size, bullets: g.bullets.length, bal: g.serverBalance, fps: g.app.ticker.FPS }; });
log('in game', st);
await page.waitForTimeout(3000);
await page.screenshot({ path: OUT + '05-gameplay-lock.png' });
await page.click('.hud .back'); await page.waitForSelector('.lobby'); await page.waitForTimeout(500);
const c2 = await coins(); const shown = await page.textContent('.pill span');
log('back in lobby, server coins', c2, 'shown', shown);
await page.reload(); await page.waitForSelector('.lobby');
const c3 = await coins(); log('after reload coins', c3, 'persisted:', c3 === c2, 'shown', await page.textContent('.pill span'));
// logout/login persistence
await page.click('.iconbtn[title="Log out"]'); await page.waitForSelector('.auth');
await page.fill('input[type=email]', email); await page.fill('input[type=password]', 'partyhard123'); await page.click('button[type=submit]');
await page.waitForSelector('.lobby'); log('re-login coins', await coins());

// mobile landscape shot
const m = await browser.newContext({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, storageState: await ctx.storageState() });
const mp = await m.newPage(); mp.on('pageerror', e => errors.push('mobile: ' + e));
await mp.goto(BASE); await mp.waitForSelector('.lobby'); await mp.waitForTimeout(500);
await mp.screenshot({ path: OUT + '06-mobile-lobby.png' });
await mp.click('.room.happy'); await mp.waitForSelector('.hud'); await mp.waitForTimeout(2000);
await mp.tap('.hbtn:has-text("AUTO")'); await mp.touchscreen.tap(420, 150); await mp.waitForTimeout(6000);
await mp.screenshot({ path: OUT + '07-mobile-gameplay.png' });
// visual check of the big-win celebration (client-side render only, no balance change)
await page.goto(BASE + '/?room=happy'); await page.waitForSelector('.hud'); await page.waitForTimeout(2500);
await page.evaluate(() => { const g = window.__hr.game; g.bigWin('whale', 300, 30000); g.shakeT = 0.9; g.shakeAmp = 20; });
await page.waitForTimeout(1500);
await page.screenshot({ path: OUT + '08-bigwin.png' });
log('errors:', errors.length ? errors : 'none');
await browser.close();
