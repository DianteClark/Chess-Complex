// Synthesised sound effects, settings, haptics. No audio files needed.
let ac = null, master = null, sfxBus = null, musicBus = null, verb = null;
const SKEY = 'cc_settings_v1';
export const settings = { sfx: 0.8, music: 0.55, haptics: true, shake: true };
try { Object.assign(settings, JSON.parse(localStorage.getItem(SKEY) || '{}')); if (localStorage.getItem('cc_muted') === '1') { settings.sfx = 0; settings.music = 0; localStorage.removeItem('cc_muted'); } } catch {}
export function saveSettings() { try { localStorage.setItem(SKEY, JSON.stringify(settings)); } catch {} applyVolumes(); }

export function getCtx() {
  if (!ac) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch {}
    ac = new AC();
    master = ac.createDynamicsCompressor(); master.threshold.value = -12; master.ratio.value = 4; master.connect(ac.destination);
    sfxBus = ac.createGain(); sfxBus.connect(master);
    musicBus = ac.createGain(); musicBus.connect(master);
    // cheap reverb send
    verb = ac.createConvolver();
    const len = ac.sampleRate * 1.6, buf = ac.createBuffer(2, len, ac.sampleRate);
    for (let c = 0; c < 2; c++) { const d = buf.getChannelData(c); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3); }
    verb.buffer = buf; const vg = ac.createGain(); vg.gain.value = 0.22; verb.connect(vg); vg.connect(master);
    applyVolumes();
  }
  if (ac.state !== 'running') ac.resume().catch(() => {});
  return ac;
}
export const buses = () => ({ ac, sfxBus, musicBus, verb });
function applyVolumes() { if (!ac) return; sfxBus.gain.value = settings.sfx * 0.6; musicBus.gain.value = settings.music * 0.35; }
export function unlockAudio() { getCtx(); }
export const isMuted = () => settings.sfx === 0 && settings.music === 0;
export function setMuted(m) { if (m) { settings._s = settings.sfx || 0.8; settings._m = settings.music || 0.55; settings.sfx = 0; settings.music = 0; } else { settings.sfx = settings._s || 0.8; settings.music = settings._m || 0.55; } saveSettings(); }
export function haptic(p) { if (settings.haptics && navigator.vibrate) try { navigator.vibrate(p); } catch {} }

function tone(f, d, { type = 'sine', v = 0.3, slide = 0, at = 0, attack = 0.005, rev = 0, pan = 0 } = {}) {
  const a = getCtx(); if (!a || settings.sfx === 0) return;
  const t = a.currentTime + at;
  const o = a.createOscillator(), g = a.createGain();
  o.type = type; o.frequency.setValueAtTime(f, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, f * slide), t + d);
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(v, t + attack); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
  let out = g;
  if (pan && a.createStereoPanner) { const p = a.createStereoPanner(); p.pan.value = pan; g.connect(p); out = p; }
  o.connect(g); out.connect(sfxBus); if (rev) { const r = a.createGain(); r.gain.value = rev; out.connect(r); r.connect(verb); }
  o.start(t); o.stop(t + d + 0.02);
}
const NOISE = new Map();
function noise(d, { v = 0.3, f = 1200, q = 1, at = 0, type = 'lowpass', sweep = 0, rev = 0 } = {}) {
  const a = getCtx(); if (!a || settings.sfx === 0) return;
  const t = a.currentTime + at;
  const key = Math.round(d * 20);
  let buf = NOISE.get(key);
  if (!buf) { const len = Math.max(1, Math.floor(a.sampleRate * key / 20)); buf = a.createBuffer(1, len, a.sampleRate); const data = buf.getChannelData(0); for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 1.5); NOISE.set(key, buf); }
  const src = a.createBufferSource(); src.buffer = buf;
  const fl = a.createBiquadFilter(); fl.type = type; fl.frequency.setValueAtTime(f, t); fl.Q.value = q;
  if (sweep) fl.frequency.exponentialRampToValueAtTime(Math.max(40, f * sweep), t + d);
  const g = a.createGain(); g.gain.value = v;
  src.connect(fl); fl.connect(g); g.connect(sfxBus);
  if (rev) { const r = a.createGain(); r.gain.value = rev; g.connect(r); r.connect(verb); }
  src.start(t);
}
const chord = (fs, d, o = {}) => fs.forEach((f, i) => tone(f, d, { ...o, at: (o.at || 0) + i * (o.roll || 0) }));

export const sfx = {
  tap: () => tone(660, 0.05, { type: 'triangle', v: 0.1 }),
  hover: () => tone(1200, 0.03, { type: 'sine', v: 0.04 }),
  select: () => { tone(520, 0.06, { type: 'triangle', v: 0.12 }); tone(780, 0.08, { type: 'triangle', v: 0.1, at: 0.04 }); },
  back: () => { tone(500, 0.06, { type: 'triangle', v: 0.1 }); tone(340, 0.08, { type: 'triangle', v: 0.08, at: 0.04 }); },
  step: () => { noise(0.05, { v: 0.22, f: 900 }); tone(170, 0.06, { v: 0.14, slide: 0.6 }); },
  slide: () => noise(0.2, { v: 0.16, f: 2600, type: 'bandpass', q: 0.8, sweep: 0.4 }),
  jump: () => tone(260, 0.22, { type: 'triangle', v: 0.14, slide: 2.2 }),
  land: () => { noise(0.12, { v: 0.35, f: 500 }); tone(80, 0.18, { v: 0.4, slide: 0.5 }); },
  whoosh: () => noise(0.3, { v: 0.3, f: 600, type: 'bandpass', q: 0.6, sweep: 6 }),
  blink: () => { tone(1400, 0.15, { type: 'sine', v: 0.1, slide: 0.3, rev: 0.4 }); tone(700, 0.2, { type: 'sine', v: 0.08, slide: 2, at: 0.05, rev: 0.4 }); },
  swing: () => noise(0.12, { v: 0.25, f: 3000, type: 'bandpass', q: 1.2, sweep: 0.3 }),
  zap: () => { tone(1800, 0.25, { type: 'sawtooth', v: 0.06, slide: 0.2 }); noise(0.2, { v: 0.15, f: 5000, type: 'highpass' }); },
  cannon: () => { noise(0.3, { v: 0.5, f: 400 }); tone(70, 0.3, { v: 0.4, slide: 0.4 }); },
  boom: () => { noise(0.5, { v: 0.5, f: 700, sweep: 0.2, rev: 0.3 }); tone(60, 0.4, { v: 0.45, slide: 0.5 }); },
  dark: () => { tone(110, 0.6, { type: 'sawtooth', v: 0.1, slide: 0.5, rev: 0.5 }); tone(165, 0.6, { type: 'sawtooth', v: 0.06, slide: 0.5, rev: 0.5 }); },
  hit: () => { noise(0.1, { v: 0.45, f: 1800 }); tone(150, 0.12, { type: 'square', v: 0.1, slide: 0.4 }); },
  crit: () => { noise(0.2, { v: 0.55, f: 3200 }); tone(900, 0.2, { type: 'sawtooth', v: 0.1, slide: 0.25 }); tone(100, 0.3, { v: 0.45, slide: 0.4 }); },
  burn: () => noise(0.25, { v: 0.3, f: 900, type: 'bandpass', sweep: 0.5 }),
  impact: () => { noise(0.18, { v: 0.5, f: 700 }); tone(90, 0.2, { v: 0.4, slide: 0.5 }); },
  shatter: () => { noise(0.35, { v: 0.4, f: 4000, type: 'highpass', rev: 0.3 }); for (let i = 0; i < 5; i++) tone(2000 + Math.random() * 3000, 0.08, { type: 'triangle', v: 0.05, at: i * 0.03 }); },
  crate: () => { noise(0.14, { v: 0.4, f: 700 }); tone(260, 0.08, { type: 'square', v: 0.06, slide: 0.5 }); },
  rubble: () => noise(0.18, { v: 0.35, f: 500 }),
  pickup: () => { tone(988, 0.08, { type: 'triangle', v: 0.13 }); tone(1319, 0.14, { type: 'triangle', v: 0.11, at: 0.06, rev: 0.3 }); },
  coin: () => tone(1500 + Math.random() * 300, 0.06, { type: 'triangle', v: 0.06 }),
  heal: () => chord([523, 659, 784], 0.4, { v: 0.08, roll: 0.06, rev: 0.4 }),
  buff: () => chord([440, 660], 0.25, { type: 'triangle', v: 0.08, roll: 0.05, rev: 0.3 }),
  shrine: () => chord([392, 587, 784, 1175], 0.8, { v: 0.07, roll: 0.07, rev: 0.6 }),
  rampart: () => { noise(0.25, { v: 0.4, f: 400 }); tone(110, 0.2, { v: 0.3, slide: 0.6 }); },
  promote: () => { chord([523, 659, 784, 1047], 0.45, { type: 'triangle', v: 0.13, roll: 0.07, rev: 0.5 }); noise(0.6, { v: 0.12, f: 6000, type: 'highpass', at: 0.2, rev: 0.4 }); },
  crown: () => { chord([392, 523, 659, 784, 1047, 1319], 0.7, { type: 'triangle', v: 0.12, roll: 0.07, rev: 0.6 }); tone(98, 1.2, { type: 'sawtooth', v: 0.08, rev: 0.4 }); },
  turn: () => { tone(740, 0.1, { type: 'triangle', v: 0.13 }); tone(1110, 0.2, { type: 'triangle', v: 0.11, at: 0.08, rev: 0.4 }); },
  storm: () => { noise(1.4, { v: 0.6, f: 240, rev: 0.4 }); tone(55, 1.4, { type: 'sawtooth', v: 0.12, slide: 0.6 }); },
  warn: () => { tone(330, 0.15, { type: 'square', v: 0.07 }); tone(330, 0.15, { type: 'square', v: 0.07, at: 0.22 }); },
  error: () => tone(160, 0.12, { type: 'square', v: 0.07 }),
  buy: () => { chord([659, 880, 1175, 1568], 0.3, { type: 'triangle', v: 0.12, roll: 0.06, rev: 0.4 }); noise(0.4, { v: 0.1, f: 6000, type: 'highpass', at: 0.2 }); },
  win: () => { [523, 659, 784, 1047, 784, 1047, 1319].forEach((f, i) => tone(f, 0.45, { type: 'triangle', v: 0.13, at: i * 0.12, rev: 0.5 })); },
  lose: () => [392, 330, 262, 196].forEach((f, i) => tone(f, 0.5, { type: 'triangle', v: 0.12, at: i * 0.17, rev: 0.5 })),
  levelup: () => { chord([523, 784, 1047, 1568], 0.6, { type: 'triangle', v: 0.12, roll: 0.05, rev: 0.6 }); noise(0.8, { v: 0.1, f: 7000, type: 'highpass', at: 0.15, rev: 0.5 }); },
  stinger: (n = 1) => { const base = [440, 494, 523, 587, 659][Math.min(4, n - 1)]; chord([base, base * 1.25, base * 1.5, base * 2], 0.5, { type: 'sawtooth', v: 0.06, roll: 0.03, rev: 0.5 }); noise(0.3, { v: 0.25, f: 2000, sweep: 0.2 }); },
  tick: () => tone(1800, 0.02, { type: 'square', v: 0.03 }),
  heartbeat: () => { tone(60, 0.12, { v: 0.35, slide: 0.7 }); tone(55, 0.12, { v: 0.25, slide: 0.7, at: 0.18 }); },
  attune: () => { chord([784, 988, 1319, 1568], 0.5, { type: 'triangle', v: 0.09, roll: 0.04, rev: 0.6 }); },
  ultcharge: () => { tone(110, 0.8, { type: 'sawtooth', v: 0.12, slide: 4, rev: 0.4 }); noise(0.8, { v: 0.25, f: 400, type: 'bandpass', sweep: 8, rev: 0.4 }); tone(55, 0.9, { v: 0.3, rev: 0.3 }); },
  ultready: () => { chord([523, 784, 1047], 0.5, { type: 'sawtooth', v: 0.05, roll: 0.05, rev: 0.6 }); tone(1568, 0.6, { type: 'sine', v: 0.06, at: 0.15, rev: 0.6 }); },
  meteorfall: () => noise(0.7, { v: 0.35, f: 3000, type: 'bandpass', sweep: 0.1, rev: 0.4 }),
  firework: () => { noise(0.08, { v: 0.4, f: 3000 }); noise(0.9, { v: 0.2, f: 6000, type: 'highpass', at: 0.05, rev: 0.6 }); },
  quest: () => chord([659, 988, 1319], 0.4, { type: 'triangle', v: 0.1, roll: 0.06, rev: 0.5 }),
  emote: () => { tone(880, 0.06, { type: 'sine', v: 0.08 }); tone(1320, 0.08, { type: 'sine', v: 0.06, at: 0.05 }); },
};
const AB_SFX = { excommunicate: 'zap', nova: 'boom', fork: 'boom', enPassant: 'boom', castling: 'rampart', divineRight: 'shrine', ray: 'zap', cross: 'zap', checkmate: 'zap', siege: 'cannon', starburst: 'boom', dominion: 'dark', trample: 'jump', transpose: 'blink', blink: 'blink', charge: 'whoosh', decree: 'whoosh', rampart: 'rampart', sanctuary: 'heal' };
const KILL_SFX = {
  shatter: () => sfx.shatter(),
  inferno: () => { noise(0.9, { v: 0.5, f: 1200, type: 'bandpass', sweep: 0.3, rev: 0.4 }); tone(80, 0.6, { v: 0.4, slide: 0.5 }); },
  lightning: () => { noise(0.08, { v: 0.8, f: 8000, type: 'highpass' }); noise(1.2, { v: 0.6, f: 300, at: 0.05, rev: 0.5 }); },
  voidrift: () => { tone(200, 0.55, { type: 'sawtooth', v: 0.1, slide: 4, rev: 0.4 }); noise(0.4, { v: 0.5, f: 600, at: 0.55, rev: 0.5 }); tone(50, 0.5, { v: 0.4, at: 0.55, slide: 0.5 }); },
  coronation: () => { tone(1200, 0.45, { type: 'sine', v: 0.06, slide: 0.4, rev: 0.4 }); chord([523, 659, 784, 1047, 1319], 0.8, { type: 'triangle', v: 0.1, roll: 0.05, at: 0.45, rev: 0.7 }); noise(0.5, { v: 0.4, f: 900, at: 0.45, rev: 0.4 }); },
  starfall: () => { noise(0.5, { v: 0.3, f: 3000, type: 'bandpass', sweep: 0.15, rev: 0.4 }); noise(0.6, { v: 0.5, f: 500, at: 0.5, rev: 0.5 }); },
  midas: () => { chord([1047, 1319, 1568], 0.4, { type: 'triangle', v: 0.08, roll: 0.04, rev: 0.4 }); for (let i = 0; i < 10; i++) tone(1600 + Math.random() * 800, 0.06, { type: 'triangle', v: 0.05, at: 0.4 + i * 0.04 }); },
};
export function playNamed(n) {
  if (n.startsWith('ab:')) { const id = n.slice(3); const k = AB_SFX[id]; if (k) sfx[k](); else if (!['vault', 'sprint', 'digin', 'fortify', 'royalGuard', 'rally'].includes(id)) sfx.swing(); return; }
  if (n.startsWith('kill:')) { (KILL_SFX[n.slice(5)] || KILL_SFX.shatter)(); tone(70, 0.5, { v: 0.4, slide: 0.4 }); return; }
  if (sfx[n]) sfx[n]();
}

document.addEventListener('visibilitychange', () => { if (!ac) return; if (document.hidden) ac.suspend().catch(() => {}); else ac.resume().catch(() => {}); });
