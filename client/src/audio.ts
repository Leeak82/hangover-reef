// Tiny Web Audio synth: every sound is generated, no audio files needed.
class Sfx {
  ctx: AudioContext | null = null;
  master!: GainNode; sfxBus!: GainNode; musicBus!: GainNode;
  muted = localStorage.getItem('hr_muted') === '1';
  private noiseBuf!: AudioBuffer;
  private musicTimer: number | null = null;
  private nextBeat = 0; private step = 0;

  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const Ctx = window.AudioContext || (window as any).webkitAudioContext;
    if (!Ctx) return;
    this.ctx = new Ctx();
    const c = this.ctx;
    this.master = c.createGain(); this.master.gain.value = this.muted ? 0 : 0.8;
    const comp = c.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 4;
    this.master.connect(comp).connect(c.destination);
    this.sfxBus = c.createGain(); this.sfxBus.gain.value = 0.9; this.sfxBus.connect(this.master);
    this.musicBus = c.createGain(); this.musicBus.gain.value = 0.22; this.musicBus.connect(this.master);
    this.noiseBuf = c.createBuffer(1, c.sampleRate, c.sampleRate);
    const d = this.noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }

  setMuted(m: boolean) { this.muted = m; localStorage.setItem('hr_muted', m ? '1' : '0'); if (this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.8, this.ctx.currentTime, 0.05); }

  private tone(freq: number, dur: number, type: OscillatorType, vol: number, when = 0, slideTo?: number, bus?: GainNode) {
    const c = this.ctx; if (!c) return;
    const t = c.currentTime + when;
    const o = c.createOscillator(); const g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.008); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(bus || this.sfxBus); o.start(t); o.stop(t + dur + 0.05);
  }
  private noise(dur: number, vol: number, freq: number, q = 1, when = 0, type: BiquadFilterType = 'bandpass', bus?: GainNode) {
    const c = this.ctx; if (!c) return;
    const t = c.currentTime + when;
    const s = c.createBufferSource(); s.buffer = this.noiseBuf;
    const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = c.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(bus || this.sfxBus); s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.05);
  }

  shoot() { this.tone(880, 0.09, 'square', 0.05, 0, 220); this.noise(0.06, 0.12, 3000, 0.8); this.tone(140, 0.08, 'sine', 0.15, 0, 60); }
  hit() { this.noise(0.05, 0.12, 1800, 2); this.tone(520, 0.04, 'triangle', 0.05); }
  net() { this.noise(0.15, 0.06, 900, 1.2, 0, 'lowpass'); }
  coin(i = 0) { const w = i * 0.045; this.tone(1568, 0.08, 'square', 0.035, w); this.tone(2093, 0.16, 'square', 0.03, w + 0.05); }
  kill(mult: number) {
    this.tone(330, 0.18, 'triangle', 0.18, 0, 660); this.noise(0.25, 0.15, 600, 0.7, 0, 'lowpass');
    const n = Math.min(12, 3 + Math.floor(mult / 6)); for (let i = 0; i < n; i++) this.coin(i);
  }
  bigWin() {
    const notes = [523, 659, 784, 1047, 784, 1047, 1319];
    notes.forEach((f, i) => { this.tone(f, 0.3, 'triangle', 0.16, i * 0.11); this.tone(f * 2, 0.2, 'square', 0.025, i * 0.11); });
    this.tone(65, 0.9, 'sawtooth', 0.12, 0, 40); this.noise(1.2, 0.2, 200, 0.5, 0, 'lowpass');
    for (let i = 0; i < 24; i++) this.coin(i * 0.9 + 8);
  }
  boss() { for (let i = 0; i < 3; i++) { this.tone(110, 0.5, 'sawtooth', 0.12, i * 0.62, 98); this.tone(116, 0.5, 'sawtooth', 0.08, i * 0.62, 104); } }
  click() { this.tone(660, 0.05, 'triangle', 0.08); }
  reject() { this.tone(200, 0.15, 'square', 0.05, 0, 120); }

  // laid-back beach lounge loop
  startMusic() {
    if (!this.ctx || this.musicTimer) return;
    this.nextBeat = this.ctx.currentTime + 0.1; this.step = 0;
    this.musicTimer = window.setInterval(() => this.schedule(), 60);
  }
  stopMusic() { if (this.musicTimer) clearInterval(this.musicTimer); this.musicTimer = null; }
  private schedule() {
    const c = this.ctx!; const spb = 60 / 104 / 2; // eighth notes at 104 bpm
    const prog = [[220, 277, 330], [196, 247, 294], [175, 220, 262], [196, 247, 294]];
    const bass = [55, 55, 49, 49, 44, 44, 49, 49];
    while (this.nextBeat < c.currentTime + 0.25) {
      const when = this.nextBeat - c.currentTime; const s = this.step % 32; const bar = Math.floor(s / 8);
      if (s % 4 === 0) { this.tone(70, 0.22, 'sine', 0.5, when, 40, this.musicBus); }
      if (s % 4 === 2) this.noise(0.12, 0.18, 2000, 0.6, when, 'highpass', this.musicBus);
      if (s % 2 === 1) this.noise(0.03, 0.08, 8000, 1, when, 'highpass', this.musicBus);
      if (s % 2 === 0) this.tone(bass[(s / 2) % 8] * (s % 8 === 6 ? 1.5 : 1), spb * 1.6, 'triangle', 0.35, when, undefined, this.musicBus);
      if (s % 8 === 2 || s % 8 === 5) prog[bar].forEach(f => this.tone(f * 2, 0.18, 'square', 0.025, when, undefined, this.musicBus));
      this.nextBeat += spb; this.step++;
    }
  }
}
export const sfx = new Sfx();
