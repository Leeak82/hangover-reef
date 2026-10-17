import { Texture } from 'pixi.js';

function cv(w: number, h: number, draw: (c: CanvasRenderingContext2D) => void) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d')!);
  return Texture.from(c);
}

export function makeTextures() {
  const glow = cv(256, 256, c => {
    const g = c.createRadialGradient(128, 128, 0, 128, 128, 128);
    g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.25, 'rgba(255,255,255,.55)'); g.addColorStop(0.6, 'rgba(255,255,255,.12)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g; c.fillRect(0, 0, 256, 256);
  });
  const coin = cv(96, 96, c => {
    const g = c.createRadialGradient(36, 30, 4, 48, 48, 46);
    g.addColorStop(0, '#fffbd6'); g.addColorStop(0.35, '#ffd84a'); g.addColorStop(0.8, '#e08c00'); g.addColorStop(1, '#8a4b00');
    c.fillStyle = g; c.beginPath(); c.arc(48, 48, 44, 0, Math.PI * 2); c.fill();
    c.lineWidth = 5; c.strokeStyle = '#a85d00'; c.beginPath(); c.arc(48, 48, 33, 0, Math.PI * 2); c.stroke();
    c.lineWidth = 3; c.strokeStyle = '#fff3a8'; c.beginPath(); c.arc(48, 48, 43, Math.PI * 1.1, Math.PI * 1.7); c.stroke();
    c.fillStyle = '#a85d00'; c.font = 'bold 42px Arial Black, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('$', 49, 51);
    c.fillStyle = '#fff6b8'; c.fillText('$', 47, 48);
  });
  const bullet = cv(64, 128, c => {
    const g = c.createRadialGradient(32, 40, 2, 32, 56, 56);
    g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.18, 'rgba(255,250,200,1)'); g.addColorStop(0.4, 'rgba(255,190,40,.8)'); g.addColorStop(1, 'rgba(255,120,0,0)');
    c.fillStyle = g; c.beginPath(); c.ellipse(32, 56, 26, 56, 0, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#fff'; c.beginPath(); c.ellipse(32, 34, 9, 18, 0, 0, Math.PI * 2); c.fill();
  });
  const net = cv(256, 256, c => {
    c.translate(128, 128);
    const g = c.createRadialGradient(0, 0, 40, 0, 0, 124);
    g.addColorStop(0, 'rgba(255,240,150,0)'); g.addColorStop(0.75, 'rgba(255,220,90,.35)'); g.addColorStop(1, 'rgba(255,200,40,0)');
    c.fillStyle = g; c.beginPath(); c.arc(0, 0, 124, 0, Math.PI * 2); c.fill();
    c.strokeStyle = 'rgba(255,245,190,.9)'; c.lineWidth = 3;
    for (let r = 30; r <= 110; r += 26) { c.beginPath(); c.arc(0, 0, r, 0, Math.PI * 2); c.stroke(); }
    for (let i = 0; i < 16; i++) { const a = i / 16 * Math.PI * 2; c.beginPath(); c.moveTo(Math.cos(a) * 12, Math.sin(a) * 12); c.lineTo(Math.cos(a) * 112, Math.sin(a) * 112); c.stroke(); }
    c.lineWidth = 6; c.strokeStyle = '#ffe680'; c.beginPath(); c.arc(0, 0, 112, 0, Math.PI * 2); c.stroke();
  });
  const rays = cv(512, 512, c => {
    c.translate(256, 256);
    for (let i = 0; i < 18; i++) {
      const a = i / 18 * Math.PI * 2;
      const g = c.createLinearGradient(0, 0, Math.cos(a) * 256, Math.sin(a) * 256);
      g.addColorStop(0, 'rgba(255,240,170,.9)'); g.addColorStop(1, 'rgba(255,200,60,0)');
      c.fillStyle = g; c.beginPath(); c.moveTo(0, 0); c.arc(0, 0, 256, a - 0.07, a + 0.07); c.closePath(); c.fill();
    }
  });
  const bubble = cv(64, 64, c => {
    const g = c.createRadialGradient(32, 32, 18, 32, 32, 31);
    g.addColorStop(0, 'rgba(180,240,255,.05)'); g.addColorStop(0.85, 'rgba(200,250,255,.35)'); g.addColorStop(1, 'rgba(255,255,255,.8)');
    c.fillStyle = g; c.beginPath(); c.arc(32, 32, 30, 0, Math.PI * 2); c.fill();
    c.fillStyle = 'rgba(255,255,255,.9)'; c.beginPath(); c.ellipse(22, 20, 7, 4, -0.6, 0, Math.PI * 2); c.fill();
  });
  const spark = cv(64, 64, c => {
    c.translate(32, 32); c.fillStyle = '#fff';
    const g = c.createRadialGradient(0, 0, 0, 0, 0, 32); g.addColorStop(0, 'rgba(255,255,230,1)'); g.addColorStop(1, 'rgba(255,220,120,0)');
    c.fillStyle = g; c.beginPath();
    for (let i = 0; i < 8; i++) { const r = i % 2 ? 7 : 32; const a = i / 8 * Math.PI * 2; c.lineTo(Math.cos(a) * r, Math.sin(a) * r); }
    c.fill();
  });
  const reticle = cv(160, 160, c => {
    c.translate(80, 80); c.strokeStyle = '#ff3b5c'; c.lineWidth = 6; c.shadowColor = '#ff2040'; c.shadowBlur = 10;
    for (let i = 0; i < 4; i++) { c.beginPath(); c.arc(0, 0, 62, i * Math.PI / 2 + 0.25, i * Math.PI / 2 + Math.PI / 2 - 0.25); c.stroke(); }
    c.lineWidth = 4; c.beginPath(); c.arc(0, 0, 40, 0, Math.PI * 2); c.stroke();
    for (let i = 0; i < 4; i++) { c.save(); c.rotate(i * Math.PI / 2); c.beginPath(); c.moveTo(0, -76); c.lineTo(0, -48); c.stroke(); c.restore(); }
  });
  const water = cv(4, 256, c => {
    const g = c.createLinearGradient(0, 0, 0, 256);
    g.addColorStop(0, 'rgba(30,190,255,.55)'); g.addColorStop(0.45, 'rgba(8,90,170,.5)'); g.addColorStop(1, 'rgba(2,24,80,.72)');
    c.fillStyle = g; c.fillRect(0, 0, 4, 256);
  });
  const vignette = cv(512, 288, c => {
    const g = c.createRadialGradient(256, 150, 120, 256, 144, 330);
    g.addColorStop(0, 'rgba(0,10,30,0)'); g.addColorStop(1, 'rgba(0,8,26,.7)');
    c.fillStyle = g; c.fillRect(0, 0, 512, 288);
  });
  const beam = cv(128, 512, c => {
    const g = c.createLinearGradient(0, 0, 0, 512); g.addColorStop(0, 'rgba(220,255,255,.55)'); g.addColorStop(1, 'rgba(220,255,255,0)');
    c.fillStyle = g; c.beginPath(); c.moveTo(44, 0); c.lineTo(84, 0); c.lineTo(128, 512); c.lineTo(0, 512); c.closePath(); c.fill();
  });
  const caustic = cv(512, 512, c => {
    const pts: [number, number][] = []; for (let i = 0; i < 46; i++) pts.push([Math.random() * 512, Math.random() * 512]);
    for (let x = 0; x < 512; x += 4) for (let y = 0; y < 512; y += 4) {
      let d1 = 1e9, d2 = 1e9;
      for (const [px, py] of pts) for (const ox of [-512, 0, 512]) for (const oy of [-512, 0, 512]) { const d = Math.hypot(x - px - ox, y - py - oy); if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d; }
      const e = d2 - d1; if (e < 5) { c.globalAlpha = (1 - e / 5) * 0.8; c.fillStyle = '#fff'; c.fillRect(x - 1.5, y - 1.5, 5, 5); }
    }
    // soften once (filter on the whole canvas, not per rect)
    const tmp = document.createElement('canvas'); tmp.width = tmp.height = 512; const t = tmp.getContext('2d')!; t.filter = 'blur(2px)'; t.drawImage(c.canvas, 0, 0);
    c.globalAlpha = 1; c.clearRect(0, 0, 512, 512); c.drawImage(tmp, 0, 0);
  });
  const flare = cv(256, 64, c => {
    const g = c.createRadialGradient(128, 32, 0, 128, 32, 128); g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g; c.scale(1, 0.25); c.fillRect(0, 0, 256, 256);
  });
  return { glow, coin, bullet, net, rays, bubble, spark, reticle, water, vignette, beam, caustic, flare };
}
export type Tex = ReturnType<typeof makeTextures>;
