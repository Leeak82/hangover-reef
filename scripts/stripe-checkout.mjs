// Real Stripe TEST-mode checkout E2E. Usage: node scripts/stripe-checkout.mjs [baseUrl]
// Signs up, buys the 'Pint' pack through hosted Stripe Checkout with card 4242, checks coins, plays, reloads.
import { chromium } from 'playwright-core';
const BASE = process.argv[2] || 'http://localhost:8787';
const OUT = new URL('../screenshots/', import.meta.url).pathname;
const tag = BASE.includes('localhost') ? 'local' : 'live';
const browser = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const ctx = await browser.newContext({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
const log = (...a) => console.log(`[stripe-${tag}]`, ...a);
page.on('pageerror', e => log('PAGEERR', String(e).slice(0, 200)));
const coins = async () => (await page.evaluate(() => fetch('/api/auth/me').then(r => r.json()))).user.coins;

await page.goto(BASE, { timeout: 120000 }); await page.waitForSelector('.auth', { timeout: 120000 });
const email = `stripe${Date.now()}@example.com`;
await page.fill('input[type=email]', email); await page.fill('input[type=password]', 'partyhard123'); await page.check('#age');
await page.click('button[type=submit]'); await page.waitForSelector('.lobby');
const c0 = await coins(); log('signed up, coins', c0);
await page.click('text=AMMO SHOP'); await page.waitForSelector('.packs'); await page.waitForTimeout(500);
log('shop banner:', await page.textContent('.devtag'));
await page.screenshot({ path: OUT + `11-${tag}-shop-stripe.png` });
await Promise.all([page.waitForURL(/checkout\.stripe\.com/, { timeout: 60000 }), page.click('.pack:nth-child(1) .gold-btn')]);
log('on Stripe checkout; coins before paying', await (async () => { const r = await ctx.request.get(BASE + '/api/auth/me'); return (await r.json()).user.coins; })());
await page.waitForLoadState('networkidle').catch(() => {});
await page.waitForTimeout(2500);
await page.screenshot({ path: '/tmp/co-before.png' });
log('inputs', JSON.stringify(await page.evaluate(() => [...document.querySelectorAll('input,button,select')].map(e => e.id || e.getAttribute('data-testid') || e.name).filter(Boolean).slice(0, 40))));
log('frames', page.frames().map(f => f.url().slice(0, 60)).join(' | '));
const accordion = page.locator('[data-testid="card-accordion-item-button"]');
if (await accordion.count()) { const card = page.getByText('Card', { exact: true }).first(); await card.scrollIntoViewIfNeeded().catch(() => {}); await card.click().catch(() => accordion.dispatchEvent('click')); }
await page.waitForTimeout(2000); await page.screenshot({ path: '/tmp/co-after-accordion.png' });
await page.waitForSelector('#cardNumber', { timeout: 30000 });
await page.fill('#email', email).catch(() => {});
await page.fill('#cardNumber', '4242 4242 4242 4242');
await page.fill('#cardExpiry', '12 / 34');
await page.fill('#cardCvc', '123');
await page.fill('#billingName', 'Test Player').catch(() => {});
const zip = page.locator('#billingPostalCode'); if (await zip.count() && await zip.isVisible()) await zip.fill('94107');
const country = page.locator('#billingCountry'); if (await country.count() && await country.isVisible()) await country.selectOption('US').catch(() => {});
// opt out of saving to Link (it would require a phone number)
const linkBox = page.locator('input[type=checkbox]:checked').first();
if (await linkBox.count()) { await linkBox.uncheck({ force: true }).catch(() => page.getByText('Save my information', { exact: false }).first().click()); }
await page.waitForTimeout(500);
await page.screenshot({ path: OUT + `12-${tag}-stripe-checkout.png` });
await page.click('[data-testid="hosted-payment-submit-button"], .SubmitButton');
try { await page.waitForURL(u => u.toString().startsWith(BASE), { timeout: 60000 }); }
catch (e) { await page.screenshot({ path: '/tmp/co-stuck.png', fullPage: true }); log('stuck after submit; visible errors:', JSON.stringify(await page.evaluate(() => [...document.querySelectorAll('[role=alert], .FieldError, .Error')].map(e => e.textContent).filter(Boolean)))); throw e; }
log('redirected back:', page.url().replace(/session_id=[^&]+/, 'session_id=cs_…'));
await page.waitForSelector('.lobby'); await page.waitForTimeout(2500);
const c1 = await coins(); log('coins after Stripe payment', c1, 'delta', c1 - c0);
await page.screenshot({ path: OUT + `13-${tag}-after-purchase.png` });
await page.click('.room.happy'); await page.waitForSelector('.hud'); await page.waitForTimeout(2500);
await page.tap('.hbtn:has-text("AUTO")'); await page.touchscreen.tap(420, 150); await page.waitForTimeout(9000);
await page.screenshot({ path: OUT + `14-${tag}-gameplay.png` });
await page.tap('.hud .back'); await page.waitForSelector('.lobby'); await page.waitForTimeout(800);
const c2 = await coins(); await page.reload(); await page.waitForSelector('.lobby');
const c3 = await coins(); log('after play', c2, 'after reload', c3, 'persisted', c2 === c3, 'shown', await page.textContent('.pill span'));
const tp = await page.evaluate(() => fetch('/api/shop/test-purchase', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"packId":"p1"}' }).then(r => r.status));
log('test-purchase endpoint status (expect 403):', tp);
console.log(JSON.stringify({ email }));
await browser.close();
