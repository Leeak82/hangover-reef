import './env.js';
import express from 'express';
import cookieParser from 'cookie-parser';
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { authRouter } from './auth.js';
import { shopRouter, webhookHandler, stripe, devPurchasesEnabled } from './shop.js';
import { attachGame } from './game.js';

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.post('/api/stripe/webhook', ...webhookHandler); // raw body, before json parser
app.use(express.json({ limit: '20kb' }));
app.use(cookieParser());
app.use('/api/auth', authRouter);
app.use('/api/shop', shopRouter);
app.get('/api/health', (_req, res) => res.json({ ok: true }));

const dist = path.resolve('dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist, { maxAge: '1h', index: false }));
  app.get(/^\/(?!api|ws).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
}
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err); res.status(500).json({ error: 'Server error' });
});

const server = http.createServer(app);
attachGame(server);
const port = Number(process.env.PORT || 8787);
server.listen(port, () => console.log(`[hangover-reef] server on http://localhost:${port}  stripe=${stripe ? 'on' : 'off'}  devPurchases=${devPurchasesEnabled}`));
