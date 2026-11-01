// Chess Complex 10.0 front end (A8): cinematic menu scene, sequel reveal, loadout showroom, mode art.
import { drawPiece } from './pieces.js';
import { SKINS, TRAILS, DEFAULT_SKINS } from './data.js';

const PCS = ['pawn', 'knight', 'bishop', 'rook', 'queen', 'king'];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const skinOf = (k) => SKINS[k] || SKINS.ivory;
const reducedNow = (settings) => !!(settings && settings.motion) || document.body.classList.contains('reduced');

// ---------- mode art (play screen cards) ----------
// Each mode gets an illustrated card: theme colours, a hero piece, a glyph and a short tagline.
export const MODE_ART = {
  royale: { piece: 'king', skin: 'gilded', icon: 'm-crown', c1: '#f0c25e', c2: '#5a3a0c', tag: 'Last piece standing', who: '2-8 players' },
  blitz: { piece: 'knight', skin: 'ember', icon: 'm-bolt', c1: '#ff7a3d', c2: '#5a1606', tag: 'Fast storm, 15s turns', who: '2-8 players' },
  duel: { piece: 'rook', skin: 'glacier', icon: 'm-swords', c1: '#7fd8ff', c2: '#0d3550', tag: 'One on one', who: '1v1' },
  squads: { piece: 'bishop', skin: 'jade', icon: 'm-users', c1: '#5cffb0', c2: '#0b4a32', tag: 'Teams of two', who: '4-8 players' },
  siege: { piece: 'rook', skin: 'obsidian', icon: 'm-castle', c1: '#b18cff', c2: '#2a1758', tag: 'Co-op wave defence', who: 'Co-op 1-4' },
  daily: { piece: 'queen', skin: 'celestial', icon: 'm-sun', c1: '#ffd76a', c2: '#3b2d6b', tag: 'New challenge every day', who: 'Solo' },
  hill: { piece: 'king', skin: 'crimson', icon: 'm-flag', c1: '#ff5a6e', c2: '#4a0c18', tag: 'Hold the Throne' },
  chaos: { piece: 'queen', skin: 'neon', icon: 'm-spark', c1: '#ff4dd2', c2: '#2a0b4a', tag: 'Every round, an event' },
  gauntlet: { piece: 'rook', skin: 'voidborn', icon: 'm-skull', c1: '#9d7bff', c2: '#170c33', tag: 'Co-op boss rush' },
  mirror: { piece: 'bishop', skin: 'glacier', icon: 'm-target', c1: '#9fe8ff', c2: '#123a4e', tag: 'Same build for all' },
};
const FALLBACK_ART = [
  { piece: 'queen', skin: 'amethyst', icon: 'm-spark', c1: '#ff7ad9', c2: '#4a0f3e' },
  { piece: 'knight', skin: 'onyx', icon: 'm-target', c1: '#ffb35c', c2: '#4a2a08' },
  { piece: 'bishop', skin: 'frostfire', icon: 'm-flag', c1: '#7fffe0', c2: '#0b4a44' },
];
export function modeArt(id, m, i = 0) {
  let a = MODE_ART[id] || FALLBACK_ART[i % FALLBACK_ART.length];
  if (m && Array.isArray(m.icon) && m.icon.length === 2) a = { ...a, piece: m.icon[0], skin: m.icon[1] };
  const P = (m && m.players) || [2, 8];
  const who = a.who || (m && m.siege ? `Co-op ${P[0]}-${P[1]}` : P[0] === P[1] ? (P[0] === 2 ? '1v1' : `${P[0]} players`) : `${P[0]}-${P[1]} players`);
  const tag = a.tag || ((m && m.desc) || '').split(/[.!]/)[0];
  return { ...a, skin: SKINS[a.skin] ? a.skin : 'ivory', who, tag };
}

// ---------- What's New headline for the title news card ----------
export function newsFrom(html) {
  try {
    const d = document.createElement('div'); d.innerHTML = html;
    const h = d.querySelector('h4'); const ul = h && h.nextElementSibling;
    const items = ul ? [...ul.querySelectorAll('li > b')].map((b) => b.textContent.trim()).filter(Boolean) : [];
    return { ver: h ? h.textContent.trim() : '', items };
  } catch { return { ver: '', items: [] }; }
}

// ---------- cinematic title / menu background ----------
// Layers (back to front): sky gradient (cached), light shafts, perspective board floor with fog,
// drifting pieces with depth parallax, dust motes, and the hero piece on its pedestal (title only).
// B3 10.1 perf: everything here is soft (gradients, fog, faint drifting pieces), so the scene renders at 1x and the
// browser scales it up (about 4x fewer pixels per frame on a phone). Static layers (sky, horizon fog, vignette) are
// prerendered; light shafts (including the title's former CSS shafts, which cost a masked full-screen layer each)
// go to a 1/3-resolution layer. The crisp hero piece and pedestal get their own small full-DPR canvas (#bg-hero).
const mkC = (w, h) => { const k = document.createElement('canvas'); k.width = Math.max(1, Math.ceil(w)); k.height = Math.max(1, Math.ceil(h)); return k; };
const smooth = (t) => t * t * (3 - 2 * t);
export function initScene({ canvas, bg, getProfile, getScreen, settings }) {
  const c = canvas, x = c.getContext('2d');
  let W = 0, H = 0, d = 1, sky = null, vig = null, fogL = null, shL = null, shX = null, shSpr = null, hd = 1, hzY = 0;
  const SH = 3; // shaft layer downscale
  const hc = document.createElement('canvas'); hc.id = 'bg-hero'; hc.setAttribute('aria-hidden', 'true');
  hc.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;z-index:0;pointer-events:none;visibility:hidden';
  c.after(hc);
  const hx = hc.getContext('2d'); let hShown = false, hKey = '';
  const lowQ = () => settings && settings.quality === 'low';
  const tileCol = Array.from({ length: 33 }, (_, i) => { const f = i / 32; return `rgba(232,189,98,${(0.05 * f * f + 0.01).toFixed(4)})`; });
  const resize = () => {
    d = Math.min(1, devicePixelRatio || 1); hd = Math.min(lowQ() ? 1 : 2, devicePixelRatio || 1); W = innerWidth; H = innerHeight;
    c.width = Math.round(W * d); c.height = Math.round(H * d); hKey = '';
    hzY = H * (W > H ? 0.6 : 0.64);
    // horizon glow + fog (static for a given size), quarter resolution: pure gradients upscale cleanly
    fogL = mkC(W / 4, H / 4); { const f = fogL.getContext('2d'); f.scale(fogL.width / W, fogL.height / H); const hz = hzY;
      const hg = f.createLinearGradient(0, hz - 70, 0, hz + 60); hg.addColorStop(0, 'rgba(255,200,120,0)'); hg.addColorStop(0.55, 'rgba(255,200,120,0.16)'); hg.addColorStop(1, 'rgba(20,14,34,0)');
      f.fillStyle = hg; f.fillRect(0, hz - 70, W, 130);
      const fog = f.createLinearGradient(0, hz - 40, 0, H); fog.addColorStop(0, 'rgba(14,11,26,0)'); fog.addColorStop(0.12, 'rgba(14,11,26,0.55)'); fog.addColorStop(0.45, 'rgba(14,11,26,0.08)'); fog.addColorStop(1, 'rgba(6,5,10,0.6)');
      f.fillStyle = fog; f.fillRect(0, hz - 40, W, H - hz + 40); }
    vig = mkC(W / 4, H / 4); { const v = vig.getContext('2d'); v.scale(vig.width / W, vig.height / H);
      const g = v.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.max(W, H) * 0.75); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.55)');
      v.fillStyle = g; v.fillRect(0, 0, W, H); }
    shL = mkC(W * d / SH, H * d / SH); shX = shL.getContext('2d');
    if (!shSpr) { // the title's CSS shaft: horizontal beam gradient x vertical fade mask
      shSpr = mkC(32, 128); const q = shSpr.getContext('2d');
      const hg = q.createLinearGradient(0, 0, 32, 0); hg.addColorStop(0, 'rgba(255,226,170,0)'); hg.addColorStop(0.4, 'rgba(255,226,170,0.09)'); hg.addColorStop(0.5, 'rgba(255,236,200,0.14)'); hg.addColorStop(0.6, 'rgba(255,226,170,0.09)'); hg.addColorStop(1, 'rgba(255,226,170,0)');
      q.fillStyle = hg; q.fillRect(0, 0, 32, 128); q.globalCompositeOperation = 'destination-in';
      const vg = q.createLinearGradient(0, 0, 0, 128); vg.addColorStop(0, '#000'); vg.addColorStop(0.45, 'rgba(0,0,0,0.5)'); vg.addColorStop(0.8, 'rgba(0,0,0,0)');
      q.fillStyle = vg; q.fillRect(0, 0, 32, 128);
    }
    sky = mkC(c.width, c.height);
    const s = sky.getContext('2d'); s.scale(d, d);
    const g = s.createLinearGradient(0, 0, 0, H); g.addColorStop(0, '#0a0916'); g.addColorStop(0.45, '#151129'); g.addColorStop(0.62, '#1d1631'); g.addColorStop(1, '#07060c');
    s.fillStyle = g; s.fillRect(0, 0, W, H);
    const r = s.createRadialGradient(W / 2, H * 0.6, 10, W / 2, H * 0.6, Math.max(W, H) * 0.65); r.addColorStop(0, 'rgba(255,196,110,0.16)'); r.addColorStop(0.4, 'rgba(120,80,190,0.08)'); r.addColorStop(1, 'rgba(0,0,0,0)');
    s.fillStyle = r; s.fillRect(0, 0, W, H);
    for (let i = 0; i < (lowQ() ? 40 : 90); i++) { s.globalAlpha = 0.15 + Math.random() * 0.5; s.fillStyle = '#fff'; const sz = Math.random() < 0.1 ? 1.6 : 1; s.fillRect(Math.random() * W, Math.random() * H * 0.55, sz, sz); }
    s.globalAlpha = 1;
    bg.d = d;
  };
  resize(); addEventListener('resize', resize);
  bg.resize = resize;
  const parts = [];
  const spawn = (y) => {
    const p = getProfile(); const skins = p.owned && p.owned.length ? p.owned : DEFAULT_SKINS;
    const depth = Math.random();
    return { x: Math.random(), y: y ?? 1.15, s: 18 + depth * depth * 110, v: 0.008 + depth * 0.03, piece: PCS[Math.floor(Math.random() * PCS.length)], skin: skins[Math.floor(Math.random() * skins.length)], r: (Math.random() - 0.5) * 0.5, vr: (Math.random() - 0.5) * 0.12, a: 0.05 + depth * 0.2, ph: Math.random() * 6, depth };
  };
  const N = () => (lowQ() ? 10 : 18);
  for (let i = 0; i < N(); i++) parts.push(spawn(Math.random() * 1.2));
  parts.sort((a, b) => a.depth - b.depth);
  const motes = Array.from({ length: 36 }, () => ({ x: Math.random(), y: Math.random(), v: 0.005 + Math.random() * 0.02, ph: Math.random() * 6, s: 0.6 + Math.random() * 1.6 }));
  let mx = 0, my = 0, tmx = 0, tmy = 0;
  addEventListener('pointermove', (e) => { tmx = e.clientX / innerWidth - 0.5; tmy = e.clientY / innerHeight - 0.5; });
  let last = performance.now(), acc = 0, T = 0, floorZ = 0, heroSwap = 0, heroSkin = null;
  const hero = { parts: [] };

  const drawFloor = (hz, dt) => {
    // a perspective chessboard sliding slowly towards the viewer
    const cx = W / 2 - mx * 60, f = H * 0.5, rows = lowQ() ? 9 : 14, cols = 9, camH = 1;
    floorZ = (floorZ + dt * 0.18) % 2;
    x.save();
    for (let r = rows; r >= 0; r--) {
      const z0 = r + 1 - floorZ + 0.6, z1 = z0 + 1;
      if (z0 <= 0.2) continue;
      const y0 = hz + (camH * f) / z0, y1 = hz + (camH * f) / z1;
      const fade = clamp(1 - z0 / (rows + 1), 0, 1);
      x.fillStyle = tileCol[Math.round(fade * 32)];
      x.beginPath(); // one path per row (same colour)
      for (let k = -cols; k < cols; k++) {
        if (((k + r) & 1) === 0) continue;
        const xa0 = cx + (k * f * 0.55) / z0, xb0 = cx + ((k + 1) * f * 0.55) / z0;
        const xa1 = cx + (k * f * 0.55) / z1, xb1 = cx + ((k + 1) * f * 0.55) / z1;
        if (Math.max(xa0, xb0) < -50 || Math.min(xa0, xb0) > W + 50) continue;
        x.moveTo(xa0, y0); x.lineTo(xb0, y0); x.lineTo(xb1, y1); x.lineTo(xa1, y1); x.closePath();
      }
      x.fill();
    }
    x.restore();
    // horizon glow + fog (prerendered)
    x.drawImage(fogL, 0, 0, W, H);
  };
  const shG = [{ k: null, len: 0 }, { k: null, len: 0 }, { k: null, len: 0 }]; // cached beam gradients
  const drawShafts = (title) => {
    // 1/3-resolution light layer: the scene's three swaying beams plus, on the title, its three pulsing CSS-style shafts
    const k = d / SH; shX.setTransform(1, 0, 0, 1, 0, 0); shX.clearRect(0, 0, shL.width, shL.height);
    shX.setTransform(k, 0, 0, k, 0, 0); shX.globalCompositeOperation = 'lighter';
    const len = H * 1.1;
    for (let i = 0; i < 3; i++) {
      const sw = Math.sin(T * 0.15 + i * 2.1) * 0.06;
      const ox = W * (0.3 + i * 0.22) - mx * 30 * (i + 1);
      const ang = -0.35 + i * 0.3 + sw, wTop = 30 + i * 12, wBot = 160 + i * 50;
      const gc = shG[i]; if (gc.len !== len) { gc.len = len; gc.k = shX.createLinearGradient(0, 0, 0, len); gc.k.addColorStop(0, `rgba(255,220,160,${0.09 - i * 0.015})`); gc.k.addColorStop(1, 'rgba(255,220,160,0)'); }
      shX.save(); shX.translate(ox, -20); shX.rotate(ang); shX.fillStyle = gc.k;
      shX.beginPath(); shX.moveTo(-wTop, 0); shX.lineTo(wTop, 0); shX.lineTo(wBot, len); shX.lineTo(-wBot, len); shX.closePath(); shX.fill(); shX.restore();
    }
    if (title) {
      const vmax = Math.max(W, H) / 100;
      for (let i = 0; i < 3; i++) { // left 6/36/64%, 34/22/34vmax wide, rotate 16/-4/-18deg about the top centre, opacity .25-.7 over 9 s alternate
        const w = (i === 1 ? 22 : 34) * vmax, left = W * [0.06, 0.36, 0.64][i], top = -0.2 * H, hh = 1.4 * H;
        const ph = ((T + i * 3) / 9) % 2, tri = ph < 1 ? ph : 2 - ph;
        shX.save(); shX.globalAlpha = 0.25 + 0.45 * smooth(tri); shX.translate(left + w / 2, top); shX.rotate([16, -4, -18][i] * Math.PI / 180);
        shX.drawImage(shSpr, -w / 2, 0, w, hh); shX.restore();
      }
    }
    shX.globalCompositeOperation = 'source-over';
    x.save(); x.setTransform(1, 0, 0, 1, 0, 0); x.globalCompositeOperation = 'lighter'; x.drawImage(shL, 0, 0, c.width, c.height); x.restore();
  };
  const drawHero = (dt) => {
    const slot = (bg.heroEl ||= document.getElementById('hero-slot'));
    if (!slot) return hideHero();
    const rc = slot.getBoundingClientRect();
    if (rc.width < 90 || rc.height < 100) return hideHero();
    const p = getProfile();
    if (heroSkin !== p.skin) { heroSkin = p.skin; heroSwap = 1; }
    heroSwap = Math.max(0, heroSwap - dt * 2.2);
    const sz = Math.min(rc.height * 0.82, rc.width * 0.9, 240), cx0 = rc.left + rc.width / 2, by = rc.bottom - Math.max(14, sz * 0.12);
    const sk = skinOf(p.skin);
    // soft light (spotlight cone + glow) stays in the 1x scene canvas
    x.save();
    const cone = x.createLinearGradient(0, by - sz * 1.4, 0, by); cone.addColorStop(0, 'rgba(255,230,180,0)'); cone.addColorStop(1, 'rgba(255,230,180,0.12)');
    x.fillStyle = cone; x.beginPath(); x.moveTo(cx0 - sz * 0.12, by - sz * 1.5); x.lineTo(cx0 + sz * 0.12, by - sz * 1.5); x.lineTo(cx0 + sz * 0.5, by); x.lineTo(cx0 - sz * 0.5, by); x.closePath(); x.fill();
    const g2 = x.createRadialGradient(cx0, by, 4, cx0, by, sz * 0.8); g2.addColorStop(0, hexA(sk.glow, 0.42)); g2.addColorStop(1, hexA(sk.glow, 0));
    x.fillStyle = g2; x.fillRect(cx0 - sz, by - sz, sz * 2, sz * 1.3);
    x.restore();
    // crisp parts (pedestal, piece, motes) on the small full-DPR hero canvas, sized in 16 px steps
    const szB = Math.ceil(sz / 16) * 16, bw = szB * 1.7, bh = szB * 1.85, bx = cx0 - bw / 2, bt = by - szB * 1.5;
    const key = szB + '|' + hd;
    if (key !== hKey) { hKey = key; hc.width = Math.ceil(bw * hd); hc.height = Math.ceil(bh * hd); hc.style.width = bw + 'px'; hc.style.height = bh + 'px'; }
    hc.style.transform = `translate(${bx.toFixed(1)}px,${bt.toFixed(1)}px)`;
    if (!hShown) { hShown = true; hc.style.visibility = 'visible'; }
    { const x = hx; // same drawing code, other canvas
    x.setTransform(1, 0, 0, 1, 0, 0); x.clearRect(0, 0, hc.width, hc.height);
    x.setTransform(hd, 0, 0, hd, -bx * hd, -bt * hd);
    x.save();
    // pedestal: two stacked discs with a rotating rune ring
    x.fillStyle = '#120f1d'; x.beginPath(); x.ellipse(cx0, by + 8, sz * 0.46, sz * 0.12, 0, 0, Math.PI * 2); x.fill();
    const pg = x.createLinearGradient(cx0 - sz * 0.46, 0, cx0 + sz * 0.46, 0); pg.addColorStop(0, '#2a2440'); pg.addColorStop(0.5, '#4a4068'); pg.addColorStop(1, '#1a1628');
    x.fillStyle = pg; x.fillRect(cx0 - sz * 0.46, by, sz * 0.92, 8);
    x.fillStyle = '#3a3256'; x.beginPath(); x.ellipse(cx0, by, sz * 0.46, sz * 0.12, 0, 0, Math.PI * 2); x.fill();
    x.strokeStyle = 'rgba(255,215,120,0.75)'; x.lineWidth = 1.5; x.beginPath(); x.ellipse(cx0, by, sz * 0.46, sz * 0.12, 0, 0, Math.PI * 2); x.stroke();
    x.save(); x.setLineDash([6, 10]); x.lineDashOffset = -T * 18; x.strokeStyle = 'rgba(255,215,120,0.45)'; x.beginPath(); x.ellipse(cx0, by, sz * 0.36, sz * 0.09, 0, 0, Math.PI * 2); x.stroke(); x.restore();
    const ring = (T * 0.6) % 1;
    x.strokeStyle = `rgba(255,215,120,${0.4 * (1 - ring)})`; x.beginPath(); x.ellipse(cx0, by, sz * (0.46 + ring * 0.3), sz * (0.12 + ring * 0.08), 0, 0, Math.PI * 2); x.stroke();
    // piece: slow turntable sway + bob, pops when the skin changes
    const turn = Math.cos(T * 0.7) * 0.18, bob = Math.sin(T * 1.6) * 3, pop = 1 + heroSwap * 0.18;
    x.translate(cx0, by - 4 + bob);
    x.save(); x.scale(1, 0.25); x.fillStyle = 'rgba(0,0,0,0.45)'; x.beginPath(); x.arc(0, 16 - bob * 2, sz * 0.24, 0, Math.PI * 2); x.fill(); x.restore();
    x.scale(sz * 0.8 * (1 - Math.abs(turn) * 0.5) * pop, sz * 0.8 * pop);
    drawPiece(x, 'king', p.skin, { t: T, flash: heroSwap * 0.8 });
    x.restore();
    // trail / glow motes rising off the piece
    const tr = TRAILS[p.trail];
    const cols = tr && tr.colors && tr.colors.length ? tr.colors : [sk.glow];
    if (hero.parts.length < (lowQ() ? 14 : 34) && Math.random() < 0.6) hero.parts.push({ x: cx0 + (Math.random() - 0.5) * sz * 0.5, y: by - Math.random() * sz * 0.7, vy: -16 - Math.random() * 22, life: 1, c: cols[(Math.random() * cols.length) | 0] });
    hero.parts = hero.parts.filter((q) => (q.life -= dt * 0.8) > 0);
    for (const q of hero.parts) { q.y += q.vy * dt; x.globalAlpha = q.life * 0.9; x.fillStyle = q.c; x.beginPath(); x.arc(q.x, q.y, 1.8, 0, Math.PI * 2); x.fill(); }
    x.globalAlpha = 1;
    // the scene vignette used to darken the hero too: apply its value at the piece
    const vr = Math.hypot(cx0 - W / 2, by - sz * 0.5 - H / 2), r0 = Math.min(W, H) * 0.35, r1 = Math.max(W, H) * 0.75, va = 0.55 * clamp((vr - r0) / (r1 - r0), 0, 1);
    if (va > 0.01) { x.globalCompositeOperation = 'source-atop'; x.fillStyle = `rgba(0,0,0,${va.toFixed(3)})`; x.fillRect(bx, bt, bw, bh); x.globalCompositeOperation = 'source-over'; }
    }
  };
  function hideHero() { if (hShown) { hShown = false; hc.style.visibility = 'hidden'; } }
  const frame = (dt) => {
    const reduced = reducedNow(settings);
    const k = reduced ? 0 : 1;
    T += dt * (reduced ? 0.15 : 1);
    mx += (tmx - mx) * Math.min(1, dt * 3); my += (tmy - my) * Math.min(1, dt * 3);
    x.setTransform(1, 0, 0, 1, 0, 0); x.drawImage(sky, 0, 0);
    x.setTransform(d, 0, 0, d, 0, 0);
    const scr = getScreen();
    const hz = hzY;
    if (!lowQ()) drawShafts(scr === 'title');
    drawFloor(hz, dt * k);
    for (const p of parts) {
      p.y -= p.v * dt * k; p.ph += dt * k; p.r += p.vr * dt * k;
      if (p.y < -0.25) Object.assign(p, spawn());
      x.setTransform(d, 0, 0, d, 0, 0);
      x.globalAlpha = p.a * (scr === 'title' ? 1 : 0.7);
      x.translate(p.x * W + Math.sin(p.ph * 0.5) * 12 - mx * 60 * p.depth, p.y * H - my * 40 * p.depth);
      x.rotate(p.r + Math.sin(p.ph * 0.3) * 0.08); x.scale(p.s, p.s);
      drawPiece(x, p.piece, p.skin, { t: T });
    }
    x.globalAlpha = 1; x.setTransform(d, 0, 0, d, 0, 0);
    if (!lowQ()) {
      x.fillStyle = '#ffe9c0';
      for (const m of motes) {
        m.y -= m.v * dt * k; m.ph += dt * k; if (m.y < -0.02) { m.y = 1.02; m.x = Math.random(); }
        x.globalAlpha = 0.25 + 0.35 * Math.abs(Math.sin(m.ph)); x.fillRect(m.x * W + Math.sin(m.ph) * 6 - mx * 20, m.y * H, m.s, m.s);
      }
      x.globalAlpha = 1;
    }
    if (scr === 'title') drawHero(dt); else hideHero();
    // vignette (prerendered)
    x.drawImage(vig, 0, 0, W, H);
  };
  const loop = (now) => {
    requestAnimationFrame(loop);
    try {
      const dt = Math.min(0.05, (now - last) / 1000); last = now; acc += dt;
      if (!bg.on) { hideHero(); return; } // nothing to do during matches: skip the DOM query entirely
      const fps = reducedNow(settings) ? 12 : lowQ() ? 24 : 30;
      if (acc < 1 / fps) return;
      const modalUp = !!document.querySelector('.modal.global:not(.hidden), .sequel');
      if (modalUp) return;
      const step = Math.min(acc, 0.1); acc = 0; // after a match or a modal, resume without a jump
      if (lowQ() !== bg.wasLow) { bg.wasLow = lowQ(); resize(); }
      frame(step);
    } catch (err) { console.error(err); }
  };
  requestAnimationFrame(loop);
  releaseFinishedAnimations();
}
// B3 10.1 perf: a finished CSS entrance animation with fill-mode both/forwards (riseIn, a7in, scrIn...) keeps its element
// on its own compositor layer for as long as it exists (the store's 45 cards alone made ~110 extra layers through
// overlap). When an animation ends and its final frame equals the element's normal style, drop the fill so the layer
// can go away. Animations whose end state differs from the base style (fade-outs, sqUp...) keep their fill.
let releaseOn = false;
function releaseFinishedAnimations() {
  if (releaseOn || typeof document === 'undefined') return; releaseOn = true;
  document.addEventListener('animationend', (e) => {
    try {
      const el = e.target; if (!el || !el.getAnimations) return;
      const pseudo = e.pseudoElement || null;
      for (const a of el.getAnimations({ subtree: !!pseudo })) {
        if (a.animationName !== e.animationName || a.playState !== 'finished') continue;
        const ef = a.effect; if (!ef || (pseudo && ef.pseudoElement !== pseudo) || (!pseudo && ef.pseudoElement)) continue;
        const fill = ef.getComputedTiming().fill; if (fill !== 'forwards' && fill !== 'both') continue;
        const props = new Set(); for (const k of ef.getKeyframes()) for (const p in k) if (p !== 'offset' && p !== 'easing' && p !== 'composite' && p !== 'computedOffset') props.add(p);
        const norm = (p, v) => { if (p === 'transform' && v !== 'none') { try { const m = new DOMMatrix(v); return m.isIdentity ? 'none' : m.toString(); } catch { return v; } } return v; };
        const cs = getComputedStyle(el, pseudo), before = [...props].map((p) => norm(p, cs[p]));
        ef.updateTiming({ fill: 'none' });
        const cs2 = getComputedStyle(el, pseudo);
        if ([...props].some((p, i) => norm(p, cs2[p]) !== before[i])) ef.updateTiming({ fill }); // end state is not the base style
      }
    } catch { /* never let this break anything */ }
  }, true);
}
function hexA(hex, a) {
  if (typeof hex !== 'string' || hex[0] !== '#') return `rgba(255,215,120,${a})`;
  let h = hex.slice(1); if (h.length === 3) h = h.split('').map((ch) => ch + ch).join('');
  const n = parseInt(h.slice(0, 6), 16); return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

// ---------- 10.0 sequel reveal ----------
// A full-screen, skippable title card the first time a returning player opens 10.0.
export function sequelReveal(done, { reduced = false, sfx = null } = {}) {
  const el = document.createElement('div');
  el.className = 'sequel' + (reduced ? ' calm' : '');
  el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', 'Chess Complex 10');
  el.innerHTML = `<div class="sq-rays"></div><div class="sq-flare"></div><div class="sq-ring"></div>
    <div class="sq-stack"><div class="sq-kicker">The sequel</div>
    <div class="sq-logo"><span class="a">CHESS</span><span class="b">COMPLEX</span></div>
    <div class="sq-ten"><span>10</span></div>
    <div class="sq-sub">A new board. A new war.</div></div>
    <div class="sq-skip">Tap to continue</div>`;
  document.body.appendChild(el);
  let closed = false;
  const close = () => {
    if (closed) return; closed = true;
    el.classList.add('out');
    setTimeout(() => { el.remove(); done && done(); }, reduced ? 200 : 650);
  };
  const t0 = performance.now();
  el.addEventListener('pointerdown', () => { if (performance.now() - t0 > 500) close(); });
  addEventListener('keydown', function k(e) { if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') { removeEventListener('keydown', k); close(); } });
  if (sfx && !reduced) { setTimeout(() => { try { sfx.whoosh && sfx.whoosh(); } catch {} }, 300); setTimeout(() => { try { sfx.levelup && sfx.levelup(); } catch {} }, 1350); }
  setTimeout(close, reduced ? 2600 : 4600);
}

// ---------- loadout showroom ----------
// A spotlit turntable for one piece of your build. Runs only while the Loadout screen is open.
export const showroom = {
  piece: 'pawn', skin: 'ivory', swap: 0, T: 0, running: false, parts: [],
  attach(canvas, getScreen, settings) { this.c = canvas; this.getScreen = getScreen; this.settings = settings; },
  set(piece, skin) { if (piece !== this.piece || skin !== this.skin) this.swap = 1; this.piece = piece; this.skin = skin; this.start(); },
  start() {
    if (this.running || !this.c) return; this.running = true;
    let last = performance.now();
    const loop = (now) => {
      if (this.getScreen() !== 'loadout') { this.running = false; return; }
      requestAnimationFrame(loop);
      const dt = Math.min(0.05, (now - last) / 1000); last = now;
      try { this.draw(dt); } catch (e) { console.error(e); this.running = false; }
    };
    requestAnimationFrame(loop);
  },
  draw(dt) {
    const c = this.c, r = c.getBoundingClientRect(); if (r.width < 10) return;
    const d = Math.min(2, devicePixelRatio || 1);
    if (c.width !== Math.round(r.width * d) || c.height !== Math.round(r.height * d)) { c.width = Math.round(r.width * d); c.height = Math.round(r.height * d); }
    const x = c.getContext('2d'), W = r.width, H = r.height;
    const reduced = reducedNow(this.settings);
    this.T += dt * (reduced ? 0.2 : 1); this.swap = Math.max(0, this.swap - dt * 2.5);
    const T = this.T, sk = skinOf(this.skin);
    x.setTransform(d, 0, 0, d, 0, 0); x.clearRect(0, 0, W, H);
    const sz = Math.min(H * 0.62, W * 0.55), cx = W / 2, by = H * 0.8;
    // backdrop spotlight
    const sp = x.createRadialGradient(cx, by - sz * 0.5, 4, cx, by - sz * 0.4, sz * 1.25); sp.addColorStop(0, hexA(sk.glow, 0.32)); sp.addColorStop(0.5, hexA(sk.glow, 0.08)); sp.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = sp; x.fillRect(0, 0, W, H);
    const cone = x.createLinearGradient(0, 0, 0, by); cone.addColorStop(0, 'rgba(255,240,210,0)'); cone.addColorStop(1, 'rgba(255,240,210,0.1)');
    x.fillStyle = cone; x.beginPath(); x.moveTo(cx - 20, 0); x.lineTo(cx + 20, 0); x.lineTo(cx + sz * 0.6, by); x.lineTo(cx - sz * 0.6, by); x.closePath(); x.fill();
    // turntable floor
    x.fillStyle = 'rgba(10,8,18,0.7)'; x.beginPath(); x.ellipse(cx, by + 6, sz * 0.62, sz * 0.15, 0, 0, Math.PI * 2); x.fill();
    x.strokeStyle = hexA(sk.glow, 0.7); x.lineWidth = 1.5; x.beginPath(); x.ellipse(cx, by, sz * 0.6, sz * 0.14, 0, 0, Math.PI * 2); x.stroke();
    x.save(); x.setLineDash([3, 9]); x.lineDashOffset = -T * 24; x.strokeStyle = hexA(sk.glow, 0.5); x.beginPath(); x.ellipse(cx, by, sz * 0.48, sz * 0.11, 0, 0, Math.PI * 2); x.stroke(); x.restore();
    for (let i = 0; i < 12; i++) { const a = T * 0.5 + (i / 12) * Math.PI * 2; const px = cx + Math.cos(a) * sz * 0.6, py = by + Math.sin(a) * sz * 0.14; x.fillStyle = hexA(sk.glow, Math.sin(a) > 0 ? 0.8 : 0.25); x.fillRect(px - 1.5, py - 1.5, 3, 3); }
    // piece
    const turn = Math.sin(T * 0.8), bob = Math.sin(T * 1.7) * 3, pop = 1 + this.swap * 0.22;
    x.save(); x.translate(cx, by + 2); x.scale(1, 0.22); x.fillStyle = 'rgba(0,0,0,0.5)'; x.beginPath(); x.arc(0, 0, sz * 0.3, 0, Math.PI * 2); x.fill(); x.restore();
    x.save(); x.translate(cx, by - 2 + bob);
    const sx = (0.84 + 0.16 * Math.abs(Math.cos(T * 0.8))) * (turn < -0.98 ? -1 : 1);
    x.scale(sz * sx * pop, sz * pop);
    drawPiece(x, this.piece, this.skin, { t: T, flash: this.swap });
    x.restore();
    // sparkles
    if (!reduced && this.parts.length < 24 && Math.random() < 0.5) this.parts.push({ x: cx + (Math.random() - 0.5) * sz * 0.7, y: by - Math.random() * sz, vy: -10 - Math.random() * 18, life: 1 });
    this.parts = this.parts.filter((q) => (q.life -= dt * 0.9) > 0);
    x.fillStyle = sk.glow;
    for (const q of this.parts) { q.y += q.vy * dt; x.globalAlpha = q.life * 0.8; x.fillRect(q.x, q.y, 2, 2); }
    x.globalAlpha = 1;
  },
};
