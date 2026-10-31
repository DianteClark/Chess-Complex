// Synthesised sound effects — no audio files needed.
let ac = null, master = null, muted = false;
try { muted = localStorage.getItem('cc_muted') === '1'; } catch {}

function ctx() {
  if (!ac) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ac = new AC(); master = ac.createGain(); master.gain.value = 0.5; master.connect(ac.destination);
  }
  if (ac.state === 'suspended') ac.resume();
  return ac;
}
export function unlockAudio() { ctx(); }
export const isMuted = () => muted;
export function setMuted(m) { muted = m; try { localStorage.setItem('cc_muted', m ? '1' : '0'); } catch {} }

function tone(f, d, { type = 'sine', v = 0.3, slide = 0, at = 0, attack = 0.005 } = {}) {
  const a = ctx(); if (!a || muted) return;
  const t = a.currentTime + at;
  const o = a.createOscillator(), g = a.createGain();
  o.type = type; o.frequency.setValueAtTime(f, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, f * slide), t + d);
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(v, t + attack); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
  o.connect(g); g.connect(master); o.start(t); o.stop(t + d + 0.02);
}
function noise(d, { v = 0.3, f = 1200, q = 1, at = 0, type = 'lowpass' } = {}) {
  const a = ctx(); if (!a || muted) return;
  const t = a.currentTime + at;
  const len = Math.floor(a.sampleRate * d), buf = a.createBuffer(1, len, a.sampleRate), data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = a.createBufferSource(); src.buffer = buf;
  const fl = a.createBiquadFilter(); fl.type = type; fl.frequency.value = f; fl.Q.value = q;
  const g = a.createGain(); g.gain.value = v;
  src.connect(fl); fl.connect(g); g.connect(master); src.start(t);
}

export const sfx = {
  tap: () => tone(660, 0.05, { type: 'triangle', v: 0.12 }),
  select: () => { tone(520, 0.06, { type: 'triangle', v: 0.12 }); tone(780, 0.08, { type: 'triangle', v: 0.1, at: 0.04 }); },
  step: () => { noise(0.06, { v: 0.25, f: 900 }); tone(180, 0.06, { type: 'sine', v: 0.15, slide: 0.6 }); },
  slide: () => noise(0.18, { v: 0.18, f: 2400, type: 'bandpass', q: 0.7 }),
  jump: () => { tone(240, 0.2, { type: 'triangle', v: 0.18, slide: 2 }); noise(0.1, { v: 0.2, f: 600, at: 0.3 }); tone(90, 0.15, { v: 0.3, at: 0.3, slide: 0.5 }); },
  whoosh: () => noise(0.25, { v: 0.25, f: 1800, type: 'bandpass', q: 0.5 }),
  hit: () => { noise(0.12, { v: 0.45, f: 1600 }); tone(140, 0.14, { type: 'square', v: 0.12, slide: 0.4 }); },
  crit: () => { noise(0.18, { v: 0.5, f: 3000 }); tone(880, 0.18, { type: 'sawtooth', v: 0.1, slide: 0.3 }); tone(110, 0.25, { v: 0.35, slide: 0.4 }); },
  kill: () => { noise(0.4, { v: 0.5, f: 800 }); tone(220, 0.5, { type: 'sawtooth', v: 0.14, slide: 0.25 }); tone(330, 0.4, { type: 'triangle', v: 0.12, slide: 0.3, at: 0.05 }); },
  crate: () => { noise(0.15, { v: 0.4, f: 700 }); tone(300, 0.08, { type: 'square', v: 0.06, slide: 0.5 }); },
  pickup: () => { tone(988, 0.08, { type: 'triangle', v: 0.14 }); tone(1319, 0.14, { type: 'triangle', v: 0.12, at: 0.06 }); },
  heal: () => { tone(523, 0.2, { v: 0.12 }); tone(784, 0.3, { v: 0.1, at: 0.08 }); },
  promote: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.35, { type: 'triangle', v: 0.14, at: i * 0.08 })),
  crown: () => [392, 523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, 0.5, { type: 'triangle', v: 0.13, at: i * 0.07 })),
  turn: () => { tone(740, 0.1, { type: 'triangle', v: 0.14 }); tone(1110, 0.18, { type: 'triangle', v: 0.12, at: 0.08 }); },
  storm: () => { noise(1.2, { v: 0.5, f: 220 }); tone(55, 1.2, { type: 'sawtooth', v: 0.12, slide: 0.7 }); },
  warn: () => { tone(330, 0.15, { type: 'square', v: 0.08 }); tone(330, 0.15, { type: 'square', v: 0.08, at: 0.22 }); },
  error: () => tone(160, 0.12, { type: 'square', v: 0.08 }),
  buy: () => { [659, 880, 1175, 1568].forEach((f, i) => tone(f, 0.25, { type: 'triangle', v: 0.12, at: i * 0.06 })); noise(0.3, { v: 0.1, f: 6000, type: 'highpass', at: 0.2 }); },
  win: () => [523, 659, 784, 1047, 784, 1047, 1319].forEach((f, i) => tone(f, 0.4, { type: 'triangle', v: 0.14, at: i * 0.12 })),
  lose: () => [392, 330, 262, 196].forEach((f, i) => tone(f, 0.45, { type: 'triangle', v: 0.13, at: i * 0.16 })),
};

export function playEvents(events, myId) {
  let hit = 0, crit = false, kill = false;
  for (const e of events) {
    if (e.e === 'dmg') { hit++; crit ||= e.crit; }
    if (e.e === 'death') kill = true;
  }
  if (kill) sfx.kill(); else if (crit) sfx.crit(); else if (hit) sfx.hit();
  for (const e of events) {
    switch (e.e) {
      case 'move': e.how === 'jump' ? sfx.jump() : e.how === 'step' || e.how === 'push' ? sfx.step() : e.how === 'dash' ? sfx.whoosh() : sfx.slide(); break;
      case 'crate': sfx.crate(); break;
      case 'pickup': sfx.pickup(); break;
      case 'heal': if (e.id === myId) sfx.heal(); break;
      case 'promote': sfx.promote(); break;
      case 'crowned': case 'crownSpawn': sfx.crown(); break;
      case 'storm': e.phase === 'collapse' ? sfx.storm() : sfx.warn(); break;
      case 'turn': if (e.id === myId) sfx.turn(); break;
    }
  }
}
