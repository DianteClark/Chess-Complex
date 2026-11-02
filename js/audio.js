// Chess Complex 10.0 sound engine. Fully procedural Web Audio: no audio files.
// Layout: tiny synthesis toolkit -> recipes (sound design) -> named sound table -> playNamed() router.
// Signal flow: layers -> category bus (ui / combat / world / voice) [+ room / hall reverb, crunch sends]
//   combat+world -> danger low-pass -> sfx master -> glue compressor -> limiter -> out; music -> duck -> glue.
import * as D from './data.js';

let ac = null, master = null, sfxBus = null, musicBus = null, verb = null;
let glue = null, limiter = null, musicDuck = null, dangerLP = null, roomIn = null, crunchIn = null;
const B = {}; // category buses
const SKEY = 'cc_settings_v1';
export const settings = { sfx: 0.8, music: 0.55, haptics: true, shake: true, sfxUi: 1, sfxCombat: 1, sfxWorld: 1, sfxVoice: 1 };
try { Object.assign(settings, JSON.parse(localStorage.getItem(SKEY) || '{}')); if (localStorage.getItem('cc_muted') === '1') { settings.sfx = 0; settings.music = 0; localStorage.removeItem('cc_muted'); } } catch {}
for (const k of ['sfxUi', 'sfxCombat', 'sfxWorld', 'sfxVoice']) if (typeof settings[k] !== 'number' || !isFinite(settings[k])) settings[k] = 1;
export function saveSettings() { try { localStorage.setItem(SKEY, JSON.stringify(settings)); } catch {} applyVolumes(); }

// ---------------------------------------------------------------- context + graph
const NB = {}; // shared noise buffers (white / pink / brown)
// ---- background job queue: heavy buffer work runs in <=5 ms slices during idle time, never on the unlock tap
const jobs = []; let pumping = false, rvState = { room: false, hall: false, noise: false };
const later = (f) => (typeof requestIdleCallback === 'function' ? requestIdleCallback(f, { timeout: 150 }) : setTimeout(f, 16));
function bg(gen, done) { jobs.push({ gen, done }); if (!pumping) { pumping = true; later(pump); } }
function pump(dl) {
  const budget = dl && dl.timeRemaining && !dl.didTimeout ? Math.min(8, Math.max(2, dl.timeRemaining())) : 4;
  const end = performance.now() + budget;
  while (jobs.length && performance.now() < end) {
    const j = jobs[0]; let r;
    try { r = j.gen.next(); } catch { r = { done: true }; }
    if (r.done) { jobs.shift(); try { if (j.done) j.done(); } catch {} break; } // finishing step (e.g. convolver setup) gets its own slice
  }
  if (window.__ccAudioDebug) (window.__ccAudioSlices = window.__ccAudioSlices || []).push(+(performance.now() - end + budget).toFixed(1) + (jobs[0] ? '' : '.end'));
  if (jobs.length) later(pump); else pumping = false;
}
const CH = 2048; // samples per step
// Tiny seed buffer so sounds work on the very first tap (≈0.3 ms); full buffers replace it in the background.
function seedNoise(a) {
  const len = Math.floor(a.sampleRate * 0.35), w = a.createBuffer(1, len, a.sampleRate), d = w.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  NB.white = NB.pink = NB.brown = w;
}
function* genNoise(a) {
  const len = Math.floor(a.sampleRate * 3);
  const w = a.createBuffer(1, len, a.sampleRate), p = a.createBuffer(1, len, a.sampleRate), br = a.createBuffer(1, len, a.sampleRate);
  const wd = w.getChannelData(0), pd = p.getChannelData(0), bd = br.getChannelData(0);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, last = 0;
  for (let i0 = 0; i0 < len; i0 += CH) {
    for (let i = i0, e = Math.min(len, i0 + CH); i < e; i++) {
      const x = Math.random() * 2 - 1; wd[i] = x;
      b0 = 0.99886 * b0 + x * 0.0555179; b1 = 0.99332 * b1 + x * 0.0750759; b2 = 0.969 * b2 + x * 0.153852;
      b3 = 0.8665 * b3 + x * 0.3104856; b4 = 0.55 * b4 + x * 0.5329522; b5 = -0.7616 * b5 - x * 0.016898;
      pd[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + x * 0.5362) * 0.11; b6 = x * 0.115926;
      last = (last + 0.02 * x) / 1.02; bd[i] = last * 3.5;
    }
    yield;
  }
  NB.white = w; NB.pink = p; NB.brown = br; rvState.noise = true;
}
// Generated impulse response: early-reflection taps + decorrelated stereo tail that darkens as it decays. Chunked.
// Normalised like ConvolverNode.normalize (so the mix matches), but done here so the IR can be split into segments.
function* genIR(a, out, sec, decay, dark, pre, taps) {
  const sr = a.sampleRate, len = Math.floor(sr * sec), chans = [new Float32Array(len), new Float32Array(len)];
  let ss = 0;
  for (let c = 0; c < 2; c++) {
    const d = chans[c]; let lp = 0;
    const p0 = Math.floor(sr * pre);
    for (let i0 = p0; i0 < len; i0 += CH) {
      for (let i = i0, e = Math.min(len, i0 + CH); i < e; i++) {
        const k = (i - p0) / (len - p0);
        const coef = 0.92 - dark * k * 0.85; // one-pole low-pass that closes over time
        lp = lp * (1 - coef) + (Math.random() * 2 - 1) * coef;
        d[i] = lp * Math.pow(1 - k, decay) * (k < 0.02 ? k / 0.02 : 1);
      }
      yield;
    }
    for (let j = 0; j < taps; j++) { const ix = Math.floor(p0 * 0.3 + Math.random() * sr * 0.07); if (ix < len) d[ix] += (Math.random() < 0.5 ? -1 : 1) * (0.6 - j / taps * 0.4) * 0.3; }
    for (let i0 = 0; i0 < len; i0 += CH * 4) { for (let i = i0, e = Math.min(len, i0 + CH * 4); i < e; i++) ss += d[i] * d[i]; yield; }
  }
  out.scale = (0.00125 * 44100 / sr) / Math.max(0.000125, Math.sqrt(ss / (2 * len)));
  out.chans = chans; out.len = len;
}
// IR = seg0 + delay(seg1) + delay(seg2)...: exact, and each convolver's setup (the costly part) is its own idle slice.
const SEG = 0.4; // convolver setup grows faster than IR length: 0.4 s pieces keep each idle slice small
function* genReverb(spec, inGain, outGain, key) {
  const job = {}; yield* genIR(ac, job, ...spec);
  const sr = ac.sampleRate, segLen = Math.floor(sr * SEG);
  for (let s0 = 0, i = 0; s0 < job.len; s0 += segLen, i++) {
    const n = Math.min(segLen, job.len - s0), buf = ac.createBuffer(2, n, sr);
    for (let c = 0; c < 2; c++) { const d = buf.getChannelData(c), src = job.chans[c]; for (let k = 0; k < n; k++) d[k] = src[s0 + k] * job.scale; }
    yield;
    const t = performance.now(), cv = ac.createConvolver(); cv.normalize = false; cv.buffer = buf;
    if (i) { const dl = ac.createDelay(Math.max(1, (s0 / sr) + 0.1)); dl.delayTime.value = s0 / sr; inGain.connect(dl); dl.connect(cv); } else inGain.connect(cv);
    cv.connect(outGain);
    if (window.__ccAudioDebug) console.log('a3 convolver', key, i, (performance.now() - t).toFixed(1));
    yield;
  }
  rvState[key] = true;
}
export const reverbState = () => ({ ...rvState, pending: jobs.length });
function shaperCurve(k) { const n = 1024, c = new Float32Array(n); for (let i = 0; i < n; i++) { const x = i / (n - 1) * 2 - 1; c[i] = Math.tanh(k * x) / Math.tanh(k); } return c; }

export function getCtx(quiet) {
  if (!ac) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    // 'playback' lets sound play through the iPhone silent switch, but it also blocks the microphone, so never
    // override 'play-and-record' while voice chat holds the mic (voice.js switches it back when it lets go).
    try { if (navigator.audioSession && navigator.audioSession.type !== 'play-and-record') navigator.audioSession.type = 'playback'; } catch {}
    try { ac = new AC({ latencyHint: 'interactive' }); } catch { ac = new AC(); }
    limiter = ac.createDynamicsCompressor(); limiter.threshold.value = -2.5; limiter.knee.value = 0; limiter.ratio.value = 20; limiter.attack.value = 0.002; limiter.release.value = 0.09;
    glue = ac.createDynamicsCompressor(); glue.threshold.value = -16; glue.knee.value = 8; glue.ratio.value = 3; glue.attack.value = 0.005; glue.release.value = 0.2;
    const trim = ac.createGain(); trim.gain.value = 0.95;
    glue.connect(trim); trim.connect(limiter); limiter.connect(ac.destination);
    master = glue;
    sfxBus = ac.createGain(); sfxBus.connect(glue);
    musicBus = ac.createGain(); musicDuck = ac.createGain(); musicBus.connect(musicDuck); musicDuck.connect(glue);
    dangerLP = ac.createBiquadFilter(); dangerLP.type = 'lowpass'; dangerLP.frequency.value = 20000; dangerLP.Q.value = 0.4; dangerLP.connect(sfxBus);
    for (const k of ['ui', 'combat', 'world', 'voice']) { B[k] = ac.createGain(); B[k].connect(k === 'combat' || k === 'world' ? dangerLP : sfxBus); }
    seedNoise(ac);
    // reverb sends exist immediately (silent until their convolver is built in the background):
    // room first (short, cheap), then full noise buffers, then the big hall.
    const low = settings.quality === 'low';
    roomIn = ac.createGain(); roomIn.gain.value = 0.5;
    bg(genReverb([0.5, 3.2, 0.5, 0.004, 10], roomIn, sfxBus, 'room'));
    bg(genNoise(ac));
    if (low) verb = roomIn;
    else {
      const hg = ac.createGain(); hg.gain.value = 0.42; hg.connect(sfxBus);
      verb = ac.createGain(); // public send (music may use it)
      bg(genReverb([1.6, 2.3, 0.9, 0.018, 16], verb, hg, 'hall'));
    }
    // shared saturation send for crunchy impacts
    crunchIn = ac.createGain(); const sh = ac.createWaveShaper(); sh.curve = shaperCurve(4); sh.oversample = 'none';
    const sl = ac.createBiquadFilter(); sl.type = 'lowpass'; sl.frequency.value = 5200; const sg = ac.createGain(); sg.gain.value = 0.35;
    crunchIn.connect(sh); sh.connect(sl); sl.connect(sg); sg.connect(B.combat);
    applyVolumes();
  }
  if (!quiet && ac.state !== 'running') ac.resume().catch(() => {});
  return ac;
}
// Opening the audio device (new AudioContext) costs 50-300 ms on phones. Do it, suspended, in idle time after load,
// so the first tap only has to resume(). If the player taps first, getCtx() still builds everything on the spot.
function precreate() { if (!ac && !(settings.sfx === 0 && settings.music === 0)) try { getCtx(true); } catch {} }
if (typeof window !== 'undefined') {
  const go = () => setTimeout(() => later(precreate), 400);
  if (document.readyState === 'complete') go(); else addEventListener('load', go, { once: true });
}
export const buses = () => ({ ac, sfxBus, musicBus, verb, master, ui: B.ui, combat: B.combat, world: B.world, voice: B.voice });
function applyVolumes() {
  if (!ac) return;
  sfxBus.gain.value = settings.sfx * 0.7; musicBus.gain.value = settings.music * 0.35;
  B.ui.gain.value = settings.sfxUi; B.combat.gain.value = settings.sfxCombat; B.world.gain.value = settings.sfxWorld; B.voice.gain.value = settings.sfxVoice;
}
export function setVolume(cat, v) { const k = { sfx: 'sfx', music: 'music', ui: 'sfxUi', combat: 'sfxCombat', world: 'sfxWorld', voice: 'sfxVoice' }[cat]; if (!k) return; settings[k] = Math.max(0, Math.min(1, +v || 0)); saveSettings(); }
export function unlockAudio() { getCtx(); }
export const isMuted = () => settings.sfx === 0 && settings.music === 0;
export function setMuted(m) { if (m) { settings._s = settings.sfx || 0.8; settings._m = settings.music || 0.55; settings.sfx = 0; settings.music = 0; } else { settings.sfx = settings._s || 0.8; settings.music = settings._m || 0.55; } saveSettings(); }
export function haptic(p) { if (settings.haptics && navigator.vibrate) try { navigator.vibrate(p); } catch {} }
// Duck the music under big moments (announcer, kills, crowns). amt 0..1, len seconds.
export function duck(amt = 0.5, len = 0.8) {
  if (!ac || !musicDuck) return; const t = ac.currentTime, g = musicDuck.gain;
  g.cancelScheduledValues(t); g.setTargetAtTime(Math.max(0.05, 1 - amt), t, 0.03); g.setTargetAtTime(1, t + len, 0.35);
}
// Low-HP: combat/world get muffled while heartbeats keep coming; opens again by itself.
function danger() {
  if (!dangerLP) return; const t = ac.currentTime, f = dangerLP.frequency;
  f.cancelScheduledValues(t); f.setTargetAtTime(3200, t, 0.12); f.setTargetAtTime(20000, t + 1.5, 0.4);
}

// ---------------------------------------------------------------- synthesis toolkit
let live = 0; // currently sounding sources (voice limiting)
const maxVoices = () => (settings.quality === 'low' ? 36 : 72);
let CUR = { t0: 0, pm: 1, vm: 1, bus: 'combat' };
const R = Math.random, rr = (a, b) => a + R() * (b - a), clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const st = (n) => Math.pow(2, n / 12);
const ok = (o) => !(live > maxVoices() * 1.6 || (o.lo && live > maxVoices()));
function shape(p, t, v, a, h, d) { p.setValueAtTime(0, t); p.linearRampToValueAtTime(v, t + a); if (h) p.setValueAtTime(v, t + a + h); p.exponentialRampToValueAtTime(0.0001, t + a + h + d); return t + a + h + d; }
function filt(type, f, q, t, to, glide) { const fl = ac.createBiquadFilter(); fl.type = type; fl.frequency.setValueAtTime(clamp(f, 20, 20000), t); fl.Q.value = q == null ? 0.8 : q; if (to) fl.frequency.exponentialRampToValueAtTime(clamp(to, 20, 20000), t + glide); return fl; }
function out(src, head, o, t, end, offset) {
  const g = ac.createGain(); shape(g.gain, t, (o.v == null ? 0.2 : o.v) * CUR.vm, o.a == null ? 0.003 : o.a, o.h || 0, end);
  head.connect(g); let n = g;
  const pan = o.pan != null ? o.pan : o.spread ? rr(-o.spread, o.spread) : 0;
  if (pan && ac.createStereoPanner) { const p = ac.createStereoPanner(); p.pan.value = clamp(pan, -1, 1); g.connect(p); n = p; }
  n.connect(B[o.bus || CUR.bus] || B.combat);
  if (o.room) { const s = ac.createGain(); s.gain.value = o.room; n.connect(s); s.connect(roomIn); }
  if (o.hall) { const s = ac.createGain(); s.gain.value = o.hall; n.connect(s); s.connect(verb); }
  if (o.crunch) { const s = ac.createGain(); s.gain.value = o.crunch; n.connect(s); s.connect(crunchIn); }
  live++; src.onended = () => { live--; };
  const stopAt = t + (o.a == null ? 0.003 : o.a) + (o.h || 0) + end + 0.05;
  if (offset != null) src.start(t, offset); else src.start(t);
  src.stop(stopAt); return stopAt;
}
// Oscillator layer. o: type, v, a, h, to (glide target), glide, lin, det (cents jitter), vib [rate, depth], lp/hp/bp {f,q,to}, fix (no pitch var)
function T(f, d, o = {}) {
  if (!ok(o)) return;
  const t = CUR.t0 + (o.at || 0), pm = o.fix ? 1 : CUR.pm, f0 = clamp(f * pm, 10, 20000);
  const s = ac.createOscillator(); s.type = o.type || 'sine'; s.frequency.setValueAtTime(f0, t);
  if (o.to) { const tt = t + (o.glide == null ? d : o.glide); if (o.lin) s.frequency.linearRampToValueAtTime(clamp(o.to * pm, 10, 20000), tt); else s.frequency.exponentialRampToValueAtTime(clamp(o.to * pm, 10, 20000), tt); }
  if (o.det) s.detune.value = rr(-o.det, o.det);
  if (o.vib) { const l = ac.createOscillator(), lg = ac.createGain(); l.frequency.value = o.vib[0]; lg.gain.value = f0 * o.vib[1]; l.connect(lg); lg.connect(s.frequency); l.start(t); l.stop(t + d + 0.2); }
  let head = s;
  for (const ft of ['lp', 'hp', 'bp']) if (o[ft]) { const x = o[ft]; const fl = filt(ft === 'lp' ? 'lowpass' : ft === 'hp' ? 'highpass' : 'bandpass', x.f, x.q, t, x.to, x.g || d); head.connect(fl); head = fl; }
  out(s, head, o, t, d);
}
// FM / metallic layer. o.ratio (inharmonic = metallic), o.idx (brightness), o.iEnd, o.type
function FM(f, d, o = {}) {
  if (!ok(o)) return;
  const t = CUR.t0 + (o.at || 0), pm = o.fix ? 1 : CUR.pm, f0 = clamp(f * pm, 10, 18000), ratio = o.ratio || 1.41, idx = o.idx == null ? 2 : o.idx;
  const c = ac.createOscillator(), m = ac.createOscillator(), mg = ac.createGain();
  c.type = o.type || 'sine'; c.frequency.setValueAtTime(f0, t); if (o.to) c.frequency.exponentialRampToValueAtTime(clamp(o.to * pm, 10, 18000), t + (o.glide || d));
  m.frequency.setValueAtTime(f0 * ratio, t); if (o.to) m.frequency.exponentialRampToValueAtTime(clamp(o.to * pm * ratio, 10, 18000), t + (o.glide || d));
  mg.gain.setValueAtTime(f0 * ratio * idx, t); mg.gain.exponentialRampToValueAtTime(Math.max(1, f0 * ratio * idx * (o.iEnd == null ? 0.08 : o.iEnd)), t + d * 0.8);
  m.connect(mg); mg.connect(c.frequency);
  let head = c; if (o.hp) { const fl = filt('highpass', o.hp.f, o.hp.q, t); head.connect(fl); head = fl; }
  const end = out(c, head, o, t, d); m.start(t); m.stop(end);
}
// Noise layer. o.c: white|pink|brown, ft filter type, f, q, to (sweep), g (sweep time), hp (extra high-pass), rate
function N(d, o = {}) {
  if (!ok(o)) return;
  const t = CUR.t0 + (o.at || 0), pm = o.fix ? 1 : CUR.pm;
  const src = ac.createBufferSource(); src.buffer = NB[o.c || 'white']; src.loop = true; src.playbackRate.value = (o.rate || 1) * (o.fix ? 1 : rr(0.92, 1.08));
  let head = src;
  if (o.f) { const fl = filt(o.ft || 'lowpass', o.f * pm, o.q, t, o.to ? o.to * pm : 0, o.g || d); head.connect(fl); head = fl; }
  if (o.hp) { const fl = filt('highpass', o.hp, 0.7, t); head.connect(fl); head = fl; }
  out(src, head, o, t, d, rr(0, Math.max(0, src.buffer.duration - 0.05)));
}
// pitch-dropping sine thump (kick / body)
const K = (f0, f1, d, o = {}) => T(f0, d, { a: 0.002, ...o, to: f1, glide: o.drop || Math.min(d, 0.09) });
const chord = (fs, d, o = {}) => fs.forEach((f, i) => T(f, d, { ...o, at: (o.at || 0) + i * (o.roll || 0) }));
const at = (o, dt) => ({ ...o, at: (o.at || 0) + dt });

// ---------------------------------------------------------------- recipes
const lib = {
  click(o = {}) { N(0.018, { c: 'white', ft: 'highpass', f: o.f || 3500, v: o.v || 0.25, a: 0.0005, at: o.at, bus: o.bus, pan: o.pan }); },
  // layered impact: transient + body + sub + crunch + debris; p = power 0..1.5
  impact(p = 0.6, o = {}) {
    const b = o.bright || 1, a0 = o.at || 0;
    lib.click({ v: 0.18 + 0.25 * p, f: 2800 * b, at: a0 });
    N(0.09 + 0.22 * p, { c: 'pink', f: 1800 * b, to: 220, g: 0.12 + 0.2 * p, v: 0.35 + 0.3 * p, at: a0, room: 0.35, crunch: 0.4 * p, hall: p > 0.7 ? 0.25 * p : 0 });
    K((o.sub || 150) * (1 + p * 0.1), 42, 0.16 + 0.3 * p, { v: 0.35 + 0.35 * p, at: a0, drop: 0.07 + 0.05 * p });
    if (p > 0.75) for (let i = 0; i < 4; i++) N(0.04, { c: 'white', ft: 'bandpass', f: rr(900, 2600) * b, q: 2, v: 0.08, at: a0 + 0.06 + i * rr(0.03, 0.07), lo: true, spread: 0.6 });
  },
  whoosh(d = 0.3, o = {}) { N(d, { c: 'pink', ft: 'bandpass', f: o.f || 400, to: o.to || 2800, q: o.q || 1.4, v: o.v || 0.22, a: d * (o.peak || 0.6), at: o.at, room: o.room, hall: o.hall, bus: o.bus }); },
  swish(o = {}) { N(o.d || 0.11, { c: 'white', ft: 'bandpass', f: o.f || 4200, to: o.to || 900, q: 1.6, v: o.v || 0.2, a: 0.025, at: o.at, spread: 0.3 }); },
  bell(f, d = 0.8, o = {}) { FM(f, d, { ratio: o.ratio || 3.5, idx: o.idx || 1.6, v: o.v || 0.07, at: o.at, hall: o.hall == null ? 0.35 : o.hall, bus: o.bus, pan: o.pan, spread: o.spread, lo: o.lo, a: 0.002 }); T(f * 2.76, d * 0.4, { v: (o.v || 0.07) * 0.35, at: o.at, bus: o.bus, lo: true }); },
  chime(notes, o = {}) { notes.forEach((f, i) => lib.bell(f, o.d || 0.7, { ...o, at: (o.at || 0) + i * (o.roll == null ? 0.07 : o.roll), spread: 0.4 })); },
  sparkle(n = 6, o = {}) { for (let i = 0; i < n; i++) T(rr(o.lo2 || 2600, o.hi || 6500), 0.07 + R() * 0.08, { type: 'triangle', v: o.v || 0.035, at: (o.at || 0) + i * (o.gap || 0.035) + R() * 0.02, hall: 0.3, lo: true, spread: 0.8, bus: o.bus }); },
  riser(d = 0.8, o = {}) {
    T(o.f || 110, d, { type: 'sawtooth', to: (o.f || 110) * (o.mult || 4), v: o.v || 0.07, a: d * 0.85, lp: { f: 300, to: 5000, q: 4 }, at: o.at, hall: 0.3, det: 8, bus: o.bus });
    N(d, { c: 'pink', ft: 'bandpass', f: 300, to: 6000, q: 1.2, v: (o.v || 0.07) * 2.5, a: d * 0.9, at: o.at, bus: o.bus });
  },
  downer(d = 0.6, o = {}) { T(o.f || 900, d, { type: 'sawtooth', to: (o.f || 900) * 0.12, v: o.v || 0.06, lp: { f: 4000, to: 300 }, at: o.at, hall: 0.3, bus: o.bus }); },
  sub(f, d, o = {}) { T(f, d, { v: o.v || 0.4, a: o.a || 0.01, to: o.to, at: o.at, bus: o.bus }); },
  zap(o = {}) { const f = o.f || 2400; T(f, o.d || 0.18, { type: 'sawtooth', to: f * 0.15, v: o.v || 0.06, at: o.at, hp: { f: 400 } }); FM(f * 0.5, o.d || 0.18, { ratio: 2.01, idx: 6, to: f * 0.08, v: (o.v || 0.06) * 0.8, at: o.at, room: 0.3 }); N(0.06, { c: 'white', ft: 'highpass', f: 6000, v: 0.12, at: o.at }); },
  beam(d = 0.45, o = {}) { const f = o.f || 880; T(f, d, { type: 'sawtooth', v: o.v || 0.05, vib: [32, 0.015], lp: { f: 6000, to: 1200 }, hall: 0.35, at: o.at, det: 10 }); T(f * 1.5, d, { type: 'square', v: (o.v || 0.05) * 0.5, lp: { f: 4000, to: 800 }, at: o.at, det: 14 }); N(d, { c: 'white', ft: 'bandpass', f: 5000, q: 2, v: 0.08, at: o.at, a: 0.01 }); },
  glass(p = 1, o = {}) { N(0.3 * p, { c: 'white', ft: 'highpass', f: 3500, v: 0.3, at: o.at, room: 0.3, hall: 0.2 }); for (let i = 0; i < 4 + 5 * p; i++) FM(rr(2400, 6200), rr(0.08, 0.25), { ratio: rr(1.3, 3.1), idx: 1.2, v: 0.04, at: (o.at || 0) + i * rr(0.012, 0.035), spread: 0.8, lo: i > 3 }); },
  stone(n = 5, o = {}) { for (let i = 0; i < n; i++) N(rr(0.03, 0.07), { c: 'pink', ft: 'bandpass', f: rr(300, 1400), q: 1.5, v: rr(0.08, 0.2), at: (o.at || 0) + i * rr(0.025, 0.06), lo: i > 1, spread: 0.6, room: 0.3 }); },
  fire(d = 0.6, o = {}) { N(d, { c: 'brown', ft: 'bandpass', f: 600, to: 1400, q: 0.7, v: o.v || 0.3, a: 0.04, at: o.at, room: 0.3 }); N(d, { c: 'white', ft: 'highpass', f: 3500, v: (o.v || 0.3) * 0.25, a: 0.05, at: o.at }); for (let i = 0; i < (o.crackle || 6); i++) lib.click({ v: rr(0.05, 0.14), f: rr(2000, 5000), at: (o.at || 0) + R() * d }); },
  frost(o = {}) { N(0.35, { c: 'white', ft: 'highpass', f: 6000, to: 9000, v: 0.12, at: o.at, hall: 0.3 }); for (let i = 0; i < 4; i++) FM(rr(2800, 4800), 0.3, { ratio: 2.71, idx: 0.8, v: 0.03, at: (o.at || 0) + i * 0.05, hall: 0.4, lo: i > 1, spread: 0.6 }); },
  elec(d = 0.4, o = {}) { T(o.f || 70, d, { type: 'sawtooth', v: 0.08, bp: { f: 1600, q: 3 }, vib: [43, 0.4], at: o.at }); for (let i = 0; i < 6; i++) N(0.02, { c: 'white', ft: 'highpass', f: 4000, v: rr(0.08, 0.2), at: (o.at || 0) + R() * d, lo: true, spread: 0.7 }); },
  coins(n = 6, o = {}) { for (let i = 0; i < n; i++) FM(rr(2600, 4200), rr(0.08, 0.16), { ratio: 2.4, idx: 1, v: o.v || 0.045, at: (o.at || 0) + i * (o.gap || 0.045) + R() * 0.015, room: 0.3, spread: 0.6, lo: i > 2, bus: o.bus }); },
  // choir-ish pad through vowel formants
  choir(notes, d = 1, o = {}) { const v = VOW[o.vowel || 'a']; notes.forEach((f, i) => { if (!ok({})) return; const t = CUR.t0 + (o.at || 0) + i * (o.roll || 0); const s = ac.createOscillator(); s.type = 'sawtooth'; s.frequency.value = f * CUR.pm; s.detune.value = rr(-9, 9); const sum = ac.createGain(); sum.gain.value = 1; v.forEach((ff, j) => { const fl = filt('bandpass', ff, 8 + j * 3, t); const g = ac.createGain(); g.gain.value = [1, 0.5, 0.25][j]; s.connect(fl); fl.connect(g); g.connect(sum); }); out(s, sum, { v: (o.v || 0.12), a: o.a || d * 0.4, hall: 0.6, bus: o.bus || CUR.bus, spread: 0.5 }, t, d); }); },
  dark(o = {}) { const f = o.f || 55; T(f, o.d || 1, { type: 'sawtooth', v: 0.09, lp: { f: 900, to: 200 }, det: 12, hall: 0.5, at: o.at, a: 0.1 }); T(f * 1.06, o.d || 1, { type: 'sawtooth', v: 0.07, lp: { f: 700, to: 180 }, hall: 0.5, at: o.at, a: 0.12 }); N(o.d || 1, { c: 'brown', f: 400, v: 0.25, a: 0.3, at: o.at, hall: 0.4 }); },
};

// ---------------------------------------------------------------- announcer voice (formant vocoder, no speech APIs)
const VOW = { a: [760, 1250, 2650], e: [520, 1800, 2500], i: [300, 2250, 3000], o: [480, 820, 2550], u: [340, 760, 2350], r: [470, 1300, 1650], m: [280, 900, 2200], w: [300, 650, 2200] };
// syl: [vowels (1-2 letters, glides between), duration, semitone offset, consonant]
function voice(syl, o = {}) {
  if (!ac || live > maxVoices() * 1.4) return;
  const t0 = CUR.t0 + (o.at || 0), base = o.p || 92, intervals = o.chord || [0, 12, 19];
  const total = syl.reduce((s, x) => s + x[1] + 0.03, 0) + 0.25;
  const pre = ac.createGain(); pre.gain.value = 0;
  const oscs = intervals.map((iv, k) => { const s = ac.createOscillator(); s.type = 'sawtooth'; s.detune.value = (k ? rr(-7, 7) : 0); const g = ac.createGain(); g.gain.value = [1, 0.45, 0.25, 0.2][k] || 0.2; s.connect(g); g.connect(pre); return { s, iv }; });
  const fls = [0, 1, 2].map((j) => { const fl = ac.createBiquadFilter(); fl.type = 'bandpass'; fl.Q.value = [7, 11, 13][j]; return fl; });
  const sum = ac.createGain(); sum.gain.value = 1.6;
  fls.forEach((fl, j) => { const g = ac.createGain(); g.gain.value = [1, 0.7, 0.4][j]; pre.connect(fl); fl.connect(g); g.connect(sum); });
  // consonants: one noise source with a moving band-pass and gated gain
  const ns = ac.createBufferSource(); ns.buffer = NB.white; ns.loop = true; const nf = ac.createBiquadFilter(); nf.type = 'bandpass'; nf.Q.value = 1.5; const ng = ac.createGain(); ng.gain.value = 0; ns.connect(nf); nf.connect(ng);
  let t = t0;
  syl.forEach(([vw, d, semi = 0, cons], i) => {
    const v1 = VOW[vw[0]] || VOW.a, v2 = VOW[vw[1] || vw[0]] || v1, f = base * st(semi);
    if (cons) {
      const c = { k: [2400, 0.035], t: [4500, 0.03], p: [1200, 0.03], s: [5500, 0.09], h: [3200, 0.09], f: [4000, 0.06], v: [3500, 0.05], d: [700, 0.025], b: [400, 0.025], g: [1500, 0.03], j: [3000, 0.06] }[cons] || [2000, 0.03];
      nf.frequency.setValueAtTime(c[0], t); ng.gain.setValueAtTime(0, t); ng.gain.linearRampToValueAtTime(0.5, t + 0.005); ng.gain.exponentialRampToValueAtTime(0.001, t + c[1]);
      t += c[1] * 0.6;
    }
    oscs.forEach(({ s, iv }) => { const fr = f * st(iv); if (i === 0) s.frequency.setValueAtTime(fr, t); else s.frequency.exponentialRampToValueAtTime(fr, t + 0.04); s.frequency.setValueAtTime(fr, t + 0.04); if (i === syl.length - 1 && o.fall !== 0) s.frequency.exponentialRampToValueAtTime(fr * st(o.fall == null ? -3 : o.fall), t + d); });
    fls.forEach((fl, j) => { fl.frequency.setValueAtTime(v1[j], t); fl.frequency.linearRampToValueAtTime(v2[j], t + d); });
    pre.gain.setValueAtTime(i ? 0.25 : 0, t); pre.gain.linearRampToValueAtTime(1, t + 0.025); pre.gain.setValueAtTime(1, t + d * 0.7); pre.gain.linearRampToValueAtTime(i === syl.length - 1 ? 0.0001 : 0.3, t + d);
    t += d + 0.03;
  });
  const hp = ac.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 160; sum.connect(hp);
  const g = ac.createGain(); g.gain.value = (o.v || 0.5); hp.connect(g); g.connect(B.voice);
  const hs = ac.createGain(); hs.gain.value = o.hall == null ? 0.45 : o.hall; g.connect(hs); hs.connect(verb);
  const end = t + 0.2;
  live += oscs.length + 1;
  oscs.forEach(({ s }) => { s.start(t0); s.stop(end); }); ns.start(t0, rr(0, Math.max(0, NB.white.duration - 0.05))); ns.stop(end);
  oscs[0].s.onended = () => { live -= oscs.length + 1; };
  duck(0.45, total + 0.3);
}
// stinger under every callout: whoosh in, hit, shimmer; level 1..5 escalates
function sting(level = 1, o = {}) {
  const L = clamp(level, 1, 6), root = o.root || [220, 233, 247, 262, 277, 294][L - 1];
  lib.whoosh(0.22, { f: 300, to: 4000, v: 0.12 + L * 0.02, peak: 0.9, bus: 'voice' });
  N(0.4 + L * 0.1, { c: 'pink', f: 2600, to: 300, v: 0.25 + L * 0.04, at: 0.2, hall: 0.4, bus: 'voice' });
  K(120, 40, 0.4 + L * 0.06, { v: 0.4, at: 0.2, bus: 'voice' });
  chord((o.minor ? [1, 1.2, 1.5, 2] : [1, 1.26, 1.5, 2]).map((k) => root * k), 0.6 + L * 0.1, { type: 'sawtooth', v: 0.035 + L * 0.006, roll: 0.012, at: 0.2, lp: { f: 1500 + L * 900, to: 600, g: 0.8 }, hall: 0.5, det: 10, bus: 'voice' });
  if (L >= 3) lib.sparkle(4 + L * 2, { at: 0.25, bus: 'voice' });
  if (L >= 4) lib.sub(55, 1, { at: 0.2, v: 0.3, to: 40, bus: 'voice' });
}
const P = (s) => s; // phrase literal marker (readability)
const PHRASES = {
  multi: P([['u', 0.14, 0, 'm'], ['i', 0.12, 2, 't'], ['i', 0.34, 3, 'k']]),
  double: P([['u', 0.16, 0, 'd'], ['o', 0.1, -1, 'b'], ['i', 0.34, 2, 'k']]),
  triple: P([['i', 0.16, 0, 't'], ['o', 0.1, -1, 'p'], ['i', 0.34, 3, 'k']]),
  quad: P([['ao', 0.3, 0, 'k'], ['i', 0.34, 3, 'k']]),
  rampage: P([['a', 0.16, 0, ''], ['ae', 0.34, 3, 'p']]),
  final: P([['ai', 0.2, 0, 'f'], ['o', 0.12, -2, ''], ['u', 0.14, 0, 'd'], ['eo', 0.36, 2, '']]),
  shutdown: P([['u', 0.18, 2, 'h'], ['au', 0.42, -1, 'd']]),
  regicide: P([['e', 0.12, 0, ''], ['i', 0.12, 2, 'j'], ['ai', 0.42, 4, 's']]),
  revive: P([['i', 0.12, 0, ''], ['ai', 0.42, 4, 'v']]),
  wave: P([['wei', 0.42, 0, '']]),
  boss: P([['o', 0.3, 0, 'b'], ['wei', 0.42, -2, 's']]),
  victory: P([['i', 0.15, 0, 'v'], ['o', 0.12, 2, 't'], ['i', 0.44, 4, '']]),
  defeat: P([['i', 0.14, 0, 'd'], ['i', 0.5, -3, 'f']]),
  waveclear: P([['we', 0.22, 0, ''], ['ia', 0.42, 4, 'k']]),
  firstblood: P([['r', 0.18, 0, 'f'], ['u', 0.42, 3, 'b']]),
  crowned: P([['au', 0.5, 2, 'k']]),
  ultimate: P([['u', 0.1, 0, ''], ['i', 0.1, 2, 't'], ['a', 0.36, 4, 'm']]),
  streak: P([['i', 0.4, 2, 's']]),
  unstoppable: P([['u', 0.1, 0, ''], ['o', 0.14, 2, 't'], ['a', 0.1, 0, 'p'], ['u', 0.3, -2, 'b']]),
  storm: P([['o', 0.42, 0, 's']]),
  fight: P([['ai', 0.42, 3, 'f']]),
  ready: P([['e', 0.14, 0, ''], ['i', 0.34, 3, 'd']]),
  go: P([['ou', 0.4, 4, 'g']]),
  crown: P([['au', 0.48, 2, 'k']]),
  laststand: P([['a', 0.16, 0, ''], ['a', 0.36, 3, 's']]),
  comeback: P([['u', 0.14, 0, 'k'], ['a', 0.36, 3, 'b']]),
  domination: P([['o', 0.1, 0, 'd'], ['i', 0.1, 2, 'm'], ['e', 0.12, 3, 'n'], ['u', 0.3, 0, 'h']]),
  godlike: P([['o', 0.16, 0, 'g'], ['ai', 0.36, 4, '']]),
  legendary: P([['e', 0.12, 0, ''], ['e', 0.1, 2, 'j'], ['e', 0.1, 3, 'd'], ['i', 0.3, 5, 'r']]),
  promoted: P([['o', 0.1, 0, 'p'], ['ou', 0.18, 2, 'm'], ['e', 0.3, 4, 't']]),
};
function hashStr(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
// Unknown callouts still get a voice: syllables derived from the name.
function phraseFor(name) {
  const key = name.toLowerCase().replace(/[^a-z]/g, '');
  if (PHRASES[key]) return PHRASES[key];
  const vs = key.match(/[aeiou]+/g) || ['a']; const cs = key.match(/[^aeiou]+/g) || [''];
  return vs.slice(0, 4).map((v, i, arr) => [v.slice(0, 2), i === arr.length - 1 ? 0.36 : 0.13, [0, 2, 3, 4][i] || 3, (cs[i] || '')[0] || '']);
}

// ---------------------------------------------------------------- chains / escalation state
const chain = { kill: 0, killT: -9, hit: 0, hitT: -9, crit: 0, critT: -9 };
const now = () => (ac ? ac.currentTime : 0);
function bump(k, win) { const t = now(); chain[k] = t - chain[k + 'T'] < win ? chain[k] + 1 : 1; chain[k + 'T'] = t; return chain[k]; }

// ---------------------------------------------------------------- sound table
const UI = new Set(['tap', 'hover', 'select', 'back', 'tick', 'error', 'buy', 'purchase', 'levelup', 'quest', 'emote', 'coin', 'toggle', 'toggle:on', 'toggle:off', 'tab', 'open', 'close', 'confirm', 'deny', 'equip', 'unlock', 'notify', 'swipe', 'count', 'countgo', 'slider', 'win', 'lose', 'turn', 'xp', 'rankup', 'claim']);
const WORLD = new Set(['storm', 'storm:crack', 'storm:collapse', 'storm:warn', 'meteorfall', 'meteor', 'firework', 'shrine', 'ice', 'ice:skid', 'portal', 'sizzle', 'lava', 'hollowrise', 'waveclear', 'crownspawn', 'chest', 'chest:open', 'supply', 'shardrain', 'bloodmoon', 'bramble', 'wind', 'eclipse', 'warn', 'geyser:warn', 'geyser:erupt', 'crumble:crack', 'crumble:collapse', 'rift', 'conveyor', 'earthquake', 'manasurge', 'bounty', 'frenzy', 'restless', 'hill:score', 'hill:contested']);
const catOf = (n) => (n.startsWith('announce:') || n === 'stinger' || n.startsWith('voice:') ? 'voice' : UI.has(n) || n.startsWith('reveal:') || n.startsWith('ui:') ? 'ui' : WORLD.has(n) || n.startsWith('world:') || n.startsWith('hazard:') ? 'world' : 'combat');
const VARI = { ui: 0.25, combat: 0.7, world: 0.5, voice: 0 };

const S = {
  // ---- UI
  tap: () => { T(rr(1180, 1260), 0.035, { type: 'triangle', v: 0.09, fix: true }); lib.click({ v: 0.06, f: 6000 }); },
  hover: () => T(rr(2300, 2500), 0.025, { v: 0.025, fix: true }),
  select: () => { T(880, 0.07, { type: 'triangle', v: 0.1 }); T(1320, 0.1, { type: 'triangle', v: 0.08, at: 0.045, room: 0.3 }); lib.click({ v: 0.05, f: 5000 }); },
  back: () => { T(990, 0.06, { type: 'triangle', v: 0.08 }); T(660, 0.09, { type: 'triangle', v: 0.07, at: 0.045 }); },
  toggle: () => { lib.click({ v: 0.12, f: 2500 }); T(1500, 0.03, { type: 'square', v: 0.025, hp: { f: 900 } }); },
  'toggle:on': () => { lib.click({ v: 0.1, f: 2500 }); T(1000, 0.05, { type: 'triangle', v: 0.07, to: 1500, glide: 0.04 }); },
  'toggle:off': () => { lib.click({ v: 0.1, f: 2200 }); T(1300, 0.05, { type: 'triangle', v: 0.06, to: 850, glide: 0.04 }); },
  tab: () => { N(0.05, { c: 'white', ft: 'bandpass', f: 2600, to: 5000, q: 1.5, v: 0.1, a: 0.015 }); T(1568, 0.05, { type: 'triangle', v: 0.05, at: 0.02 }); },
  open: () => { lib.whoosh(0.16, { f: 600, to: 3500, v: 0.1, bus: 'ui' }); T(784, 0.12, { type: 'triangle', v: 0.06, at: 0.08, to: 1175, glide: 0.06 }); },
  close: () => { lib.whoosh(0.14, { f: 3000, to: 500, v: 0.08, bus: 'ui' }); T(988, 0.08, { type: 'triangle', v: 0.05, to: 660, glide: 0.06 }); },
  confirm: () => { chord([784, 1175], 0.14, { type: 'triangle', v: 0.08, roll: 0.05 }); lib.click({ v: 0.06 }); },
  equip: () => { lib.click({ v: 0.12, f: 1800 }); FM(1200, 0.25, { ratio: 2.01, idx: 1.2, v: 0.06, room: 0.4 }); T(220, 0.08, { v: 0.15, to: 120 }); },
  error: () => { T(196, 0.09, { type: 'square', v: 0.05, lp: { f: 1400 } }); T(185, 0.12, { type: 'square', v: 0.05, at: 0.08, lp: { f: 1200 } }); },
  deny: () => S.error(),
  tick: () => T(rr(1900, 2050), 0.018, { type: 'square', v: 0.022, hp: { f: 1200 }, fix: true }),
  slider: () => S.tick(),
  notify: () => { lib.bell(1568, 0.4, { v: 0.05, bus: 'ui', hall: 0.3 }); lib.bell(2093, 0.5, { v: 0.04, at: 0.08, bus: 'ui', hall: 0.3 }); },
  swipe: () => lib.whoosh(0.12, { f: 1200, to: 4000, v: 0.07, bus: 'ui' }),
  count: () => { T(880, 0.12, { type: 'triangle', v: 0.1, fix: true }); lib.click({ v: 0.08 }); },
  countgo: () => { chord([880, 1320, 1760], 0.4, { type: 'sawtooth', v: 0.04, lp: { f: 5000, to: 1200 }, hall: 0.3, fix: true }); lib.click({ v: 0.15 }); },
  coin: () => FM(rr(2800, 3400), 0.09, { ratio: 2.4, idx: 1, v: 0.04 }),
  xp: () => T(rr(1300, 1700), 0.04, { type: 'triangle', v: 0.03 }),
  buy: () => { lib.coins(5, { bus: 'ui', v: 0.04 }); chord([659, 880, 1175, 1568], 0.35, { type: 'triangle', v: 0.09, roll: 0.05, at: 0.1, hall: 0.3 }); N(0.4, { c: 'white', ft: 'highpass', f: 7000, v: 0.05, at: 0.25, hall: 0.3, a: 0.05 }); },
  purchase: () => S.buy(),
  claim: () => { lib.coins(3, { bus: 'ui' }); chord([784, 1175, 1568], 0.3, { type: 'triangle', v: 0.08, roll: 0.04, at: 0.06, hall: 0.3 }); },
  unlock: () => { lib.click({ v: 0.2, f: 1500 }); T(300, 0.08, { v: 0.15, to: 160 }); chord([523, 784, 1047, 1568], 0.5, { type: 'triangle', v: 0.08, roll: 0.06, at: 0.12, hall: 0.4 }); lib.sparkle(5, { at: 0.2, bus: 'ui' }); },
  levelup: () => { lib.riser(0.35, { f: 220, mult: 4, v: 0.05, bus: 'ui' }); chord([523, 659, 784, 1047, 1568], 0.7, { type: 'triangle', v: 0.09, roll: 0.05, at: 0.3, hall: 0.5 }); lib.sparkle(8, { at: 0.35, bus: 'ui' }); K(140, 50, 0.3, { v: 0.25, at: 0.3 }); },
  rankup: () => { S.levelup(); lib.choir([262, 330, 392], 1.1, { at: 0.3, v: 0.06, vowel: 'a', bus: 'ui' }); },
  quest: () => { lib.chime([988, 1319, 1760], { bus: 'ui', v: 0.06, roll: 0.06, d: 0.5 }); T(659, 0.3, { type: 'triangle', v: 0.06, hall: 0.3 }); },
  emote: () => { T(880, 0.06, { type: 'sine', v: 0.07, to: 1100, glide: 0.05 }); T(1320, 0.09, { type: 'sine', v: 0.05, at: 0.05 }); },
  turn: () => { lib.bell(1175, 0.5, { v: 0.06, bus: 'ui', hall: 0.35 }); T(740, 0.12, { type: 'triangle', v: 0.09 }); T(1109, 0.25, { type: 'triangle', v: 0.08, at: 0.08, hall: 0.3 }); lib.click({ v: 0.06 }); },
  win: () => { [523, 659, 784, 1047, 784, 1047, 1319].forEach((f, i) => T(f, 0.45, { type: 'triangle', v: 0.1, at: i * 0.12, hall: 0.4 })); lib.choir([262, 330, 392, 523], 1.6, { at: 0.36, v: 0.05 }); lib.sparkle(10, { at: 0.7, gap: 0.06, bus: 'ui' }); K(110, 45, 0.5, { v: 0.3, at: 0.84 }); },
  lose: () => { [392, 330, 262, 196].forEach((f, i) => T(f, 0.55, { type: 'triangle', v: 0.1, at: i * 0.18, hall: 0.5, lp: { f: 2400, to: 700 } })); lib.sub(49, 1.2, { at: 0.54, v: 0.2 }); },
  // ---- combat basics
  step: () => { N(0.05, { c: 'pink', f: 1100, v: 0.2, room: 0.2 }); K(190, 80, 0.07, { v: 0.12 }); },
  slide: () => { N(0.25, { c: 'pink', ft: 'bandpass', f: 2200, to: 700, q: 0.9, v: 0.14, a: 0.03 }); N(0.2, { c: 'brown', f: 300, v: 0.15 }); },
  jump: () => { lib.whoosh(0.2, { f: 500, to: 2500, v: 0.12 }); T(240, 0.18, { type: 'triangle', v: 0.08, to: 520, glide: 0.15 }); },
  land: () => lib.impact(0.45, { sub: 120 }),
  whoosh: () => lib.whoosh(0.32, { f: 350, to: 3000, v: 0.24, room: 0.2 }),
  blink: () => { T(1800, 0.14, { v: 0.07, to: 400, hall: 0.4 }); FM(600, 0.22, { ratio: 1.5, idx: 4, to: 1800, v: 0.05, at: 0.06, hall: 0.4 }); N(0.12, { c: 'white', ft: 'bandpass', f: 3000, to: 8000, q: 2, v: 0.1, at: 0.04 }); },
  swing: () => lib.swish({ v: 0.2 }),
  zap: () => lib.zap(),
  cannon: () => { lib.impact(0.9, { sub: 120 }); N(0.5, { c: 'brown', f: 700, to: 150, v: 0.3, hall: 0.3 }); },
  boom: () => { lib.impact(1, { sub: 110 }); N(0.8, { c: 'brown', f: 900, to: 120, v: 0.4, hall: 0.4, at: 0.02 }); lib.sub(48, 0.6, { v: 0.35, to: 32 }); },
  dark: () => lib.dark(),
  hit: () => { const n = bump('hit', 1.4), up = st(Math.min(5, n - 1) * 0.6); CUR.pm *= up; lib.click({ v: 0.2, f: 3000 }); N(0.08, { c: 'pink', f: 2400, to: 500, v: 0.32, room: 0.3, crunch: 0.25 }); K(170, 70, 0.11, { v: 0.28 }); FM(rr(380, 460), 0.08, { ratio: 1.73, idx: 2, v: 0.03, lo: true }); },
  crit: () => {
    const n = bump('crit', 3), up = st(Math.min(4, n - 1)); CUR.pm *= up;
    lib.click({ v: 0.35, f: 2400 }); lib.impact(0.95, { sub: 150, bright: 1.3 });
    FM(1100, 0.4, { ratio: 2.76, idx: 3, v: 0.07, room: 0.3, hall: 0.3 }); T(2200, 0.2, { type: 'sawtooth', to: 500, v: 0.05, hp: { f: 600 } });
    lib.swish({ f: 6000, to: 1500, v: 0.22, d: 0.09 }); duck(0.25, 0.25);
  },
  burn: () => { lib.fire(0.3, { v: 0.22, crackle: 3 }); K(150, 70, 0.1, { v: 0.15 }); },
  impact: () => lib.impact(0.75),
  shatter: () => { lib.glass(1); K(140, 50, 0.2, { v: 0.3 }); },
  crate: () => { lib.impact(0.4, { sub: 220, bright: 0.7 }); lib.stone(4); FM(330, 0.06, { ratio: 1.41, idx: 1.5, v: 0.04 }); },
  rubble: () => { lib.stone(6); N(0.2, { c: 'brown', f: 500, v: 0.25, room: 0.3 }); },
  pickup: () => { T(988, 0.08, { type: 'triangle', v: 0.1 }); T(1319, 0.16, { type: 'triangle', v: 0.09, at: 0.06, hall: 0.3 }); lib.bell(2637, 0.3, { v: 0.03, at: 0.1 }); },
  heal: () => { chord([523, 659, 784, 1047], 0.6, { v: 0.06, roll: 0.06, hall: 0.5, a: 0.03 }); N(0.5, { c: 'white', ft: 'highpass', f: 6000, v: 0.04, a: 0.2, hall: 0.4 }); lib.sparkle(4, { at: 0.15, v: 0.025 }); },
  buff: () => { T(330, 0.3, { type: 'sawtooth', v: 0.05, to: 660, glide: 0.2, lp: { f: 800, to: 4000, g: 0.2 } }); chord([660, 990], 0.3, { type: 'triangle', v: 0.06, roll: 0.05, at: 0.12, hall: 0.3 }); },
  shrine: () => { lib.chime([392, 587, 784, 1175], { v: 0.06, roll: 0.08, d: 1 }); lib.choir([196, 294, 392], 1.4, { v: 0.05, vowel: 'o', bus: 'world' }); },
  rampart: () => { lib.impact(0.7, { sub: 100, bright: 0.6 }); N(0.4, { c: 'brown', f: 300, to: 900, v: 0.3, a: 0.1 }); lib.stone(5, { at: 0.12 }); },
  promote: () => S['promote:2'](),
  crown: () => { S['promote:5'](); },
  stinger: (n = 1) => sting(n),
  heartbeat: () => { danger(); K(70, 42, 0.14, { v: 0.45, fix: true, bus: 'combat' }); N(0.06, { c: 'brown', f: 200, v: 0.3, fix: true }); K(62, 40, 0.14, { v: 0.32, at: 0.19, fix: true }); N(0.05, { c: 'brown', f: 180, v: 0.2, at: 0.19, fix: true }); },
  attune: () => { lib.chime([784, 988, 1319, 1568], { v: 0.06, roll: 0.045, d: 0.6 }); T(392, 0.6, { type: 'sine', v: 0.06, to: 784, glide: 0.3, hall: 0.4 }); },
  ultcharge: () => { lib.riser(0.8, { f: 110, mult: 4, v: 0.08 }); lib.sub(55, 0.9, { v: 0.3, a: 0.3 }); lib.choir([110, 165, 220], 0.9, { v: 0.05, a: 0.6, vowel: 'a' }); duck(0.5, 1); },
  ultready: () => { chord([523, 784, 1047], 0.5, { type: 'sawtooth', v: 0.04, roll: 0.05, hall: 0.5, lp: { f: 3000, to: 900 } }); lib.bell(1568, 0.8, { v: 0.06, at: 0.15 }); lib.sparkle(4, { at: 0.2 }); },
  steadfast: () => { FM(520, 0.7, { ratio: 1.41, idx: 2.5, v: 0.08, hall: 0.4 }); lib.impact(0.5, { bright: 0.6 }); },
  block: () => { FM(700, 0.35, { ratio: 1.41, idx: 3, v: 0.08, room: 0.4 }); lib.click({ v: 0.25, f: 2000 }); },
  stagger: () => { T(600, 0.3, { type: 'triangle', v: 0.06, to: 300, vib: [12, 0.05] }); lib.impact(0.4); },
  mark: () => { FM(1400, 0.3, { ratio: 3, idx: 1.5, v: 0.05, hall: 0.4 }); T(700, 0.2, { v: 0.05, to: 1400 }); },
  evolve: () => S['promote:3'](),
  hone: () => { FM(1800, 0.25, { ratio: 1.41, idx: 2, v: 0.06, room: 0.4 }); lib.swish({ f: 7000, to: 3000, v: 0.12 }); FM(2400, 0.3, { ratio: 1.41, idx: 2, v: 0.05, at: 0.12, room: 0.4 }); },
  // ---- world, hazards
  storm: () => S['storm:collapse'](),
  'storm:collapse': () => { lib.impact(1.2, { sub: 90, bright: 0.6 }); N(1.6, { c: 'brown', f: 500, to: 90, v: 0.6, hall: 0.4, a: 0.02 }); for (let i = 0; i < 7; i++) lib.stone(2, { at: 0.08 + i * 0.13 }); lib.sub(41, 1.5, { v: 0.45, to: 28 }); T(55, 1.4, { type: 'sawtooth', v: 0.08, to: 35, lp: { f: 400 } }); duck(0.6, 1.2); },
  'storm:crack': () => { N(0.05, { c: 'white', ft: 'highpass', f: 3000, v: 0.4 }); N(0.5, { c: 'pink', f: 1400, to: 200, v: 0.35, room: 0.4, at: 0.02 }); for (let i = 0; i < 5; i++) lib.click({ v: 0.12, f: rr(1500, 4000), at: 0.04 + i * rr(0.03, 0.08) }); lib.sub(50, 0.6, { v: 0.25, to: 35 }); },
  'storm:warn': () => { [0, 0.28].forEach((a) => T(440, 0.22, { type: 'square', v: 0.045, at: a, to: 330, glide: 0.2, lp: { f: 2000 } })); N(0.6, { c: 'brown', f: 300, v: 0.2, a: 0.2 }); },
  warn: () => { T(660, 0.12, { type: 'square', v: 0.04, lp: { f: 2600 }, fix: true }); T(660, 0.12, { type: 'square', v: 0.04, at: 0.2, lp: { f: 2600 }, fix: true }); },
  meteorfall: () => { N(0.8, { c: 'pink', ft: 'bandpass', f: 4000, to: 300, q: 1.2, v: 0.3, a: 0.6, hall: 0.3 }); T(1200, 0.8, { type: 'sawtooth', v: 0.03, to: 150, lp: { f: 2000 } }); },
  meteor: () => { lib.impact(1.1, { sub: 100 }); lib.fire(0.6, { v: 0.2, at: 0.05 }); },
  firework: () => { lib.click({ v: 0.25, f: 1500 }); K(200, 60, 0.12, { v: 0.15 }); N(1, { c: 'white', ft: 'highpass', f: 5000, v: 0.08, at: 0.05, hall: 0.5, a: 0.02 }); lib.sparkle(5, { at: 0.08, gap: 0.08, v: 0.02 }); },
  ice: () => { N(0.32, { c: 'white', ft: 'bandpass', f: 7000, to: 3500, q: 1, v: 0.12, a: 0.02 }); FM(rr(2600, 3200), 0.25, { ratio: 2.71, idx: 0.7, v: 0.03, hall: 0.4 }); },
  'ice:skid': () => { N(0.45, { c: 'white', ft: 'bandpass', f: 5000, to: 2000, q: 2, v: 0.14, a: 0.03 }); T(rr(2200, 2600), 0.4, { v: 0.025, to: 1600, vib: [18, 0.01] }); },
  portal: () => { T(220, 0.4, { v: 0.1, to: 1100, glide: 0.35, hall: 0.6, vib: [9, 0.03] }); FM(440, 0.5, { ratio: 1.5, idx: 5, to: 110, v: 0.05, at: 0.1, hall: 0.6 }); N(0.4, { c: 'pink', ft: 'bandpass', f: 400, to: 3000, q: 3, v: 0.12, a: 0.2 }); lib.sub(70, 0.4, { v: 0.2, at: 0.25 }); },
  sizzle: () => { lib.fire(0.5, { v: 0.25 }); N(0.45, { c: 'white', ft: 'highpass', f: 4500, to: 2500, v: 0.18, a: 0.01 }); K(130, 60, 0.15, { v: 0.15 }); },
  lava: () => { N(0.9, { c: 'brown', f: 300, v: 0.35, a: 0.2 }); for (let i = 0; i < 4; i++) K(rr(80, 140), 40, 0.12, { v: 0.15, at: 0.1 + i * rr(0.12, 0.22), lo: true }); N(0.5, { c: 'white', ft: 'highpass', f: 5000, v: 0.06, a: 0.2 }); },
  trapset: () => { lib.click({ v: 0.15, f: 3000 }); FM(2200, 0.04, { ratio: 1.41, idx: 2, v: 0.04 }); FM(1600, 0.05, { ratio: 1.41, idx: 2, v: 0.035, at: 0.06 }); },
  trap: () => { lib.click({ v: 0.45, f: 3500 }); FM(900, 0.3, { ratio: 1.41, idx: 4, v: 0.08, room: 0.4 }); T(880, 0.18, { type: 'square', v: 0.05, to: 500, lp: { f: 3000 } }); lib.impact(0.6); },
  soul: () => { lib.choir([523, 784, 1175], 1, { v: 0.04, a: 0.3, vowel: 'u' }); T(392, 0.9, { v: 0.04, to: 588, hall: 0.6 }); lib.sparkle(3, { at: 0.2, v: 0.02 }); },
  souldeny: () => { lib.glass(0.7); T(988, 0.4, { type: 'sawtooth', v: 0.04, to: 300, hall: 0.4, lp: { f: 3000 } }); lib.downer(0.5, { f: 660, v: 0.04 }); },
  soulfade: () => { T(784, 0.9, { v: 0.04, to: 392, hall: 0.8, a: 0.05 }); N(0.8, { c: 'pink', ft: 'bandpass', f: 2000, to: 600, q: 2, v: 0.05, a: 0.2, hall: 0.5 }); },
  revive: () => { lib.riser(0.5, { f: 196, mult: 4, v: 0.05 }); lib.choir([262, 330, 392, 523], 1.3, { at: 0.4, v: 0.06 }); lib.chime([1047, 1319, 1568, 2093], { at: 0.45, v: 0.05 }); },
  hollowrise: () => { T(65, 0.7, { type: 'sawtooth', v: 0.07, to: 110, lp: { f: 300, to: 1200 }, hall: 0.4 }); N(0.6, { c: 'brown', ft: 'bandpass', f: 300, to: 900, q: 1, v: 0.25, a: 0.3, hall: 0.4 }); lib.choir([98, 104], 0.7, { v: 0.04, vowel: 'o' }); },
  waveclear: () => { chord([523, 659, 784, 1047], 0.6, { type: 'triangle', v: 0.09, roll: 0.07, hall: 0.5 }); lib.bell(1568, 0.9, { at: 0.3, v: 0.06 }); lib.sparkle(8, { at: 0.3 }); K(120, 45, 0.4, { v: 0.3, at: 0.28 }); },
  crownspawn: () => { lib.chime([784, 988, 1175, 1568], { v: 0.05, roll: 0.09, d: 1.1 }); T(98, 1.2, { type: 'sawtooth', v: 0.05, lp: { f: 600 }, hall: 0.5, a: 0.3 }); },
  chest: () => { lib.impact(0.4, { sub: 200, bright: 0.8 }); lib.coins(3); },
  'chest:open': () => { lib.impact(0.6, { sub: 160 }); lib.coins(9, { at: 0.08 }); chord([784, 988, 1175, 1568], 0.6, { type: 'triangle', v: 0.06, roll: 0.05, at: 0.12, hall: 0.4 }); },
  supply: () => { lib.whoosh(0.6, { f: 4000, to: 400, v: 0.15, peak: 0.85 }); lib.impact(0.9, { at: 0.6 }); },
  shardrain: () => { for (let i = 0; i < 6; i++) lib.bell(rr(1800, 3200), 0.4, { v: 0.03, at: i * 0.1, lo: i > 2, spread: 0.8 }); },
  bloodmoon: () => { lib.dark({ f: 49, d: 1.6 }); lib.choir([98, 117, 147], 1.6, { v: 0.05, vowel: 'o', a: 0.5 }); },
  bramble: () => { lib.stone(4); N(0.3, { c: 'pink', ft: 'bandpass', f: 1500, q: 3, v: 0.1, a: 0.1 }); },
  wind: () => N(1.4, { c: 'pink', ft: 'bandpass', f: 500, to: 1400, q: 2, v: 0.12, a: 0.6 }),
  colossus: () => { lib.whoosh(0.26, { f: 200, to: 900, v: 0.15, peak: 0.9 }); lib.impact(1.5, { at: 0.26, sub: 80, bright: 0.6 }); N(1.2, { c: 'brown', f: 500, to: 80, v: 0.6, at: 0.26, hall: 0.5 }); lib.sub(38, 1.1, { v: 0.5, at: 0.26, to: 26 }); lib.stone(6, { at: 0.35 }); duck(0.6, 1.2); },
  boss: () => S['announce:boss'](),
  // ---- 10.0 hazards / world events / siege (A9)
  'geyser:warn': () => { N(0.9, { c: 'white', ft: 'highpass', f: 3000, to: 6000, v: 0.08, a: 0.6 }); for (let i = 0; i < 5; i++) K(rr(90, 150), 50, 0.08, { v: 0.12, at: i * rr(0.1, 0.18), lo: i > 1 }); },
  'geyser:erupt': () => { K(90, 40, 0.3, { v: 0.4 }); N(1.1, { c: 'white', ft: 'bandpass', f: 800, to: 4000, q: 0.7, v: 0.4, a: 0.05, hall: 0.3 }); N(0.9, { c: 'brown', f: 500, v: 0.3, a: 0.02 }); },
  'crumble:crack': () => { for (let i = 0; i < 4; i++) lib.click({ v: rr(0.1, 0.2), f: rr(1500, 3500), at: i * rr(0.02, 0.05) }); N(0.15, { c: 'pink', f: 1200, v: 0.15 }); },
  'crumble:collapse': () => { lib.stone(8); N(0.9, { c: 'brown', f: 400, to: 80, v: 0.4, hall: 0.3 }); lib.sub(45, 0.7, { v: 0.3, to: 30 }); },
  rift: () => { FM(300, 0.6, { ratio: 1.5, idx: 5, to: 900, v: 0.06, hall: 0.5 }); T(600, 0.6, { v: 0.05, to: 300, vib: [14, 0.05], hall: 0.5 }); },
  conveyor: () => { lib.click({ v: 0.08, f: 1500 }); FM(400, 0.05, { ratio: 1.41, idx: 1.5, v: 0.03, at: 0.08 }); },
  pull: () => lib.whoosh(0.25, { f: 2000, to: 300, v: 0.12 }),
  earthquake: () => { N(2.2, { c: 'brown', f: 220, to: 120, v: 0.6, a: 0.3, hall: 0.3 }); lib.sub(36, 2, { v: 0.5, a: 0.3, to: 30 }); for (let i = 0; i < 6; i++) lib.stone(2, { at: 0.2 + i * rr(0.2, 0.35) }); duck(0.5, 2); },
  eclipse: () => { lib.dark({ f: 41, d: 2.4 }); lib.bell(1175, 1.6, { v: 0.04, ratio: 1.5, at: 0.3 }); lib.choir([82, 98, 123], 2.2, { v: 0.05, vowel: 'o', a: 0.8 }); },
  manasurge: () => { lib.riser(0.9, { f: 220, mult: 4, v: 0.05 }); lib.chime([659, 880, 1109, 1319, 1760], { at: 0.5, v: 0.05, roll: 0.06 }); lib.sparkle(8, { at: 0.6 }); },
  bounty: () => { lib.bell(523, 1.6, { v: 0.09, ratio: 2.76, idx: 2.5 }); lib.bell(523, 1.6, { v: 0.06, ratio: 2.76, idx: 2.5, at: 0.5 }); lib.sub(65, 1, { v: 0.15 }); },
  bountyclaim: () => { lib.coins(10, { gap: 0.03 }); lib.bell(1047, 0.8, { v: 0.06 }); chord([523, 659, 784, 1047], 0.5, { type: 'triangle', v: 0.07, roll: 0.05, at: 0.1, hall: 0.4 }); },
  frenzy: () => { [0, 0.25, 0.5, 0.62, 0.75].forEach((a, i) => { K(i % 2 ? 110 : 80, 45, 0.25, { v: 0.45, at: a }); N(0.12, { c: 'pink', f: 900, v: 0.2, at: a, room: 0.4 }); }); T(110, 1, { type: 'sawtooth', v: 0.05, lp: { f: 700 }, at: 0.2, hall: 0.4 }); },
  restless: () => { lib.choir([147, 156], 1.6, { v: 0.06, vowel: 'u', a: 0.6 }); T(294, 1.6, { v: 0.03, to: 196, vib: [5, 0.03], hall: 0.7 }); N(1.2, { c: 'pink', ft: 'bandpass', f: 600, to: 300, q: 4, v: 0.08, a: 0.5, hall: 0.4 }); lib.stone(4, { at: 0.8 }); },
  split: () => { K(300, 90, 0.08, { v: 0.3 }); N(0.12, { c: 'pink', f: 2000, to: 500, v: 0.3 }); for (let i = 0; i < 4; i++) T(rr(500, 900), 0.08, { type: 'triangle', v: 0.05, to: 1500, at: 0.04 + i * 0.03, spread: 0.8 }); },
  shieldbreak: () => { FM(700, 0.6, { ratio: 1.41, idx: 4, v: 0.1, room: 0.4 }); lib.glass(0.8, { at: 0.02 }); lib.impact(0.7); },
  summon: () => { lib.choir([110, 131, 165], 1.4, { v: 0.07, vowel: 'a', a: 0.4 }); lib.dark({ f: 55, d: 1.4 }); lib.stone(5, { at: 0.6 }); },
  'hill:score': () => { lib.bell(1319, 0.5, { v: 0.05 }); T(988, 0.12, { type: 'triangle', v: 0.06 }); },
  'hill:contested': () => { T(440, 0.18, { type: 'square', v: 0.035, lp: { f: 2000 } }); T(466, 0.18, { type: 'square', v: 0.035, at: 0.2, lp: { f: 2000 } }); },
  // ---- kills / chains
  multikill: (n = 2) => { const k = clamp(n, 2, 6); chord([1, 1.26, 1.5, 2].map((x) => 330 * st(k * 2) * x), 0.5, { type: 'sawtooth', v: 0.04, roll: 0.02, lp: { f: 5000, to: 900 }, hall: 0.5 }); lib.sub(55, 0.6, { v: 0.3 }); lib.sparkle(3 + k * 2); },
};
// numeric variants so callers can pass the level in the name
for (let n = 2; n <= 6; n++) S['multikill:' + n] = () => S.multikill(n);
for (let n = 1; n <= 5; n++) S['stinger:' + n] = () => sting(n);

// ---- promotion per tier (1 pawn .. 5 king / crowned)
const TIER_OF = (p) => (D.PIECES && D.PIECES[p] && D.PIECES[p].tier) || 2;
const promoteTier = (tier) => {
  const k = clamp(tier, 1, 5), root = [262, 294, 330, 349, 392][k - 1];
  lib.riser(0.3 + k * 0.08, { f: root / 2, mult: 4, v: 0.05 + k * 0.01 });
  const t1 = 0.3 + k * 0.08;
  lib.impact(0.4 + k * 0.15, { at: t1, sub: 130 });
  chord([1, 1.26, 1.5, 2, 2.52, 3].slice(0, 3 + Math.min(3, k)).map((x) => root * x), 0.6 + k * 0.15, { type: 'triangle', v: 0.08, roll: 0.05, at: t1, hall: 0.5 });
  T(root / 2, 0.8 + k * 0.2, { type: 'sawtooth', v: 0.05, at: t1, lp: { f: 900 + k * 500, to: 400 }, hall: 0.4, det: 10 });
  if (k >= 3) lib.choir([root, root * 1.26, root * 1.5], 1 + k * 0.2, { at: t1, v: 0.04 + k * 0.01, vowel: 'a' });
  if (k >= 2) lib.sparkle(3 + k * 2, { at: t1 + 0.1 });
  if (k >= 4) { lib.bell(root * 4, 1.4, { at: t1 + 0.1, v: 0.05 }); lib.sub(root / 4, 1.2, { at: t1, v: 0.3 }); duck(0.5, 1.2); }
  if (k >= 5) { lib.chime([root * 2, root * 2.52, root * 3, root * 4], { at: t1 + 0.3, v: 0.05, roll: 0.1, d: 1.2 }); voice(PHRASES.crowned, { at: t1 + 0.25, p: 98, v: 0.35 }); }
};
for (let n = 1; n <= 5; n++) S['promote:' + n] = () => promoteTier(n);
S.crown = () => promoteTier(5);

// ---- rarity-tiered reveal
const RAR = { common: 1, uncommon: 1.5, rare: 2, epic: 3, legendary: 4, season: 4, mythic: 5 };
const reveal = (r) => {
  const k = RAR[r] || 1, roots = { 1: 523, 1.5: 523, 2: 587, 3: 466, 4: 523, 5: 440 }, root = roots[k];
  CUR.bus = 'ui';
  if (k >= 3) lib.riser(0.4 + k * 0.15, { f: root / 4, mult: 8, v: 0.05 + k * 0.01, bus: 'ui' });
  const t1 = k >= 3 ? 0.4 + k * 0.15 : 0;
  lib.click({ v: 0.2, at: t1, bus: 'ui' });
  const notes = k >= 5 ? [1, 1.19, 1.5, 1.78, 2, 2.38, 3] : k >= 4 ? [1, 1.26, 1.5, 2, 2.52, 3] : k >= 3 ? [1, 1.19, 1.5, 2] : k >= 2 ? [1, 1.26, 1.5] : [1, 1.5];
  lib.chime(notes.map((x) => root * x), { at: t1, v: 0.05 + k * 0.006, roll: k >= 4 ? 0.06 : 0.05, d: 0.5 + k * 0.2, bus: 'ui' });
  if (k >= 2) lib.sparkle(2 + k * 3, { at: t1 + 0.05, bus: 'ui' });
  if (k >= 3) { lib.impact(0.3 + k * 0.15, { at: t1 }); K(110, 40, 0.5, { v: 0.25, at: t1, bus: 'ui' }); }
  if (k >= 4) { lib.choir([root / 2, root / 2 * 1.26, root / 2 * 1.5, root], 1.6, { at: t1, v: 0.06, bus: 'ui' }); lib.sub(root / 8, 1.4, { at: t1, v: 0.35, bus: 'ui' }); duck(0.55, 1.6); }
  if (k >= 5) { // mythic: dissonant swell that resolves, second hit, choir chord
    T(root / 2 * 1.06, 0.4 + k * 0.15, { type: 'sawtooth', v: 0.04, a: 0.6, lp: { f: 400, to: 3000 }, bus: 'ui', det: 20 });
    lib.impact(1.1, { at: t1 + 0.55 }); lib.chime([root * 2, root * 2.38, root * 3, root * 4], { at: t1 + 0.55, v: 0.06, roll: 0.08, d: 1.4, bus: 'ui' });
    lib.choir([root / 2 * 1.19, root * 0.75, root * 1.19], 2, { at: t1 + 0.55, v: 0.06, vowel: 'o', bus: 'ui' });
  }
};
for (const r of Object.keys(RAR)) S['reveal:' + r] = () => reveal(r);

// ---- announcer callouts: stinger + formant voice
const ANN = {
  multi: { lv: 3, p: 98 }, double: { lv: 2, p: 98 }, triple: { lv: 3, p: 104 }, quad: { lv: 4, p: 110 }, rampage: { lv: 5, p: 116 },
  final: { lv: 4, p: 87, minor: true }, shutdown: { lv: 4, p: 92, minor: true }, regicide: { lv: 5, p: 87, minor: true },
  revive: { lv: 3, p: 104 }, wave: { lv: 2, p: 87, minor: true }, waveclear: { lv: 3, p: 98 }, firstblood: { lv: 3, p: 92, minor: true },
  crowned: { lv: 5, p: 98 }, ultimate: { lv: 3, p: 98 }, streak: { lv: 3, p: 98 }, unstoppable: { lv: 5, p: 104 }, storm: { lv: 2, p: 82, minor: true },
  fight: { lv: 3, p: 98 }, ready: { lv: 1, p: 98 }, go: { lv: 3, p: 110 }, laststand: { lv: 4, p: 87, minor: true }, comeback: { lv: 4, p: 104 },
  domination: { lv: 5, p: 98 }, godlike: { lv: 5, p: 110 }, legendary: { lv: 5, p: 104 }, promoted: { lv: 3, p: 98 },
};
function announce(name) {
  const key = name.toLowerCase().replace(/[^a-z]/g, ''), a = ANN[key] || { lv: 2 + (hashStr(key) % 3), p: 92 + (hashStr(key) % 4) * 6 };
  CUR.bus = 'voice';
  sting(a.lv, { minor: a.minor });
  voice(phraseFor(key), { at: 0.12, p: a.p, v: 0.42 });
}
S['announce:boss'] = () => { CUR.bus = 'voice'; [0, 0.45, 0.9].forEach((a) => { K(60, 30, 0.6, { v: 0.5, at: a }); N(0.35, { c: 'brown', f: 400, v: 0.4, at: a, hall: 0.4 }); }); lib.dark({ f: 46, d: 2, at: 0.2 }); T(138.6, 1.6, { type: 'sawtooth', v: 0.05, at: 0.5, lp: { f: 1200, to: 300 }, hall: 0.6 }); voice(PHRASES.boss, { at: 1.1, p: 73, chord: [0, 7, 12], v: 0.45 }); duck(0.7, 2.4); };
S['announce:victory'] = () => { CUR.bus = 'voice'; [523, 659, 784, 1047, 1319, 1568].forEach((f, i) => T(f, 0.6, { type: 'triangle', v: 0.09, at: i * 0.09, hall: 0.5 })); lib.choir([262, 330, 392, 523], 1.8, { at: 0.4, v: 0.06 }); lib.sparkle(12, { at: 0.4, gap: 0.05 }); K(110, 40, 0.6, { v: 0.35, at: 0.45 }); voice(PHRASES.victory, { at: 0.5, p: 110, v: 0.42 }); };
S['announce:defeat'] = () => { CUR.bus = 'voice'; T(220, 1.6, { type: 'sawtooth', v: 0.06, to: 110, lp: { f: 1500, to: 300 }, hall: 0.6 }); T(233, 1.6, { type: 'sawtooth', v: 0.05, to: 116, lp: { f: 1200, to: 250 }, hall: 0.6 }); N(1.2, { c: 'brown', f: 300, to: 120, v: 0.4, hall: 0.5 }); lib.sub(40, 1.4, { v: 0.4, to: 28 }); voice(PHRASES.defeat, { at: 0.35, p: 73, chord: [0, 12, 15], v: 0.4, fall: -5 }); };
for (const k of Object.keys(ANN)) S['announce:' + k] = () => announce(k);
S['announce:waveclear'] = () => { S.waveclear(); announce('waveclear'); };
S['announce:wave'] = () => { CUR.bus = 'voice'; N(0.45, { c: 'brown', f: 600, to: 150, v: 0.3, hall: 0.4 }); K(80, 35, 0.5, { v: 0.4 }); T(220, 0.6, { type: 'sawtooth', v: 0.05, lp: { f: 2000, to: 500 }, hall: 0.5 }); T(330, 0.6, { type: 'sawtooth', v: 0.04, at: 0.12, lp: { f: 2000, to: 500 }, hall: 0.5 }); voice(PHRASES.wave, { at: 0.15, p: 82, v: 0.42 }); };

// ---- abilities: every id gets a signature
const AB = {
  // basic attacks
  pawnStrike: () => { lib.swish({ f: 3800, to: 1200, v: 0.16 }); K(220, 110, 0.06, { v: 0.1, at: 0.05 }); },
  tstrike: () => { lib.swish({ f: 3200, to: 800, v: 0.2, d: 0.14 }); lib.swish({ f: 4500, to: 1500, v: 0.12, at: 0.06 }); },
  ray: () => lib.beam(0.35, { f: 1175 }),
  slam: () => { lib.whoosh(0.16, { f: 300, to: 1200, v: 0.15, peak: 0.9 }); K(120, 45, 0.25, { v: 0.35, at: 0.14 }); N(0.2, { c: 'brown', f: 600, v: 0.3, at: 0.14, room: 0.3 }); },
  starburst: () => { lib.impact(0.7, { bright: 1.4 }); for (let i = 0; i < 6; i++) T(rr(1500, 3500), 0.12, { type: 'triangle', v: 0.03, at: i * 0.02, to: 600, spread: 0.8, lo: true }); },
  royalStrike: () => { lib.swish({ f: 2800, to: 700, v: 0.22, d: 0.14 }); FM(660, 0.3, { ratio: 1.41, idx: 2, v: 0.05, at: 0.08, room: 0.3 }); },
  hollowClaw: () => { lib.swish({ f: 2200, to: 600, v: 0.18 }); T(140, 0.2, { type: 'sawtooth', v: 0.05, to: 80, lp: { f: 800 } }); N(0.12, { c: 'pink', ft: 'bandpass', f: 900, q: 4, v: 0.1, at: 0.04 }); },
  // signatures
  shove: () => { N(0.12, { c: 'pink', f: 900, v: 0.25, a: 0.02 }); K(160, 60, 0.15, { v: 0.3, at: 0.03 }); lib.whoosh(0.18, { f: 800, to: 300, v: 0.1, at: 0.04 }); },
  vault: () => { lib.whoosh(0.18, { f: 700, to: 3000, v: 0.1 }); T(330, 0.18, { type: 'triangle', v: 0.06, to: 660, glide: 0.14 }); },
  transpose: () => { FM(600, 0.35, { ratio: 1.5, idx: 4, to: 1200, v: 0.05, hall: 0.5 }); FM(1200, 0.35, { ratio: 1.5, idx: 4, to: 600, v: 0.05, hall: 0.5, at: 0.05, pan: 0.4 }); N(0.3, { c: 'white', ft: 'bandpass', f: 2000, to: 6000, q: 3, v: 0.08 }); },
  charge: () => { for (let i = 0; i < 4; i++) K(110, 60, 0.07, { v: 0.2, at: i * 0.07 }); lib.whoosh(0.35, { f: 300, to: 2200, v: 0.25 }); lib.impact(0.7, { at: 0.3 }); },
  decree: () => { lib.whoosh(0.28, { f: 1000, to: 6000, v: 0.2 }); FM(880, 0.4, { ratio: 2, idx: 2, v: 0.05, hall: 0.4 }); for (let i = 0; i < 3; i++) lib.swish({ f: 5000, to: 1800, v: 0.12, at: 0.08 + i * 0.07, d: 0.06 }); },
  royalGuard: () => { FM(392, 0.8, { ratio: 1.41, idx: 2.5, v: 0.07, hall: 0.4 }); chord([392, 587], 0.6, { type: 'triangle', v: 0.05, roll: 0.06, at: 0.05, hall: 0.4 }); lib.click({ v: 0.2, f: 1800 }); },
  // ultimates
  enPassant: () => { lib.whoosh(0.3, { f: 400, to: 3000, v: 0.2 }); lib.impact(1, { at: 0.32 }); chord([392, 587, 784], 0.5, { type: 'sawtooth', v: 0.035, at: 0.32, lp: { f: 3000, to: 600 }, hall: 0.4 }); },
  fork: () => { lib.whoosh(0.3, { f: 400, to: 3000, v: 0.2 }); for (let i = 0; i < 8; i++) { lib.click({ v: 0.12, f: 2500, at: 0.32 + i * 0.03, pan: Math.sin(i) * 0.7 }); } lib.impact(0.9, { at: 0.32 }); lib.swish({ f: 6000, to: 1200, at: 0.34, v: 0.18 }); },
  excommunicate: () => { lib.choir([294, 440, 587], 0.9, { v: 0.06, a: 0.05 }); [0, 0.05, 0.1, 0.15].forEach((a, i) => lib.beam(0.6, { f: 587 * [1, 1.5, 2, 1.26][i], at: a, v: 0.03 })); lib.impact(0.8, { at: 0.1, bright: 1.4 }); },
  castling: () => { lib.whoosh(0.25, { f: 1500, to: 400, v: 0.15 }); FM(300, 0.3, { ratio: 1.5, idx: 3, v: 0.05 }); lib.impact(1.2, { at: 0.28, sub: 90, bright: 0.6 }); lib.stone(8, { at: 0.32 }); lib.sub(40, 0.8, { at: 0.28, v: 0.4 }); },
  nova: () => { lib.riser(0.35, { f: 220, mult: 6, v: 0.06 }); lib.impact(1.4, { at: 0.35, bright: 1.2 }); N(1.2, { c: 'brown', f: 1200, to: 100, v: 0.5, at: 0.35, hall: 0.5 }); lib.sub(36, 1, { at: 0.35, v: 0.5, to: 26 }); lib.sparkle(8, { at: 0.4 }); duck(0.6, 1.2); },
  divineRight: () => { lib.choir([262, 392, 523, 659], 1.2, { v: 0.07, a: 0.08 }); lib.chime([1047, 1319, 1568], { v: 0.05, at: 0.1 }); lib.impact(0.8, { at: 0.15, bright: 1.3 }); },
  // equips
  sprint: () => { for (let i = 0; i < 3; i++) N(0.04, { c: 'pink', f: 1200, v: 0.12, at: i * 0.06 }); lib.whoosh(0.16, { f: 1000, to: 4000, v: 0.08 }); },
  digin: () => { N(0.25, { c: 'brown', f: 600, v: 0.3, a: 0.04 }); lib.stone(3); K(90, 50, 0.2, { v: 0.25, at: 0.05 }); },
  pickpocket: () => { lib.swish({ f: 5000, to: 2500, v: 0.12, d: 0.07 }); lib.coins(2, { at: 0.08 }); },
  trample: () => { lib.whoosh(0.28, { f: 400, to: 2400, v: 0.18 }); lib.impact(1, { at: 0.3, sub: 110 }); for (let i = 0; i < 3; i++) K(100, 50, 0.1, { v: 0.15, at: 0.42 + i * 0.08, lo: true }); },
  stagger: () => { lib.swish({ f: 3200, to: 800, v: 0.2 }); T(500, 0.35, { type: 'triangle', v: 0.05, to: 250, vib: [10, 0.06], at: 0.08 }); },
  rally: () => { T(196, 0.5, { type: 'sawtooth', v: 0.06, lp: { f: 600, to: 2500, g: 0.2 } }); chord([392, 494, 587], 0.4, { type: 'sawtooth', v: 0.035, at: 0.15, roll: 0.05, lp: { f: 3000 }, hall: 0.4 }); lib.choir([196, 247, 294], 0.6, { v: 0.04, vowel: 'o' }); },
  sanctuary: () => { lib.choir([392, 494, 587, 784], 1.1, { v: 0.06, a: 0.2 }); lib.chime([1175, 1568, 1976], { at: 0.2, v: 0.04 }); },
  cross: () => { lib.beam(0.3, { f: 988, v: 0.04 }); lib.beam(0.3, { f: 1319, v: 0.035, at: 0.04 }); lib.click({ v: 0.2, f: 3000 }); },
  blink: () => S.blink(),
  rampart: () => S.rampart(),
  fortify: () => { FM(220, 0.6, { ratio: 1.41, idx: 3, v: 0.07, room: 0.4 }); lib.impact(0.5, { sub: 100, bright: 0.5 }); N(0.3, { c: 'brown', f: 400, v: 0.2, a: 0.05 }); },
  siege: () => { lib.impact(1, { sub: 110 }); N(0.6, { c: 'brown', f: 700, to: 140, v: 0.35, hall: 0.4 }); N(0.35, { c: 'pink', ft: 'bandpass', f: 3000, to: 600, q: 1, v: 0.15, at: 0.03 }); },
  dominion: () => { lib.dark({ f: 55, d: 0.9 }); T(440, 0.8, { type: 'sine', v: 0.04, vib: [6, 0.04], to: 330, hall: 0.6 }); lib.whoosh(0.6, { f: 2000, to: 200, v: 0.12 }); },
  execute: () => { T(3000, 0.12, { type: 'sawtooth', v: 0.03, to: 1500, hp: { f: 1000 } }); lib.swish({ f: 7000, to: 1200, v: 0.25, d: 0.1, at: 0.08 }); lib.impact(0.9, { at: 0.12 }); FM(150, 0.6, { ratio: 1.41, idx: 3, v: 0.08, at: 0.12, room: 0.4 }); },
  checkmate: () => { for (let i = 0; i < 8; i++) T(1760 * st(i), 0.15, { type: 'sawtooth', v: 0.025, at: i * 0.02, to: 400, hp: { f: 600 }, pan: Math.cos(i * 0.785) * 0.7 }); lib.zap({ f: 2000 }); lib.impact(0.7, { at: 0.1, bright: 1.3 }); },
  tripwire: () => S.trapset(),
  lance: () => { N(0.14, { c: 'white', ft: 'bandpass', f: 1500, to: 5000, q: 1.5, v: 0.3, a: 0.06 }); FM(1800, 0.2, { ratio: 1.41, idx: 2, to: 900, v: 0.04 }); lib.impact(0.55, { at: 0.08, bright: 1.2 }); },
  penance: () => { lib.chime([784, 1175, 1568], { v: 0.05, roll: 0.03 }); T(1400, 0.25, { type: 'sawtooth', v: 0.03, to: 560, at: 0.1, hp: { f: 600 } }); lib.impact(0.5, { at: 0.1 }); lib.choir([523, 659], 0.7, { at: 0.35, v: 0.04, vowel: 'u' }); },
  quake: () => { N(0.9, { c: 'brown', f: 260, to: 120, v: 0.6, hall: 0.4 }); lib.sub(45, 0.8, { v: 0.5, to: 30 }); for (let i = 0; i < 3; i++) lib.impact(0.4, { at: 0.08 + i * 0.1, sub: 100, bright: 0.5 }); lib.stone(6, { at: 0.1 }); },
  gambit: () => { K(62, 40, 0.12, { v: 0.4 }); K(58, 40, 0.12, { v: 0.3, at: 0.16 }); T(110, 0.6, { type: 'sawtooth', v: 0.06, to: 330, at: 0.1, lp: { f: 500, to: 3000 }, hall: 0.4 }); lib.coins(3, { at: 0.3 }); N(0.4, { c: 'pink', ft: 'bandpass', f: 500, to: 3000, q: 1, v: 0.12, at: 0.1, a: 0.3 }); },
  colossusSlam: () => S.colossus(),
  // 10.0 (A9)
  phalanx: () => { [0.7, -0.7, 0.35, -0.35].forEach((p, i) => lib.click({ v: 0.14, f: 2200, at: i * 0.012, pan: p })); lib.impact(0.75, { sub: 130 }); FM(520, 0.35, { ratio: 1.41, idx: 2.5, v: 0.05, room: 0.4 }); },
  outflank: () => { lib.swish({ f: 2000, to: 6000, v: 0.12, d: 0.1 }); T(600, 0.14, { type: 'triangle', v: 0.05, to: 1500, glide: 0.1 }); lib.swish({ f: 6000, to: 1200, v: 0.22, at: 0.12, d: 0.1 }); lib.impact(0.55, { at: 0.16, bright: 1.2 }); },
  consecrate: () => { T(2400, 0.25, { v: 0.04, to: 600, hall: 0.5 }); lib.choir([330, 494, 659], 1, { v: 0.06, a: 0.15, at: 0.1 }); lib.impact(0.9, { at: 0.24, bright: 1.4 }); lib.chime([1319, 1760, 2637], { at: 0.26, v: 0.04 }); },
  repel: () => { lib.impact(0.8, { sub: 120 }); N(0.5, { c: 'pink', ft: 'bandpass', f: 300, to: 3000, q: 1.2, v: 0.25, a: 0.03, room: 0.4 }); T(90, 0.4, { v: 0.25, to: 180, glide: 0.2 }); },
  bombard: () => { K(160, 60, 0.12, { v: 0.4 }); N(0.08, { c: 'pink', f: 2000, v: 0.3 }); T(1800, 0.45, { v: 0.04, to: 500, at: 0.05, lin: true }); lib.impact(1.1, { at: 0.5 }); lib.stone(4, { at: 0.55 }); N(0.5, { c: 'brown', f: 700, to: 150, v: 0.3, at: 0.5, hall: 0.3 }); },
  gravity: () => { T(60, 0.6, { type: 'sawtooth', v: 0.08, to: 30, lp: { f: 1200, to: 150 }, hall: 0.4 }); N(0.6, { c: 'pink', ft: 'bandpass', f: 3000, to: 200, q: 3, v: 0.2, a: 0.45 }); FM(220, 0.6, { ratio: 1.07, idx: 3, to: 55, v: 0.05 }); lib.impact(1.1, { at: 0.6, sub: 80, bright: 0.5 }); lib.sub(32, 0.8, { at: 0.6, v: 0.45 }); },
  hexBolt: () => { FM(330, 0.35, { ratio: 1.5, idx: 6, to: 880, v: 0.06, hall: 0.4 }); T(165, 0.35, { type: 'sawtooth', v: 0.04, lp: { f: 900, to: 2400 }, vib: [11, 0.04] }); N(0.2, { c: 'pink', ft: 'bandpass', f: 900, to: 2600, q: 4, v: 0.1 }); },
  soulLance: () => { lib.choir([220, 233], 0.5, { v: 0.04, vowel: 'u', a: 0.05 }); N(0.2, { c: 'white', ft: 'bandpass', f: 1500, to: 5000, q: 2, v: 0.25, a: 0.08 }); lib.impact(0.6, { at: 0.15 }); T(880, 0.5, { v: 0.03, to: 220, at: 0.15, hall: 0.6 }); },
  wraithStep: () => { N(0.35, { c: 'pink', ft: 'bandpass', f: 2500, to: 400, q: 3, v: 0.12, a: 0.1, hall: 0.5 }); T(1100, 0.35, { v: 0.03, to: 550, vib: [7, 0.03], hall: 0.6 }); },
};
// Unknown / new abilities: pick an archetype from the description, then voice it with a pitch from the id hash.
function archetype(id) {
  const a = (D.ABILITIES && D.ABILITIES[id]) || {}, d = ((a.desc || '') + ' ' + (a.name || '')).toLowerCase(), h = hashStr(id);
  const pm = st((h % 9) - 4); CUR.pm *= pm;
  if (/heal|restore|regen|bless/.test(d)) return AB.sanctuary();
  if (/trap|mine|snare/.test(d)) return S.trapset();
  if (/teleport|swap|warp|blink/.test(d)) return AB.transpose();
  if (/beam|ray|diagonal|bolt|laser|line/.test(d)) return lib.beam(0.4, { f: 600 + (h % 800) });
  if (/explo|blast|detonat|nova|burst|shockwave|quake/.test(d)) return AB.nova();
  if (/leap|jump|vault|dash|charge|ram/.test(d)) return AB.trample();
  if (/def|shield|guard|armor|armour|fortif/.test(d)) return AB.fortify();
  if (/slow|curse|dark|void|shadow|drain/.test(d)) return AB.dominion();
  if (/free action|atk|spd|initiative|rally/.test(d)) return AB.rally();
  if (/fire|burn|flame|lava/.test(d)) return lib.fire(0.6);
  if (/ice|frost|freeze/.test(d)) return lib.frost();
  if (a.ult) return AB.enPassant();
  return [AB.tstrike, AB.royalStrike, AB.lance, AB.execute][h % 4]();
}

// ---- finishers: every id unique; unknown ones get a description-driven design
const KILL = {
  shatter: () => { lib.glass(1.3); lib.impact(0.6); },
  inferno: () => { lib.whoosh(0.3, { f: 200, to: 1500, v: 0.2 }); lib.fire(1, { v: 0.4, crackle: 10, at: 0.05 }); lib.sub(60, 0.7, { v: 0.35, to: 40 }); N(0.6, { c: 'pink', f: 600, to: 200, v: 0.2, at: 0.7, hall: 0.4 }); },
  lightning: () => { N(0.06, { c: 'white', ft: 'highpass', f: 6000, v: 0.6 }); lib.elec(0.3); lib.impact(1.1, { at: 0.02, bright: 1.5 }); N(1.4, { c: 'brown', f: 400, to: 80, v: 0.5, at: 0.08, hall: 0.6 }); for (let i = 0; i < 4; i++) K(rr(60, 90), 35, 0.3, { v: 0.15, at: 0.3 + i * rr(0.12, 0.2), lo: true }); },
  voidrift: () => { T(200, 0.55, { type: 'sawtooth', v: 0.07, to: 50, lp: { f: 3000, to: 200 }, hall: 0.4 }); N(0.55, { c: 'pink', ft: 'bandpass', f: 3000, to: 200, q: 3, v: 0.2, a: 0.4 }); lib.impact(1, { at: 0.55, sub: 90, bright: 0.5 }); lib.sub(32, 0.9, { at: 0.55, v: 0.45 }); lib.bell(220, 1.2, { at: 0.6, ratio: 1.07, v: 0.05 }); },
  confetti: () => { lib.click({ v: 0.5, f: 1500 }); K(240, 80, 0.12, { v: 0.3 }); N(0.4, { c: 'white', ft: 'highpass', f: 5000, v: 0.12, a: 0.01, hall: 0.3 }); for (let i = 0; i < 10; i++) T(rr(800, 2400), 0.08, { type: 'triangle', v: 0.04, at: 0.05 + i * 0.03, spread: 0.9, lo: i > 4 }); T(523, 0.2, { type: 'square', v: 0.04, to: 1047, glide: 0.1, at: 0.05, lp: { f: 3000 } }); },
  frozen: () => { lib.frost(); T(2400, 0.4, { v: 0.05, to: 1200, hall: 0.6 }); lib.glass(1, { at: 0.45 }); K(120, 45, 0.25, { v: 0.3, at: 0.45 }); },
  ascend: () => { lib.riser(0.6, { f: 262, mult: 4, v: 0.05 }); lib.choir([523, 659, 784, 1047], 1.6, { v: 0.07, a: 0.4 }); lib.chime([1047, 1319, 1568, 2093, 2637], { at: 0.4, v: 0.04, roll: 0.1 }); },
  coronation: () => { lib.whoosh(0.4, { f: 3000, to: 400, v: 0.15 }); FM(800, 0.6, { ratio: 1.41, idx: 3, v: 0.08, at: 0.42, hall: 0.4 }); lib.impact(1, { at: 0.42 }); chord([523, 659, 784, 1047, 1319], 0.9, { type: 'triangle', v: 0.07, roll: 0.05, at: 0.5, hall: 0.6 }); lib.sparkle(10, { at: 0.55 }); },
  starfall: () => { N(0.5, { c: 'pink', ft: 'bandpass', f: 5000, to: 400, q: 1, v: 0.25, a: 0.4 }); T(2000, 0.5, { v: 0.04, to: 300 }); lib.impact(1.2, { at: 0.5 }); lib.sparkle(10, { at: 0.55 }); lib.sub(40, 0.8, { at: 0.5, v: 0.4 }); },
  soulfire: () => { lib.fire(0.6, { v: 0.2 }); T(147, 1.2, { type: 'sawtooth', v: 0.06, to: 588, at: 0.3, lp: { f: 600, to: 3000 }, hall: 0.6 }); lib.choir([587, 740, 880, 1175], 1.2, { at: 0.35, v: 0.05, vowel: 'u', roll: 0.08 }); },
  checkmate: () => { lib.whoosh(0.45, { f: 200, to: 900, v: 0.15, peak: 0.95 }); FM(98, 0.5, { ratio: 1.41, idx: 2, v: 0.06, at: 0.2 }); lib.impact(1.5, { at: 0.45, sub: 70, bright: 0.6 }); N(0.3, { c: 'white', ft: 'highpass', f: 2500, v: 0.3, at: 0.47, room: 0.4 }); lib.stone(8, { at: 0.5 }); lib.sub(30, 1.4, { at: 0.45, v: 0.5 }); chord([392, 466, 587, 784], 1.2, { type: 'sawtooth', v: 0.04, roll: 0.03, at: 0.5, lp: { f: 3500, to: 500 }, hall: 0.6, det: 10 }); lib.bell(1568, 1.4, { at: 0.55, v: 0.05 }); duck(0.7, 1.4); },
  midas: () => { FM(1047, 0.6, { ratio: 1.41, idx: 2, v: 0.08, hall: 0.4 }); chord([1047, 1319, 1568], 0.4, { type: 'triangle', v: 0.06, roll: 0.04, hall: 0.3 }); lib.coins(14, { at: 0.4, gap: 0.035 }); },
};
const KILL_TAGS = [
  [/glass|shatter|crystal/, () => KILL.shatter()], [/fire|flame|ash|burn|ember|inferno|magma/, () => KILL.inferno()], [/bolt|lightning|thunder|storm|spark/, () => KILL.lightning()],
  [/void|singular|black|abyss|shadow|rift/, () => KILL.voidrift()], [/ice|frost|freez|snow/, () => KILL.frozen()], [/gold|coin|treasure|midas/, () => KILL.midas()],
  [/star|comet|meteor|cosmic/, () => KILL.starfall()], [/light|beam|ascen|heaven|holy|angel/, () => KILL.ascend()], [/crown|royal|king/, () => KILL.coronation()],
  [/confetti|party|pop|balloon/, () => KILL.confetti()], [/soul|spirit|ghost/, () => KILL.soulfire()],
  [/petal|flower|bloom|leaf|vine/, () => { lib.whoosh(0.8, { f: 800, to: 3000, v: 0.12 }); lib.chime([784, 988, 1175, 1568], { v: 0.04, roll: 0.09 }); N(0.8, { c: 'pink', ft: 'bandpass', f: 2500, q: 2, v: 0.06, a: 0.3 }); }],
  [/stone|rock|crumbl|dust|sand/, () => { lib.impact(0.9, { bright: 0.6 }); lib.stone(10); N(0.8, { c: 'brown', f: 900, to: 200, v: 0.3, hall: 0.3 }); }],
  [/pixel|glitch|digital|neon|circuit/, () => { for (let i = 0; i < 8; i++) T(rr(200, 2000), 0.05, { type: 'square', v: 0.04, at: i * 0.04, lp: { f: 4000 } }); lib.zap({ f: 3000 }); }],
  [/ink|paint|splat|slime/, () => { N(0.3, { c: 'pink', f: 1200, to: 300, v: 0.35 }); K(200, 60, 0.15, { v: 0.3 }); for (let i = 0; i < 5; i++) N(0.04, { c: 'pink', f: rr(600, 1500), v: 0.1, at: 0.1 + i * 0.05, lo: true }); }],
  [/blade|sword|slash|cut|guillotine/, () => { lib.swish({ f: 8000, to: 1500, v: 0.3, d: 0.12 }); FM(1800, 0.6, { ratio: 1.41, idx: 2, v: 0.06, room: 0.4 }); lib.impact(0.8, { at: 0.1 }); }],
  [/wind|tornado|gust|vortex/, () => { N(1, { c: 'pink', ft: 'bandpass', f: 400, to: 2500, q: 3, v: 0.2, a: 0.5 }); lib.impact(0.6, { at: 0.8 }); }],
];
function finisher(id) {
  if (KILL[id]) return KILL[id]();
  const f = (D.FINISHERS && D.FINISHERS[id]) || {}, d = (id + ' ' + (f.name || '') + ' ' + (f.desc || '')).toLowerCase();
  CUR.pm *= st((hashStr(id) % 7) - 3);
  for (const [re, fn] of KILL_TAGS) if (re.test(d)) return fn();
  return KILL.shatter();
}
function killSound(id) {
  const n = bump('kill', 4);
  finisher(id);
  // shared punch + escalating sweetener so kill streaks climb
  K(90, 34, 0.5, { v: 0.4 }); duck(0.35 + Math.min(0.3, n * 0.08), 0.7);
  if (n >= 2) { const r = 220 * st((n - 2) * 2); chord([r, r * 1.5, r * 2], 0.5 + n * 0.1, { type: 'sawtooth', v: 0.025 + n * 0.006, roll: 0.02, at: 0.12, lp: { f: 1500 + n * 800, to: 500 }, hall: 0.5, det: 12 }); }
  if (n >= 3) lib.sparkle(2 + n * 2, { at: 0.2 });
  if (n >= 4) lib.sub(41, 1, { at: 0.12, v: 0.3 });
}

// ---------------------------------------------------------------- router
const gateT = new Map(), burst = new Map();
const MIN_GAP = { tick: 0.02, hover: 0.04, coin: 0.025, firework: 0.06, xp: 0.02, heartbeat: 0.5, kill: 0, hit: 0.02 };
function play(name, fn) {
  if (settings.sfx === 0) return;
  const a = getCtx(); if (!a || !NB.white) return;
  const cat = catOf(name), cv = settings[{ ui: 'sfxUi', combat: 'sfxCombat', world: 'sfxWorld', voice: 'sfxVoice' }[cat]];
  if (cv === 0) return;
  const t = a.currentTime, base = name;
  const last = gateT.get(base) ?? -9;
  if (t - last < (MIN_GAP[base] ?? 0.03)) return;
  gateT.set(base, t);
  // repeated plays in a short window get quieter so bursts never clip or smear
  const b = burst.get(base); const cnt = b && t - b.t < 0.3 ? b.n + 1 : 1; burst.set(base, { t, n: cnt });
  if (live > maxVoices() * 1.6) return;
  const v = VARI[cat];
  CUR = { t0: t + 0.006, pm: v ? st(rr(-v, v)) : 1, vm: Math.max(0.4, 1 / (1 + 0.3 * (cnt - 1))) * rr(0.9, 1), bus: cat };
  try { fn(); } catch (e) { if (window.__ccAudioDebug) console.warn('sfx', name, e); }
}
export const sfx = {};
for (const k of Object.keys(S)) sfx[k] = (...args) => play(k, () => S[k](...args));
sfx.ab = (id) => playNamed('ab:' + id);
sfx.kill = (id) => playNamed('kill:' + id);
sfx.reveal = (rarity = 'common') => playNamed('reveal:' + rarity);   // store / Crown Path reveal, common..mythic
sfx.promoteTo = (piece) => playNamed('promote:' + piece);             // per-tier promotion (pawn..king or 1..5)
sfx.announce = (name) => playNamed('announce:' + name);
sfx.finisherPreview = (id) => playNamed('fin:' + id);
export function playNamed(n) {
  if (typeof n !== 'string' || !n) return;
  if (n.startsWith('ab:')) { const id = n.slice(3); return play(n, () => (AB[id] ? AB[id]() : archetype(id))); }
  if (n.startsWith('kill:')) { const id = n.slice(5); return play('kill', () => killSound(id)); }
  if (n.startsWith('fin:')) { const id = n.slice(4); return play('fin', () => finisher(id)); } // finisher alone (store previews)
  if (n.startsWith('promote:')) { const k = n.slice(8); if (S[n]) return sfx[n](); return play(n, () => promoteTier(TIER_OF(k))); }
  if (n.startsWith('reveal:')) { if (S[n]) return sfx[n](); return play(n, () => reveal('common')); }
  if (n.startsWith('announce:')) { if (S[n]) return sfx[n](); return play(n, () => announce(n.slice(9))); }
  if (n.startsWith('world:') || n.startsWith('hazard:')) { // world:<kind> / hazard:<kind>:<phase>, e.g. straight from engine events
    const k = n.slice(n.indexOf(':') + 1), lk = k.toLowerCase(), alias = { shardrain: 'shardrain', bloodmoon: 'bloodmoon', meteor: 'meteorfall', lava: 'sizzle', ice: 'ice:skid', portals: 'portal', portal: 'portal' }[lk];
    const hit = S[k] ? k : S[lk] ? lk : alias || (S[lk.split(':')[0]] ? lk.split(':')[0] : null);
    return hit ? sfx[hit]() : play(n, () => S.wind());
  }
  if (n.startsWith('multikill:')) return play(n, () => S.multikill(parseInt(n.slice(10), 10) || 2));
  if (n.startsWith('stinger:')) return play(n, () => sting(parseInt(n.slice(8), 10) || 1));
  if (S[n]) return sfx[n]();
}
// For the test page / codex: every concrete name this module answers to.
export function soundNames() {
  const out = Object.keys(S);
  for (const id of Object.keys(D.ABILITIES || {})) out.push('ab:' + id);
  for (const id of Object.keys(D.FINISHERS || {})) out.push('kill:' + id);
  for (const p of Object.keys(D.PIECES || {})) out.push('promote:' + p);
  return out;
}

document.addEventListener('visibilitychange', () => { if (!ac) return; if (document.hidden) ac.suspend().catch(() => {}); else ac.resume().catch(() => {}); });
