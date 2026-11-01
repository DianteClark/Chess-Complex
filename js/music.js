// Generative soundtrack. Intensity 0 = menu, 1 = early match, 2 = storm / few left, 3 = final duel.
import { getCtx, buses } from './audio.js';

const N = (m) => 440 * Math.pow(2, (m - 69) / 12);
// chords as midi note sets (A minor world)
const PROG = {
  menu: [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]],      // Am F C G
  fight: [[57, 60, 64], [53, 57, 60], [50, 53, 57], [52, 56, 59]],     // Am F Dm E
  final: [[57, 60, 64], [58, 62, 65], [53, 57, 60], [52, 56, 59]],     // Am Bb F E
  siege: [[50, 53, 57], [46, 50, 53], [48, 52, 55], [45, 49, 52]],     // Dm Bb C A (co-op, heroic minor)
  boss: [[50, 53, 57], [51, 55, 58], [50, 53, 57], [49, 53, 56]],      // Dm Eb Dm C#dim-ish (Colossus wave)
};

class Music {
  constructor() { this.on = false; this.intensity = 0; this.target = 0; this.step = 0; this.bar = 0; this.next = 0; this.timer = null; this.mode = 'menu'; }
  start() {
    const a = getCtx(); if (!a || this.on) return;
    const { musicBus } = buses();
    this.a = a; this.on = true;
    this.out = a.createGain(); this.out.gain.value = 0; this.out.connect(musicBus);
    this.out.gain.linearRampToValueAtTime(1, a.currentTime + 2);
    this.delay = a.createDelay(); this.delay.delayTime.value = 60 / this.bpm() * 0.75;
    const fb = a.createGain(); fb.gain.value = 0.35; const dl = a.createBiquadFilter(); dl.type = 'lowpass'; dl.frequency.value = 2500;
    this.delay.connect(dl); dl.connect(fb); fb.connect(this.delay); dl.connect(this.out);
    this.next = a.currentTime + 0.1;
    this.timer = setInterval(() => this.schedule(), 25);
  }
  bpm() { return [84, 100, 112, 124][this.intensity]; }
  set(intensity, mode) { this.target = intensity; if (mode) this.pendingMode = mode; }
  schedule() {
    const a = this.a; if (!a) return;
    if (a.state !== 'running') return;
    if (this.next < a.currentTime) this.next = a.currentTime + 0.05;
    while (this.next < a.currentTime + 0.15) { this.play(this.step, this.next); this.advance(); }
  }
  advance() {
    const sixteenth = 60 / this.bpm() / 4;
    this.next += sixteenth; this.step++;
    if (this.step % 16 === 0) {
      this.bar++;
      if (this.bar % 2 === 0 || this.target > this.intensity) { this.intensity = this.target; if (this.pendingMode) { this.mode = this.pendingMode; this.pendingMode = null; } }
      this.delay.delayTime.setValueAtTime(60 / this.bpm() * 0.75, this.next);
    }
  }
  play(step, t) {
    const s = step % 16, I = this.intensity;
    const prog = PROG[this.mode] || PROG.menu;
    const ch = prog[Math.floor(this.bar / (I >= 2 ? 1 : 2)) % 4];
    if (s === 0) this.pad(ch, t, 60 / this.bpm() * 4 * (I >= 2 ? 1 : 2));
    // bass
    if (I >= 1 && (s % 4 === 0 || (I >= 2 && s % 4 === 2) || (I >= 3 && s % 2 === 1 && Math.random() < 0.3))) this.bass(N(ch[0] - 24), t, s % 4 === 0 ? 0.32 : 0.2);
    // arp
    const arpEvery = I === 0 ? 4 : I === 1 ? 2 : 1;
    if (s % arpEvery === 0) {
      const pat = [0, 1, 2, 1, 0, 2, 1, 2];
      const idx = pat[(s / arpEvery) % pat.length];
      const oct = I >= 2 && s % 8 >= 4 ? 24 : 12;
      this.pluck(N(ch[idx] + oct), t, I === 0 ? 0.05 : 0.065);
    }
    // drums
    if (I >= 2) {
      if (s === 0 || s === 8 || (I >= 3 && (s === 4 || s === 12)) || (s === 14 && Math.random() < 0.4)) this.kick(t);
      if (s === 4 || s === 12) this.snare(t);
      if (s % 2 === 1 || (I >= 3 && Math.random() < 0.5)) this.hat(t, s % 4 === 2 ? 0.06 : 0.035);
    } else if (I === 1 && s % 8 === 4) this.hat(t, 0.025);
    // lead motif at max intensity
    if (I >= 3 && s === 0 && this.bar % 2 === 1) [0, 3, 6].forEach((o, i) => this.pluck(N(ch[2] + 24 - i * 2), t + i * 60 / this.bpm() / 2, 0.06));
  }
  env(g, t, a, v, d) { g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(v, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + d); }
  pad(ch, t, dur) {
    const a = this.a;
    const f = a.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 700 + this.intensity * 300; f.Q.value = 0.7;
    const g = a.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.09, t + dur * 0.3); g.gain.linearRampToValueAtTime(0.0001, t + dur * 1.05);
    f.connect(g); g.connect(this.out);
    for (const m of ch) for (const det of [-7, 7]) { const o = a.createOscillator(); o.type = 'sawtooth'; o.frequency.value = N(m); o.detune.value = det; o.connect(f); o.start(t); o.stop(t + dur * 1.1); }
  }
  bass(fr, t, v) {
    const a = this.a, o = a.createOscillator(), g = a.createGain(), f = a.createBiquadFilter();
    o.type = 'triangle'; o.frequency.value = fr; f.type = 'lowpass'; f.frequency.value = 600;
    this.env(g, t, 0.01, v, t + 0.35 - t); o.connect(f); f.connect(g); g.connect(this.out); o.start(t); o.stop(t + 0.4);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
  }
  pluck(fr, t, v) {
    const a = this.a, o = a.createOscillator(), g = a.createGain();
    o.type = 'triangle'; o.frequency.value = fr;
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(v, t + 0.005); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
    o.connect(g); g.connect(this.out); g.connect(this.delay); o.start(t); o.stop(t + 0.32);
  }
  kick(t) {
    const a = this.a, o = a.createOscillator(), g = a.createGain();
    o.frequency.setValueAtTime(140, t); o.frequency.exponentialRampToValueAtTime(40, t + 0.15);
    g.gain.setValueAtTime(0.5, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
    o.connect(g); g.connect(this.out); o.start(t); o.stop(t + 0.26);
  }
  noiseBuf() { if (!this._nb) { const a = this.a, len = a.sampleRate * 0.3, b = a.createBuffer(1, len, a.sampleRate), d = b.getChannelData(0); for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1; this._nb = b; } return this._nb; }
  snare(t) {
    const a = this.a, s = a.createBufferSource(), f = a.createBiquadFilter(), g = a.createGain();
    s.buffer = this.noiseBuf(); f.type = 'bandpass'; f.frequency.value = 1800; f.Q.value = 0.8;
    g.gain.setValueAtTime(0.22, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
    s.connect(f); f.connect(g); g.connect(this.out); s.start(t); s.stop(t + 0.2);
  }
  hat(t, v) {
    const a = this.a, s = a.createBufferSource(), f = a.createBiquadFilter(), g = a.createGain();
    s.buffer = this.noiseBuf(); f.type = 'highpass'; f.frequency.value = 7000;
    g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
    s.connect(f); f.connect(g); g.connect(this.out); s.start(t); s.stop(t + 0.06);
  }
}
export const music = new Music();
