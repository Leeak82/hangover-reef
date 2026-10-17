# Hangover Reef 🐳🍺 (MVP)

An original arcade fish-table shooter for mobile and desktop web. It has a 17+ cheeky party theme (no explicit content), a server-authoritative kill roll, email login, and a Stripe ammo shop.
**Coins are for entertainment only. There's no cash-out, withdrawal, redemption or prize of any kind, anywhere.**

- Front end: Vite + TypeScript + PixiJS v8 (WebGL), landscape-first, touch + mouse
- Back end: Node + Express 5 + `ws` WebSocket + Postgres when `DATABASE_URL` is set (production), otherwise a local SQLite file (`better-sqlite3`)
- Auth: email + password (bcrypt, cost 12, via `bcryptjs`), httpOnly session cookie, 17+ age-gate checkbox
- Payments: Stripe Checkout (test mode). Coins are credited only from a verified webhook or a server-side session check

## Run it

```bash
npm install
npm run build        # typecheck + build the client into dist/
npm start            # http://localhost:8787 (serves dist/ + API + game socket)
```

Hot-reload dev mode: `npm run dev`, then open http://localhost:5173 (Vite proxies `/api` and `/ws` to :8787).

Tests (server must be running on :8787):

```bash
npm run test:security   # 14 server-authority checks over the real WebSocket protocol
npm run e2e             # Playwright: signup → test purchase → play → reload persistence + screenshots/
```
`e2e` uses the system Chrome at `/usr/bin/google-chrome` (override with `CHROME=/path`).

## Env vars (see `.env.example`; `.env` is loaded automatically)

| Var | Default | What it does |
|---|---|---|
| `PORT` | 8787 | HTTP + WebSocket port |
| `PUBLIC_URL` | http://localhost:5173 | Base URL Stripe redirects back to after checkout. Set it to the URL players actually use |
| `DATABASE_URL` | empty | Postgres connection string. When set, it's used instead of SQLite (tables are created automatically) |
| `DB_PATH` | ./data/hangover-reef.sqlite | SQLite file (only when `DATABASE_URL` is empty) |
| `SESSION_SECRET` | empty | HMAC key for stored session-token hashes. Set a long random value in production; changing it logs everyone out |
| `STRIPE_SECRET_KEY` | empty | Turns on real Stripe Checkout. When empty, the shop runs in **DEV MODE** and credits coins free (clearly labeled) |
| `STRIPE_WEBHOOK_SECRET` | empty | Signing secret for `/api/stripe/webhook` |
| `NODE_ENV` | — | Set to `production` when deployed: secure cookies, and the dev purchase path is disabled |
| `ALLOW_TEST_PURCHASES` | — | `true` = keep the free, clearly labeled test-purchase path on in production while Stripe isn't set (test builds only). Ignored once `STRIPE_SECRET_KEY` is set |
| `BOSS_FIRST_MS` | 25–40s random | Make the first whale arrive sooner (testing) |

## Plugging in Stripe

1. Get your **test** keys from the Stripe Dashboard (Developers → API keys). Put `STRIPE_SECRET_KEY=sk_test_...` in `.env`.
2. Webhook (recommended, it credits coins even if the player closes the tab):
   - Local: `stripe listen --forward-to localhost:8787/api/stripe/webhook`, then copy the `whsec_...` it prints into `STRIPE_WEBHOOK_SECRET`.
   - Deployed: add an endpoint at `https://YOUR_DOMAIN/api/stripe/webhook` for `checkout.session.completed` and `checkout.session.async_payment_succeeded`.
3. Set `PUBLIC_URL` to your site URL and restart. The shop now opens Stripe Checkout. Test card: `4242 4242 4242 4242`, any future date, any CVC.
4. Going live means swapping in `sk_live_...` and a live webhook secret. The server logs a warning when the key isn't a test key. **Before going live, check app store rules (Apple/Google require their own in-app purchase for digital goods inside native apps) and local law on coin-based amusement games.**

How crediting works: the client never says "I paid". After the Stripe redirect, the server fetches the Checkout Session from Stripe (`/api/shop/verify`) or receives the signed webhook. It credits only when `payment_status === 'paid'`, the amount matches the pack price, and the session belongs to the logged-in user. Each Stripe session id has a unique ledger row, so a purchase can never be credited twice.

## Game rules (server-side, `shared/config.ts` + `server/game.ts`)

- The server spawns every creature (id, type, bezier path, timing) and streams it over WebSocket. The client only renders it.
- `fire` debits the bet atomically in SQLite (`coins >= bet` guard) and returns a bullet id. Bets must be one of the room's levels, rate-limited to about 10 shots/s, with at most 40 bullets in flight.
- `hit {bullet, fish}` is only accepted for a real, unused bullet and a live fish in its time window. The kill roll uses `crypto.randomInt`: `P(kill) = RTP / multiplier` with RTP = 0.94, and payout = bet × multiplier.
- Unused bullets are refunded when you leave the table.
- Paytable: Sardine 2x, Seahorse 3x, Clownfish 5x, Puffer 8x, Crab 15x, Jelly 25x, Turtle 40x, Octopus 60x, Shark 120x, DJ Lobster 300x, Hangover Whale 150–500x (weighted random).
- Rooms: Happy Hour (bet 1–10), Bottle Service (10–100, needs 500 coins), Whale Lounge VIP (100–1,000, needs 10,000).
- Free coins: 2,000 on signup, plus 1,000 every 24h ("Daily Refill").

## Layout

```
shared/config.ts      paytable, rooms, packs, protocol types (used by client + server)
server/               index (express+static), auth, shop (Stripe), game (WebSocket table), db (SQLite)
client/src/           main (screens), ui (modals/shop/paytable), game (Pixi engine), audio (Web Audio synth), textures (procedural FX)
client/public/assets  creature sprites (AI-generated, chroma-keyed), background, logo, cannon
art-src/              source renders + key.py (chroma-key/crop script)
scripts/              e2e.mjs, security-test.mjs
screenshots/          headless Chromium captures
```

## Art

The creature sprites, background, logo and cannon were made with an image generator on flat magenta/green backgrounds, then keyed out with `art-src/key.py`. FX (coins, nets, glows, light rays, caustics, bubbles) are drawn procedurally. Swimming is a real-time mesh deformation on side-view fish, and bob/pulse/sway on front-view ones. All sounds and the lounge music loop are synthesized live with Web Audio, so there are no audio files.

## Deployed test build (Render)

- Web service `hangover-reef` (free plan, Node), build: `npm ci --include=dev && npm run build`, start: `npm start`
- Data: Render Postgres `hangover-reef-db` (basic-256mb), connected via `DATABASE_URL`
- Env: `NODE_ENV=production`, `ALLOW_TEST_PURCHASES=true`, `SESSION_SECRET`, `PUBLIC_URL`
- Pushing to `main` redeploys automatically.
