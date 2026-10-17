import { Router, type Request, type Response } from 'express';
import express from 'express';
import Stripe from 'stripe';
import { grant } from './db.js';
import { requireAuth, publicUser, type AuthedRequest } from './auth.js';
import { PACKS } from '../shared/config.js';

const key = process.env.STRIPE_SECRET_KEY?.trim();
export const stripe = key ? new Stripe(key) : null;
const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET?.trim();
// Dev purchases are only possible when Stripe is NOT configured, and never in production unless explicitly allowed.
const flag = (v?: string) => ['1', 'true', 'yes'].includes((v || '').toLowerCase());
export const devPurchasesEnabled = !stripe && (process.env.NODE_ENV !== 'production' || flag(process.env.ALLOW_TEST_PURCHASES) || flag(process.env.ALLOW_DEV_PURCHASES));
if (key && !key.startsWith('sk_test_')) console.warn('[shop] STRIPE_SECRET_KEY is not a test key. You are taking REAL payments.');

const publicUrl = () => (process.env.PUBLIC_URL || 'http://localhost:5173').replace(/\/$/, '');

/** Credit a paid Checkout Session exactly once (idempotent on the session id). */
async function fulfill(session: Stripe.Checkout.Session): Promise<{ ok: boolean; userId?: number; coins?: number; reason?: string }> {
  if (session.payment_status !== 'paid') return { ok: false, reason: 'not paid' };
  const userId = Number(session.metadata?.user_id);
  const pack = PACKS.find(p => p.id === session.metadata?.pack_id);
  if (!userId || !pack) return { ok: false, reason: 'bad metadata' };
  if (session.amount_total !== pack.priceCents) return { ok: false, reason: 'amount mismatch' };
  await grant(userId, 'purchase', pack.coins + pack.bonus, session.id, session.amount_total);
  return { ok: true, userId, coins: pack.coins + pack.bonus };
}

export const shopRouter = Router();

shopRouter.get('/config', (_req, res) => res.json({ packs: PACKS, stripe: !!stripe, testMode: !!key?.startsWith('sk_test_'), devPurchases: devPurchasesEnabled }));

shopRouter.post('/checkout', requireAuth, async (req: AuthedRequest, res) => {
  if (!stripe) return res.status(400).json({ error: 'Stripe is not configured on this server' });
  const pack = PACKS.find(p => p.id === req.body?.packId);
  if (!pack) return res.status(400).json({ error: 'Unknown pack' });
  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    line_items: [{ quantity: 1, price_data: { currency: 'usd', unit_amount: pack.priceCents, product_data: { name: `Hangover Reef: ${pack.label} (${(pack.coins + pack.bonus).toLocaleString()} coins)`, description: 'Virtual coins for entertainment only. No cash value. Cannot be redeemed, withdrawn or exchanged for money or prizes.' } } }],
    metadata: { user_id: String(req.userId), pack_id: pack.id },
    client_reference_id: String(req.userId),
    success_url: `${publicUrl()}/?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${publicUrl()}/?checkout=cancel`,
  });
  res.json({ url: session.url });
});

/** Called by the client after redirect back from Stripe. Verifies with Stripe directly; never trusts the client. */
shopRouter.post('/verify', requireAuth, async (req: AuthedRequest, res) => {
  if (!stripe) return res.status(400).json({ error: 'Stripe is not configured' });
  const id = String(req.body?.sessionId || '');
  if (!id.startsWith('cs_')) return res.status(400).json({ error: 'Bad session id' });
  const session = await stripe.checkout.sessions.retrieve(id);
  if (Number(session.metadata?.user_id) !== req.userId) return res.status(403).json({ error: 'Not your purchase' });
  const r = await fulfill(session);
  res.json({ ok: r.ok, reason: r.reason, user: await publicUser(req.userId!) });
});

/** Dev-only: credits coins without payment. Disabled automatically when STRIPE_SECRET_KEY is set. */
shopRouter.post('/test-purchase', requireAuth, async (req: AuthedRequest, res) => {
  if (!devPurchasesEnabled) return res.status(403).json({ error: 'Test purchases are disabled' });
  const pack = PACKS.find(p => p.id === req.body?.packId);
  if (!pack) return res.status(400).json({ error: 'Unknown pack' });
  await grant(req.userId!, 'dev_purchase', pack.coins + pack.bonus, null, 0);
  res.json({ user: await publicUser(req.userId!), granted: pack.coins + pack.bonus });
});

/** Stripe webhook: must be mounted with a raw body parser BEFORE express.json(). */
export const webhookHandler = [express.raw({ type: 'application/json' }), async (req: Request, res: Response) => {
  if (!stripe || !webhookSecret) return res.status(400).send('webhook not configured');
  let event: Stripe.Event;
  try { event = stripe.webhooks.constructEvent(req.body, req.headers['stripe-signature'] as string, webhookSecret); }
  catch (e) { return res.status(400).send(`signature error: ${(e as Error).message}`); }
  if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
    const r = await fulfill(event.data.object as Stripe.Checkout.Session);
    console.log('[shop] webhook', event.type, r);
  }
  res.json({ received: true });
}];
