// 10.0 gameplay tiles (A9 stand-ins, art by B4 in 10.1): King of the Hill throne, geysers, conveyors,
// crumbling floor and pits, plus Rift Storm tears, geyser eruptions and throne capture pulses.
// Static art is painted once into cached sprites and baked into world.js's floor cache through bake();
// render.js calls tile() per frame from the animated floor loop (cheap animated parts only), overlay()
// after the units (eruption columns, rift tears, unit states) and event() for hazard / hill events.
// Everything is in world units (1 = one tile). lowQ drops secondary layers; reduced motion slows flows.
import { ROLES, unitById, ringOf, HILL } from './engine.js';

export const TILES = { throne: 1, geyser: 1, conveyor: 1, crumble: 1, pit: 1 };
const SIZE = 16, TAU = Math.PI * 2;
const isT = (s, x, y, k) => x >= 0 && y >= 0 && x < SIZE && y < SIZE && s.tiles[y * SIZE + x].t === k;
const mkC = (w, h) => { const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h)); return c; };
const rng = (seed) => { let s = (seed * 2654435761) >>> 0 || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; };
const hex = (c) => { if (!c || c[0] !== '#') return [255, 210, 77]; let h = c.slice(1); if (h.length === 3) h = h.split('').map((q) => q + q).join(''); const n = parseInt(h.slice(0, 6), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const rgba = (c, a) => { const [r, g, b] = hex(c); return `rgba(${r},${g},${b},${a})`; };

// ---------- sprite cache: paint(g) draws in tile units, origin at the tile's top-left ----------
const PX = 128;
const SPR = new Map();
function sprite(key, w, h, ox, oy, paint) {
  let p = SPR.get(key); if (p) return p;
  const c = mkC(w * PX, h * PX), g = c.getContext('2d');
  g.setTransform(PX, 0, 0, PX, ox * PX, oy * PX); paint(g);
  p = { c, w, h, ox, oy }; SPR.set(key, p); return p;
}
const blit = (ctx, p, x, y) => ctx.drawImage(p.c, x - p.ox, y - p.oy, p.w, p.h);
const GLOW = new Map();
function glow(col) { // soft additive dot
  let c = GLOW.get(col); if (c) return c;
  c = mkC(64, 64); const g = c.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, rgba(col, 1)); gr.addColorStop(0.35, rgba(col, 0.45)); gr.addColorStop(1, rgba(col, 0));
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64); GLOW.set(col, c); return c;
}
let PUFF = null;
function puff() { // steam cloud blob
  if (PUFF) return PUFF;
  const c = mkC(96, 96), g = c.getContext('2d'), r = rng(5);
  for (let i = 0; i < 7; i++) {
    const x = 30 + r() * 36, y = 30 + r() * 36, rad = 14 + r() * 16, gr = g.createRadialGradient(x, y, 0, x, y, rad);
    gr.addColorStop(0, 'rgba(244,250,255,0.55)'); gr.addColorStop(0.6, 'rgba(225,238,246,0.25)'); gr.addColorStop(1, 'rgba(210,228,240,0)');
    g.fillStyle = gr; g.beginPath(); g.arc(x, y, rad, 0, TAU); g.fill();
  }
  PUFF = c; return c;
}
const dot = (ctx, col, x, y, rad, a) => { ctx.globalAlpha = a; ctx.drawImage(glow(col), x - rad, y - rad, rad * 2, rad * 2); };
const rr = (g, x, y, w, h, q) => { g.beginPath(); g.moveTo(x + q, y); g.arcTo(x + w, y, x + w, y + h, q); g.arcTo(x + w, y + h, x, y + h, q); g.arcTo(x, y + h, x, y, q); g.arcTo(x, y, x + w, y, q); g.closePath(); };
function lg(g, x0, y0, x1, y1, stops) { const gr = g.createLinearGradient(x0, y0, x1, y1); for (const [k, c] of stops) gr.addColorStop(k, c); return gr; }

// ---------- throne dais (4x4) ----------
const GOLD = '#ffd24d';
function throneSprite() {
  return sprite('throne', 5.6, 6.0, 0.8, 1.1, (g) => {
    // soft drop shadow onto the apron
    g.save(); g.filter = 'blur(6px)'; g.fillStyle = 'rgba(0,0,0,0.6)'; rr(g, 0.02, 0.2, 4.24, 4.3, 0.2); g.fill(); g.restore();
    // front face of the raised dais (south edge)
    g.fillStyle = lg(g, 0, 4.0, 0, 4.26, [[0, '#7a5418'], [0.45, '#4a3010'], [1, '#1a1006']]); g.fillRect(-0.1, 3.98, 4.2, 0.28);
    g.fillStyle = 'rgba(255,214,120,0.75)'; g.fillRect(-0.1, 3.98, 4.2, 0.02);
    for (let i = 0; i <= 8; i++) { g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(-0.06 + i * 0.515, 4.02, 0.03, 0.22); g.fillStyle = 'rgba(255,200,110,0.25)'; g.fillRect(-0.03 + i * 0.515, 4.02, 0.012, 0.22); }
    // lower step: brushed gold rim
    rr(g, -0.1, -0.1, 4.2, 4.1, 0.08);
    g.fillStyle = lg(g, -0.1, -0.1, 4.1, 4.0, [[0, '#ffe6a0'], [0.35, '#d9a640'], [0.75, '#9a6a1c'], [1, '#6a4410']]); g.fill();
    g.strokeStyle = 'rgba(60,30,4,0.9)'; g.lineWidth = 0.02; g.stroke();
    // upper step
    rr(g, 0.05, 0.05, 3.9, 3.86, 0.06);
    g.fillStyle = lg(g, 0, 0, 4, 4, [[0, '#f6cf6a'], [0.5, '#b8862c'], [1, '#7a5214']]); g.fill();
    g.fillStyle = 'rgba(40,20,0,0.55)'; g.fillRect(0.1, 3.86, 3.8, 0.05); // riser shadow
    g.fillRect(3.9, 0.12, 0.05, 3.76);
    g.fillStyle = 'rgba(255,245,200,0.7)'; g.fillRect(0.08, 0.06, 3.84, 0.02); g.fillRect(0.06, 0.08, 0.02, 3.8); // lit edges
    // top: royal crimson stone, one slab per tile so the 16 squares stay readable
    const T0 = 0.14, TW = 3.72;
    g.fillStyle = '#2c1020'; g.fillRect(T0, T0, TW, TW - 0.04);
    const r = rng(41);
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
      const x0 = Math.max(T0, x) + 0.03, y0 = Math.max(T0, y) + 0.03, x1 = Math.min(T0 + TW, x + 1) - 0.03, y1 = Math.min(T0 + TW - 0.04, y + 1) - 0.03;
      const par = (x + y) % 2;
      g.fillStyle = lg(g, x0, y0, x1, y1, par ? [[0, '#5a1f36'], [1, '#3a1224']] : [[0, '#6c2742'], [1, '#46162c']]); g.fillRect(x0, y0, x1 - x0, y1 - y0);
      // marble veins
      g.strokeStyle = 'rgba(255,190,200,0.08)'; g.lineWidth = 0.012;
      for (let k = 0; k < 2; k++) { g.beginPath(); let vx = x0 + r() * (x1 - x0), vy = y0; g.moveTo(vx, vy); for (let j = 0; j < 4; j++) { vx += (r() - 0.5) * 0.3; vy += (y1 - y0) / 4; g.lineTo(Math.max(x0, Math.min(x1, vx)), vy); } g.stroke(); }
      g.fillStyle = 'rgba(255,230,240,0.07)'; g.fillRect(x0, y0, x1 - x0, 0.03); g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(x0, y1 - 0.03, x1 - x0, 0.03);
    }
    // gold inlay seams on the tile grid
    g.strokeStyle = 'rgba(255,205,100,0.55)'; g.lineWidth = 0.022; g.beginPath();
    for (let i = 1; i < 4; i++) { g.moveTo(i, T0); g.lineTo(i, T0 + TW - 0.04); g.moveTo(T0, i); g.lineTo(T0 + TW, i); } g.stroke();
    // corner studs
    g.fillStyle = '#ffe08a'; for (let i = 1; i < 4; i++) for (let j = 1; j < 4; j++) { g.beginPath(); g.arc(i, j, 0.035, 0, TAU); g.fill(); }
    // central crown sigil, inlaid (low contrast so pieces on the centre still read)
    g.save(); g.translate(2, 2); g.globalAlpha = 0.6;
    g.strokeStyle = '#ffcf5a'; g.lineWidth = 0.04; g.beginPath(); g.arc(0, 0, 0.78, 0, TAU); g.stroke();
    g.lineWidth = 0.015; g.beginPath(); g.arc(0, 0, 0.7, 0, TAU); g.stroke();
    for (let i = 0; i < 16; i++) { const a = (i / 16) * TAU; g.beginPath(); g.moveTo(Math.cos(a) * 0.7, Math.sin(a) * 0.7); g.lineTo(Math.cos(a) * 0.78, Math.sin(a) * 0.78); g.stroke(); }
    g.fillStyle = lg(g, 0, -0.35, 0, 0.3, [[0, '#ffe7a0'], [1, '#c48a26']]);
    g.beginPath(); g.moveTo(-0.38, 0.22); g.lineTo(-0.44, -0.2); g.lineTo(-0.2, 0.0); g.lineTo(0, -0.34); g.lineTo(0.2, 0.0); g.lineTo(0.44, -0.2); g.lineTo(0.38, 0.22); g.closePath(); g.fill();
    g.fillRect(-0.38, 0.26, 0.76, 0.08);
    g.fillStyle = '#c2183a'; for (const [cx, cy] of [[-0.44, -0.24], [0, -0.38], [0.44, -0.24]]) { g.beginPath(); g.arc(cx, cy, 0.05, 0, TAU); g.fill(); }
    g.restore();
    // corner posts: stone plinth, gilded pole and brazier bowl (flames and banners animate per frame)
    for (const [cx, cy] of [[0, 0], [4, 0], [0, 4], [4, 4]]) {
      g.fillStyle = 'rgba(0,0,0,0.45)'; g.beginPath(); g.ellipse(cx + 0.06, cy + 0.05, 0.24, 0.1, 0, 0, TAU); g.fill();
      g.fillStyle = lg(g, cx - 0.17, 0, cx + 0.17, 0, [[0, '#4a3a30'], [0.4, '#2a2028'], [1, '#141016']]); g.fillRect(cx - 0.17, cy - 0.12, 0.34, 0.16);
      g.fillStyle = '#d9a640'; g.fillRect(cx - 0.19, cy - 0.16, 0.38, 0.05); g.fillStyle = '#ffe6a0'; g.fillRect(cx - 0.19, cy - 0.16, 0.38, 0.012);
      g.fillStyle = lg(g, cx - 0.04, 0, cx + 0.04, 0, [[0, '#ffe08a'], [1, '#8a5c16']]); g.fillRect(cx - 0.035, cy - 0.78, 0.07, 0.64);
      g.fillStyle = '#6a4410'; g.fillRect(cx - 0.14, cy - 0.74, 0.28, 0.025); // banner crossbar
      // bowl
      g.fillStyle = lg(g, cx - 0.2, 0, cx + 0.2, 0, [[0, '#ffe08a'], [0.5, '#c48a26'], [1, '#5a3a0c']]);
      g.beginPath(); g.moveTo(cx - 0.21, cy - 0.86); g.quadraticCurveTo(cx, cy - 0.62, cx + 0.21, cy - 0.86); g.closePath(); g.fill();
      g.fillStyle = '#1a0c04'; g.beginPath(); g.ellipse(cx, cy - 0.86, 0.21, 0.05, 0, 0, TAU); g.fill();
      g.fillStyle = '#ff9a3a'; g.beginPath(); g.ellipse(cx, cy - 0.86, 0.15, 0.03, 0, 0, TAU); g.fill();
    }
  });
}
function hillState(s) {
  const H = s.hill; if (!H) return { holder: null, contested: false, on: 0 };
  const on = s.units.filter((u) => u.alive && u.kind === 'player' && isT(s, u.x, u.y, 'throne') && ringOf(u.x, u.y) >= s.storm.ring);
  let contested = false;
  for (let i = 0; i < on.length && !contested; i++) for (let j = i + 1; j < on.length; j++) { const a = on[i], b = on[j]; if (!(a.team != null && a.team === b.team)) { contested = true; break; } }
  const h = H.holder != null ? unitById(s, H.holder) : null;
  return { holder: h && h.alive && on.includes(h) ? h : null, contested, on: on.length };
}
function drawThrone(r, ctx, T, x0, y0) {
  const s = r.state, st = hillState(s), sp = r.reduced ? 0.35 : 1, hz = r.hz || {};
  const col = st.contested ? '#ff4d6d' : st.holder ? st.holder.color || GOLD : GOLD;
  const cx = x0 + 2, cy = y0 + 2;
  ctx.save();
  // owner wash over the dais top and contested flicker
  ctx.globalCompositeOperation = 'lighter';
  if (st.holder && !st.contested) { ctx.globalAlpha = 0.1 + 0.04 * Math.sin(T * 2 * sp); ctx.fillStyle = col; ctx.fillRect(x0 + 0.14, y0 + 0.14, 3.72, 3.68); }
  if (st.contested) { // red alarm wash, a pulsing red rim on the steps and crossed swords over the sigil
    const p = Math.abs(Math.sin(T * 5 * sp));
    ctx.globalAlpha = 0.1 + 0.1 * p; ctx.fillStyle = '#ff2a4a'; ctx.fillRect(x0 + 0.14, y0 + 0.14, 3.72, 3.68);
    ctx.globalAlpha = 0.45 + 0.45 * p; ctx.strokeStyle = '#ff4d6d'; ctx.lineWidth = 0.08; rr(ctx, x0 - 0.06, y0 - 0.06, 4.12, 4.06, 0.08); ctx.stroke();
    ctx.save(); ctx.translate(cx, cy); ctx.globalAlpha = 0.55 + 0.35 * p; ctx.strokeStyle = '#ffd0d8'; ctx.lineCap = 'round';
    for (const sgn of [1, -1]) { ctx.save(); ctx.rotate(sgn * Math.PI / 4); ctx.lineWidth = 0.07; ctx.beginPath(); ctx.moveTo(0, -0.55); ctx.lineTo(0, 0.38); ctx.stroke(); ctx.lineWidth = 0.06; ctx.beginPath(); ctx.moveTo(-0.15, 0.3); ctx.lineTo(0.15, 0.3); ctx.stroke(); ctx.restore(); }
    ctx.restore();
  }
  // score pulse: the dais flashes and a ring expands in the scorer's colour
  const P = hz.pulse;
  if (P) {
    const k = (r.time - P.t0) / 1.1;
    if (k >= 0 && k < 1) {
      ctx.globalAlpha = (1 - k) * 0.35; ctx.fillStyle = P.col; ctx.fillRect(x0 + 0.14, y0 + 0.14, 3.72, 3.68);
      for (let i = 0; i < (r.lowQ ? 1 : 2); i++) {
        const kk = Math.min(1, k * 1.3 - i * 0.2); if (kk <= 0) continue;
        const g = -0.3 - kk * 1.1; ctx.globalAlpha = (1 - kk) * 0.9; ctx.strokeStyle = P.col; ctx.lineWidth = 0.14 * (1 - kk) + 0.03;
        rr(ctx, x0 + g, y0 + g, 4 - g * 2, 4 - g * 2, 0.3 + kk * 0.4); ctx.stroke();
      }
    } else if (k >= 1) hz.pulse = null;
  }
  // capture ring around the dais
  const g = -0.3, w = 4.6;
  if (!r.lowQ) { ctx.globalAlpha = st.holder || st.contested ? 0.35 : 0.18; ctx.strokeStyle = col; ctx.lineWidth = 0.22; rr(ctx, x0 + g, y0 + g, w, w, 0.32); ctx.stroke(); }
  ctx.globalAlpha = st.holder || st.contested ? 0.95 : 0.6; ctx.lineWidth = 0.06; ctx.strokeStyle = col;
  if (st.contested) { // clashing dashes: red against the colours of everyone on it
    ctx.setLineDash([0.3, 0.2]); ctx.lineDashOffset = -T * 1.6 * sp; rr(ctx, x0 + g, y0 + g, w, w, 0.32); ctx.stroke();
    ctx.strokeStyle = '#ffffff'; ctx.globalAlpha = 0.7; ctx.lineDashOffset = T * 1.6 * sp + 0.25; ctx.setLineDash([0.08, 0.42]); rr(ctx, x0 + g, y0 + g, w, w, 0.32); ctx.stroke();
  } else if (st.holder) { rr(ctx, x0 + g, y0 + g, w, w, 0.32); ctx.stroke(); }
  else { ctx.setLineDash([0.22, 0.16]); ctx.lineDashOffset = -T * 0.4 * sp; rr(ctx, x0 + g, y0 + g, w, w, 0.32); ctx.stroke(); }
  ctx.setLineDash([]); ctx.lineDashOffset = 0;
  // brazier flames
  for (const [px, py] of [[x0, y0], [x0 + 4, y0], [x0, y0 + 4], [x0 + 4, y0 + 4]]) {
    const fy = py - 0.88, fl = 0.85 + 0.15 * Math.sin(T * 11 * sp + px * 3 + py);
    dot(ctx, st.contested ? '#ff5a3a' : '#ffb347', px, fy - 0.05, 0.6, 0.35);
    if (st.holder && !st.contested) dot(ctx, col, px, fy, 0.4, 0.3);
    ctx.globalAlpha = 0.9;
    for (let i = 0; i < (r.lowQ ? 1 : 3); i++) {
      const h = (0.34 - i * 0.08) * fl, ww = 0.13 - i * 0.03, sw = Math.sin(T * 7 * sp + i * 2 + px) * 0.03;
      ctx.fillStyle = i === 0 ? '#ff6a1e' : i === 1 ? '#ffb347' : '#fff1b0';
      ctx.beginPath(); ctx.moveTo(px - ww, fy); ctx.quadraticCurveTo(px - ww * 0.7, fy - h * 0.6, px + sw, fy - h); ctx.quadraticCurveTo(px + ww * 0.7, fy - h * 0.6, px + ww, fy); ctx.closePath(); ctx.fill();
    }
  }
  ctx.globalCompositeOperation = 'source-over';
  // banners hanging from the crossbars: gold when free, the holder's colour when held, flickering red when contested
  const bc = st.contested ? ((T * 3 * sp) % 1 < 0.5 ? '#ff4d6d' : '#7a1020') : st.holder ? st.holder.color || GOLD : '#c9a24a';
  for (const [px, py] of [[x0, y0], [x0 + 4, y0], [x0, y0 + 4], [x0 + 4, y0 + 4]]) {
    const top = py - 0.73, len = 0.42, wv = r.lowQ ? 0 : Math.sin(T * 3 * sp + px) * 0.025;
    ctx.globalAlpha = 1; ctx.fillStyle = bc;
    ctx.beginPath(); ctx.moveTo(px - 0.12, top); ctx.lineTo(px + 0.12, top); ctx.lineTo(px + 0.12 + wv, top + len); ctx.lineTo(px + wv, top + len - 0.08); ctx.lineTo(px - 0.12 + wv, top + len); ctx.closePath(); ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.fillRect(px + 0.04, top, 0.08, len - 0.06);
    ctx.fillStyle = '#ffe08a'; ctx.fillRect(px - 0.12, top, 0.24, 0.025); ctx.fillRect(px - 0.025, top + 0.1, 0.05, 0.12);
  }
  ctx.restore();
  void cx; void cy;
}

// ---------- geyser vent ----------
function ventSprite(v) {
  return sprite('vent' + v, 1.3, 1.3, 0.15, 0.15, (g) => {
    const r = rng(v * 31 + 3);
    g.save(); g.filter = 'blur(3px)'; g.fillStyle = 'rgba(0,0,0,0.45)'; g.beginPath(); g.ellipse(0.53, 0.6, 0.48, 0.38, 0, 0, TAU); g.fill(); g.restore();
    // sinter terraces: pale mineral rings stained with iron
    for (let i = 0; i < 4; i++) {
      const rad = 0.47 - i * 0.07;
      g.beginPath(); for (let k = 0; k <= 20; k++) { const a = (k / 20) * TAU, j = 1 + (r() - 0.5) * 0.12; const px = 0.5 + Math.cos(a) * rad * j, py = 0.55 + Math.sin(a) * rad * 0.78 * j; k ? g.lineTo(px, py) : g.moveTo(px, py); } g.closePath();
      g.fillStyle = ['#5a4a3e', '#8a6a4a', '#b89a72', '#d8c8a4'][i]; g.fill();
      g.strokeStyle = i < 2 ? 'rgba(20,12,8,0.5)' : 'rgba(120,70,30,0.6)'; g.lineWidth = 0.015; g.stroke();
    }
    g.fillStyle = 'rgba(200,110,40,0.35)'; for (let i = 0; i < 6; i++) { g.beginPath(); g.ellipse(0.5 + (r() - 0.5) * 0.6, 0.55 + (r() - 0.5) * 0.45, 0.05, 0.03, r() * 3, 0, TAU); g.fill(); }
    g.fillStyle = 'rgba(255,250,235,0.5)'; g.beginPath(); g.ellipse(0.38, 0.38, 0.14, 0.05, -0.4, 0, TAU); g.fill();
    // throat: dark hole with a visible far wall
    g.fillStyle = '#081016'; g.beginPath(); g.ellipse(0.5, 0.56, 0.2, 0.15, 0, 0, TAU); g.fill();
    g.fillStyle = lg(g, 0, 0.41, 0, 0.6, [[0, '#4a3a30'], [1, 'rgba(8,16,22,0)']]); g.beginPath(); g.ellipse(0.5, 0.56, 0.2, 0.15, 0, Math.PI, TAU); g.fill();
    g.strokeStyle = 'rgba(255,245,220,0.55)'; g.lineWidth = 0.018; g.beginPath(); g.ellipse(0.5, 0.56, 0.2, 0.15, 0, 0.1, Math.PI - 0.1); g.stroke();
  });
}
function drawGeyser(r, ctx, t, x, y, T) {
  const ph = t.ph || 0, sp = r.reduced ? 0.35 : 1, cx = x + 0.5, cy = y + 0.56;
  const sd = (x * 13 + y * 7) % 11;
  ctx.save();
  if (ph === 2) { // warning: the plus that will be scalded next round
    const p = 0.5 + 0.5 * Math.sin(T * 8 * sp);
    for (const [dx, dy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const tx = x + dx, ty = y + dy; if (tx < 0 || ty < 0 || tx >= SIZE || ty >= SIZE || ringOf(tx, ty) < r.state.storm.ring) continue;
      ctx.globalAlpha = 0.14 + p * 0.14; ctx.fillStyle = '#7fe8ff'; ctx.fillRect(tx + 0.04, ty + 0.04, 0.92, 0.92);
      ctx.globalAlpha = 0.7 + p * 0.3; ctx.strokeStyle = '#c8fbff'; ctx.lineWidth = 0.045;
      const q = 0.22, a = tx + 0.08, b = ty + 0.08, c = tx + 0.92, d = ty + 0.92;
      ctx.beginPath(); ctx.moveTo(a, b + q); ctx.lineTo(a, b); ctx.lineTo(a + q, b); ctx.moveTo(c - q, b); ctx.lineTo(c, b); ctx.lineTo(c, b + q); ctx.moveTo(c, d - q); ctx.lineTo(c, d); ctx.lineTo(c - q, d); ctx.moveTo(a + q, d); ctx.lineTo(a, d); ctx.lineTo(a, d - q); ctx.stroke();
      if (dx || dy) { // outward chevron: the blast travels this way
        ctx.save(); ctx.translate(tx + 0.5, ty + 0.5); ctx.rotate(Math.atan2(dy, dx)); const o = ((T * 1.2 * sp) % 1) * 0.16;
        ctx.globalAlpha = 0.55 + p * 0.35; ctx.lineWidth = 0.06; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(-0.1 + o, -0.14); ctx.lineTo(0.04 + o, 0); ctx.lineTo(-0.1 + o, 0.14); ctx.stroke(); ctx.restore();
      }
    }
  }
  ctx.globalCompositeOperation = 'lighter';
  if (ph) dot(ctx, '#5fe0ff', cx, cy, ph === 2 ? 0.8 : 0.45, ph === 2 ? 0.35 + 0.15 * Math.sin(T * 9 * sp) : 0.16);
  ctx.globalCompositeOperation = 'source-over';
  // water in the throat: low and dark when spent, rising and glowing as pressure builds
  const shake = ph === 2 && !r.reduced ? Math.sin(T * 40) * 0.008 : 0;
  ctx.globalAlpha = 1;
  ctx.fillStyle = ph === 2 ? '#7feeff' : ph === 1 ? '#2f7f9a' : '#163845';
  ctx.beginPath(); ctx.ellipse(cx + shake, cy + (ph ? 0.01 : 0.04), ph === 2 ? 0.17 : 0.14, ph === 2 ? 0.12 : 0.09, 0, 0, TAU); ctx.fill();
  if (ph === 2) { ctx.fillStyle = '#e6fdff'; ctx.globalAlpha = 0.6 + 0.4 * Math.sin(T * 12 * sp); ctx.beginPath(); ctx.ellipse(cx + shake, cy, 0.07, 0.045, 0, 0, TAU); ctx.fill(); }
  // bubbles
  const nb = ph === 2 ? (r.lowQ ? 3 : 6) : ph === 1 ? (r.lowQ ? 1 : 3) : 1;
  for (let i = 0; i < nb; i++) {
    const k = (T * (ph === 2 ? 2.4 : ph === 1 ? 1.2 : 0.5) * sp + i / nb + sd * 0.13) % 1;
    const bx = cx + Math.sin(i * 2.3 + sd) * 0.1, by = cy + 0.03 - (ph === 2 ? k * 0.08 : 0), rad = (ph === 2 ? 0.045 : 0.03) * Math.sin(k * Math.PI);
    if (rad <= 0.002) continue;
    ctx.globalAlpha = ph ? 0.9 : 0.5; ctx.strokeStyle = ph === 2 ? '#ffffff' : '#9fd6e6'; ctx.lineWidth = 0.012;
    ctx.beginPath(); ctx.arc(bx, by, rad, 0, TAU); ctx.stroke();
  }
  // steam: a faint wisp when spent, plumes as it builds, a roaring jet when about to blow
  const ns = ph === 2 ? (r.lowQ ? 3 : 6) : ph === 1 ? (r.lowQ ? 1 : 3) : r.lowQ ? 0 : 1;
  const P = puff();
  for (let i = 0; i < ns; i++) {
    const k = (T * (ph === 2 ? 0.9 : 0.45) * sp + i / ns + sd * 0.07) % 1;
    const h = (ph === 2 ? 1.4 : ph === 1 ? 0.9 : 0.5) * k, sz = (ph === 2 ? 0.35 : 0.22) + k * (ph === 2 ? 0.55 : 0.35);
    const sx = cx + Math.sin(k * 5 + i * 1.7 + sd) * 0.12 * k;
    ctx.globalAlpha = (ph === 2 ? 0.75 : ph === 1 ? 0.45 : 0.22) * Math.sin(k * Math.PI);
    ctx.drawImage(P, sx - sz / 2, cy - 0.1 - h - sz / 2, sz, sz);
  }
  ctx.restore();
}

// ---------- conveyor belt ----------
const DIRS = { '1,0': 0, '0,1': 1, '-1,0': 2, '0,-1': 3 };
function beltSprite(dir, up, down) {
  return sprite(`belt${dir}${up ? 1 : 0}${down ? 1 : 0}`, 1, 1, 0, 0, (g) => {
    g.translate(0.5, 0.5); g.rotate(dir * Math.PI / 2); g.translate(-0.5, -0.5); // painted running +x
    g.fillStyle = '#17161c'; g.fillRect(0, 0, 1, 1);
    // belt bed
    g.fillStyle = lg(g, 0, 0.14, 0, 0.86, [[0, '#0e0d12'], [0.15, '#25232c'], [0.85, '#1f1d25'], [1, '#0b0a0e']]); g.fillRect(0, 0.15, 1, 0.7);
    // side rails with bolts
    for (const ry of [0, 0.85]) {
      g.fillStyle = lg(g, 0, ry, 0, ry + 0.15, [[0, '#8a8d98'], [0.35, '#5a5d68'], [1, '#2a2b32']]); g.fillRect(0, ry, 1, 0.15);
      g.fillStyle = 'rgba(255,255,255,0.35)'; g.fillRect(0, ry + 0.01, 1, 0.012);
      g.fillStyle = 'rgba(0,0,0,0.5)'; g.fillRect(0, ry + 0.135, 1, 0.015);
      for (const bx of [0.25, 0.75]) { g.fillStyle = '#2a2b32'; g.beginPath(); g.arc(bx, ry + 0.075, 0.03, 0, TAU); g.fill(); g.fillStyle = '#b8bcc8'; g.beginPath(); g.arc(bx - 0.008, ry + 0.067, 0.012, 0, TAU); g.fill(); }
    }
    // end rollers with hazard stripes where the line starts and stops
    const endCap = (x0, w) => {
      g.fillStyle = lg(g, 0, 0.15, 0, 0.85, [[0, '#3a3c44'], [0.5, '#9a9eaa'], [1, '#2a2b32']]); g.fillRect(x0, 0.15, w, 0.7);
      g.save(); g.beginPath(); g.rect(x0, 0, w, 0.15); g.rect(x0, 0.85, w, 0.15); g.clip();
      g.fillStyle = '#ffb000'; g.fillRect(x0, 0, w, 1); g.fillStyle = '#141414';
      for (let i = -2; i < 6; i++) { g.beginPath(); g.moveTo(x0 + i * 0.08, 0); g.lineTo(x0 + i * 0.08 + 0.04, 0); g.lineTo(x0 + i * 0.08 + 0.04 + 0.15, 1); g.lineTo(x0 + i * 0.08 + 0.15, 1); g.closePath(); g.fill(); }
      g.restore();
    };
    if (!up) endCap(0, 0.12);
    if (!down) endCap(0.88, 0.12);
    // inner shadow onto the belt from the rails
    g.fillStyle = 'rgba(0,0,0,0.45)'; g.fillRect(0, 0.15, 1, 0.04);
  });
}
function chevronStrip() {
  return sprite('chev', 2, 0.7, 0, 0, (g) => {
    for (let i = 0; i < 8; i++) { g.fillStyle = 'rgba(255,255,255,0.05)'; g.fillRect(i * 0.25, 0, 0.02, 0.7); } // belt slats
    g.lineCap = 'round'; g.lineJoin = 'round';
    for (let i = 0; i < 4; i++) {
      const c = i * 0.5 + 0.25;
      g.strokeStyle = 'rgba(0,0,0,0.6)'; g.lineWidth = 0.14; g.beginPath(); g.moveTo(c - 0.12, 0.13); g.lineTo(c + 0.08, 0.35); g.lineTo(c - 0.12, 0.57); g.stroke();
      g.strokeStyle = '#ffae2e'; g.lineWidth = 0.08; g.beginPath(); g.moveTo(c - 0.12, 0.13); g.lineTo(c + 0.08, 0.35); g.lineTo(c - 0.12, 0.57); g.stroke();
      g.strokeStyle = '#fff0b0'; g.lineWidth = 0.025; g.beginPath(); g.moveTo(c - 0.11, 0.15); g.lineTo(c + 0.06, 0.35); g.stroke();
    }
  });
}
function drawConveyor(r, ctx, t, x, y, T) {
  const dx = t.dx || 0, dy = t.dy || 0, hz = r.hz || {};
  const surge = hz.surge != null ? Math.max(0, 1 - (r.time - hz.surge) / 0.9) : 0;
  if (hz.bT !== T) { // belt phase advances once per frame; a surge speeds it up without jumping
    const dt = hz.bT == null ? 0 : Math.max(0, Math.min(0.1, T - hz.bT));
    hz.bph = ((hz.bph || 0) + dt * (r.reduced ? 0.18 : 0.55) * (1 + surge * 4)) % 0.5; hz.bT = T; r.hz = hz;
  }
  const off = hz.bph || 0;
  const S = chevronStrip();
  ctx.save(); ctx.translate(x + 0.5, y + 0.5); ctx.rotate(Math.atan2(dy, dx));
  ctx.globalAlpha = 0.85 + surge * 0.15;
  const k = PX; // source px per tile
  ctx.drawImage(S.c, (0.5 - off) * k, 0, k, 0.7 * k, -0.5, -0.35, 1, 0.7);
  if (surge > 0) { ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = surge * 0.5; ctx.drawImage(S.c, (0.5 - off) * k, 0, k, 0.7 * k, -0.5, -0.35, 1, 0.7); ctx.globalCompositeOperation = 'source-over'; }
  ctx.restore();
}

// ---------- crumbling floor and pits ----------
function crumbleSprite(hp, v) {
  return sprite(`crum${hp}${v}`, 1, 1, 0, 0, (g) => {
    const r = rng(v * 17 + 5), bad = hp <= 1;
    // seed points and plates
    const cx = 0.4 + r() * 0.2, cy = 0.4 + r() * 0.2;
    const spokes = []; const n = bad ? 6 : 4; for (let i = 0; i < n; i++) { const a = (i / n) * TAU + r() * 0.8; spokes.push(a); }
    const edge = (a) => { const c = Math.cos(a), s = Math.sin(a); const t = Math.min(c > 0 ? (1 - cx) / c : c < 0 ? -cx / c : 9, s > 0 ? (1 - cy) / s : s < 0 ? -cy / s : 9); return [cx + c * t, cy + s * t]; };
    const path = (a) => { const pts = [[cx, cy]]; const [ex, ey] = edge(a); for (let k = 1; k <= 4; k++) { const f = k / 4; pts.push([cx + (ex - cx) * f + (k < 4 ? (r() - 0.5) * 0.09 : 0), cy + (ey - cy) * f + (k < 4 ? (r() - 0.5) * 0.09 : 0)]); } return pts; };
    const paths = spokes.map(path);
    if (bad) { // sunken plates: alternate plates darkened and shifted
      for (let i = 0; i < n; i++) {
        if (i % 2) continue;
        const A = paths[i], B = paths[(i + 1) % n];
        g.beginPath(); g.moveTo(cx, cy); for (const p of A) g.lineTo(p[0], p[1]);
        const [ax, ay] = A[A.length - 1], [bx, by] = B[B.length - 1];
        const corners = [[0, 0], [1, 0], [1, 1], [0, 1]].filter(([qx, qy]) => { const a1 = Math.atan2(ay - cy, ax - cx), b1 = Math.atan2(by - cy, bx - cx), q = Math.atan2(qy - cy, qx - cx); let d1 = (q - a1 + TAU) % TAU, d2 = (b1 - a1 + TAU) % TAU; return d1 < d2; });
        corners.sort((p, q) => ((Math.atan2(p[1] - cy, p[0] - cx) - Math.atan2(ay - cy, ax - cx) + TAU) % TAU) - ((Math.atan2(q[1] - cy, q[0] - cx) - Math.atan2(ay - cy, ax - cx) + TAU) % TAU));
        for (const q of corners) g.lineTo(q[0], q[1]);
        for (let k = B.length - 1; k >= 0; k--) g.lineTo(B[k][0], B[k][1]);
        g.closePath(); g.fillStyle = 'rgba(0,0,0,0.3)'; g.fill();
      }
    }
    // cracks: dark gaps with a lit lower lip
    g.lineJoin = 'round'; g.lineCap = 'round';
    for (const P of paths) {
      g.beginPath(); P.forEach(([px, py], k) => (k ? g.lineTo(px, py) : g.moveTo(px, py)));
      g.save(); g.translate(0.012, 0.016); g.strokeStyle = 'rgba(255,240,210,0.3)'; g.lineWidth = bad ? 0.03 : 0.022; g.stroke(); g.restore();
      g.strokeStyle = 'rgba(0,0,0,0.92)'; g.lineWidth = bad ? 0.075 : 0.042; g.stroke();
      if (bad) { g.strokeStyle = 'rgba(255,150,70,0.75)'; g.lineWidth = 0.022; g.stroke(); }
      // side branches
      const m = P[2]; const a = Math.atan2(P[3][1] - P[1][1], P[3][0] - P[1][0]) + (r() < 0.5 ? 1 : -1) * (0.6 + r() * 0.5), l = bad ? 0.2 : 0.12;
      g.beginPath(); g.moveTo(m[0], m[1]); g.lineTo(m[0] + Math.cos(a) * l * 0.5 + (r() - 0.5) * 0.03, m[1] + Math.sin(a) * l * 0.5); g.lineTo(m[0] + Math.cos(a) * l, m[1] + Math.sin(a) * l);
      g.strokeStyle = 'rgba(0,0,0,0.7)'; g.lineWidth = bad ? 0.03 : 0.015; g.stroke();
    }
    if (bad) { // a hole at the impact point showing the depth below, and loose chips
      g.fillStyle = '#050308'; g.beginPath(); for (let k = 0; k < 7; k++) { const a = (k / 7) * TAU, rad = 0.07 + r() * 0.04; g.lineTo(cx + Math.cos(a) * rad, cy + Math.sin(a) * rad * 0.8); } g.closePath(); g.fill();
      g.strokeStyle = 'rgba(255,140,60,0.5)'; g.lineWidth = 0.012; g.stroke();
      for (let i = 0; i < 5; i++) { const px = 0.15 + r() * 0.7, py = 0.15 + r() * 0.7; g.fillStyle = 'rgba(190,170,140,0.55)'; g.fillRect(px, py, 0.03 + r() * 0.02, 0.02 + r() * 0.02); }
    }
  });
}
function pitSprite(m, v) { // m: bit 1 north, 2 east, 4 south, 8 west = neighbour is also a pit
  return sprite(`pit${m}${v}`, 1, 1.3, 0, 0, (g) => {
    const r = rng(m * 11 + v * 3 + 1);
    const N = !(m & 1), E = !(m & 2), S = !(m & 4), Wd = !(m & 8);
    const j = () => (r() - 0.5) * 0.05;
    const i0 = 0.05;
    // jagged hole outline (only open edges are jagged/inset)
    const pts = [];
    const xa = Wd ? i0 : -0.01, xb = E ? 1 - i0 : 1.01, ya = N ? i0 : -0.01, yb = S ? 1 - i0 : 1.01;
    for (let k = 0; k <= 6; k++) pts.push([xa + (xb - xa) * (k / 6), ya + (N && k && k < 6 ? j() : 0)]);
    for (let k = 1; k <= 6; k++) pts.push([xb + (E && k < 6 ? j() : 0), ya + (yb - ya) * (k / 6)]);
    for (let k = 5; k >= 0; k--) pts.push([xa + (xb - xa) * (k / 6), yb + (S && k ? j() : 0)]);
    for (let k = 5; k >= 1; k--) pts.push([xa + (Wd ? j() : 0), ya + (yb - ya) * (k / 6)]);
    g.save(); g.beginPath(); pts.forEach(([px, py], k) => (k ? g.lineTo(px, py) : g.moveTo(px, py))); g.closePath();
    g.fillStyle = '#030206'; g.fill(); g.clip();
    // faint glow far below
    const gr = g.createRadialGradient(0.5, 0.8, 0, 0.5, 0.8, 0.7); gr.addColorStop(0, 'rgba(110,40,120,0.5)'); gr.addColorStop(1, 'rgba(20,8,30,0)'); g.fillStyle = gr; g.fillRect(-0.1, -0.1, 1.2, 1.2);
    // far (north) wall face seen from the south, with strata
    if (N) {
      g.fillStyle = lg(g, 0, ya, 0, ya + 0.7, [[0, '#a89aa6'], [0.08, '#7a6c7a'], [0.5, '#4a3e4c'], [0.62, '#241c28'], [1, 'rgba(3,2,6,0)']]); g.fillRect(-0.1, ya - 0.05, 1.2, 0.76);
      g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(-0.1, ya + 0.42, 1.2, 0.03); // ledge where the wall drops away into the dark
      for (let k = 0; k < 4; k++) { const yy = ya + 0.07 + k * 0.085; g.globalAlpha = 1 - k * 0.2; g.strokeStyle = 'rgba(0,0,0,0.55)'; g.lineWidth = 0.014; const a1 = j(), a2 = j(), a3 = j(); g.beginPath(); g.moveTo(-0.05, yy + a1); g.lineTo(0.5, yy + a2); g.lineTo(1.05, yy + a3); g.stroke(); g.strokeStyle = 'rgba(255,235,220,0.12)'; g.lineWidth = 0.008; g.beginPath(); g.moveTo(-0.05, yy + a1 + 0.012); g.lineTo(0.5, yy + a2 + 0.012); g.lineTo(1.05, yy + a3 + 0.012); g.stroke(); }
      g.globalAlpha = 1; g.strokeStyle = 'rgba(0,0,0,0.5)'; for (let k = 0; k < 4; k++) { const xx = 0.1 + r() * 0.8; g.beginPath(); g.moveTo(xx, ya); g.lineTo(xx + j(), ya + 0.12 + r() * 0.15); g.stroke(); }
    }
    if (Wd) { g.fillStyle = lg(g, xa, 0, xa + 0.2, 0, [[0, 'rgba(110,98,112,0.9)'], [0.4, 'rgba(50,42,56,0.7)'], [1, 'rgba(3,2,6,0)']]); g.fillRect(xa - 0.02, -0.1, 0.22, 1.2); }
    if (E) { g.fillStyle = lg(g, xb, 0, xb - 0.12, 0, [[0, 'rgba(20,16,24,0.9)'], [1, 'rgba(3,2,6,0)']]); g.fillRect(xb - 0.12, -0.1, 0.14, 1.2); }
    if (S) { g.fillStyle = lg(g, 0, yb, 0, yb - 0.12, [[0, 'rgba(0,0,0,0.8)'], [1, 'rgba(0,0,0,0)']]); g.fillRect(-0.1, yb - 0.12, 1.2, 0.13); } // overhang shadow
    g.restore();
    // broken rim: lit lip on the near edge, dark rim stroke on the rest
    g.lineJoin = 'round';
    g.beginPath(); pts.forEach(([px, py], k) => (k ? g.lineTo(px, py) : g.moveTo(px, py))); g.closePath();
    g.strokeStyle = 'rgba(0,0,0,0.6)'; g.lineWidth = 0.03; g.stroke();
    if (S) { g.strokeStyle = 'rgba(255,235,200,0.55)'; g.lineWidth = 0.02; g.beginPath(); g.moveTo(xa, yb + 0.012); g.lineTo(xb, yb + 0.012); g.stroke(); }
    if (N) { g.strokeStyle = 'rgba(255,240,220,0.4)'; g.lineWidth = 0.016; g.beginPath(); g.moveTo(xa, ya - 0.008); g.lineTo(xb, ya - 0.008); g.stroke(); }
    if (Wd) { g.strokeStyle = 'rgba(255,240,220,0.25)'; g.lineWidth = 0.012; g.beginPath(); g.moveTo(xa - 0.008, ya); g.lineTo(xa - 0.008, yb); g.stroke(); }
    // rubble chips on the rim
    for (let k = 0; k < 4; k++) {
      const side = r(); let px, py;
      if (side < 0.25 && N) { px = r(); py = ya - 0.03; } else if (side < 0.5 && S) { px = r(); py = yb + 0.02; } else if (side < 0.75 && Wd) { px = xa - 0.03; py = r(); } else if (E) { px = xb + 0.01; py = r(); } else continue;
      g.fillStyle = 'rgba(120,110,105,0.7)'; g.fillRect(px, py, 0.035, 0.025); g.fillStyle = 'rgba(0,0,0,0.5)'; g.fillRect(px, py + 0.025, 0.035, 0.01);
    }
  });
}
function pitMask(s, x, y) { return (isT(s, x, y - 1, 'pit') ? 1 : 0) | (isT(s, x + 1, y, 'pit') ? 2 : 0) | (isT(s, x, y + 1, 'pit') ? 4 : 0) | (isT(s, x - 1, y, 'pit') ? 8 : 0); }
function drawPit(r, ctx, x, y, T) {
  const hz = r.hz || {};
  // the collapse: floor chunks tumble into the dark
  const F = hz.falls;
  if (F) for (let i = F.length - 1; i >= 0; i--) {
    const f = F[i]; if (f.x !== x || f.y !== y) continue;
    const k = (r.time - f.t0) / 1.2; if (k >= 1) { F.splice(i, 1); continue; } if (k < 0) continue;
    const rnd = rng(f.x * 31 + f.y * 7 + 3);
    for (let c = 0; c < (r.lowQ ? 4 : 7); c++) {
      const px = x + 0.15 + rnd() * 0.7, py = y + 0.15 + rnd() * 0.6, sz = 0.12 + rnd() * 0.16, del = rnd() * 0.25, kk = Math.max(0, Math.min(1, (k - del) / (1 - del)));
      const sc = 1 - kk * 0.85, fall = kk * kk * 0.5;
      ctx.globalAlpha = 1 - kk * 0.6; ctx.fillStyle = `rgb(${110 - kk * 90 | 0},${100 - kk * 82 | 0},${96 - kk * 76 | 0})`;
      ctx.save(); ctx.translate(px + (x + 0.5 - px) * kk * 0.5, py + fall); ctx.rotate(kk * (rnd() - 0.5) * 6); ctx.fillRect(-sz * sc / 2, -sz * sc / 2, sz * sc, sz * sc * 0.8); ctx.restore();
    }
    ctx.globalAlpha = 1;
  }
  if (r.lowQ || r.reduced) return;
  // dust motes drifting down into the depth
  const sd = (x * 7 + y * 13) % 9;
  for (let i = 0; i < 2; i++) {
    const k = (T * 0.35 + i * 0.5 + sd * 0.11) % 1;
    ctx.globalAlpha = 0.5 * Math.sin(k * Math.PI); ctx.fillStyle = '#b9a8c8';
    ctx.fillRect(x + 0.2 + ((sd * 3 + i * 5) % 7) / 10, y + 0.15 + k * 0.6, 0.02, 0.02);
  }
  ctx.globalAlpha = 1;
}

// ---------- bake: static art into the cached floor layer (world.js paintBoard) ----------
export function bake(r, ctx, live) {
  const s = r.state; if (!s) return;
  const ring = s.storm.ring;
  ctx.save();
  ctx.beginPath(); ctx.rect(ring, ring, SIZE - ring * 2, SIZE - ring * 2); ctx.clip();
  let throne = false;
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
    const t = s.tiles[y * SIZE + x], k = t.t; if (!TILES[k] || ringOf(x, y) < ring) continue;
    const vis = live ? r.tileVisible(x, y) : 1; if (vis <= 0) continue;
    ctx.globalAlpha = vis;
    if (k === 'throne') throne = true;
    else if (k === 'geyser') blit(ctx, ventSprite((x * 7 + y * 3) % 3), x, y);
    else if (k === 'conveyor') {
      const dx = t.dx || 0, dy = t.dy || 0, d = DIRS[dx + ',' + dy] || 0;
      const up = isT(s, x - dx, y - dy, 'conveyor') && s.tiles[(y - dy) * SIZE + x - dx].dx === dx && s.tiles[(y - dy) * SIZE + x - dx].dy === dy;
      const down = isT(s, x + dx, y + dy, 'conveyor') && s.tiles[(y + dy) * SIZE + x + dx].dx === dx && s.tiles[(y + dy) * SIZE + x + dx].dy === dy;
      blit(ctx, beltSprite(d, up, down), x, y);
    } else if (k === 'crumble') blit(ctx, crumbleSprite(t.hp <= 1 ? 1 : 2, (x * 5 + y * 3) % 3), x, y);
    else if (k === 'pit') blit(ctx, pitSprite(pitMask(s, x, y), (x + y * 3) % 2), x, y);
  }
  if (throne && s.hill) { ctx.globalAlpha = live ? r.tileVisible(HILL.x0 + 1, HILL.y0 + 1) : 1; if (ctx.globalAlpha > 0) blit(ctx, throneSprite(), HILL.x0, HILL.y0); }
  ctx.restore();
}
// cache key part for world.js solidsKey: changes whenever a baked hazard changes look
export function bakeKey(t, i) { return t.t === 'pit' ? i * 13 + 5 : t.t === 'crumble' ? i * 11 + (t.hp <= 1 ? 3 : 1) : 0; }

// ---------- per frame, from render.js's animated floor loop ----------
export function tile(r, ctx, t, x, y, T) {
  const s = r.state;
  if (t.t === 'throne') { if (!isT(s, x - 1, y, 'throne') && !isT(s, x, y - 1, 'throne')) drawThrone(r, ctx, T, x, y); }
  else if (t.t === 'geyser') drawGeyser(r, ctx, t, x, y, T);
  else if (t.t === 'conveyor') drawConveyor(r, ctx, t, x, y, T);
  else if (t.t === 'pit') drawPit(r, ctx, x, y, T);
  else if (t.t === 'crumble' && t.hp <= 1) { // ember glow in the gaps and loose grit trembling over a breaking tile
    ctx.globalCompositeOperation = 'lighter'; dot(ctx, '#ff8a3a', x + 0.5, y + 0.5, 0.55, 0.16 + 0.1 * Math.sin(T * (r.reduced ? 1.5 : 4) + x + y)); ctx.globalCompositeOperation = 'source-over';
    if (r.lowQ) { ctx.globalAlpha = 1; return; }
    const p = Math.pow(Math.max(0, Math.sin(T * 1.7 + x * 2 + y)), 8);
    if (p > 0.05) { ctx.globalAlpha = p * 0.6; ctx.fillStyle = '#d9cfb8'; for (let i = 0; i < 3; i++) ctx.fillRect(x + 0.3 + i * 0.17, y + 0.4 + ((i * 7) % 3) * 0.1 - p * 0.04, 0.025, 0.025); ctx.globalAlpha = 1; }
  }
  ctx.globalAlpha = 1;
}

// per-frame light glows (called from world.js drawLighting with 'lighter' compositing)
export function lights(r, ctx, T) {
  const s = r.state; if (!s) return;
  const sp = r.reduced ? 0.35 : 1;
  if (s.hill && isT(s, HILL.x0 + 1, HILL.y0 + 1, 'throne') && ringOf(HILL.x0 + 1, HILL.y0 + 1) >= s.storm.ring) {
    const st = hillState(s), col = st.contested ? '#ff4d6d' : st.holder ? st.holder.color || GOLD : GOLD;
    dot(ctx, col, HILL.x0 + 2, HILL.y0 + 2, 3.2, st.holder || st.contested ? 0.22 : 0.12);
    for (const [px, py] of [[0, 0], [4, 0], [0, 4], [4, 4]]) dot(ctx, '#ffa040', HILL.x0 + px, HILL.y0 + py - 0.4, 1.3, 0.2 + 0.04 * Math.sin(T * 9 * sp + px + py));
  }
  for (let i = 0; i < s.tiles.length; i++) {
    const t = s.tiles[i]; if (t.t !== 'geyser' || !t.ph) continue;
    const x = i % SIZE, y = (i / SIZE) | 0; if (ringOf(x, y) < s.storm.ring) continue;
    dot(ctx, '#6fe6ff', x + 0.5, y + 0.55, t.ph === 2 ? 1.8 : 1.1, t.ph === 2 ? 0.2 + 0.08 * Math.sin(T * 8 * sp) : 0.08);
  }
  ctx.globalAlpha = 1;
}

// ---------- events (render.js default branch, at playback time) ----------
export function event(r, e, at) {
  const hz = r.hz || (r.hz = {});
  if (e.e === 'hill' && e.phase === 'score') { const u = unitById(r.state, e.id); hz.pulse = { t0: r.time, col: (u && u.color) || GOLD }; r.light(HILL.x0 + 2, HILL.y0 + 2, (u && u.color) || GOLD, 3.6, 0.9, 0.9); }
  else if (e.e === 'hill' && e.phase === 'contested') hz.pulse = { t0: r.time, col: '#ff4d6d' };
  if (e.e !== 'hazard') return;
  if (e.kind === 'geyser' && e.phase === 'erupt') {
    (hz.erupts ||= []);
    for (const c of e.centers || []) { hz.erupts.push({ x: c.x, y: c.y, t0: r.time }); r.light(c.x + 0.5, c.y + 0.5, '#bff6ff', 3, 1.0, 1); }
    if (hz.erupts.length > 8) hz.erupts.splice(0, hz.erupts.length - 8);
  } else if (e.kind === 'crumble' && e.phase === 'collapse') { (hz.falls ||= []).push({ x: e.x, y: e.y, t0: r.time }); if (hz.falls.length > 8) hz.falls.shift(); }
  else if (e.kind === 'conveyor') hz.surge = r.time;
  else if (e.kind === 'rift' && e.from && e.to) { (hz.rifts ||= []).push({ a: e.from, b: e.to, t0: r.time }); if (hz.rifts.length > 3) hz.rifts.shift(); r.light(e.from.x + 0.5, e.from.y + 0.5, '#c77dff', 2.4, 1.2); r.light(e.to.x + 0.5, e.to.y + 0.5, '#3dfff0', 2.4, 1.2); }
  void at;
}

function drawErupt(r, ctx, f, T) {
  const k = (r.time - f.t0) / 1.6; if (k < 0 || k >= 1) return k >= 1;
  const cx = f.x + 0.5, base = f.y + 0.56, grow = Math.min(1, k / 0.12), fade = k > 0.55 ? 1 - (k - 0.55) / 0.45 : 1;
  const H = 3.6 * grow, wB = 0.5, wT = 1.05;
  ctx.save();
  // water jet body
  const gr = ctx.createLinearGradient(0, base, 0, base - H);
  gr.addColorStop(0, `rgba(235,252,255,${0.95 * fade})`); gr.addColorStop(0.5, `rgba(200,240,255,${0.7 * fade})`); gr.addColorStop(1, 'rgba(220,245,255,0)');
  ctx.fillStyle = gr;
  const wob = r.reduced ? 0 : Math.sin(T * 30) * 0.03;
  ctx.beginPath(); ctx.moveTo(cx - wB * 0.5, base); ctx.quadraticCurveTo(cx - wT * 0.4 + wob, base - H * 0.5, cx - wT * 0.5, base - H); ctx.lineTo(cx + wT * 0.5, base - H); ctx.quadraticCurveTo(cx + wT * 0.4 - wob, base - H * 0.5, cx + wB * 0.5, base); ctx.closePath(); ctx.fill();
  ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.6 * fade; ctx.fillStyle = '#ffffff'; ctx.fillRect(cx - 0.06, base - H * 0.9, 0.12, H * 0.9); ctx.globalCompositeOperation = 'source-over';
  // billowing steam along and around the column
  const P = puff(), n = r.lowQ ? 6 : 12;
  for (let i = 0; i < n; i++) {
    const q = (i / n + k * 1.4) % 1, h = q * H * 1.1, sz = 0.6 + q * 1.2;
    const sx = cx + Math.sin(i * 2.7) * (0.15 + q * 0.5);
    ctx.globalAlpha = fade * 0.8 * Math.sin(q * Math.PI) * grow; ctx.drawImage(P, sx - sz / 2, base - h - sz / 2, sz, sz);
  }
  // splash ring at the foot
  const kr = Math.min(1, k * 2.2);
  ctx.globalAlpha = (1 - kr) * 0.8; ctx.strokeStyle = '#e6fdff'; ctx.lineWidth = 0.06;
  ctx.beginPath(); ctx.ellipse(cx, base + 0.1, 0.3 + kr * 1.1, (0.3 + kr * 1.1) * 0.45, 0, 0, TAU); ctx.stroke();
  ctx.restore();
  return false;
}
function drawRift(r, ctx, f, T) {
  const k = (r.time - f.t0) / 1.8; if (k < 0 || k >= 1) return k >= 1;
  const ax = f.a.x + 0.5, ay = f.a.y + 0.45, bx = f.b.x + 0.5, by = f.b.y + 0.45;
  const L = Math.hypot(bx - ax, by - ay) || 1, nx = -(by - ay) / L, ny = (bx - ax) / L;
  const open = Math.min(1, k / 0.18), fade = k > 0.7 ? 1 - (k - 0.7) / 0.3 : 1, A = open * fade;
  const sp = r.reduced ? 0.3 : 1, seg = Math.max(8, Math.min(26, Math.round(L * 3)));
  const pts = (amp, ph) => { const o = []; for (let i = 0; i <= seg; i++) { const q = i / seg, env = Math.sin(q * Math.PI); const w = (Math.sin(q * 9 + T * 7 * sp + ph) * 0.6 + Math.sin(q * 23 - T * 11 * sp + ph * 2) * 0.4) * amp * env; o.push([ax + (bx - ax) * q * open + nx * w, ay + (by - ay) * q * open + ny * w]); } return o; };
  const stroke = (P, col, w, a) => { ctx.globalAlpha = a * A; ctx.strokeStyle = col; ctx.lineWidth = w; ctx.beginPath(); P.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.stroke(); };
  ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  // the tear: a lens-shaped wound in space, dark violet inside, edged in violet and cyan light
  const mid = pts(0.16, 0), wob = r.reduced ? 0 : 1;
  const half = (i) => { const q = i / seg; return (0.07 + 0.26 * Math.pow(Math.sin(q * Math.PI), 0.7)) * open * (0.85 + 0.15 * Math.sin(T * 9 * wob + q * 13)); };
  const top = [], bot = [];
  for (let i = 0; i <= seg; i++) { const [x, y] = mid[i], h = half(i), jt = wob * Math.sin(i * 7.3 + T * 14) * 0.03; top.push([x + nx * (h + jt), y + ny * (h + jt)]); bot.push([x - nx * (h - jt), y - ny * (h - jt)]); }
  const lens = () => { ctx.beginPath(); top.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); for (let i = bot.length - 1; i >= 0; i--) ctx.lineTo(bot[i][0], bot[i][1]); ctx.closePath(); };
  ctx.globalCompositeOperation = 'lighter';
  if (!r.lowQ) { ctx.globalAlpha = 0.35 * A; ctx.strokeStyle = '#7a2cff'; ctx.lineWidth = 0.45; lens(); ctx.stroke(); }
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 0.92 * A; ctx.fillStyle = '#0c0218'; lens(); ctx.fill();
  // swirling energy inside the tear
  ctx.globalCompositeOperation = 'lighter';
  ctx.save(); lens(); ctx.clip();
  for (let k = 0; k < (r.lowQ ? 2 : 4); k++) stroke(pts(0.12 + k * 0.03, k * 1.9 + T * 3 * wob), k % 2 ? '#3dfff0' : '#b066ff', 0.035, 0.55);
  ctx.restore();
  stroke(top, '#d9b3ff', 0.045, 0.95); stroke(bot, '#7ffcff', 0.045, 0.95);
  if (!r.lowQ) { stroke(top, '#c77dff', 0.12, 0.35); stroke(bot, '#3dfff0', 0.12, 0.35); }
  // sparks drifting off the edges
  if (!r.lowQ) for (let i = 0; i < 10; i++) { const q = ((i * 0.137 + k * 0.6) % 1), j = Math.round(q * seg), side = i % 2 ? top : bot, [x, y] = side[j], d = ((k * 3 + i * 0.31) % 1) * 0.35 * (i % 2 ? 1 : -1); ctx.globalAlpha = A * (1 - Math.abs(d) / 0.35); ctx.fillStyle = i % 2 ? '#e6c8ff' : '#bffcff'; ctx.fillRect(x + nx * d - 0.02, y + ny * d - 0.02, 0.04, 0.04); }
  // vortices at both ends, spinning opposite ways
  for (const [x, y, dir, col] of [[ax, ay, 1, '#c77dff'], [bx, by, -1, '#3dfff0']]) {
    dot(ctx, col, x, y, 1.0, 0.5 * A);
    ctx.save(); ctx.translate(x, y); ctx.scale(1, 0.6); ctx.rotate(T * 5 * sp * dir);
    ctx.strokeStyle = col; ctx.lineWidth = 0.05;
    for (let i = 0; i < 3; i++) { ctx.globalAlpha = A * (0.9 - i * 0.2); ctx.beginPath(); ctx.arc(0, 0, 0.25 + i * 0.13, i * 2.1, i * 2.1 + 3.6 - i * 0.6); ctx.stroke(); }
    ctx.restore();
  }
  ctx.globalCompositeOperation = 'source-over';
  for (const [x, y] of [[ax, ay], [bx, by]]) { ctx.globalAlpha = 0.85 * A; ctx.fillStyle = '#0a0214'; ctx.beginPath(); ctx.ellipse(x, y, 0.13 * open, 0.08 * open, 0, 0, TAU); ctx.fill(); }
  ctx.restore();
  return false;
}

// Unit states and screen-wide effects, drawn after the units inside the world transform.
export function overlay(r, ctx, s, T) {
  const hz = r.hz;
  if (hz) {
    if (hz.erupts) for (let i = hz.erupts.length - 1; i >= 0; i--) if (drawErupt(r, ctx, hz.erupts[i], T)) hz.erupts.splice(i, 1);
    if (hz.rifts) for (let i = hz.rifts.length - 1; i >= 0; i--) if (drawRift(r, ctx, hz.rifts[i], T)) hz.rifts.splice(i, 1);
    ctx.globalAlpha = 1;
  }
  for (const u of s.units) {
    if (!u.alive) continue;
    const d = r.disp && r.disp.get(u.id); if (!d) continue;
    const cx = d.x + 0.5, base = d.y + 0.86;
    if (d.how === 'conveyor' && !r.lowQ) { // riding the belt: speed lines trail behind the piece
      const k = (r.time - d.t0) / Math.max(0.05, d.dur);
      if (k >= 0 && k < 1.4) {
        const vx = d.tx - d.sx, vy = d.ty - d.sy, a = (1 - Math.max(0, k - 0.4)) * 0.7;
        ctx.strokeStyle = '#ffd08a'; ctx.lineWidth = 0.035; ctx.lineCap = 'round';
        for (let i = 0; i < 3; i++) { const o = (i - 1) * 0.16, px = -vy * o, py = vx * o; ctx.globalAlpha = a * (1 - Math.abs(i - 1) * 0.35); ctx.beginPath(); ctx.moveTo(cx + px - vx * 0.25, base - 0.3 + py - vy * 0.25); ctx.lineTo(cx + px - vx * 0.65, base - 0.3 + py - vy * 0.65); ctx.stroke(); }
        ctx.globalAlpha = 1; ctx.lineCap = 'butt';
      }
    }
    if (u.role && ROLES[u.role] && !u.boss) { ctx.strokeStyle = ROLES[u.role].color; ctx.lineWidth = 0.05; ctx.beginPath(); ctx.ellipse(cx, base, 0.36, 0.13, 0, 0, Math.PI * 2); ctx.stroke(); }
    if (u.role === 'regent') { ctx.strokeStyle = 'rgba(90,255,200,0.7)'; ctx.lineWidth = 0.06; ctx.beginPath(); ctx.ellipse(cx, base, 0.6, 0.2, 0, 0, Math.PI * 2); ctx.stroke(); }
    if (u.shield > 0) {
      const f = Math.max(0.2, u.shield / (u.shieldMax || u.shield));
      ctx.strokeStyle = `rgba(150,200,255,${0.35 + 0.5 * f})`; ctx.lineWidth = 0.05 + 0.04 * f;
      ctx.beginPath(); ctx.arc(cx, d.y + 0.35, 0.5, Math.PI * 1.05, Math.PI * 1.95); ctx.stroke();
    }
    if (s.bounty && s.bounty.id === u.id) {
      const y = d.y - 0.45 + Math.sin(T * 3) * 0.05;
      ctx.save(); ctx.translate(cx, y); ctx.rotate(T * 1.2);
      ctx.strokeStyle = '#ffd24d'; ctx.lineWidth = 0.05; ctx.beginPath(); ctx.arc(0, 0, 0.16, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); for (let i = 0; i < 4; i++) { const a = (i * Math.PI) / 2; ctx.moveTo(Math.cos(a) * 0.1, Math.sin(a) * 0.1); ctx.lineTo(Math.cos(a) * 0.27, Math.sin(a) * 0.27); } ctx.stroke();
      ctx.restore();
    }
    if (u.braced) { ctx.strokeStyle = 'rgba(200,220,255,0.6)'; ctx.lineWidth = 0.04; ctx.beginPath(); ctx.ellipse(cx, base, 0.42, 0.16, 0, 0, Math.PI * 2); ctx.stroke(); }
  }
  if (s.eclipse) { // darkness everywhere except a sight radius of about 4 tiles around my piece
    const me = r.viewer && r.viewer();
    const d = me && me.alive && r.disp.get(me.id);
    if (d) {
      const g = ctx.createRadialGradient(d.x + 0.5, d.y + 0.5, 3.6, d.x + 0.5, d.y + 0.5, 4.8);
      g.addColorStop(0, 'rgba(6,3,14,0)'); g.addColorStop(1, 'rgba(6,3,14,0.9)');
      ctx.fillStyle = g;
    } else ctx.fillStyle = 'rgba(6,3,14,0.45)';
    ctx.fillRect(-4, -4, 24, 24);
  }
}
