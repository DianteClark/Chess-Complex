// Chess Complex 10.0 generative soundtrack (A2). Everything is synthesised with Web Audio: no audio files.
//
// Structure
//   Composition: every theme is a key + mode + chord progression (roman numerals), voice-led 4-part pads,
//   bass / arp / drum patterns chosen by an energy value (0..1), and a lead that quotes the main theme
//   ("The Crown Motif") transformed into each theme's mode (major for the King, phrygian for Duels...).
//   Arrangement: layers (pad, bass, arp, drums, lead, bell) enter and leave on bar lines as energy rises.
//   Master chain: layers -> mix -> highpass -> glue compressor -> limiter -> duck -> fade -> audio.js musicBus,
//   with a generated stereo reverb and a ping-pong tempo delay as sends.
//   Scheduler: lookahead (setInterval + AudioContext clock); persistent oscillators for pads and the lead,
//   shared filters per drum/voice type, cached noise buffers, so per-note cost is one or two tiny nodes.
//
// API (main.js / announcer.js)
//   music.start()                 once, from a user gesture (audio.js unlock)
//   music.set(level, mood)        level 0..3, mood = theme id (old ids 'menu' / 'fight' still work)
//   music.newMatch(); music.match(state, me)   per state update in a match; handles stingers on its own
//   music.sting(name)             victory | defeat | end | crowned | final | wave | boss
//   music.duck(ms, depth)         dip the music under a big moment (depth 0..1 = remaining level)
//   music.stats()                 scheduler cost for QA
import { getCtx, buses, settings, isLite, onCtxSwap, onSfxEvent } from './audio.js';

const LOOK = 0.3;        // seconds scheduled ahead (survives ~250 ms main-thread stalls on phones)
const TICK = 50;         // scheduler period (ms)
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const rnd = Math.random;
// k-rate automation: params of persistent nodes are computed once per 128-sample block instead of per sample (big CPU win)
const kr = (...ps) => { for (const p of ps) try { p.automationRate = 'k-rate'; } catch {} };
const human = (ms) => (rnd() + rnd() - 1) * ms / 1000; // triangular jitter

// ---------------------------------------------------------------- music theory
const SCALES = {
  ionian: [0, 2, 4, 5, 7, 9, 11], dorian: [0, 2, 3, 5, 7, 9, 10], phrygian: [0, 1, 3, 5, 7, 8, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11], mixolydian: [0, 2, 4, 5, 7, 9, 10], aeolian: [0, 2, 3, 5, 7, 8, 10],
  harmonic: [0, 2, 3, 5, 7, 8, 11], phrygdom: [0, 1, 4, 5, 7, 8, 10],
};
const ROMAN = { I: 0, II: 2, III: 4, IV: 5, V: 7, VI: 9, VII: 11 };
// 'bVI', 'iv', 'V7', 'IM7', 'i9', 'Vsus', 'viio' -> semitones above the key tonic
function chord(sym) {
  const m = /^([b#]?)(iv|i{1,3}|vi{0,2}|IV|I{1,3}|VI{0,2})(.*)$/.exec(sym); // iv / IV before i / I (15.0 fix: IV used to parse as I + 'V')
  if (!m) throw new Error('chord ' + sym);
  const root = ROMAN[m[2].toUpperCase()] + (m[1] === 'b' ? -1 : m[1] === '#' ? 1 : 0);
  const minor = m[2] === m[2].toLowerCase(), q = m[3];
  let iv = minor ? [0, 3, 7] : [0, 4, 7];
  if (q.includes('o')) iv = [0, 3, 6];
  if (q.includes('+')) iv = [0, 4, 8];
  if (q.includes('sus2')) iv = [0, 2, 7]; else if (q.includes('sus')) iv = [0, 5, 7];
  if (q.includes('M7')) iv.push(11); else if (q.includes('7') || q.includes('9')) iv.push(q.includes('o7') ? 9 : 10);
  if (q.includes('9')) iv.push(14);
  if (q.includes('add9')) iv.push(14);
  return iv.map((x) => root + x);
}
const PERMS = (() => { const out = [], p = (a, r) => { if (!a.length) out.push(r); a.forEach((x, i) => p(a.filter((_, j) => j !== i), [...r, x])); }; p([0, 1, 2, 3], []); return out; })();
// 4-voice voice leading: smallest total motion, no crossings, inside [lo, hi]
function voiceLead(prev, pcs, lo, hi) {
  const tgt = pcs.length >= 4 ? [pcs[0], pcs[1], pcs[2], pcs[3]] : [pcs[0], pcs[1], pcs[2], pcs[0]];
  let best = null, bc = 1e9;
  for (const perm of PERMS) {
    let cost = 0; const out = [0, 0, 0, 0];
    for (let i = 0; i < 4; i++) {
      const p = prev[i], pc = tgt[perm[i]];
      let n = p - ((((p - pc) % 12) + 12) % 12); if (p - n > 6) n += 12;
      while (n < lo) n += 12; while (n > hi) n -= 12;
      out[i] = n; cost += Math.abs(n - p);
    }
    for (let i = 1; i < 4; i++) { if (out[i] < out[i - 1]) cost += 3; if (out[i] === out[i - 1]) cost += 4; }
    if (cost < bc) { bc = cost; best = out; }
  }
  return best;
}

// ---------------------------------------------------------------- the main theme ("The Crown Motif")
// [step (16ths), length, scale degree (0 = tonic, negative = below)]. Hook: rising fourth then stepwise climb.
const MAIN = [[0, 4, -3], [4, 2, 0], [6, 2, 1], [8, 6, 2], [14, 2, 1], [16, 4, 0], [20, 4, 4], [24, 6, 3], [30, 2, 2],
  [32, 4, 1], [36, 2, 2], [38, 2, 3], [40, 6, 4], [46, 2, 5], [48, 6, 4], [54, 2, 3], [56, 8, 1]];
const ANSWER = [[0, 4, 2], [4, 2, 1], [6, 2, 0], [8, 6, 4], [14, 2, 3], [16, 4, 2], [20, 4, 0], [24, 8, 1],
  [32, 4, 0], [36, 2, 2], [38, 2, 3], [40, 6, 4], [46, 2, 6], [48, 4, 7], [52, 4, 6], [56, 6, 4], [62, 2, -1]];
const motifBank = (() => {
  const full = [...MAIN, ...ANSWER.map(([s, l, d]) => [s + 64, l, d])];
  const scale = (list, k) => list.map(([s, l, d]) => [s * k, l * k, d]);
  const build = (list, len) => { const arr = new Array(len).fill(null); for (const n of list) arr[Math.round(n[0])] = n; return arr; };
  return {
    full: build(full, 128),                                   // 8 bars: statement + answer
    aug: build(scale(MAIN, 2), 128),                          // 8 bars, broad (boss, final)
    dim: build(scale(full, 0.5).map(([s, l, d]) => [s, Math.max(1, l), d]), 64), // 4 bars, twice per phrase (blitz)
    head: build(MAIN.filter((n) => n[0] < 16), 128),          // bar 1 only (duel, sparse)
    heads: build([...MAIN.filter((n) => n[0] < 16), ...MAIN.filter((n) => n[0] < 16).map(([s, l, d]) => [s + 64, l, d + 2])], 128),
  };
})();

// ---------------------------------------------------------------- themes
// Drum pattern lanes: k kick, s snare, c clap, h hat, H open hat, p shaker, t low tom, T high tom, r rim. X/x/o = accent/normal/ghost, ? = maybe.
// Bass: R/r root accent/soft, O octave, 5 fifth, a approach (to the next chord), - hold, . rest.
const THEMES = {
  title: {
    key: 57, scale: 'aeolian', bpm: [90, 90], fixed: 0.5, swing: 0.04, rev: 0.34, dly: 0.2,
    prog: ['i', 'bVI', 'bIII', 'bVII', 'i', 'bVI', 'iv', ['V', 'V7']],
    pad: { wave: 'sawtooth', cut: 900, lfo: 0.07, v: 0.05 }, bassWave: 'triangle', arpWave: 'bell', leadWave: ['triangle', 'sine'],
    layers: { bass: 0.1, arp: 0.1, drums: 0.3, lead: 0.4, bell: 0.9 },
    bass: [[0, 'R-------5-------']],
    arp: [[0, { rate: 2, seq: [0, 2, 1, 3, 2, 1, 3, 2], oct: 12, v: 0.05, gate: 3 }]],
    drums: [[0.3, { k: 'X.......x.......', p: '..o...o...o...oo', r: '........o.......' }]],
    lead: { mode: 'full', oct: 12, start: 1, every: 2, v: 0.09 },
  },
  armory: {
    key: 50, scale: 'dorian', bpm: [74, 74], fixed: 0.35, swing: 0.08, rev: 0.45, dly: 0.3,
    prog: ['i7', 'IV7', 'i9', ['bVIIM7', 'IV']],
    pad: { wave: 'triangle', cut: 1400, lfo: 0.05, v: 0.07 }, bassWave: 'sine', arpWave: 'bell', leadWave: ['sine', 'triangle'],
    layers: { bass: 0, arp: 0, drums: 0.3, lead: 0.3, bell: 2 },
    bass: [[0, 'R-------------5-']],
    arp: [[0, { rate: 3, seq: [0, 3, 1, 2, 3, 0, 2, 1], oct: 12, v: 0.045, gate: 2, sparse: 0.25 }]],
    drums: [[0.3, { p: '....o.......o..?', r: '?...........o...' }]],
    lead: { mode: 'heads', oct: 24, start: 1, every: 2, v: 0.05, bell: true },
  },
  results: {
    key: 53, scale: 'ionian', bpm: [82, 82], fixed: 0.4, swing: 0.05, rev: 0.42, dly: 0.26,
    prog: ['IM7', 'vi7', 'IVM7', ['ii7', 'Vsus']],
    pad: { wave: 'sawtooth', cut: 1000, lfo: 0.06, v: 0.05 }, bassWave: 'triangle', arpWave: 'bell', leadWave: ['triangle', 'sine'],
    layers: { bass: 0, arp: 0, drums: 0.3, lead: 0.3, bell: 2 },
    bass: [[0, 'R-------R---5---']],
    arp: [[0, { rate: 2, seq: [0, 1, 2, 3, 2, 1, 2, 3], oct: 12, v: 0.04, gate: 3 }]],
    drums: [[0.3, { k: 'x...............', p: '..o...o...o...o.' }]],
    lead: { mode: 'full', oct: 12, start: 1, every: 2, v: 0.07 },
  },
  royale: {
    key: 52, scale: 'aeolian', bpm: [104, 122], swing: 0.02, rev: 0.26, dly: 0.18, pump: 0.35,
    prog: ['i', 'bVI', 'bIII', 'bVII', 'i', 'bVI', 'iv', ['V', 'V7']],
    pad: { wave: 'sawtooth', cut: 700, lfo: 0.1, v: 0.045 }, bassWave: 'sawtooth', arpWave: 'square', leadWave: ['sawtooth', 'square'],
    layers: { bass: 0.15, arp: 0.25, drums: 0.3, lead: 0.55, bell: 0.8 },
    bass: [[0, 'R-------R---5---'], [0.45, 'R.r.R.r.R.r.5.a.'], [0.75, 'RrOrRrOrRrOr5rar']],
    arp: [[0, { rate: 4, seq: [0, 1, 2, 3], oct: 12, v: 0.04, gate: 2 }], [0.5, { rate: 2, seq: [0, 1, 2, 3, 2, 1, 3, 2], oct: 12, v: 0.045, gate: 1.4 }], [0.8, { rate: 1, seq: [0, 1, 2, 3, 4, 3, 2, 1], oct: 12, v: 0.04, gate: 0.8 }]],
    drums: [[0.3, { k: 'X.......X.......', h: '..o...o...o...o.' }],
      [0.5, { k: 'X.......X.x.....', s: '....X.......X...', h: 'x.o.x.o.x.o.x.oo' }],
      [0.75, { k: 'X..x..x.X.x...x.', s: '....X.......X..o', h: 'xoxoxoxoxoxoxoxo', H: '..............x.' }]],
    lead: { mode: 'full', oct: 12, start: 0, every: 1, v: 0.075 },
  },
  blitz: {
    key: 50, scale: 'aeolian', bpm: [138, 150], swing: 0, rev: 0.2, dly: 0.14, pump: 0.45, floor: 0.45,
    prog: ['i', 'bVII', 'bVI', ['bVII', 'V']],
    pad: { wave: 'sawtooth', cut: 900, lfo: 0.15, v: 0.04 }, bassWave: 'sawtooth', arpWave: 'square', leadWave: ['square', 'sawtooth'],
    layers: { bass: 0, arp: 0, drums: 0, lead: 0.5, bell: 0.85 },
    bass: [[0, 'RORORORORORORORO'], [0.7, 'RORORORORORO5O5a']],
    arp: [[0, { rate: 1, seq: [0, 2, 1, 3, 2, 4, 3, 1], oct: 12, v: 0.035, gate: 0.7 }]],
    drums: [[0, { k: 'X...X...X...X...', s: '....X.......X...', h: '..x...x...x...x.' }],
      [0.6, { k: 'X...X...X...X.x.', s: '....X..o....X.oo', h: 'xxxxxxxxxxxxxxxx', H: '..x...x...x...x.' }]],
    lead: { mode: 'dim', oct: 12, start: 0, every: 1, v: 0.065 },
  },
  duel: {
    key: 49, scale: 'phrygian', bpm: [82, 98], swing: 0, rev: 0.36, dly: 0.28,
    prog: ['i', 'bII', 'i', 'bII', 'iv', 'bII', 'Vsus', ['V', 'bII']],
    pad: { wave: 'triangle', cut: 600, lfo: 0.05, v: 0.065 }, bassWave: 'sawtooth', arpWave: 'pluck', leadWave: ['triangle', 'sawtooth'],
    layers: { bass: 0, arp: 0.3, drums: 0.15, lead: 0.4, bell: 0.75 },
    bass: [[0, 'R.......r.......'], [0.4, 'R..r....R..r....'], [0.7, 'R.rR..r.R.rR..ra']],
    arp: [[0, { rate: 2, seq: [3, 1, 2, 0, 3, 2, 1, 0], oct: 12, v: 0.045, gate: 1, sparse: 0.45 }], [0.65, { rate: 1, seq: [0, 1, 0, 2, 0, 3, 0, 2], oct: 12, v: 0.035, gate: 0.6, sparse: 0.2 }]],
    drums: [[0.15, { r: 'x...o...x...o...' }], [0.45, { t: 'X.........x.....', r: 'x.o.x.o.x.o.x.o.' }],
      [0.7, { k: 'X.........X.....', t: 'X.....x...X...x.', s: '............X...', r: 'xoxoxoxoxoxoxoxo' }]],
    lead: { mode: 'head', oct: 24, start: 0, every: 1, v: 0.06 },
  },
  squads: {
    key: 55, scale: 'dorian', bpm: [108, 124], swing: 0.06, rev: 0.24, dly: 0.2, pump: 0.3,
    prog: ['i7', 'IV', 'bVII', 'i7', 'bVI', 'bVII', 'IV', ['V', 'V7']],
    pad: { wave: 'sawtooth', cut: 850, lfo: 0.09, v: 0.042 }, bassWave: 'square', arpWave: 'pluck', leadWave: ['sawtooth', 'triangle'],
    layers: { bass: 0.1, arp: 0.2, drums: 0.25, lead: 0.5, bell: 0.8 },
    bass: [[0, 'R.....r.R.......'], [0.45, 'R..r..O.R.5..r.a'], [0.75, 'R.rO.rR.5.rO.r5a']],
    arp: [[0, { rate: 2, seq: [0, 2, 3, 1, 2, 3, 1, 2], oct: 12, v: 0.042, gate: 1.2 }], [0.7, { rate: 1, seq: [0, 2, 1, 3, 2, 4, 3, 2], oct: 12, v: 0.035, gate: 0.7 }]],
    drums: [[0.25, { k: 'X.........X.....', c: '....X.......X...', p: 'oooooooooooooooo' }],
      [0.5, { k: 'X..x......X..x..', c: '....X.......X...', h: 'x.x.x.x.x.x.x.x.', p: '.o.o.o.o.o.o.o.o' }],
      [0.75, { k: 'X..x..x...X..x..', s: '....X..o....X..o', c: '....X.......X...', h: 'xoxoxoxoxoxoxoxo', H: '......x.......x.' }]],
    lead: { mode: 'full', oct: 12, start: 0, every: 1, v: 0.072 },
  },
  siege: {
    key: 50, scale: 'aeolian', bpm: [96, 112], swing: 0, rev: 0.32, dly: 0.16,
    prog: ['i', 'bVI', 'bVII', 'i', 'iv', 'bVI', ['bVII', 'V'], 'V'],
    pad: { wave: 'sawtooth', cut: 800, lfo: 0.07, v: 0.05 }, bassWave: 'sawtooth', arpWave: 'saw', leadWave: ['sawtooth', 'sawtooth'],
    layers: { bass: 0, arp: 0.2, drums: 0, lead: 0.45, bell: 0.8 },
    bass: [[0, 'R-------R---R-a-'], [0.5, 'R.R.R.r.R.R.5.a.']],
    arp: [[0, { rate: 2, seq: [0, 0, 1, 0, 2, 0, 1, 0], oct: 0, v: 0.05, gate: 0.9 }], [0.6, { rate: 1, seq: [0, 1, 2, 1, 0, 1, 2, 3], oct: 12, v: 0.04, gate: 0.6 }]],
    drums: [[0, { t: 'X.......x.......', T: '..............o.' }],
      [0.45, { t: 'X..x..x.X.......', T: '............x.x.', s: '........X.......' }],
      [0.7, { k: 'X.......X.......', t: 'X..x..x.X..x....', T: '............xxxx', s: '....X.......X...', H: 'x...............' }]],
    lead: { mode: 'full', oct: 12, start: 0, every: 1, v: 0.08, brass: true },
  },
  boss: {
    key: 50, scale: 'harmonic', bpm: [118, 126], swing: 0, rev: 0.28, dly: 0.12, pump: 0.3, floor: 0.7,
    prog: ['i', 'bII', 'i', 'bII', 'bVI', 'V', 'bII', ['V', 'V7']],
    pad: { wave: 'sawtooth', cut: 900, lfo: 0.2, v: 0.05 }, bassWave: 'sawtooth', arpWave: 'saw', leadWave: ['sawtooth', 'sawtooth'],
    layers: { bass: 0, arp: 0, drums: 0, lead: 0, bell: 0.85 },
    bass: [[0, 'RRrRRRrRRRrRRrar'], [0.85, 'RORrRORr5O5rRrar']],
    arp: [[0, { rate: 1, seq: [0, 1, 0, 2, 0, 3, 0, 2], oct: 0, v: 0.04, gate: 0.6 }]],
    drums: [[0, { k: 'X.x.X...X.x.X...', s: '....X.......X...', t: '..x.......x...x.', h: 'x.x.x.x.x.x.x.x.' }],
      [0.85, { k: 'XxXxXxXxXxXxXxXx', s: '....X.......X..x', t: 'X.....x...X.....', H: 'x.x.x.x.x.x.x.x.' }]],
    lead: { mode: 'aug', oct: 12, start: 0, every: 1, v: 0.085, brass: true },
  },
  final: {
    key: 57, scale: 'harmonic', bpm: [126, 134], swing: 0, rev: 0.28, dly: 0.18, pump: 0.4, floor: 0.75,
    prog: ['i', 'bVI', 'iv', 'V', 'i', 'bVI', 'bII', 'V7'],
    pad: { wave: 'sawtooth', cut: 1000, lfo: 0.12, v: 0.045 }, bassWave: 'sawtooth', arpWave: 'saw', leadWave: ['sawtooth', 'square'],
    layers: { bass: 0, arp: 0, drums: 0, lead: 0, bell: 0.85 },
    bass: [[0, 'R.RrR.RrR.Rr5.ar'], [0.88, 'RrRrRrRrRrRr5r5a']],
    arp: [[0, { rate: 1, seq: [0, 1, 2, 3, 2, 1, 2, 3], oct: 12, v: 0.035, gate: 0.6 }]],
    drums: [[0, { k: 'X...X...X...X.x.', s: '....X.......X...', h: 'xoxoxoxoxoxoxoxo', t: '..............xx' }],
      [0.88, { k: 'X.xxX...X.xxX.x.', s: '....X..o....X.xo', h: 'xxxxxxxxxxxxxxxx', H: '..x...x...x...x.', t: '............xxxx' }]],
    lead: { mode: 'full', oct: 12, start: 0, every: 1, v: 0.085, double: true },
  },
  king: {
    key: 57, scale: 'ionian', bpm: [100, 108], swing: 0, rev: 0.34, dly: 0.16, floor: 0.55,
    prog: ['I', 'bVII', 'IV', 'I', 'vi', 'IV', 'bVII', ['V', 'Vsus']],
    pad: { wave: 'sawtooth', cut: 1200, lfo: 0.08, v: 0.05 }, bassWave: 'sawtooth', arpWave: 'bell', leadWave: ['sawtooth', 'sawtooth'],
    layers: { bass: 0, arp: 0, drums: 0, lead: 0, bell: 0.7 },
    bass: [[0, 'R-----R-5-----a-'], [0.8, 'R.R.O.R.5.5.O.a.']],
    arp: [[0, { rate: 2, seq: [0, 1, 2, 3, 4, 3, 2, 1], oct: 12, v: 0.04, gate: 2 }]],
    drums: [[0, { k: 'X.......X.......', t: 'x.....x.x...x.xx', s: '........X.......', H: 'x...............' }],
      [0.8, { k: 'X.....x.X.......', t: 'X..x..x.X..x.xxx', s: '....X.......X...', h: 'x.x.x.x.x.x.x.x.' }]],
    lead: { mode: 'full', oct: 12, start: 0, every: 1, v: 0.085, brass: true },
  },
  silence: { key: 57, scale: 'aeolian', bpm: [90, 90], fixed: 0, prog: ['i'], pad: { wave: 'triangle', cut: 500, lfo: 0, v: 0 }, layers: { bass: 2, arp: 2, drums: 2, lead: 2, bell: 2 }, bass: [], arp: [], drums: [], lead: null, silent: true },
};
const ALIAS = { menu: 'title', fight: 'royale', store: 'armory', daily: 'royale', tutorial: 'royale' };
const LANES = ['k', 's', 'c', 'h', 'H', 'p', 't', 'T', 'r'];
const VEL = { X: 1, x: 0.75, o: 0.4, '?': -0.5 };
// compile strings once
for (const th of Object.values(THEMES)) {
  th.chords = th.prog.map((c) => (Array.isArray(c) ? c : [c]).map(chord));
  th.drums = th.drums.map(([e, p]) => [e, LANES.filter((l) => p[l]).map((l) => [l, [...p[l]].map((ch) => VEL[ch] || 0)])]);
  th.bass = th.bass.map(([e, p]) => [e, [...p].map((ch, i) => { if (ch === '.' || ch === '-') return null; let len = 1; while (p[i + len] === '-') len++; return { k: ch, len }; })]);
  th.scaleArr = SCALES[th.scale];
}

// ---------------------------------------------------------------- 15.0 World Tour: location flavours
// The mode theme sets the intensity (tempo range, drum / bass / arp patterns per energy, layer thresholds, lead
// treatment); the location sets key, scale, harmony, instrumentation, a signature "colour" voice and an ambient bed.
// Mode x location themes are composed on demand ('royale@forge') so every pairing is seamless: same groove engine,
// same Crown Motif, new place. Dramatic themes (duel, final, boss, king) keep their own harmony and take the
// location's key, instruments and colour, so a match never changes key when the stakes rise.
// prog: harmony for the open themes. color: per-16th signature voice. bed: filtered-noise ambience under everything.
const LOC = {
  citadel: { key: 50, scale: 'dorian', prog: ['i', 'bVII', 'IV', 'i', 'bVI', 'bVII', 'IVsus2', ['IV', 'V']], pad: { wave: 'triangle', cut: 1500, lfo: 0.06 }, bassWave: 'sine', arpWave: 'bell', leadWave: ['triangle', 'sine'], rev: 0.42, dly: 0.26, swing: 0, color: 'ice', bed: { type: 'bandpass', f: 900, q: 1.6, v: 0.05, lfo: 0.09, depth: 500 } },
  forge: { key: 48, scale: 'phrygian', prog: ['i', 'bII', 'bvii', 'i', 'bVI', 'bII', 'iv', ['bvii', 'bII']], pad: { wave: 'sawtooth', cut: 600, lfo: 0.12 }, bassWave: 'sawtooth', arpWave: 'saw', leadWave: ['sawtooth', 'square'], rev: 0.24, dly: 0.12, swing: 0, brass: true, color: 'anvil', bed: { type: 'lowpass', f: 180, q: 0.8, v: 0.11, lfo: 0.05, depth: 60 } },
  temple: { key: 54, scale: 'aeolian', prog: ['i', 'bVIM7', 'bIII', 'bVII', 'i', 'iv7', 'bVIM7', ['bVII', 'Vsus']], pad: { wave: 'sine', cut: 1200, lfo: 0.05 }, bassWave: 'sine', arpWave: 'pluck', leadWave: ['sine', 'triangle'], rev: 0.46, dly: 0.42, swing: 0.03, color: 'drip', bed: { type: 'bandpass', f: 420, q: 2.2, v: 0.06, lfo: 0.11, depth: 160 } },
  gardens: { key: 55, scale: 'ionian', prog: ['I', 'V', 'vi', 'IV', 'I', 'iii', 'IV', ['ii7', 'Vsus']], pad: { wave: 'triangle', cut: 1700, lfo: 0.07 }, bassWave: 'triangle', arpWave: 'pluck', leadWave: ['triangle', 'sine'], rev: 0.34, dly: 0.24, swing: 0.07, color: 'birds', bed: { type: 'bandpass', f: 2400, q: 0.9, v: 0.025, lfo: 0.07, depth: 900 } },
  ruins: { key: 52, scale: 'phrygdom', prog: ['I', 'bII', 'I', 'bvii', 'iv', 'bII', ['bvii', 'bII'], 'I'], pad: { wave: 'sawtooth', cut: 800, lfo: 0.08 }, bassWave: 'triangle', arpWave: 'pluck', leadWave: ['sawtooth', 'triangle'], rev: 0.3, dly: 0.2, swing: 0.05, vib: 22, color: 'darbuka', bed: { type: 'highpass', f: 3200, q: 0.7, v: 0.03, lfo: 0.13, depth: 1400 } },
  works: { key: 53, scale: 'aeolian', prog: ['i', 'i', 'bVI', 'bVII', 'i', 'i', 'iv', ['V', 'V7']], pad: { wave: 'sawtooth', cut: 650, lfo: 0.04 }, bassWave: 'square', arpWave: 'square', leadWave: ['square', 'sawtooth'], rev: 0.2, dly: 0.16, swing: 0, color: 'clank', bed: { type: 'lowpass', f: 140, q: 6, v: 0.08, lfo: 0.5, depth: 20 } },
  rift: { key: 51, scale: 'lydian', prog: ['IM7', 'II', 'IM7', 'II', 'vi', 'II', 'V', ['IM7', 'II']], pad: { wave: 'sawtooth', cut: 2000, lfo: 0.18 }, bassWave: 'sine', arpWave: 'bell', leadWave: ['sine', 'triangle'], rev: 0.5, dly: 0.34, swing: 0, color: 'shimmer', bed: { type: 'bandpass', f: 5200, q: 3, v: 0.018, lfo: 0.04, depth: 2500 } },
  // 16.0 (L): Clockwork Spire: brass over a ticking escapement, a chime phrase every 8 bars, a tower bell on the downbeat
  spire: { key: 46, scale: 'dorian', prog: ['i', 'bVII', 'bVI', 'bVII', 'i', 'iv', 'bVI', ['V', 'V7']], pad: { wave: 'sawtooth', cut: 900, lfo: 0.05 }, bassWave: 'triangle', arpWave: 'bell', leadWave: ['sawtooth', 'triangle'], rev: 0.38, dly: 0.22, swing: 0, brass: true, color: 'clock', bed: { type: 'bandpass', f: 260, q: 1.4, v: 0.05, lfo: 0.03, depth: 60 } },
  bog: { key: 47, scale: 'harmonic', prog: ['i', 'bVI', 'i', 'V', 'iv', 'bVI', 'iio', 'V'], pad: { wave: 'triangle', cut: 520, lfo: 0.1 }, bassWave: 'sine', arpWave: 'pluck', leadWave: ['triangle', 'sawtooth'], rev: 0.4, dly: 0.3, swing: 0.1, vib: 18, color: 'croak', bed: { type: 'lowpass', f: 320, q: 1.2, v: 0.07, lfo: 0.06, depth: 120 } },
};
const LOC_ALIAS = { frost: 'citadel', volcano: 'forge', volcanic: 'forge', sunken: 'temple', royal: 'gardens', garden: 'gardens', desert: 'ruins', iron: 'works', ironworks: 'works', astral: 'rift', witchwood: 'bog', swamp: 'bog', clockwork: 'spire', clock: 'spire' }; // 16.0 (L): + spire
// themes whose harmony stays their own under a location (only key, instruments and colour change)
const KEEP_HARMONY = new Set(['duel', 'final', 'boss', 'king']);
const MATCH_THEMES = new Set(['royale', 'blitz', 'duel', 'squads', 'siege', 'boss', 'final', 'king']);
for (const L of Object.values(LOC)) { L.chords = L.prog.map((c) => (Array.isArray(c) ? c : [c]).map(chord)); L.scaleArr = SCALES[L.scale]; }
const locId = (id) => { if (!id || typeof id !== 'string') return null; const k = id.toLowerCase().replace(/^loc_/, ''); return LOC[k] ? k : LOC_ALIAS[k] || (LOC[k.split(/[^a-z]/)[0]] ? k.split(/[^a-z]/)[0] : null); };
function themeOf(id) {
  if (THEMES[id]) return THEMES[id];
  const [m, l] = String(id).split('@'), base = THEMES[m], L = LOC[l];
  if (!base || !L) return THEMES.royale;
  const keep = KEEP_HARMONY.has(m), th = THEMES[id] = {
    ...base, base: m, loc: l, key: L.key + (keep && base.scale === 'phrygian' ? -1 : 0),
    pad: { ...base.pad, wave: L.pad.wave, cut: Math.round((base.pad.cut + L.pad.cut) / 2), lfo: L.pad.lfo },
    bassWave: L.bassWave, arpWave: L.arpWave, leadWave: keep && base.lead && base.lead.brass ? base.leadWave : L.leadWave,
    rev: +(base.rev * 0.4 + L.rev * 0.6).toFixed(3), dly: +(base.dly * 0.4 + L.dly * 0.6).toFixed(3), swing: keep ? base.swing : L.swing,
    color: L.color, bed: L.bed, vib: L.vib,
    lead: base.lead && { ...base.lead, brass: base.lead.brass || (L.brass && !keep) },
  };
  if (!keep) { th.scale = L.scale; th.scaleArr = L.scaleArr; th.prog = L.prog; th.chords = L.chords; }
  return th;
}
const NOP = { setValueAtTime() {}, setTargetAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {}, cancelScheduledValues() {} };
const pick = (tiers, e) => { let r = null; for (const t of tiers) if (e >= t[0]) r = t[1]; return r; };

// ---------------------------------------------------------------- engine
class Music {
  constructor() {
    this.on = false; this.theme = THEMES.title; this.themeId = 'title'; this.energy = 0.5; this.target = 0.5;
    this.pending = null; this.pos = 0; this.bar = 0; this.next = 0; this.timer = null; this.holdUntil = 0;
    this.voices = null; this.layerOn = {}; this._ap = 0; this.m = null; this._st = { calls: 0, ms: 0, max: 0, notes: 0, since: 0 };
  }
  // ---------- setup
  // Non-blocking start: the first tap only records the request. The graph, noise and reverb IR are built in small
  // steps on idle callbacks (a few ms each); the scheduler starts once the dry graph exists and the reverb joins later.
  start(ctx, out) { // ctx/out only for offline benchmarks (then everything is built synchronously)
    if (this.on) return;
    const a = ctx || getCtx(); if (!a) return;
    this.a = a; this.on = true; this.live = false; this.noiseReady = false;
    const b = ctx ? {} : buses() || {}; this._dest = out || b.musicBus || a.destination;
    const steps = [() => this.buildCore(), () => this.buildPad(), () => this.buildVoices(), () => this.buildDrums(), () => this.buildDelay(), () => this.applyTheme(this.theme, this.a.currentTime, true), () => this.go(ctx), ...this.noiseSteps(), ...this.reverbSteps()];
    if (ctx) { for (const f of steps) f(); return; }
    const later = (fn) => (window.requestIdleCallback ? requestIdleCallback(fn, { timeout: 80 }) : setTimeout(fn, 16));
    const run = (i) => { if (i >= steps.length) return; const t0 = performance.now(); try { steps[i](); } catch (e) { console.warn('music init', e); } const dt = performance.now() - t0; this._st.init = (this._st.init || 0) + dt; this._st.initMax = Math.max(this._st.initMax || 0, dt); (this._st.steps = this._st.steps || []).push(+dt.toFixed(1)); later(() => run(i + 1)); };
    setTimeout(() => run(0), 0); // never inside the tap's own task
  }
  buildCore() {
    const a = this.a, dest = this._dest;
    const G = (v = 1) => { const g = a.createGain(); g.gain.value = v; return g; };
    this.G = G;

    // master chain
    this.fade = G(0); this.fade.connect(dest);
    this.duckG = G(1); this.duckG.connect(this.fade);
    // one glue compressor (audio.js has the final master limiter); gain staging keeps it working gently
    const comp = this.comp = a.createDynamicsCompressor(); comp.threshold.value = -16; comp.knee.value = 8; comp.ratio.value = 4; comp.attack.value = 0.006; comp.release.value = 0.22; comp.connect(this.duckG);
    const hp = a.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 38; hp.Q.value = 0.6; hp.connect(comp);
    this.mix = G(0.42); this.mix.connect(hp);
    this.revIn = G(1); this.dlyIn = G(1); // sends: wired up by buildDelay / reverbSteps
    // layers
    const sat = (amt) => { const ws = a.createWaveShaper(), n = 1024, cu = new Float32Array(n); for (let i = 0; i < n; i++) { const x = i / (n - 1) * 2 - 1; cu[i] = Math.tanh(x * amt) / Math.tanh(amt); } ws.curve = cu; ws.oversample = 'none'; return ws; };
    const layer = (name, vol, rev, dly, proc) => {
      const L = { in: G(1), gate: G(0), vol, rev: G(rev), dly: G(dly) };
      let head = L.in; if (proc) { head.connect(proc[0]); head = proc[proc.length - 1]; }
      const out = G(vol); head.connect(L.gate); L.gate.connect(out); out.connect(this.mix); out.connect(L.rev); out.connect(L.dly); L.rev.connect(this.revIn); L.dly.connect(this.dlyIn);
      L.out = out; return L;
    };
    const chain = (...n) => { for (let i = 0; i < n.length - 1; i++) n[i].connect(n[i + 1]); return n; };
    // bass: shared lowpass with per-note envelope, soft saturation so it reads on phone speakers
    this.bassLp = a.createBiquadFilter(); this.bassLp.type = 'lowpass'; this.bassLp.Q.value = 3; this.bassLp.frequency.value = 400;
    this.L = {
      pad: layer('pad', 1, 0.6, 0.05, null),
      bass: layer('bass', 0.24, 0.04, 0, chain(this.bassLp, sat(2.2))),
      arp: layer('arp', 2.4, 0.5, 0.6, null),
      drums: layer('drums', 0.42, 0.12, 0, chain(sat(1.6))),
      lead: layer('lead', 2.6, 0.55, 0.45, null),
      bell: layer('bell', 1.6, 0.7, 0.5, null),
      sting: layer('sting', 1.3, 0.6, 0.15, null),
      color: layer('color', 1.2, 0.6, 0.45, null), // 15.0: the location's signature voice
    };
    this.L.sting.gate.gain.value = 1;
    // pump (kick-keyed dip on pad + arp)
    this.pump = G(1); this.L.pad.in.disconnect(); this.L.pad.in.connect(this.pump);
  }
  buildPad() {
    const a = this.a, G = this.G;
    // pad: 4 persistent voices x 2 detuned oscillators -> shared lowpass with slow LFO
    this.padLp = a.createBiquadFilter(); this.padLp.type = 'lowpass'; this.padLp.Q.value = 0.8; this.padLp.frequency.value = 800;
    this.pump.connect(this.padLp); this.padLp.connect(this.L.pad.gate);
    this.padOsc = []; this.voices = [57, 60, 64, 69];
    for (let i = 0; i < 4; i++) {
      const vg = G(1); let o2 = vg;
      if (a.createStereoPanner) { const pn = a.createStereoPanner(); pn.pan.value = [-0.45, 0.3, -0.25, 0.45][i]; vg.connect(pn); o2 = pn; }
      o2.connect(this.L.pad.in);
      for (const det of [-9, 8]) { const o = a.createOscillator(); o.type = 'sawtooth'; o.detune.value = det + (rnd() - 0.5) * 4; o.frequency.value = mtof(this.voices[i]); kr(o.frequency, o.detune); const og = G(0.5); o.connect(og); og.connect(vg); o.start(); this.padOsc.push({ o, v: i }); }
    }
  }
  buildVoices() {
    const a = this.a, G = this.G;
    // arp: shared filter + auto-pan
    this.arpLp = a.createBiquadFilter(); this.arpLp.type = 'lowpass'; this.arpLp.frequency.value = 3000; this.arpLp.Q.value = 2;
    this.arpIn = G(1); this.arpIn.connect(this.arpLp);
    this.arpLp.connect(this.L.arp.in);
    this.arpPan = [this.arpIn, this.arpIn];
    if (a.createStereoPanner) this.arpPan = [-0.4, 0.4].map((v) => { const pn = a.createStereoPanner(), g = G(1); pn.pan.value = v; g.connect(pn); pn.connect(this.arpLp); return g; });
    this.arpPump = G(1); this.L.arp.in.disconnect(); this.L.arp.in.connect(this.arpPump); this.arpPump.connect(this.L.arp.gate);
    // lead: persistent mono synth with glide, delayed vibrato and filter envelope
    this.leadLp = a.createBiquadFilter(); this.leadLp.type = 'lowpass'; this.leadLp.Q.value = 1.2; this.leadLp.frequency.value = 2000;
    this.leadAmp = G(0); this.leadLp.connect(this.leadAmp); this.leadAmp.connect(this.L.lead.in);
    const vib = a.createOscillator(); vib.frequency.value = 5.3; this.vibG = G(0); vib.connect(this.vibG); vib.start();
    this.leadOsc = [0, 1].map((i) => { const o = a.createOscillator(); o.type = i ? 'square' : 'sawtooth'; o.detune.value = i ? 6 : -6; const g = G(i ? 0.35 : 0.65); o.connect(g); g.connect(this.leadLp); this.vibG.connect(o.detune); o.frequency.value = 440; kr(o.frequency, o.detune); o.start(); return o; });
    kr(this.padLp.frequency, this.bassLp.frequency, this.leadLp.frequency, this.arpLp.frequency);
  }
  buildDrums() {
    const a = this.a;
    // drums: shared filters per voice
    const flt = (type, f, q, dst) => { const x = a.createBiquadFilter(); x.type = type; x.frequency.value = f; x.Q.value = q; kr(x.frequency, x.Q, x.gain, x.detune); x.connect(dst); return x; };
    const D = this.L.drums.in;
    this.fx = { snare: flt('bandpass', 1900, 0.7, D), clap: flt('bandpass', 1300, 1.1, D), hat: flt('highpass', 7600, 0.7, D), shaker: flt('bandpass', 5800, 1.8, D), rim: flt('bandpass', 2600, 4, D), crash: flt('highpass', 4200, 0.5, D), riser: flt('bandpass', 400, 3, this.L.sting.in) };
    // 15.0 location ambience: one looping noise source -> filter (slow LFO on the cutoff) -> gain, straight to the mix
    if (isLite()) { this.bed = null; return; } // voice mode: keep the graph light
    const bf = a.createBiquadFilter(); bf.type = 'bandpass'; bf.frequency.value = 800; kr(bf.frequency, bf.Q);
    const bg = a.createGain(); bg.gain.value = 0; bf.connect(bg); bg.connect(this.mix);
    const lfo = a.createOscillator(), lg = a.createGain(); lfo.frequency.value = 0.08; lg.gain.value = 0; lfo.connect(lg); lg.connect(bf.frequency); lfo.start();
    this.bed = { f: bf, g: bg, lfo, lg, src: null };
  }
  bedTo(b, t) { // crossfade the ambience to a location's settings (b null = off)
    const B = this.bed; if (!B) return;
    const want = b && !this.mute ? b.v : 0;
    if (want && !B.src && this.noiseReady) { const s = this.a.createBufferSource(); s.buffer = this.noise; s.loop = true; s.connect(B.f); s.start(t); B.src = s; }
    B.g.gain.setTargetAtTime(want * 1.6, t, 1.2);
    if (b) { B.f.type = b.type; B.f.frequency.setTargetAtTime(b.f, t, 0.8); B.f.Q.setTargetAtTime(b.q, t, 0.8); B.lfo.frequency.setValueAtTime(b.lfo, t); B.lg.gain.setTargetAtTime(b.depth, t, 0.8); }
    this.bedOn = b || null;
  }
  buildDelay() {
    const a = this.a, G = this.G, comp = this.comp;
    // ping-pong delay send (dotted 8th)
    const dL = a.createDelay(2), dR = a.createDelay(2), fb = G(0.38), dlp = a.createBiquadFilter(); dlp.type = 'lowpass'; dlp.frequency.value = 3200;
    const dhp = a.createBiquadFilter(); dhp.type = 'highpass'; dhp.frequency.value = 300;
    this.dlyIn.connect(dhp); dhp.connect(dL); dL.connect(dR); dR.connect(dlp); dlp.connect(fb); fb.connect(dL);
    const ret = G(0.5);
    if (a.createChannelMerger) { const mg = a.createChannelMerger(2); dL.connect(mg, 0, 0); dR.connect(mg, 0, 1); mg.connect(ret); } else { dL.connect(ret); dR.connect(ret); }
    ret.connect(comp); ret.connect(this.revIn);
    this.dL = dL; this.dR = dR;
    const dt = 60 / (this.bpm || this.theme.bpm[0]) * 0.75; dL.delayTime.value = dt; dR.delayTime.value = dt; // 15.0: was left at 0 until the tempo changed
  }
  go(ctx) {
    const a = this.a;
    this.fade.gain.setValueAtTime(0, a.currentTime); this.fade.gain.linearRampToValueAtTime(1, a.currentTime + (this._swapFade || 2.5)); this._swapFade = 0;
    this.next = a.currentTime + 0.12;
    this.live = true;
    if (ctx) return;
    this.timer = setInterval(() => this.schedule(), TICK);
    if (!this._vis) { this._vis = true; document.addEventListener('visibilitychange', () => this.visibility()); }
  }
  noiseSteps() {
    const CH = 32768; let buf, d, len;
    const st = [() => { const sr = this.a.sampleRate; len = Math.floor(sr * 3); buf = this.a.createBuffer(1, len, sr); d = buf.getChannelData(0); }];
    for (let i = 0; i < Math.ceil(this.a.sampleRate * 3 / CH); i++) st.push(() => { for (let j = i * CH, e = Math.min(len, j + CH); j < e; j++) d[j] = rnd() * 2 - 1; });
    st.push(() => { this.noise = buf; this.noiseReady = true; });
    return st;
  }
  reverbSteps() {
    // generated IR, darkened tail, 18 ms predelay; low quality keeps the delay send only
    if (globalThis.__mNoVerb || settings.quality === 'low' || isLite()) return []; // voice mode: no convolver (iOS mic crackle)
    const a = this.a, sr = a.sampleRate, len = Math.floor(sr * 1.3), pre = Math.floor(sr * 0.018), CH = 24576;
    let ir; const lp = [0, 0], st = [() => { ir = a.createBuffer(1, len, sr); }];
    for (let c = 0; c < 1; c++) for (let s0 = pre; s0 < len; s0 += CH) st.push(() => { const d = ir.getChannelData(c); let v = lp[c], env = Math.exp(-6.9 * (s0 - pre) / (len - pre)); const dk = Math.exp(-6.9 / (len - pre)); for (let i = s0, e = Math.min(len, s0 + CH); i < e; i++) { const k = (i - pre) / (len - pre); v += (rnd() * 2 - 1 - v) * (0.55 - 0.4 * k); d[i] = v * env; env *= dk; } lp[c] = v; });
    st.push(() => { const conv = a.createConvolver(); conv.buffer = ir; this._conv = conv; });
    st.push(() => {
      // mono IR (setup ~5x cheaper than stereo, half the render CPU), widened by a 13 ms offset on the right channel
      const rhp = a.createBiquadFilter(); rhp.type = 'highpass'; rhp.frequency.value = 220; const ret = this.G(0.55); this.revIn.connect(rhp); rhp.connect(this._conv); this._conv.connect(ret);
      if (a.createChannelMerger) { const mg = a.createChannelMerger(2), dr = a.createDelay(0.05); dr.delayTime.value = 0.013; ret.connect(mg, 0, 0); ret.connect(dr); dr.connect(mg, 0, 1); mg.connect(this.comp); } else ret.connect(this.comp);
    });
    return st;
  }
  visibility() {
    if (!this.live) return;
    const t = this.a.currentTime;
    if (document.hidden) { clearInterval(this.timer); this.timer = null; this.fade.gain.cancelScheduledValues(t); this.fade.gain.setTargetAtTime(0, t, 0.05); }
    else if (!this.timer) { this.next = t + 0.1; this._lastCall = 0; this.fade.gain.cancelScheduledValues(t); this.fade.gain.setTargetAtTime(1, t + 0.05, 0.4); this.timer = setInterval(() => this.schedule(), TICK); }
  }
  // 15.0: audio.js rebuilt its context (voice chat took or released the mic). Drop the old graph and build it again on
  // the new context, keeping theme, location, energy and bar position, so the music carries on after a short fade.
  rebind() {
    if (!this.on) return;
    clearInterval(this.timer); this.timer = null;
    this.on = false; this.live = false; this.noiseReady = false; this.noise = null; this._conv = null;
    this.layerOn = {}; this.leadArr = null; this.leadPrevEnd = 0; this.hold = false; this.mute = false; this.bed = null; this.bedOn = null;
    this.forceSwitch = true; this.pending = this.themeId; this._swapFade = 0.8; this._st.rebinds = (this._st.rebinds || 0) + 1;
    this.start();
  }
  // location id (W's js/locations.js ids; null = none). Changes take effect on the next bar line.
  location(id) {
    const l = locId(id); if (l === (this.loc || null)) return;
    this.loc = l;
    const base = (this.theme && this.theme.base) || this.themeId.split('@')[0];
    if (MATCH_THEMES.has(base)) this.want(base, this.target); // re-colour the running match theme
  }
  // ---------- public control
  set(level, mood) {
    if (typeof mood === 'string' && /^loc_/.test(mood)) { this.location(mood); mood = 'royale'; } // W: LOCATIONS[id].music
    const id = THEMES[mood] || /@/.test(mood || '') ? mood : ALIAS[mood] || (mood ? 'royale' : this.themeId);
    const th = themeOf(id);
    const e = th.fixed != null ? th.fixed : [0.2, 0.4, 0.7, 0.95][clamp(level | 0, 0, 3)];
    this.want(id, e);
  }
  want(id, e) {
    if (this.loc && MATCH_THEMES.has(id)) id = id + '@' + this.loc; // the match's location colours every match theme
    const th = themeOf(id);
    this.target = clamp(Math.max(e, th.floor || 0), 0, 1);
    if (id !== this.themeId || (this.pending && this.pending !== id)) this.pending = id === this.themeId ? null : id;
  }
  newMatch() { this.m = null; this.ringBase = null; this.loc = null; this.kingPh = 0; this.set(1, 'royale'); }
  // read the match state; pick theme + energy; fire stingers on edges
  match(s, me) {
    if (!s) return;
    if (s.tutorial) { this.m = null; this.ringBase = null; return this.want('royale', 0.3); }
    if (s.location !== undefined && locId(s.location) !== (this.loc || null)) this.location(s.location); // 15.0 World Tour
    const players = s.units.filter((u) => u.kind === 'player'), alive = players.filter((u) => u.alive).length, total = Math.max(2, players.length);
    const ring0 = (s.storm && s.storm.ring) || 0, crack = !!(s.storm && s.storm.crack);
    if (!this.m || this.ringBase == null) this.ringBase = ring0; // Duel starts with the arena already ringed in
    const ring = Math.max(0, ring0 - this.ringBase);
    const boss = !!(s.siege && s.units.some((v) => v.alive && v.boss));
    const king = s.units.find((v) => v.alive && v.piece === 'king');
    const meAlive = !!(me && me.alive);
    const mode = s.mode || 'royale', teams = !!s.teams;
    const prev = this.m;
    const cur = { over: !!s.over, alive, king: king ? king.id : null, boss, wave: s.siege ? s.siege.wave : 0, meAlive };
    this.m = cur;
    let id, e;
    if (s.over) { id = this.themeId; e = 0.3; }
    else if (s.siege) {
      const w = s.siege.wave || 1, ws = s.siege.waves || 8;
      if (boss) { id = 'boss'; e = 0.75 + 0.2 * (w / ws); } else { id = 'siege'; e = 0.25 + 0.6 * (w - 1) / Math.max(1, ws - 1); }
    } else if (mode === 'duel') { id = 'duel'; e = 0.2 + 0.18 * ring + (crack ? 0.1 : 0) + Math.min(0.3, (s.turnNo || 0) / 120); }
    else if (alive <= 2 && total > 2) { id = 'final'; e = 0.8 + 0.06 * ring; }
    else if (mode === 'hill' && s.hill) { // King of the Hill: the regal theme, building as anyone nears the goal
      const top = Math.max(0, ...Object.values(s.hill.score || {})); id = 'king'; e = 0.45 + 0.5 * top / (s.hill.goal || 10) + 0.05 * ring;
    }
    else if (king && me && king.id === me.id) { id = 'king'; e = 0.6 + 0.08 * ring + 0.2 * (1 - (alive - 1) / (total - 1)) + 0.08 * (this.kingPh || 0); }
    else if (king && !teams && mode !== 'hill' && (!s.kingBoss || s.kingBoss.id === king.id || king.kingBoss)) { id = 'boss'; e = 0.72 + 0.06 * ring + 0.08 * (this.kingPh || 0); } // 15.0: the King is a raid boss for everyone else
    else {
      id = mode === 'blitz' || mode === 'chaos' ? 'blitz' : mode === 'squads' || teams ? 'squads' : 'royale';
      const frac = 1 - (alive - 1) / (total - 1);
      e = 0.28 + 0.38 * frac + 0.09 * Math.min(ring, 3) + (crack ? 0.05 : 0) + (king ? 0.05 : 0);
    }
    this.want(id, e);
    if (!prev) return;
    // stingers (edges only)
    if (cur.over && !prev.over) {
      const win = s.siege ? !!s.siegeWon : !!(me && (s.winner === me.id || (teams && s.winner != null && (s.units.find((v) => v.id === s.winner) || {}).team === me.team && me.team != null)));
      this.sting(win ? 'victory' : this.defeated ? 'end' : 'defeat'); this.defeated = false; return;
    }
    if (prev.meAlive && !cur.meAlive && !teams && !s.siege && !cur.over) { this.defeated = true; this.sting('defeat', true); return; }
    if (cur.boss && !prev.boss) return this.sting('boss');
    if (cur.wave > prev.wave && !cur.boss) return this.sting('wave');
    if (cur.king && cur.king !== prev.king) return this.sting('crowned');
    if (alive <= 2 && prev.alive > 2 && total > 2 && !s.siege) return this.sting('final');
  }
  duck(ms = 1200, depth = 0.4) {
    if (!this.live) return;
    const g = this.duckG.gain, t = this.a.currentTime;
    if (g.cancelAndHoldAtTime) g.cancelAndHoldAtTime(t); else { g.cancelScheduledValues(t); g.setValueAtTime(g.value, t); }
    g.setTargetAtTime(clamp(depth, 0, 1), t, 0.05); g.setTargetAtTime(1, t + ms / 1000, 0.35);
  }
  stats() { const s = this._st; return { theme: this.themeId, loc: this.loc || null, rebinds: s.rebinds || 0, ctxRate: this.a ? this.a.sampleRate : 0, reverb: !!this._conv, sting: this.lastSting || null, hold: !!this.hold, energy: +this.energy.toFixed(2), bpm: this.bpm, look: +(this.look || LOOK).toFixed(2), calls: s.calls, avgMs: s.calls ? +(s.ms / s.calls).toFixed(4) : 0, maxMs: +s.max.toFixed(3), over2ms: s.slow || 0, notes: s.notes, nodesPerSec: this.a ? +(s.notes / Math.max(1, this.a.currentTime - s.since)).toFixed(1) : 0 }; }
  // ---------- scheduler
  get six() { return 60 / this.bpm / 4; }
  schedule() {
    const a = this.a; if (!a || !this.live || a.state !== 'running') return;
    const p0 = performance.now();
    const now = a.currentTime;
    // adaptive lookahead: if the main thread is janky (timer gaps), schedule further ahead instead of dropping notes
    const gap = this._lastCall ? now - this._lastCall : 0; this._lastCall = now;
    this.look = clamp(Math.max((this.look || LOOK) * 0.98, gap * 1.6), LOOK, 1.2);
    if (this.next < now - 0.05) this.next = now + 0.05; // stalled (tab switch / long frame): resync, never burst
    while (this.next < now + this.look) { this.tick(this.next); this.next += this.six; if (++this.pos >= 16) { this.pos = 0; this.bar++; } }
    const dt = performance.now() - p0, st = this._st; st.calls++; st.ms += dt; if (dt > st.max) st.max = dt; if (dt > 2) st.slow = (st.slow || 0) + 1;
  }
  tick(t) {
    const pos = this.pos;
    if (pos === 0) this.barStart(t);
    if (this.mute || this.hold || this.theme.silent) return;
    const th = this.theme, six = this.six;
    const tt = t + (pos & 1 ? (th.swing || 0) * six * 2 : 0);
    const half = th.chords[this.bar % th.chords.length].length > 1 && pos >= 8;
    if (half && pos === 8) this.voiceTo(this.chordB, t);
    const ch = half ? this.chordB : this.chordA;
    // drums
    if (this.layerOn.drums) {
      const lanes = this.fill ? this.fillLanes(pos) : this.drumPat;
      if (lanes) for (const [l, arr] of lanes) { let v = arr[pos]; if (!v) continue; if (v < 0) { if (rnd() < 0.5) continue; v = 0.45; } this.drum(l, tt + human(l === 'k' ? 2 : 5), v * (0.9 + rnd() * 0.15)); }
    }
    // bass
    if (this.layerOn.bass && this.bassPat) {
      const n = this.bassPat[pos];
      if (n) {
        const root = this.bassRoot(ch); let m = root;
        if (n.k === 'O') m = root + 12; else if (n.k === '5') m = root + 7; else if (n.k === 'a') { const nx = this.bassRoot(th.chords[(this.bar + 1) % th.chords.length][0]); m = nx + (rnd() < 0.5 ? -1 : 2); }
        this.bassNote(m, tt + human(3), n.len * six * 0.92, n.k === 'R' || n.k === 'O' ? 0.3 : 0.22);
      }
    }
    // arp
    const ap = this.arpPat;
    if (this.layerOn.arp && ap && pos % ap.rate === 0) {
      const i = (this.bar * 16 + pos) / ap.rate | 0, idx = ap.seq[i % ap.seq.length];
      if (!(ap.sparse && rnd() < ap.sparse)) {
        const vs = this.voices, m = vs[idx % 4] + ap.oct + (idx >= 4 ? 12 : 0);
        this.arpNote(m, tt + human(5), ap.gate * six, ap.v * (pos % 4 === 0 ? 1.15 : 0.85) * (0.85 + rnd() * 0.3));
      }
    }
    // lead (main theme)
    if (this.leadArr) {
      const L = this.leadArr.length, k = (this.phraseBar * 16 + pos) % L;
      const n = this.leadArr[k];
      if (n) this.leadNote(n, ch, tt + human(7), pos);
      else if (this.leadEnd && k === this.leadEnd) this.leadOff(tt);
    }
    if (th.color) this.color(th.color, pos, tt, ch);
  }
  // ---------- 15.0 location colour voices: sparse, one or two nodes per hit, all on the 'color' layer
  metal(m, t, d, v, ratio = 2.76, idx = 2.2) {
    const a = this.a, f = mtof(m), [o, g] = this.osc('sine', f, t, t + d + 0.3, this.L.color.in);
    g.setValueAtTime(0, t); g.linearRampToValueAtTime(v, t + 0.002); g.setTargetAtTime(0, t + 0.006, d * 0.35);
    const mo = a.createOscillator(), mg = a.createGain(); mo.frequency.value = f * ratio; mg.gain.setValueAtTime(f * idx, t); mg.gain.setTargetAtTime(0, t, d * 0.2);
    mo.connect(mg); mg.connect(o.frequency); mo.start(t); mo.stop(t + d + 0.3); this._st.notes++;
  }
  blip(f0, f1, t, d, v, type = 'sine') {
    const [o, g] = this.osc(type, f0, t, t + d + 0.05, this.L.color.in);
    o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + d);
    g.setValueAtTime(0, t); g.linearRampToValueAtTime(v, t + 0.004); g.setTargetAtTime(0, t + d * 0.4, d * 0.3);
  }
  color(kind, pos, t, ch) {
    const e = this.energy, bar = this.bar, vs = this.voices, r = rnd(), tone = (i, o = 0) => vs[i % 4] + o;
    if (kind === 'ice') { // glass chimes on the chord, frost sparkles
      if (pos === 0 && bar % 2 === 0) this.bell(tone(3, 24), t, 2.2, 0.035, this.L.color.in);
      else if (pos === 6 && bar % 4 === 1) this.bell(tone(1, 36), t, 1.6, 0.022, this.L.color.in);
      if (r < 0.04 + 0.05 * e) this.blip(mtof(tone(pos, 36)), mtof(tone(pos, 36)) * 1.01, t, 0.08, 0.012);
    } else if (kind === 'anvil') { // forge hammer on the downbeats, low taiko underneath
      if ((pos === 0 || (e > 0.55 && pos === 8)) && bar % 2 === 0) this.metal(tone(0, 24), t, 0.9, 0.05, 2.76, 3);
      if (pos === 0 || (e > 0.45 && pos === 10)) { const [o, g] = this.osc('sine', 110, t, t + 0.9, this.L.color.in); o.frequency.setValueAtTime(110, t); o.frequency.exponentialRampToValueAtTime(48, t + 0.12); g.setValueAtTime(0.16 + e * 0.1, t); g.setTargetAtTime(0, t + 0.02, 0.22); }
    } else if (kind === 'drip') { // cave drops, a temple gong every four bars
      if (r < 0.05 + 0.03 * e && pos % 2 === 1) { const f = 900 + rnd() * 900; this.blip(f, f * 2.2, t, 0.05, 0.03); }
      if (pos === 0 && bar % 4 === 0) this.metal(tone(0, -12), t, 3.2, 0.05, 1.41, 1.2);
    } else if (kind === 'birds') { // garden birdsong
      if (r < 0.035 && pos % 2 === 1) { const f = 2400 + rnd() * 1400; this.blip(f, f * 1.45, t, 0.035, 0.016); this.blip(f * 1.1, f * 1.6, t + 0.07, 0.03, 0.013); }
    } else if (kind === 'darbuka') { // doum / tek: maqsum-like hand drum
      const P = 'D..T..T.D.D.T...', c = P[pos];
      if (c === 'D') { const [o, g] = this.osc('sine', 120, t, t + 0.4, this.L.color.in); o.frequency.setValueAtTime(140, t); o.frequency.exponentialRampToValueAtTime(80, t + 0.06); g.setValueAtTime(0.12 + e * 0.06, t); g.setTargetAtTime(0, t + 0.01, 0.09); }
      else if (c === 'T') this.noiseHit(this.fx.rim, t, 0.16 + e * 0.1, 0.02, 0.08);
      else if (e > 0.5 && pos % 2 === 1 && r < 0.3) this.noiseHit(this.fx.rim, t, 0.06, 0.012, 0.05);
    } else if (kind === 'clank') { // machinery: off-beat metal clanks, factory ticking
      if (pos === 4 || pos === 12) this.metal(tone(2, 12) + (bar % 2 ? 1 : 0), t, 0.35, 0.03 + e * 0.015, 1.41, 3.5);
      if (e > 0.3 && pos % 2 === 0) this.noiseHit(this.fx.hat, t, 0.03, 0.008, 0.04);
    } else if (kind === 'shimmer') { // slow swells of a high fifth: starlight
      if (pos === 0 && bar % 2 === 0) for (const [k, det] of [[0, -4], [7, 5]]) {
        const d = 16 * this.six * 1.6, [o, g] = this.osc('sine', mtof(tone(0, 24 + k)), t, t + d + 0.3, this.L.color.in); o.detune.value = det;
        g.setValueAtTime(0, t); g.linearRampToValueAtTime(0.018, t + d * 0.6); g.linearRampToValueAtTime(0, t + d);
      }
      if (r < 0.03) this.bell(tone(pos, 36), t, 1.2, 0.012, this.L.color.in);
    } else if (kind === 'clock') { // 16.0 (L) spire: escapement tick-tock, a ratchet at high energy, Westminster-ish chimes, tower bell
      if (pos % 8 === 0) this.blip(3300, 3000, t, 0.014, 0.05 + e * 0.02, 'square');
      else if (pos % 8 === 4) this.blip(2100, 1900, t, 0.016, 0.042 + e * 0.02, 'square');
      if (pos % 4 === 0) this.noiseHit(this.fx.rim, t, 0.05 + e * 0.04, 0.008, 0.03);
      if (e > 0.55 && pos % 2 === 1 && pos % 4 !== 3) this.noiseHit(this.fx.hat, t, 0.018 + e * 0.012, 0.006, 0.03);
      if (pos === 14 && bar % 2 === 1) this.metal(tone(1, 24), t, 0.3, 0.022, 3.5, 2);
      if (bar % 8 === 0 && pos % 4 === 0) this.bell(tone([2, 0, 1, 3][pos / 4], 12), t, 1.8, 0.05, this.L.color.in);
      if (bar % 8 === 4 && pos === 0) this.metal(this.bassRoot(ch) - 12, t, 3.4, 0.06, 1.41, 1.6);
    } else if (kind === 'croak') { // bog frogs and a wobbling drone
      if (r < 0.03 && pos % 4 === 2) for (let i = 0; i < 2 + (rnd() * 2 | 0); i++) { const [o, g] = this.osc('square', 95 + rnd() * 30, t + i * 0.09, t + i * 0.09 + 0.08, this.L.color.in); g.setValueAtTime(0, t + i * 0.09); g.linearRampToValueAtTime(0.012, t + i * 0.09 + 0.01); g.setTargetAtTime(0, t + i * 0.09 + 0.03, 0.015); o.frequency.setTargetAtTime(70, t + i * 0.09, 0.03); }
      if (pos === 0 && bar % 4 === 0) { const d = 4 * 16 * this.six, [o, g] = this.osc('triangle', mtof(this.bassRoot(ch)), t, t + d, this.L.color.in); o.detune.setValueAtTime(-30, t); o.detune.linearRampToValueAtTime(25, t + d * 0.5); o.detune.linearRampToValueAtTime(-20, t + d); g.setValueAtTime(0, t); g.linearRampToValueAtTime(0.05, t + d * 0.3); g.linearRampToValueAtTime(0, t + d); }
    }
  }
  barStart(t) {
    if (this.hold && t >= this.holdUntil) { this.hold = false; this.bar = 0; if (!this.pending) this.pending = this.themeId; this.forceSwitch = true; }
    if (this.hold) return;
    // music volume 0: stop generating notes (pads fade, CPU idles)
    const muted = !(settings.music > 0.001);
    if (muted !== this.mute) { this.mute = muted; if (muted) for (const k in this.L) if (k !== 'sting') this.gateTo(k, false, t); this.bedTo(muted ? null : this.theme.bed, t); }
    if (muted) return;
    if (this.bed && this.theme.bed && !this.bed.src && this.noiseReady) this.bedTo(this.theme.bed, t); // ambience waits for the noise buffer
    if (this.pending) {
      const id = this.pending; this.pending = null;
      if (id !== this.themeId || this.forceSwitch) {
        const big = this.target >= 0.5 && themeOf(id) !== this.theme;
        this.themeId = id; this.theme = themeOf(id); this.bar = 0; this.applyTheme(this.theme, t);
        if (big && !this.theme.silent) this.drum('crash', t, 0.7);
        if (this.energy > this.target + 0.2 || this.theme.fixed != null) this.energy = this.target; // drop straight to calm themes
      }
      this.forceSwitch = false;
    }
    const th = this.theme;
    // energy: rise fast, fall slowly (no yo-yo)
    const d = this.target - this.energy; this.energy = clamp(this.energy + (d > 0 ? Math.min(d, 0.3) : Math.max(d, -0.08)), 0, 1);
    const e = this.energy;
    const bpm = Math.round(th.bpm[0] + (th.bpm[1] - th.bpm[0]) * clamp((e - 0.3) / 0.7, 0, 1));
    if (bpm !== this.bpm) { this.bpm = bpm; const dt = 60 / bpm * 0.75; this.dL.delayTime.setTargetAtTime(dt, t, 0.05); this.dR.delayTime.setTargetAtTime(dt, t, 0.05); }
    // phrase + arrangement
    this.phraseBar = this.bar % 8; const phrase = this.bar / 8 | 0;
    for (const k of ['bass', 'arp', 'drums', 'bell']) this.gateTo(k, e >= th.layers[k], t);
    this.gateTo('pad', !th.silent, t); this.gateTo('color', !!th.color, t);
    this.drumPat = pick(th.drums, e); this.bassPat = pick(th.bass, e); this.arpPat = pick(th.arp, e);
    this.fill = this.phraseBar === 7 && e >= 0.5 && th.layers.drums < 1;
    const ld = th.lead, leadOn = ld && e >= th.layers.lead && phrase >= ld.start && (phrase - ld.start) % ld.every === 0;
    if (leadOn && this.phraseBar === 0) { this.leadArr = motifBank[ld.mode]; this.leadEnd = this.leadEndOf(this.leadArr); }
    if (!leadOn && this.phraseBar === 0) { if (this.leadArr) this.leadOff(t); this.leadArr = null; }
    this.gateTo('lead', !!this.leadArr, t);
    this.dbl = !!(ld && ld.double && e > 0.85);
    // pads: brightness follows energy
    { const sw = 1 + th.pad.lfo * 2 * Math.sin(this.bar * 0.785), f = th.pad.cut * (0.6 + e * 0.9) * sw; this.ramp(this.padLp.frequency, f, t, 0.5, 15 * this.six); } // slow per-bar filter swell
    // chords
    const cs = th.chords[this.bar % th.chords.length];
    this.chordA = cs[0]; this.chordB = cs[1] || cs[0];
    this.voiceTo(this.chordA, t);
    // riser into the next phrase at high energy
    if (this.phraseBar === 7 && e >= 0.65 && !th.silent) this.riser(t, 16 * this.six);
  }
  leadEndOf(arr) { let last = 0; for (let i = 0; i < arr.length; i++) if (arr[i]) last = i + arr[i][1]; return last % arr.length; }
  applyTheme(th, t, first) {
    for (const p of this.padOsc) p.o.type = th.pad.wave;
    this.L.pad.out.gain.setTargetAtTime(th.pad.v * 2.2, t, 0.3);
    this.leadOsc[0].type = th.leadWave[0]; this.leadOsc[1].type = th.leadWave[1];
    this.L.lead.rev.gain.setTargetAtTime(th.rev * 1.6, t, 0.3); this.L.arp.rev.gain.setTargetAtTime(th.rev * 1.4, t, 0.3);
    this.L.arp.dly.gain.setTargetAtTime(th.dly * 2.4, t, 0.3); this.L.lead.dly.gain.setTargetAtTime(th.dly * 1.8, t, 0.3);
    this.L.pad.rev.gain.setTargetAtTime(th.rev * 1.8, t, 0.3);
    this.lo = th.key - 5; this.hi = th.key + 19;
    if (first) this.voices = voiceLead([th.key, th.key + 4, th.key + 7, th.key + 12], th.chords[0][0].map((x) => (th.key + x) % 12), this.lo, this.hi);
    this.leadArr = null; this.bpm = this.bpm || th.bpm[0];
    this.bedTo(th.silent ? null : th.bed || null, t);
  }
  gateTo(k, on, t) {
    if (this.layerOn[k] === on) return; this.layerOn[k] = on;
    this.L[k].gate.gain.setTargetAtTime(on ? 1 : 0, t, on ? 0.12 : 0.5);
  }
  voiceTo(semis, t) {
    const th = this.theme, pcs = semis.map((x) => (((th.key + x) % 12) + 12) % 12);
    this.pcs = pcs;
    this.voices = voiceLead(this.voices, pcs, this.lo, this.hi);
    for (const p of this.padOsc) this.ramp(p.o.frequency, mtof(this.voices[p.v]), t, 0.07);
  }
  ramp(param, v, t, tau, max = 9) { param.setTargetAtTime(v, t, tau); param.setValueAtTime(v, t + Math.min(tau * 6, max)); } // glide, then hold a constant (cheap fast path)
  bassRoot(semis) { const th = this.theme; let m = th.key + semis[0] - 24; while (m < 31) m += 12; while (m > 45) m -= 12; return m; }
  // ---------- voices
  osc(type, f, t, end, dst, gv) {
    const a = this.a, o = a.createOscillator(), g = a.createGain();
    o.type = type; o.frequency.value = f; g.gain.value = 0; o.connect(g); g.connect(dst); o.start(t); o.stop(end); this._st.notes++; this._lastOsc = o;
    return [o, g.gain];
  }
  bassNote(m, t, d, v) {
    const th = this.theme, f = mtof(m), e = this.energy;
    const [, g] = this.osc(th.bassWave, f, t, t + d + 0.12, this.L.bass.in);
    g.setValueAtTime(0, t); g.linearRampToValueAtTime(v, t + 0.008); g.setTargetAtTime(v * 0.7, t + 0.02, 0.1); g.setTargetAtTime(0, t + d, 0.03);
    const [, g2] = this.osc('sine', f, t, t + d + 0.12, this.L.bass.in);
    g2.setValueAtTime(0, t); g2.linearRampToValueAtTime(v * 0.9, t + 0.01); g2.setTargetAtTime(0, t + d, 0.04);
    const fq = this.bassLp.frequency, base = 180 + e * 260;
    const tau = 0.07 + (1 - e) * 0.08; fq.setValueAtTime(base * (2.6 + e * 2), t); fq.setTargetAtTime(base, t + 0.005, tau); fq.setValueAtTime(base, t + Math.min(0.005 + tau * 5, d * 0.95));
  }
  arpNote(m, t, d, v) {
    const wave = this.theme.arpWave;
    if (wave === 'bell') return this.bell(m, t, Math.max(d, 0.6), v * 1.1, this.L.arp.in);
    const type = wave === 'pluck' ? 'triangle' : wave === 'saw' ? 'sawtooth' : wave;
    if (wave !== 'pluck') v *= 1.5;
    const [, g] = this.osc(type, mtof(m), t, t + d + 0.25, this.arpPan[(this._ap = (this._ap + 1) & 1)]);
    g.setValueAtTime(0, t); g.linearRampToValueAtTime(v, t + 0.004); g.setTargetAtTime(0, t + 0.01, wave === 'pluck' ? 0.07 : Math.max(0.03, d * 0.45));
  }
  bell(m, t, d, v, dst) {
    const a = this.a, f = mtof(m);
    const [, g] = this.osc('sine', f, t, t + d + 0.6, dst);
    g.setValueAtTime(0, t); g.linearRampToValueAtTime(v, t + 0.003); g.setTargetAtTime(0, t + 0.01, d * 0.45);
    // FM modulator (ratio 3.5 gives the glassy partial), decays faster than the carrier
    const mo = a.createOscillator(), mg = a.createGain(); mo.frequency.value = f * 3.5; mg.gain.setValueAtTime(f * 1.4, t); mg.gain.setTargetAtTime(0, t, d * 0.18);
    mo.connect(mg); mg.connect(this._lastOsc.frequency); mo.start(t); mo.stop(t + d + 0.6); this._st.notes++;
  }
  leadNote(n, ch, t, pos) {
    const th = this.theme, ld = th.lead; if (!ld) return;
    const [, len, deg] = n, sc = th.scaleArr;
    const oct = Math.floor(deg / 7), idx = ((deg % 7) + 7) % 7;
    let m = th.key + 12 * oct + sc[idx] + ld.oct;
    // harmonic fit: long notes on strong beats never sit a semitone against the chord
    if ((pos % 8 === 0 || len >= 6) && this.pcs && !this.pcs.includes(m % 12)) { for (const dd of [1, -1]) if (this.pcs.includes((m + dd + 12) % 12)) { m += dd; break; } }
    const dur = len * this.six, f = mtof(m), v = ld.v * (0.9 + rnd() * 0.15) * (pos % 4 === 0 ? 1.05 : 0.95);
    const amp = this.leadAmp.gain, fq = this.leadLp.frequency;
    const legato = this.leadPrevEnd && Math.abs(this.leadPrevEnd - t) < 0.03;
    for (const o of this.leadOsc) this.ramp(o.frequency, f, t, legato ? 0.035 : 0.006, dur * 0.9);
    if (!legato) { amp.setTargetAtTime(0, t - 0.012, 0.004); }
    amp.setTargetAtTime(v, t, ld.brass ? 0.03 : 0.012);
    amp.setTargetAtTime(v * 0.75, t + 0.12, 0.25);
    amp.setTargetAtTime(0, t + dur * 0.94, 0.05);
    const cut = ld.brass ? 900 + this.energy * 1600 : 1600 + this.energy * 1800;
    fq.setTargetAtTime(cut * 2.2, t, ld.brass ? 0.04 : 0.01); fq.setTargetAtTime(cut, t + 0.08, 0.2); fq.setValueAtTime(cut, t + Math.min(dur, 1.1));
    const vb = this.vibG.gain; vb.setTargetAtTime(0, t, 0.02); if (dur > 0.35) vb.setTargetAtTime(th.vib || 14, t + 0.22, 0.2);
    this.leadPrevEnd = t + dur;
    if (ld.bell) this.bell(m, t, Math.min(1.8, dur * 1.5), v * 0.9, this.L.lead.in); else if (this.layerOn.bell) this.bell(m + 12, t, Math.min(1.6, dur * 1.5), v * 0.35, this.L.bell.in);
    if (this.dbl) { const [, g] = this.osc('sawtooth', f * 2, t, t + dur + 0.1, this.L.lead.in); g.setValueAtTime(0, t); g.linearRampToValueAtTime(v * 0.18, t + 0.02); g.setTargetAtTime(0, t + dur * 0.9, 0.05); }
    this._st.notes++;
  }
  leadOff(t) { this.leadAmp.gain.setTargetAtTime(0, t, 0.08); this.leadPrevEnd = 0; }
  noiseHit(dst, t, v, decay, len, off) {
    if (!this.noiseReady) return NOP;
    const a = this.a, s = a.createBufferSource(), g = a.createGain();
    s.buffer = this.noise; g.gain.value = 0; s.connect(g); g.connect(dst);
    g.gain.setValueAtTime(v, t); g.gain.setTargetAtTime(0, t + 0.002, decay);
    s.start(t, off != null ? off : rnd() * 1.5, len); this._st.notes++;
    return g.gain;
  }
  drum(l, t, v) {
    const D = this.L.drums.in, fx = this.fx;
    if (l === 'k') {
      const [o, g] = this.osc('sine', 150, t, t + 0.5, D);
      o.frequency.setValueAtTime(160, t); o.frequency.exponentialRampToValueAtTime(46, t + 0.11);
      g.setValueAtTime(v * 0.9, t); g.setTargetAtTime(0, t + 0.03, 0.11);
      const pump = this.theme.pump; if (pump && this.energy >= 0.45) for (const pg of [this.pump.gain, this.arpPump.gain]) { pg.setValueAtTime(1, t); pg.linearRampToValueAtTime(1 - pump, t + 0.008); pg.linearRampToValueAtTime(1, t + Math.min(0.16, this.six * 0.9)); }
    } else if (l === 's') {
      this.noiseHit(fx.snare, t, v * 0.5, 0.06, 0.4);
      const [o, g] = this.osc('triangle', 200, t, t + 0.15, D); o.frequency.setTargetAtTime(165, t, 0.03); g.setValueAtTime(v * 0.3, t); g.setTargetAtTime(0, t + 0.005, 0.03);
    } else if (l === 'c') {
      const g = this.noiseHit(fx.clap, t, v * 0.5, 0.005, 0.35);
      g.setValueAtTime(v * 0.45, t + 0.012); g.setTargetAtTime(0, t + 0.014, 0.005); g.setValueAtTime(v * 0.5, t + 0.024); g.setTargetAtTime(0, t + 0.026, 0.06);
    } else if (l === 'h') this.noiseHit(fx.hat, t, v * 0.2, 0.018, 0.12);
    else if (l === 'H') this.noiseHit(fx.hat, t, v * 0.17, 0.11, 0.5);
    else if (l === 'p') { const g = this.noiseHit(fx.shaker, t, 0, 0.03, 0.15); g.setValueAtTime(0, t); g.linearRampToValueAtTime(v * 0.12, t + 0.012); g.setTargetAtTime(0, t + 0.014, 0.025); }
    else if (l === 'r') this.noiseHit(fx.rim, t, v * 0.3, 0.012, 0.08);
    else if (l === 't' || l === 'T') {
      const f = l === 't' ? 72 : 120, [o, g] = this.osc('sine', f * 1.7, t, t + 0.8, D);
      o.frequency.setValueAtTime(f * 1.7, t); o.frequency.exponentialRampToValueAtTime(f, t + 0.08);
      g.setValueAtTime(v * 0.75, t); g.setTargetAtTime(0, t + 0.02, l === 't' ? 0.2 : 0.12);
      this.noiseHit(fx.snare, t, v * 0.08, 0.03, 0.1);
    } else if (l === 'crash') this.noiseHit(fx.crash, t, v * 0.22, 0.55, 2.0, 0);
  }
  fillLanes(pos) {
    // last bar of a phrase: groove for 2 beats, then a tom/snare build
    if (pos < 8) return this.drumPat;
    if (!this._fill) { const s = new Array(16).fill(0), tt = new Array(16).fill(0), k = new Array(16).fill(0); for (let i = 8; i < 16; i++) { if (i >= 12) s[i] = 0.4 + (i - 12) * 0.15; else tt[i] = i % 2 ? 0 : 0.8; } k[8] = 1; this._fill = [['k', k], ['s', s], ['T', tt]]; }
    return this._fill;
  }
  riser(t, d) {
    const fq = this.fx.riser.frequency, g = this.noiseHit(this.fx.riser, t, 0, 1, d + 0.05, 0);
    g.cancelScheduledValues(t); g.setValueAtTime(0.0001, t); g.linearRampToValueAtTime(0.09, t + d * 0.95); g.linearRampToValueAtTime(0, t + d);
    fq.setValueAtTime(300, t); fq.exponentialRampToValueAtTime(5000, t + d);
  }
  // ---------- stingers (short scored cues)
  brass(midi, t, d, v, dst = this.L.sting.in) {
    const a = this.a, lp = a.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 1; lp.connect(dst);
    lp.frequency.setValueAtTime(400, t); lp.frequency.linearRampToValueAtTime(2400, t + 0.06); lp.frequency.setTargetAtTime(1300, t + 0.1, 0.3);
    for (const det of [-7, 7]) {
      const [o, g] = this.osc('sawtooth', mtof(midi), t, t + d + 0.5, lp); o.detune.value = det;
      g.setValueAtTime(0, t); g.linearRampToValueAtTime(v, t + 0.04); g.setTargetAtTime(v * 0.75, t + 0.08, 0.3); g.setTargetAtTime(0, t + d, 0.12);
    }
  }
  sting(name, keepBed) {
    if (!this.live || !(settings.music > 0.001)) return;
    const a = this.a, six = this.six, now = a.currentTime;
    // quantise to the next beat of the running groove
    let t = this.next + ((4 - (this.pos % 4)) % 4) * six; if (t < now + 0.05) t = now + 0.05; if (t > now + 0.6) t = now + 0.08;
    const B = this.brass.bind(this), S = this.L.sting.in, bell = (m, at, d, v) => this.bell(m, at, d, v, S);
    const tom = (at, v, f = 70) => { const [o, g] = this.osc('sine', f * 1.6, at, at + 1, S); o.frequency.setValueAtTime(f * 1.6, at); o.frequency.exponentialRampToValueAtTime(f, at + 0.08); g.setValueAtTime(v, at); g.setTargetAtTime(0, at + 0.02, 0.25); };
    const boom = (at, v) => { const [o, g] = this.osc('sine', 90, at, at + 2.5, S); o.frequency.setValueAtTime(90, at); o.frequency.exponentialRampToValueAtTime(32, at + 1.2); g.setValueAtTime(v, at); g.setTargetAtTime(0, at + 0.05, 0.5); };
    const crash = (at, v) => this.noiseHit(this.fx.crash, at, v * 0.24, 0.7, 2.1, 0);
    const o = ((this.theme.key - 57 + 6 + 120) % 12) - 6; // stingers over a running bed follow its key
    let dur = 2.5, stop = false;
    if (name === 'victory') {
      stop = true; dur = 5.2;
      for (let i = 0; i < 8; i++) tom(t + i * 0.06, 0.15 + i * 0.05, 60);
      crash(t + 0.5, 1); boom(t + 0.5, 0.5);
      // A major: the theme head, now in major, as a fanfare
      [[0.5, 0.25, 64], [0.75, 0.25, 69], [1.0, 0.25, 71], [1.25, 0.7, 73]].forEach(([at, d, m]) => { B(m, t + at, d, 0.07); B(m - 12, t + at, d, 0.04); });
      [62, 66, 69, 74].forEach((m) => B(m, t + 2.0, 0.4, 0.045)); tom(t + 2.0, 0.6);
      [57, 64, 69, 73, 76].forEach((m) => B(m, t + 2.5, 2.2, 0.04)); tom(t + 2.5, 0.8, 55); crash(t + 2.5, 1);
      [69, 73, 76, 81, 85, 88].forEach((m, i) => bell(m, t + 2.5 + i * 0.09, 2, 0.05));
      B(33, t + 2.5, 2.2, 0.06); B(45, t + 2.5, 2.2, 0.04);
    } else if (name === 'defeat') {
      stop = !keepBed; dur = keepBed ? 3.4 : 4.6;
      boom(t, 0.45);
      const q = keepBed ? o : 0;
      [[0, 0.6, 72], [0.6, 0.6, 71], [1.2, 0.6, 69], [1.8, 0.6, 68], [2.4, 1.8, 64]].forEach(([at, d, m]) => B(m + q, t + at, d, 0.05));
      [45, 52, 57, 60].forEach((m) => B(m + q, t, 3.6, 0.022));
      [52, 52, 52].forEach((m, i) => bell(m + q, t + i * 1.2, 2.2, 0.06));
    } else if (name === 'end') {
      stop = true; dur = 3;
      [[0, 0.5, [57, 60, 64]], [0.6, 2, [52, 57, 61, 64]]].forEach(([at, d, ns]) => ns.forEach((m) => B(m, t + at, d, 0.035)));
      crash(t + 0.6, 0.6); tom(t + 0.6, 0.6, 55);
    } else if (name === 'crowned') {
      dur = 2.6;
      crash(t, 0.7); tom(t, 0.7, 60); tom(t + 0.25, 0.5, 60);
      B(64 + o, t, 0.25, 0.06); [69, 73, 76].forEach((m) => B(m + o, t + 0.25, 1.6, 0.045)); B(57 + o, t + 0.25, 1.6, 0.04);
      [76, 81, 85, 88, 93].forEach((m, i) => bell(m + o, t + 0.25 + i * 0.07, 2.2, 0.045));
    } else if (name === 'final') {
      dur = 2.2;
      boom(t, 0.55); crash(t, 1); tom(t, 0.9, 50);
      [45, 52, 57, 60, 64].forEach((m) => B(m, t, 0.9, 0.035));
      this.riser(t + 0.4, 1.6);
    } else if (name === 'wave') {
      dur = 1.6;
      tom(t, 0.9, 60); tom(t + 0.18, 0.6, 60); tom(t + 0.5, 0.9, 50);
      B(57, t + 0.5, 0.25, 0.05); B(62, t + 0.75, 0.8, 0.06); B(50, t + 0.5, 1, 0.04);
    } else if (name === 'boss') {
      dur = 3;
      boom(t, 0.6); crash(t, 0.8);
      [38, 45, 50].forEach((m) => B(m, t, 1.4, 0.05)); [39, 46, 51].forEach((m) => B(m, t + 1.4, 1.2, 0.05));
      for (let i = 0; i < 6; i++) tom(t + 1.4 + i * 0.2, 0.5 + i * 0.08, 55);
    } else if (name === 'phase') { // 15.0 boss King phase (66% / 33%): a hit and a climbing brass cluster in the bed's key
      dur = 2;
      boom(t, 0.55); crash(t, 0.9); tom(t, 0.8, 50); tom(t + 0.16, 0.6, 50);
      [45, 48, 51].forEach((m, i) => B(m + o, t + i * 0.12, 1.3 - i * 0.12, 0.045)); B(57 + o, t + 0.36, 1.1, 0.05);
      this.riser(t + 0.3, 1.5);
    } else return;
    this.lastSting = name;
    if (stop) { this.hold = true; this.holdUntil = t + dur - 0.2; for (const k in this.L) if (k !== 'sting') this.gateTo(k, false, t); this.leadOff(t); this.layerOn = { sting: true }; }
    else this.duck(dur * 1000, 0.45);
  }
}

export { Music };
export const music = new Music();
// 15.0: survive audio.js rebuilding the context (voice chat mic on / off), and react to a few game events
onCtxSwap(() => { try { music.rebind(); } catch (e) { console.warn('music rebind', e); } });
onSfxEvent((e) => {
  if (e.e === 'location' && e.id) music.location(e.id);
  else if (/^(kingPhase|bossPhase|phase)$/.test(e.e) || (e.e === 'king' && e.phase)) { const n = +(e.phase || e.n || 1) || 1; music.kingPh = Math.max(music.kingPh || 0, n); music.sting('phase'); }
});
