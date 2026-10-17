// Checks Stripe crediting rules against a running server that has STRIPE_SECRET_KEY set.
// Usage: WEBHOOK_SECRET=whsec_... node scripts/stripe-verify-test.mjs [baseUrl]
import Stripe from 'stripe';
const BASE = process.argv[2] || 'http://localhost:8787';
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const ok = (c, m) => console.log(c ? 'PASS' : 'FAIL', m);
async function user() {
  const r = await fetch(BASE + '/api/auth/signup', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: `v${Date.now()}${Math.random().toString(36).slice(2, 6)}@example.com`, password: 'partyhard123', ageConfirmed: true }) });
  const cookie = r.headers.get('set-cookie').split(';')[0];
  const call = async (p, body) => { const x = await fetch(BASE + '/api/' + p, { method: body ? 'POST' : 'GET', headers: { cookie, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); return { status: x.status, json: await x.json().catch(() => ({})) }; };
  const coins = async () => (await call('auth/me')).json.user.coins;
  return { call, coins, id: (await r.json()).user.id };
}
const a = await user(), b = await user();
ok((await a.call('shop/test-purchase', { packId: 'p1' })).status === 403, 'test-purchase path is off when Stripe key is set');
const co = await a.call('shop/checkout', { packId: 'p2' });
ok(co.status === 200 && co.json.url?.startsWith('https://checkout.stripe.com/'), 'checkout session created');
const sid = co.json.url.match(/cs_test_[A-Za-z0-9]+/)?.[0];
const unpaid = await a.call('shop/verify', { sessionId: sid });
ok(unpaid.json.ok === false && (await a.coins()) === 2000, 'unpaid session credits nothing');
ok((await b.call('shop/verify', { sessionId: sid })).status === 403, "another user can't claim the session");
// most recent PAID session (from the browser checkout run), replayed
const paid = (await stripe.checkout.sessions.list({ limit: 20 })).data.find(s => s.payment_status === 'paid' && s.metadata?.pack_id);
if (paid) {
  ok((await b.call('shop/verify', { sessionId: paid.id })).status === 403, 'paid session cannot be claimed by a different account');
}
// webhook: signed with the server's secret -> credited once; replay -> no double credit; bad signature -> 400
const secret = process.env.WEBHOOK_SECRET;
if (secret) {
  const fake = { id: 'cs_test_webhook_' + Date.now(), object: 'checkout.session', payment_status: 'paid', amount_total: 99, metadata: { user_id: String(a.id), pack_id: 'p1' } };
  const payload = JSON.stringify({ id: 'evt_test_' + Date.now(), object: 'event', type: 'checkout.session.completed', data: { object: fake } });
  const header = stripe.webhooks.generateTestHeaderString({ payload, secret });
  const send = (h) => fetch(BASE + '/api/stripe/webhook', { method: 'POST', headers: { 'content-type': 'application/json', 'stripe-signature': h }, body: payload });
  const before = await a.coins();
  ok((await send(header)).status === 200 && (await a.coins()) === before + 1000, 'signed webhook credits the pack');
  ok((await send(header)).status === 200 && (await a.coins()) === before + 1000, 'replayed webhook does not double-credit');
  ok((await send('t=1,v1=deadbeef')).status === 400 && (await a.coins()) === before + 1000, 'bad signature rejected');
  const wrongAmt = JSON.stringify({ id: 'evt_x', object: 'event', type: 'checkout.session.completed', data: { object: { ...fake, id: fake.id + 'b', amount_total: 1 } } });
  await fetch(BASE + '/api/stripe/webhook', { method: 'POST', headers: { 'content-type': 'application/json', 'stripe-signature': stripe.webhooks.generateTestHeaderString({ payload: wrongAmt, secret }) }, body: wrongAmt });
  ok((await a.coins()) === before + 1000, 'amount mismatch is not credited');
}
