// World-space effects system (1 unit = 1 tile). Shared by the board renderer and armory previews.
import { drawPiece, skinOf } from './pieces.js';

const SPR = 80; // sprite pixels per tile
const spriteCache = new Map();
export function pieceSprite(piece, skin, tint = null) {
  const key = piece + '|' + skin + '|' + tint;
  if (spriteCache.has(key)) return spriteCache.get(key);
  const c = document.createElement('canvas');
  c.width = 96; c.height = 120;
  const x = c.getContext('2d');
  x.translate(48, 112); x.scale(SPR * 0.92, SPR * 0.92);
  drawPiece(x, piece, skin, {});
  if (tint) {
    x.setTransform(1, 0, 0, 1, 0, 0);
    x.globalCompositeOperation = 'source-atop';
    if (tint === 'gold') { const g = x.createLinearGradient(0, 0, 96, 120); g.addColorStop(0, 'rgba(255,240,170,0.85)'); g.addColorStop(0.5, 'rgba(230,170,40,0.85)'); g.addColorStop(1, 'rgba(120,70,10,0.9)'); x.fillStyle = g; }
    else if (tint === 'ash') x.fillStyle = 'rgba(30,20,18,0.85)';
    else if (tint === 'white') x.fillStyle = 'rgba(255,255,255,1)';
    else x.fillStyle = tint;
    x.fillRect(0, 0, 96, 120);
  }
  spriteCache.set(key, c);
  return c;
}

// High-res static sprites for the board renderer (160 px per tile).
const hiCache = new Map();
export function hiSprite(piece, skin, tint = null) {
  const key = piece + '|' + skin + '|' + tint;
  let c = hiCache.get(key); if (c) return c;
  c = document.createElement('canvas'); c.width = 192; c.height = 240;
  const x = c.getContext('2d');
  x.translate(96, 224); x.scale(160, 160);
  drawPiece(x, piece, skin, {});
  if (tint) { x.setTransform(1, 0, 0, 1, 0, 0); x.globalCompositeOperation = 'source-atop'; x.fillStyle = tint === 'white' ? '#ffffff' : tint; x.fillRect(0, 0, 192, 240); }
  hiCache.set(key, c);
  return c;
}
const rnd = (a, b) => a + Math.random() * (b - a);
// cached gradient sprites (no per-frame gradient objects)
const SHOCK = new Map(), PILLAR = new Map();
function shockSprite(color) {
  let c = SHOCK.get(color); if (c) return c;
  c = document.createElement('canvas'); c.width = c.height = 128; const x = c.getContext('2d');
  const g = x.createRadialGradient(64, 64, 32, 64, 64, 64); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(0.8, color); g.addColorStop(1, 'rgba(0,0,0,0)');
  x.fillStyle = g; x.fillRect(0, 0, 128, 128); if (SHOCK.size > 64) SHOCK.clear(); SHOCK.set(color, c); return c;
}
function pillarSprite(color) {
  let c = PILLAR.get(color); if (c) return c;
  c = document.createElement('canvas'); c.width = 4; c.height = 256; const x = c.getContext('2d');
  const g = x.createLinearGradient(0, 0, 0, 256); g.addColorStop(0, color + '00'); g.addColorStop(0.7, color + 'cc'); g.addColorStop(1, '#ffffff');
  x.fillStyle = g; x.fillRect(0, 0, 4, 256); if (PILLAR.size > 64) PILLAR.clear(); PILLAR.set(color, c); return c;
}

export class FX {
  constructor() { this.reset(); }
  reset() {
    this.parts = []; this.shards = []; this.rings = []; this.beams = []; this.bolts = []; this.flashes = [];
    this.meteors = []; this.fireworks = []; this.shocks = []; this.falls = []; this.pillars = []; this.decals = []; this.slashes = []; this.projs = []; this.implodes = []; this.glyphs = []; this.thrusts = [];
    this.screenFlash = 0; this.flashColor = '#ffffff'; this.time = 0; this.pending = []; this.crowns = [];
  }
  after(t, fn) { this.pending.push({ at: this.time + t, fn }); }

  // ---------- primitives ----------
  burst(x, y, color, n, sp, kind = 'spark', extra = {}) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, v = (0.35 + Math.random()) * sp;
      this.parts.push({
        x, y, vx: Math.cos(a) * v, vy: kind === 'up' || kind === 'fire' ? -Math.random() * sp - 0.4 : Math.sin(a) * v - (kind === 'chunk' || kind === 'coin' ? 2.4 : 0.5),
        g: kind === 'up' ? -0.4 : kind === 'fire' ? -1.2 : kind === 'chunk' || kind === 'coin' ? 9 : kind === 'dust' ? 0.3 : 2.6,
        life: (kind === 'fire' ? 0.5 : 0.35) + Math.random() * 0.55, t: 0, color,
        size: kind === 'chunk' ? rnd(0.06, 0.13) : kind === 'dust' ? rnd(0.08, 0.14) : kind === 'fire' ? rnd(0.06, 0.12) : kind === 'coin' ? rnd(0.045, 0.07) : rnd(0.03, 0.065),
        kind, rot: Math.random() * 6, vr: rnd(-12, 12), floor: kind === 'coin' || kind === 'chunk' ? y + rnd(0.15, 0.35) : null, ...extra,
      });
    }
  }
  ring(x, y, color, r = 1.5, life = 0.6, w = 0.08, delay = 0) { this.rings.push({ x, y, color, r, life, w, t: -delay }); }
  shock(x, y, color, r = 1.2, life = 0.35) { this.shocks.push({ x, y, color, r, life, t: 0 }); }
  flashTile(x, y, color, life = 0.45, delay = 0) { this.flashes.push({ x, y, color, life, t: -delay }); }
  beam(a, b, color, w = 0.3, life = 0.4) { this.beams.push({ a, b, color, w, life, t: 0 }); }
  pillar(x, y, color, w = 0.7, life = 1.0, h = 7) { this.pillars.push({ x, y, color, w, life, h, t: 0 }); }
  slash(x, y, color, ang = -0.6, r = 0.45, life = 0.28) { this.slashes.push({ x, y, color, ang, r, life, t: 0 }); }
  glyph(x, y, color, kind, life = 0.9) { this.glyphs.push({ x, y, color, kind, life, t: 0 }); }
  proj(a, b, color, life = 0.26) { this.projs.push({ a, b, color, life, t: 0 }); }
  // spear streak from a to b (world units): shoots out fast, lingers, fades
  thrust(a, b, color, w = 0.16, life = 0.32) { this.thrusts.push({ a, b, color, w, life, t: 0 }); }
  // particles that flow from a to b along a wavy path (drain / lifesteal streams)
  stream(a, b, color, n = 14, life = 0.5, spread = 0.35) {
    for (let i = 0; i < n; i++) this.parts.push({ kind: 'seek', ax: a.x, ay: a.y, bx: b.x, by: b.y, x: a.x, y: a.y, off: rnd(-spread, spread), ph: rnd(0, 6.28), t: -i * (life / n) * 0.9, life, color, size: rnd(0.035, 0.06), vx: 0, vy: 0, g: 0 });
  }
  flash(a = 0.6, color = '#ffffff') { this.screenFlash = Math.max(this.screenFlash, a); this.flashColor = color; }
  bolt(x, y, color = '#cfe8ff') {
    const pts = [[x, y - 9]]; let cx = x;
    for (let yy = y - 9; yy < y; yy += 0.55) { cx += rnd(-0.35, 0.35); pts.push([cx, yy]); }
    pts.push([x, y]);
    this.bolts.push({ pts, color, life: 0.45, t: 0 });
  }
  fallTile(x, y, color, delay) { this.falls.push({ x, y, color, delay, t: -delay, life: 0.9, rot: rnd(-1, 1) }); }
  meteor(x, y, delay = 0, color = '#ff8a3d', onHit = null) { this.meteors.push({ x, y, t: -delay, life: 0.5, color, onHit, done: false }); }
  firework(x, y, color) {
    this.ring(x, y, color, 3.5, 0.8, 0.06);
    for (let i = 0; i < 40; i++) { const a = (i / 40) * Math.PI * 2, v = 2.5 + Math.random() * 1.5; this.parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, g: 1.6, life: 0.9 + Math.random() * 0.4, t: 0, color: i % 3 ? color : '#ffffff', size: 0.04, kind: 'spark', rot: 0, vr: 0 }); }
  }
  decal(x, y, color, r = 0.45, life = 8) { this.decals.push({ x, y, color, r, life, t: 0 }); }

  shatterSprite(img, x, y, power = 1, opts = {}) {
    // x,y = base centre in world units
    const cols = 4, rows = 5, w = img.width / cols, h = img.height / rows;
    const scale = 1 / SPR;
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const px = x + (c * w - 48 + w / 2) * scale, py = y + (r * h - 112 + h / 2) * scale;
      const dx = px - x, dy = py - (y - 0.5);
      this.shards.push({
        img, sx: c * w, sy: r * h, sw: w, sh: h, x: px, y: py,
        vx: dx * rnd(3, 6) * power + rnd(-0.5, 0.5), vy: dy * rnd(2, 4) * power - rnd(1.5, 3.5) * power,
        rot: 0, vr: rnd(-9, 9) * power, life: opts.life || rnd(0.7, 1.1), t: -(opts.delay || 0), g: opts.g ?? 8, floor: y + rnd(0.05, 0.3), scale,
      });
    }
  }

  // ---------- finishers ----------
  finisher(kind, x, y, piece, skin, glow) {
    const base = pieceSprite(piece, skin);
    switch (kind) {
      case 'inferno':
        this.pillar(x, y, '#ff6a1f', 0.9, 0.9, 6);
        this.flash(0.25, '#ff7a2a');
        this.shatterSprite(pieceSprite(piece, skin, 'ash'), x, y, 0.6, { delay: 0.25, life: 0.9 });
        for (let i = 0; i < 4; i++) this.after(i * 0.08, () => this.burst(x, y - 0.3, ['#fff2a8', '#ffb43d', '#ff6a1f', '#c2260a'][i], 18, 2.2, 'fire'));
        this.after(0.3, () => { this.burst(x, y - 0.2, '#3a2a24', 20, 1.2, 'dust'); this.decal(x, y - 0.1, 'rgba(20,10,6,0.75)', 0.48); });
        this.ring(x, y, '#ff8a3d', 2.4, 0.7);
        break;
      case 'lightning':
        this.bolt(x, y - 0.1); this.after(0.06, () => this.bolt(x + rnd(-0.2, 0.2), y - 0.1, '#ffffff'));
        this.flash(0.75, '#e8f4ff');
        this.shatterSprite(base, x, y, 1.3);
        this.burst(x, y - 0.4, '#bfe4ff', 34, 5);
        this.ring(x, y, '#9fd4ff', 3, 0.6, 0.1);
        this.decal(x, y - 0.1, 'rgba(10,14,30,0.6)', 0.4);
        break;
      case 'voidrift':
        this.implodes.push({ img: base, x, y, t: 0, life: 0.55 });
        for (let i = 0; i < 40; i++) { const a = Math.random() * 6.28, r = rnd(0.8, 1.8); this.parts.push({ x: x + Math.cos(a) * r, y: y - 0.5 + Math.sin(a) * r * 0.6, kind: 'spiral', cx: x, cy: y - 0.5, a, r, life: 0.55, t: 0, color: i % 2 ? '#b04dff' : '#e6c8ff', size: rnd(0.03, 0.06), vx: 0, vy: 0, g: 0 }); }
        this.after(0.55, () => { this.flash(0.4, '#c99bff'); this.ring(x, y - 0.3, '#b04dff', 3.2, 0.7, 0.14); this.burst(x, y - 0.5, '#d6a6ff', 30, 6); this.shock(x, y - 0.4, 'rgba(176,77,255,0.5)', 1.6, 0.4); });
        break;
      case 'midas':
        this.implodes.push({ img: pieceSprite(piece, skin, 'gold'), x, y, t: 0, life: 0.4, hold: true });
        this.after(0.08, () => this.burst(x, y - 0.5, '#fff1b0', 16, 1.4, 'up'));
        this.after(0.4, () => {
          this.shatterSprite(pieceSprite(piece, skin, 'gold'), x, y, 0.8);
          this.burst(x, y - 0.4, '#ffd24d', 30, 3, 'coin'); this.burst(x, y - 0.4, '#fff6d0', 20, 4);
          this.ring(x, y, '#ffd24d', 2.4, 0.6); this.flash(0.25, '#ffe7a0');
        });
        break;
      case 'coronation': {
        this.crowns = this.crowns || [];
        this.crowns.push({ x, y: y - 1.0, t: 0, life: 0.45 });
        this.after(0.45, () => {
          this.flash(0.6, '#fff1c4'); this.pillar(x, y, '#ffd24d', 1.2, 1.2, 8);
          this.shatterSprite(pieceSprite(piece, skin, 'gold'), x, y, 1.2);
          this.burst(x, y - 0.4, '#ffd24d', 40, 5, 'coin'); this.burst(x, y - 0.5, '#fff6d0', 30, 6);
          this.ring(x, y, '#ffd24d', 4, 0.8, 0.16); this.ring(x, y, '#ffffff', 2.6, 0.6, 0.1, 0.1);
          this.shock(x, y - 0.3, 'rgba(255,220,120,0.55)', 2.2, 0.45); this.impactKick = (this.impactKick || 0) + 10;
        });
        break;
      }
      case 'confetti': {
        const cols = ['#ff4d6d', '#ffd24d', '#5cff9d', '#4dabff', '#c77dff', '#ffffff'];
        this.shatterSprite(base, x, y, 0.9);
        for (let i = 0; i < 70; i++) { const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.2, v = 3 + Math.random() * 4; this.parts.push({ x, y: y - 0.5, vx: Math.cos(a) * v, vy: Math.sin(a) * v, g: 5, life: 1 + Math.random() * 0.6, t: 0, color: cols[i % cols.length], size: 0.06, kind: 'chunk', rot: Math.random() * 6, vr: (Math.random() - 0.5) * 20, floor: y + 0.2 }); }
        this.ring(x, y, '#ffd24d', 2.2, 0.5); this.flash(0.2, '#fff6d0');
        break;
      }
      case 'frozen':
        this.implodes.push({ img: pieceSprite(piece, skin, 'rgba(170,230,255,0.85)'), x, y, t: 0, life: 0.45, hold: true });
        this.after(0.05, () => { this.burst(x, y - 0.5, '#e8fbff', 20, 1.5, 'up'); this.ring(x, y, '#9df3ff', 1.6, 0.4); });
        this.after(0.45, () => {
          this.shatterSprite(pieceSprite(piece, skin, 'rgba(170,230,255,0.85)'), x, y, 1.3);
          this.burst(x, y - 0.4, '#d8fbff', 34, 5, 'chunk'); this.burst(x, y - 0.4, '#ffffff', 26, 6);
          this.ring(x, y, '#9df3ff', 3, 0.6, 0.12); this.flash(0.35, '#e8fbff'); this.decal(x, y - 0.1, 'rgba(180,230,255,0.35)', 0.55);
        });
        break;
      case 'ascend':
        this.pillar(x, y, '#fff6d0', 1, 1.4, 9);
        this.implodes.push({ img: pieceSprite(piece, skin, 'white'), x, y, t: 0, life: 1.1, rise: true });
        for (let i = 0; i < 6; i++) this.after(i * 0.12, () => this.burst(x, y - 0.5 - i * 0.3, '#fff6d0', 10, 1.2, 'up'));
        this.after(0.9, () => { this.flash(0.45, '#fffbe6'); this.ring(x, y - 2.5, '#ffe9a8', 3, 0.7, 0.1); this.burst(x, y - 2.6, '#ffffff', 40, 4); });
        break;
      case 'starfall':
        this.meteor(x, y - 0.3, 0, '#9df3ff', () => {
          this.flash(0.5, '#d8f6ff'); this.shatterSprite(base, x, y, 1.4);
          this.burst(x, y - 0.3, '#d8f6ff', 30, 5); this.burst(x, y - 0.3, '#ffe9a8', 20, 4, 'up');
          this.ring(x, y, '#9df3ff', 3.4, 0.7, 0.12); this.shock(x, y - 0.2, 'rgba(157,243,255,0.5)', 1.8, 0.4);
          this.decal(x, y - 0.1, 'rgba(10,14,40,0.7)', 0.5);
        });
        break;
      case 'soulfire': { // violet soulflame swallows the piece and carries it skyward
        const vio = pieceSprite(piece, skin, 'rgba(150,70,255,0.8)');
        this.implodes.push({ img: vio, x, y, t: 0, life: 0.35, hold: true });
        for (let i = 0; i < 5; i++) this.after(i * 0.07, () => this.burst(x + rnd(-0.15, 0.15), y - 0.2 - i * 0.12, ['#f3e6ff', '#c99bff', '#a05cff', '#7a2cff', '#3a1060'][i], 16, 2, 'fire', { c0: '#f3e6ff', c1: '#2a0a4a' }));
        this.ring(x, y, '#b06bff', 2.4, 0.6, 0.1);
        this.after(0.35, () => {
          this.implodes.push({ img: vio, x, y, t: 0, life: 1.0, rise: true });
          this.pillar(x, y, '#a05cff', 0.9, 1.2, 9); this.flash(0.35, '#c99bff');
          for (let i = 0; i < 30; i++) { const a = Math.random() * 6.28; this.parts.push({ x: x + Math.cos(a) * 0.3, y: y - 0.3, vx: Math.cos(a) * 0.5, vy: -rnd(2, 5), g: -1, life: rnd(0.6, 1.1), t: 0, color: i % 3 ? '#b06bff' : '#f3e6ff', size: rnd(0.04, 0.08), kind: 'fire', rot: 0, vr: 0, c0: '#f3e6ff', c1: '#2a0a4a' }); }
          this.decal(x, y - 0.1, 'rgba(60,20,110,0.45)', 0.5);
        });
        this.after(1.0, () => { this.burst(x, y - 3, '#e6c8ff', 30, 3); this.ring(x, y - 3, '#c99bff', 2.6, 0.6, 0.08); });
        break;
      }
      default: // shatter
        this.shatterSprite(base, x, y, 1.1);
        this.shatterSprite(pieceSprite(piece, skin, 'white'), x, y, 0.4, { life: 0.25 });
        this.burst(x, y - 0.5, '#ffffff', 26, 5);
        this.burst(x, y - 0.5, glow, 22, 4);
        this.ring(x, y, '#ffffff', 2.2, 0.6);
        this.shock(x, y - 0.4, 'rgba(255,255,255,0.35)', 1.3);
    }
  }

  // ---------- ability VFX: returns impact delay in seconds ----------
  ability(ev, color, glow) {
    const { ab, from, anchor, tiles = [] } = ev;
    const fx = from.x + 0.5, fy = from.y + 0.5, ax = anchor.x + 0.5, ay = anchor.y + 0.5;
    const ang = Math.atan2(ay - fy, ax - fx);
    switch (ab) {
      case 'pawnStrike': case 'hollowClaw': case 'royalStrike': case 'pickpocket': case 'shove':
        this.after(0.11, () => { this.slash(ax, ay, ab === 'hollowClaw' ? '#b9b6ff' : '#fff4d6', ang - 0.9, ab === 'royalStrike' ? 0.6 : 0.45); this.burst(ax, ay, glow, 8, 2.5); });
        return 0.12;
      case 'execute':
        this.after(0.14, () => { this.slash(ax, ay, '#ff3b5c', ang - 1, 0.75, 0.35); this.slash(ax, ay, '#ffffff', ang + 2.2, 0.6, 0.3); this.flash(0.25, '#ff2a4a'); });
        return 0.16;
      case 'tstrike': case 'stagger': case 'slam':
        tiles.forEach((t, i) => this.after(0.08 + i * 0.03, () => { this.shock(t.x + 0.5, t.y + 0.55, ab === 'stagger' ? 'rgba(201,166,255,0.45)' : 'rgba(255,220,170,0.4)', 0.7, 0.3); this.burst(t.x + 0.5, t.y + 0.8, '#d9cfb8', 5, 1.6, 'dust'); }));
        return 0.1;
      case 'ray': case 'siege': {
        const last = tiles[tiles.length - 1] || anchor;
        if (ab === 'siege') { this.proj({ x: fx, y: fy - 0.3 }, { x: last.x + 0.5, y: last.y + 0.3 }, '#ffd27a', 0.24); this.after(0.24, () => { this.shock(last.x + 0.5, last.y + 0.5, 'rgba(255,200,120,0.5)', 1, 0.3); this.burst(last.x + 0.5, last.y + 0.5, '#ffd27a', 16, 4); }); return 0.25; }
        this.beam({ x: fx, y: fy - 0.35 }, { x: last.x + 0.5, y: last.y + 0.2 }, glow, 0.32, 0.45);
        tiles.forEach((t, i) => this.after(i * 0.03, () => this.burst(t.x + 0.5, t.y + 0.4, glow, 5, 2)));
        return 0.08;
      }
      case 'cross': case 'checkmate': {
        const ends = new Map();
        for (const t of tiles) { const dx = Math.sign(t.x - from.x), dy = Math.sign(t.y - from.y), k = dx + ',' + dy, d = Math.max(Math.abs(t.x - from.x), Math.abs(t.y - from.y)); if (!ends.has(k) || ends.get(k).d < d) ends.set(k, { t, d }); }
        for (const { t } of ends.values()) this.beam({ x: fx, y: fy - 0.35 }, { x: t.x + 0.5, y: t.y + 0.2 }, ab === 'checkmate' ? '#ffd24d' : glow, 0.24, 0.45);
        this.ring(fx, fy + 0.2, glow, 2, 0.5);
        return 0.1;
      }
      case 'starburst': case 'dominion':
        this.shock(fx, fy, ab === 'dominion' ? 'rgba(176,77,255,0.35)' : 'rgba(255,230,160,0.45)', ab === 'dominion' ? 2.6 : 1.7, 0.4);
        this.ring(fx, fy + 0.2, ab === 'dominion' ? '#c08bff' : '#ffe9a8', ab === 'dominion' ? 5 : 3.4, 0.5, 0.12);
        this.burst(fx, fy, ab === 'dominion' ? '#d6a6ff' : '#fff1c4', 30, 5);
        return 0.1;
      case 'trample':
        this.after(0.36, () => { this.shock(ax, ay + 0.2, 'rgba(255,220,170,0.45)', 1.8, 0.35); this.ring(ax, ay + 0.3, '#ffe2a8', 3, 0.5); this.burst(ax, ay + 0.3, '#d9cfb8', 20, 3, 'dust'); });
        return 0.4;
      case 'charge': case 'decree': return 0.12;
      case 'enPassant': case 'fork':
        this.after(0.36, () => { this.shock(ax, ay + 0.2, 'rgba(255,230,160,0.55)', 2.6, 0.45); this.ring(ax, ay + 0.3, '#ffe2a8', 4.5, 0.6, 0.14); this.burst(ax, ay + 0.3, glow, 30, 5); this.flash(0.35); for (const t of tiles) this.after(Math.random() * 0.12, () => { this.burst(t.x + 0.5, t.y + 0.5, '#fff1d6', 8, 3); this.flashTile(t.x, t.y, '#ffd24d'); }); });
        return 0.42;
      case 'excommunicate': {
        const ends = new Map();
        for (const t of tiles) { const dx = Math.sign(t.x - from.x), dy = Math.sign(t.y - from.y), k = dx + ',' + dy, d = Math.abs(t.x - from.x); if (!ends.has(k) || ends.get(k).d < d) ends.set(k, { t, d }); }
        for (const { t } of ends.values()) { this.beam({ x: fx, y: fy - 0.35 }, { x: t.x + 0.5, y: t.y + 0.2 }, '#fff3c4', 0.55, 0.7); this.beam({ x: fx, y: fy - 0.35 }, { x: t.x + 0.5, y: t.y + 0.2 }, '#ffd24d', 0.25, 0.9); }
        this.pillar(fx, fy + 0.36, '#ffe9a8', 1, 0.9); this.flash(0.5, '#fff3c4'); this.ring(fx, fy + 0.3, '#ffd24d', 4, 0.7, 0.12);
        return 0.12;
      }
      case 'nova':
        this.flash(0.7, '#ffffff'); this.shock(fx, fy, 'rgba(255,240,200,0.6)', 3.4, 0.55); this.ring(fx, fy + 0.2, '#ffd24d', 6, 0.7, 0.18); this.ring(fx, fy + 0.2, glow, 4.5, 0.7, 0.12, 0.1);
        this.burst(fx, fy, '#fff1c4', 60, 7); this.burst(fx, fy, glow, 40, 5);
        for (const t of tiles) this.flashTile(t.x, t.y, '#ffd24d', 0.6, Math.hypot(t.x - from.x, t.y - from.y) * 0.04);
        return 0.12;
      case 'castling': this.glyph(fx, fy, '#ffd24d', 'swap'); this.glyph(ax, ay, '#ffd24d', 'swap'); this.after(0.25, () => { this.shock(ax, ay + 0.2, 'rgba(255,220,160,0.55)', 2.2, 0.4); this.ring(ax, ay + 0.3, '#ffd24d', 3.6, 0.6, 0.12); this.burst(ax, ay, '#d9cfb8', 24, 4, 'chunk'); this.flash(0.3); }); return 0.3;
      case 'divineRight': this.pillar(fx, fy + 0.36, '#ffd24d', 1.2, 1.1, 8); this.flash(0.5, '#ffe7a0'); this.ring(fx, fy + 0.3, '#ffd24d', 3.2, 0.7, 0.12); this.burst(fx, fy, '#fff1c4', 40, 4, 'up'); return 0.15;
      case 'sanctuary': this.glyph(fx, fy + 0.3, '#6dffa8', 'heal'); this.burst(fx, fy, '#6dffa8', 18, 1.5, 'up'); return 0.05;
      case 'digin': case 'fortify': case 'royalGuard': this.glyph(fx, fy - 0.3, '#7fb6ff', 'shield'); return 0.05;
      case 'rally': this.glyph(fx, fy, '#ffe04d', 'speed'); this.burst(fx, fy, '#ffe04d', 16, 2, 'up'); return 0.05;
      case 'vault': case 'sprint': this.glyph(fx, fy, '#9df3ff', 'speed'); return 0.05;
      case 'transpose': this.glyph(fx, fy, glow, 'swap'); this.glyph(ax, ay, glow, 'swap'); return 0.1;
      case 'rampart': this.after(0.05, () => this.burst(ax, ay + 0.3, '#b8b2c8', 14, 2.5, 'chunk')); return 0.05;
      case 'blink': this.glyph(ax, ay, '#c9a6ff', 'swap'); return 0.1;
      // ---------- 5.0 ----------
      case 'tripwire': // only the owner's side sees the placement (render.js swaps the anchor for others)
        this.after(0.06, () => { this.burst(ax, ay + 0.3, '#c8d2e0', 5, 0.8, 'dust'); this.ring(ax, ay + 0.35, 'rgba(255,90,70,0.8)', 0.9, 0.35, 0.03); });
        return 0.05;
      case 'lance': {
        const last = tiles[tiles.length - 1] || anchor, ex = last.x + 0.5, ey = last.y + 0.45;
        const dx = Math.sign(last.x - from.x), dy = Math.sign(last.y - from.y);
        this.after(0.08, () => {
          this.thrust({ x: fx - dx * 0.1, y: fy - 0.25 }, { x: ex + dx * 0.35, y: ey - 0.2 + dy * 0.35 }, '#ffe2a8', 0.15, 0.34);
          this.thrust({ x: fx, y: fy - 0.25 }, { x: ex + dx * 0.2, y: ey - 0.2 + dy * 0.2 }, glow, 0.08, 0.28);
          tiles.forEach((t, i) => this.after(i * 0.035, () => { this.burst(t.x + 0.5, t.y + 0.45, '#fff1d6', 7, 3); this.flashTile(t.x, t.y, '#ffd27a', 0.3); }));
          this.burst(ex + dx * 0.3, ey - 0.2, '#ffffff', 10, 4);
        });
        return 0.1;
      }
      case 'penance': {
        const tx = ax, ty = ay - 0.3;
        this.glyph(fx, fy - 0.3, '#fff3c4', 'holy', 0.5);
        this.proj({ x: fx, y: fy - 0.35 }, { x: tx, y: ty }, '#fff1b0', 0.22);
        this.beam({ x: fx, y: fy - 0.35 }, { x: tx, y: ty }, 'rgba(255,236,170,0.6)', 0.08, 0.35);
        this.after(0.22, () => {
          this.burst(tx, ty, '#fff6d0', 18, 3.5); this.ring(tx, ty + 0.5, '#ffe9a8', 1.8, 0.45, 0.08); this.glyph(tx, ty - 0.2, '#ffe9a8', 'holy', 0.7);
          this.shock(tx, ty + 0.3, 'rgba(255,240,190,0.45)', 1, 0.3);
        });
        this.after(0.32, () => { this.stream({ x: tx, y: ty }, { x: fx, y: fy - 0.3 }, '#6dffa8', 18, 0.55); this.stream({ x: tx, y: ty }, { x: fx, y: fy - 0.3 }, '#d6ffe6', 6, 0.5, 0.15); });
        this.after(0.85, () => { this.ring(fx, fy + 0.35, '#6dffa8', 1.4, 0.45); this.burst(fx, fy, '#6dffa8', 10, 1.4, 'up'); });
        return 0.24;
      }
      case 'quake': {
        this.shock(fx, fy + 0.3, 'rgba(210,180,130,0.5)', 1.2, 0.3); this.burst(fx, fy + 0.35, '#b9a27e', 14, 2.5, 'dust');
        for (const t of tiles) {
          const d = Math.max(Math.abs(t.x - from.x), Math.abs(t.y - from.y));
          this.after(0.06 + d * 0.09, () => {
            this.shock(t.x + 0.5, t.y + 0.6, 'rgba(225,190,140,0.55)', 0.95, 0.3);
            this.burst(t.x + 0.5, t.y + 0.7, '#9c8a6e', 7, 3, 'chunk'); this.burst(t.x + 0.5, t.y + 0.8, '#d9cfb8', 5, 1.4, 'dust');
            this.flashTile(t.x, t.y, '#d2a86a', 0.35); this.decal(t.x + 0.5, t.y + 0.45, 'rgba(20,14,8,0.45)', 0.34, 4);
            this.impactKick = (this.impactKick || 0) + 1.5;
          });
        }
        return 0.12;
      }
      case 'gambit':
        this.flash(0.22, '#ff1a2a');
        this.pillar(fx, fy + 0.36, '#ff2a3a', 0.8, 0.7, 4);
        this.ring(fx, fy + 0.35, '#ff3b2a', 2.2, 0.55, 0.1); this.ring(fx, fy + 0.35, '#ffb03d', 1.4, 0.5, 0.06, 0.12);
        this.burst(fx, fy, '#ff2a3a', 22, 2.2, 'up'); this.burst(fx, fy - 0.2, '#ff9a3d', 10, 1.6, 'fire');
        this.glyph(fx, fy - 0.6, '#ff5a3a', 'sword', 0.9);
        for (let i = 0; i < 16; i++) { const a = (i / 16) * Math.PI * 2, r = 1.1; this.parts.push({ kind: 'spiral', cx: fx, cy: fy - 0.2, a, r, x: fx, y: fy, life: 0.45, t: 0, color: i % 2 ? '#ff2a3a' : '#ffb03d', size: 0.045, vx: 0, vy: 0, g: 0 }); }
        return 0.1;
      case 'colossusSlam':
        this.burst(fx, fy - 0.6, '#c08bff', 16, 1.2, 'up');
        this.after(0.26, () => {
          this.flash(0.45, '#b06bff'); this.impactKick = (this.impactKick || 0) + 15;
          this.shock(fx, fy + 0.3, 'rgba(160,90,255,0.55)', 3.6, 0.5); this.shock(fx, fy + 0.3, 'rgba(255,220,170,0.4)', 2.2, 0.3);
          this.ring(fx, fy + 0.35, '#c08bff', 5.4, 0.7, 0.18); this.ring(fx, fy + 0.35, '#ffffff', 3.2, 0.5, 0.1, 0.06);
          this.burst(fx, fy + 0.3, '#5a4a6e', 26, 4.5, 'chunk'); this.burst(fx, fy + 0.4, '#b9a27e', 20, 2.5, 'dust'); this.burst(fx, fy, '#e0c8ff', 24, 5);
          this.decal(fx, fy + 0.3, 'rgba(25,10,40,0.6)', 1.3, 6);
          for (const t of tiles) { const dd = Math.hypot(t.x - from.x, t.y - from.y); this.flashTile(t.x, t.y, '#a06bff', 0.55, dd * 0.04); this.after(dd * 0.05, () => this.burst(t.x + 0.5, t.y + 0.7, '#8d8aa0', 5, 2.5, 'chunk')); }
        });
        return 0.3;
    }
    return 0.08;
  }

  update(dt) {
    this.time += dt;
    if (this.pending.length) { const due = this.pending.filter((p) => p.at <= this.time); this.pending = this.pending.filter((p) => p.at > this.time); due.forEach((p) => p.fn()); }
    for (const p of this.parts) {
      p.t += dt;
      if (p.kind === 'seek') { const k = Math.max(0, p.t / p.life), e = k * k * (3 - 2 * k), dx = p.bx - p.ax, dy = p.by - p.ay, l = Math.hypot(dx, dy) || 1, w = Math.sin(k * Math.PI) * p.off + Math.sin(p.ph + k * 9) * 0.04; p.x = p.ax + dx * e - dy / l * w; p.y = p.ay + dy * e + dx / l * w; continue; }
      if (p.kind === 'spiral') { const k = p.t / p.life; const r = p.r * (1 - k * k); p.a += dt * (4 + k * 10); p.x = p.cx + Math.cos(p.a) * r; p.y = p.cy + Math.sin(p.a) * r * 0.6; continue; }
      p.x += p.vx * dt; p.y += p.vy * dt; p.vy += p.g * dt; p.vx *= 1 - dt * 1.5; p.rot += p.vr * dt;
      if (p.floor != null && p.y > p.floor && p.vy > 0) { p.y = p.floor; p.vy *= -0.35; p.vx *= 0.6; p.vr *= 0.5; }
    }
    for (const s of this.shards) {
      s.t += dt; if (s.t < 0) continue;
      s.x += s.vx * dt; s.y += s.vy * dt; s.vy += s.g * dt; s.rot += s.vr * dt; s.vx *= 1 - dt * 1.2;
      if (s.y > s.floor && s.vy > 0) { s.y = s.floor; s.vy *= -0.3; s.vx *= 0.5; s.vr *= 0.4; }
    }
    const step = (a) => a.filter((p) => (p.t += dt) < p.life);
    this.parts = this.parts.filter((p) => p.t < p.life);
    if (this.parts.length > (this.cap || 900)) this.parts.splice(0, this.parts.length - (this.cap || 900));
    this.shards = this.shards.filter((s) => s.t < s.life);
    this.rings = step(this.rings); this.beams = step(this.beams); this.bolts = step(this.bolts); this.flashes = step(this.flashes);
    this.shocks = step(this.shocks); this.falls = step(this.falls); this.pillars = step(this.pillars); this.decals = step(this.decals);
    this.slashes = step(this.slashes); this.projs = step(this.projs); this.implodes = step(this.implodes); this.glyphs = step(this.glyphs); this.thrusts = step(this.thrusts);
    for (const m of this.meteors) { m.t += dt; if (!m.done && m.t >= m.life) { m.done = true; this.shock(m.x, m.y + 0.2, 'rgba(255,170,90,0.55)', 1.8, 0.4); this.burst(m.x, m.y, m.color, 26, 4.5); this.burst(m.x, m.y, '#3a2a24', 16, 1.5, 'dust'); this.decal(m.x, m.y + 0.1, 'rgba(20,10,6,0.7)', 0.55, 10); this.ring(m.x, m.y + 0.3, '#ffd27a', 2.6, 0.5, 0.1); if (m.onHit) m.onHit(); this.impactKick = (this.impactKick || 0) + 8; } }
    this.meteors = this.meteors.filter((m) => m.t < m.life + 0.05);
    if (this.crowns) { for (const c of this.crowns) c.t += dt; this.crowns = this.crowns.filter((c) => c.t < c.life + 0.05); }
    this.screenFlash = Math.max(0, this.screenFlash - dt * 3);
  }

  drawGround(ctx) {
    for (const d of this.decals) {
      const a = d.t < d.life - 1 ? 1 : d.life - d.t;
      ctx.globalAlpha = a; ctx.fillStyle = d.color;
      ctx.beginPath(); ctx.ellipse(d.x, d.y + 0.25, d.r, d.r * 0.5, 0, 0, Math.PI * 2); ctx.fill();
    }
    for (const f of this.flashes) {
      if (f.t < 0) continue;
      ctx.globalAlpha = (1 - f.t / f.life) * 0.6; ctx.fillStyle = f.color; ctx.fillRect(f.x + 0.04, f.y + 0.04, 0.92, 0.92);
    }
    for (const s of this.shocks) {
      const k = s.t / s.life, r = s.r * (0.2 + 0.8 * (1 - Math.pow(1 - k, 3)));
      ctx.globalAlpha = 1 - k;
      ctx.drawImage(shockSprite(s.color), s.x - r, s.y - r * 0.6, r * 2, r * 1.2);
    }
    ctx.globalAlpha = 1;
  }
  drawFalls(ctx, theme) {
    for (const f of this.falls) {
      if (f.t < 0) continue;
      const k = f.t / f.life, e = k * k;
      ctx.save();
      ctx.globalAlpha = 1 - e;
      ctx.translate(f.x + 0.5, f.y + 0.5 + e * 2.2); ctx.rotate(f.rot * e); ctx.scale(1 - e * 0.6, 1 - e * 0.6);
      ctx.fillStyle = f.color; ctx.fillRect(-0.5, -0.5, 1, 1);
      ctx.fillStyle = 'rgba(255,90,40,' + (0.5 * (1 - k)) + ')'; ctx.fillRect(-0.5, 0.42, 1, 0.08);
      ctx.restore();
    }
    void theme;
  }
  drawAbove(ctx) {
    const T = this.time;
    if (this.crowns) {
      for (const c of this.crowns) {
        c.t += 0; const k = Math.min(1, c.t / c.life), yy = c.y - (1 - k * k) * 6;
        ctx.save(); ctx.translate(c.x, yy); ctx.scale(0.9, 0.9);
        if (!this.lowQ) { ctx.shadowColor = '#ffd24d'; ctx.shadowBlur = 16; }
        ctx.fillStyle = '#ffd24d'; ctx.strokeStyle = '#7a5208'; ctx.lineWidth = 0.03;
        ctx.beginPath(); ctx.moveTo(-0.32, 0.16); ctx.lineTo(-0.36, -0.2); ctx.lineTo(-0.16, -0.03); ctx.lineTo(0, -0.28); ctx.lineTo(0.16, -0.03); ctx.lineTo(0.36, -0.2); ctx.lineTo(0.32, 0.16); ctx.closePath(); ctx.fill(); ctx.shadowBlur = 0; ctx.stroke();
        ctx.restore();
      }
    }
    for (const m of this.meteors) {
      if (m.t < 0) continue;
      const k = Math.min(1, m.t / m.life);
      const sx = m.x - 5 * (1 - k), sy = m.y - 9 * (1 - k);
      const g = ctx.createLinearGradient(sx - 2.2, sy - 4, sx, sy);
      g.addColorStop(0, m.color + '00'); g.addColorStop(1, m.color);
      ctx.strokeStyle = g; ctx.lineWidth = 0.35; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(sx - 2.2, sy - 4); ctx.lineTo(sx, sy); ctx.stroke();
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(sx, sy, 0.22, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = m.color; ctx.globalAlpha = 0.5; ctx.beginPath(); ctx.arc(sx, sy, 0.4, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1;
      if (Math.random() < 0.8) this.parts.push({ x: sx, y: sy, vx: (Math.random() - 0.5), vy: -Math.random(), g: 0, life: 0.4, t: 0, color: m.color, size: 0.06, kind: 'spark', rot: 0, vr: 0 });
    }
    ctx.lineCap = 'butt';
    for (const p of this.pillars) {
      const a = Math.sin((p.t / p.life) * Math.PI);
      ctx.globalAlpha = a; ctx.drawImage(pillarSprite(p.color), p.x - p.w * 0.5 * a, p.y - p.h, p.w * a, p.h + 0.3);
      ctx.fillStyle = 'rgba(255,255,255,0.7)'; ctx.fillRect(p.x - p.w * 0.12 * a, p.y - p.h, p.w * 0.24 * a, p.h + 0.3);
    }
    ctx.globalAlpha = 1;
    for (const b of this.beams) {
      const k = b.t / b.life, a = 1 - k, grow = Math.min(1, b.t / 0.06);
      const ex = b.a.x + (b.b.x - b.a.x) * grow, ey = b.a.y + (b.b.y - b.a.y) * grow;
      ctx.lineCap = 'round';
      ctx.globalAlpha = a * 0.5; ctx.strokeStyle = b.color; ctx.lineWidth = b.w * 1.8 * a;
      ctx.beginPath(); ctx.moveTo(b.a.x, b.a.y); ctx.lineTo(ex, ey); ctx.stroke();
      ctx.globalAlpha = a; ctx.lineWidth = b.w * a; ctx.stroke();
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = b.w * 0.35 * a; ctx.stroke();
    }
    for (const p of this.projs) {
      const k = p.t / p.life;
      const x = p.a.x + (p.b.x - p.a.x) * k, y = p.a.y + (p.b.y - p.a.y) * k - Math.sin(k * Math.PI) * 0.6;
      ctx.globalAlpha = 1; ctx.fillStyle = p.color;
      ctx.beginPath(); ctx.arc(x, y, 0.14, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(x, y, 0.07, 0, Math.PI * 2); ctx.fill();
      if (Math.random() < 0.9) this.parts.push({ x, y, vx: 0, vy: 0, g: 0, life: 0.3, t: 0, color: p.color, size: 0.07, kind: 'spark' });
    }
    ctx.lineCap = 'butt';
    for (const s of this.slashes) {
      const k = s.t / s.life, a = 1 - k;
      const sweep = Math.min(1, k * 3) * 2.2;
      ctx.globalAlpha = a; ctx.strokeStyle = s.color; ctx.lineWidth = 0.12 * a + 0.02; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.arc(s.x, s.y, s.r, s.ang, s.ang + sweep); ctx.stroke();
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 0.04 * a; ctx.stroke();
    }
    ctx.lineCap = 'butt';
    for (const im of this.implodes) {
      const k = im.t / im.life;
      const sc = im.hold ? 1 : im.rise ? 1 - k * 0.3 : 1 - k * k;
      ctx.save(); ctx.globalAlpha = im.hold ? 1 : im.rise ? 1 - k : 1 - k * 0.3;
      ctx.translate(im.x, im.y - (im.hold ? 0 : im.rise ? k * k * 3 : k * 0.4)); ctx.rotate(im.hold || im.rise ? 0 : k * k * 6); ctx.scale(sc / SPR, sc / SPR);
      ctx.drawImage(im.img, -48, -112);
      ctx.restore();
    }
    for (const s of this.shards) {
      if (s.t < 0) continue;
      const a = Math.min(1, (s.life - s.t) / 0.3);
      ctx.save(); ctx.globalAlpha = a;
      ctx.translate(s.x, s.y); ctx.rotate(s.rot); ctx.scale(s.scale, s.scale);
      ctx.drawImage(s.img, s.sx, s.sy, s.sw, s.sh, -s.sw / 2, -s.sh / 2, s.sw, s.sh);
      ctx.restore();
    }
    for (const b of this.bolts) {
      const a = 1 - b.t / b.life;
      ctx.globalAlpha = a; ctx.strokeStyle = b.color; ctx.lineJoin = 'round';
      for (const [w, al] of [[0.3, 0.3], [0.1, 1]]) {
        ctx.lineWidth = w; ctx.globalAlpha = a * al;
        ctx.beginPath(); b.pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.stroke();
      }
    }
    for (const r of this.rings) {
      if (r.t < 0) continue;
      const k = r.t / r.life, rad = (1 - Math.pow(1 - k, 3)) * r.r * 0.5;
      ctx.globalAlpha = 1 - k; ctx.strokeStyle = r.color; ctx.lineWidth = r.w * (1 - k) + 0.01;
      ctx.beginPath(); ctx.ellipse(r.x, r.y, rad, rad * 0.55, 0, 0, Math.PI * 2); ctx.stroke();
    }
    for (const g of this.glyphs) {
      const k = g.t / g.life, a = Math.sin(k * Math.PI);
      ctx.save(); ctx.globalAlpha = a; ctx.strokeStyle = g.color; ctx.fillStyle = g.color; ctx.lineWidth = 0.05;
      ctx.translate(g.x, g.y - k * 0.6);
      if (g.kind === 'shield') { ctx.beginPath(); for (let i = 0; i < 6; i++) { const an = i / 6 * Math.PI * 2 + Math.PI / 6; ctx[i ? 'lineTo' : 'moveTo'](Math.cos(an) * 0.42, Math.sin(an) * 0.42); } ctx.closePath(); ctx.stroke(); ctx.globalAlpha = a * 0.2; ctx.fill(); }
      else if (g.kind === 'heal') { ctx.fillRect(-0.06, -0.24, 0.12, 0.48); ctx.fillRect(-0.24, -0.06, 0.48, 0.12); }
      else if (g.kind === 'speed') { for (let i = -1; i <= 1; i++) { ctx.beginPath(); ctx.moveTo(-0.35 + k * 0.2, i * 0.15); ctx.lineTo(0.35 + k * 0.2, i * 0.15); ctx.stroke(); } }
      else if (g.kind === 'holy') { ctx.lineWidth = 0.07; ctx.beginPath(); ctx.moveTo(0, -0.34); ctx.lineTo(0, 0.34); ctx.moveTo(-0.2, -0.12); ctx.lineTo(0.2, -0.12); ctx.stroke(); }
      else if (g.kind === 'sword') { ctx.beginPath(); ctx.moveTo(0, -0.42); ctx.lineTo(0.06, -0.3); ctx.lineTo(0.06, 0.12); ctx.lineTo(-0.06, 0.12); ctx.lineTo(-0.06, -0.3); ctx.closePath(); ctx.fill(); ctx.fillRect(-0.2, 0.12, 0.4, 0.06); ctx.fillRect(-0.03, 0.18, 0.06, 0.16); }
      else if (g.kind === 'swap') { ctx.rotate(T * 3); ctx.beginPath(); ctx.arc(0, 0, 0.35, 0, Math.PI * 1.4); ctx.stroke(); ctx.beginPath(); ctx.arc(0, 0, 0.22, Math.PI, Math.PI * 2.4); ctx.stroke(); }
      ctx.restore();
    }
    for (const th of this.thrusts) {
      const k = th.t / th.life, out = Math.min(1, th.t / 0.07), a = k < 0.35 ? 1 : 1 - (k - 0.35) / 0.65;
      const dx = th.b.x - th.a.x, dy = th.b.y - th.a.y, l = Math.hypot(dx, dy) || 1, nx = -dy / l, ny = dx / l;
      const tx = th.a.x + dx * out, ty = th.a.y + dy * out, tail = Math.max(0, out - 0.75 - k * 0.4);
      const sx = th.a.x + dx * tail, sy = th.a.y + dy * tail, w = th.w * (1 - k * 0.5);
      ctx.globalAlpha = a * 0.45; ctx.fillStyle = th.color;
      ctx.beginPath(); ctx.moveTo(sx + nx * w * 1.6, sy + ny * w * 1.6); ctx.lineTo(tx + dx / l * 0.25, ty + dy / l * 0.25); ctx.lineTo(sx - nx * w * 1.6, sy - ny * w * 1.6); ctx.closePath(); ctx.fill();
      ctx.globalAlpha = a; ctx.beginPath(); ctx.moveTo(sx + nx * w * 0.6, sy + ny * w * 0.6); ctx.lineTo(tx + dx / l * 0.18, ty + dy / l * 0.18); ctx.lineTo(sx - nx * w * 0.6, sy - ny * w * 0.6); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.moveTo(sx + nx * w * 0.2, sy + ny * w * 0.2); ctx.lineTo(tx + dx / l * 0.14, ty + dy / l * 0.14); ctx.lineTo(sx - nx * w * 0.2, sy - ny * w * 0.2); ctx.closePath(); ctx.fill();
    }
    for (const p of this.parts) {
      if (p.t < 0) continue;
      const a = 1 - p.t / p.life; ctx.globalAlpha = Math.max(0, a);
      if (p.kind === 'seek') { ctx.globalAlpha = Math.min(1, a * 2.5); ctx.fillStyle = p.color; ctx.beginPath(); ctx.arc(p.x, p.y, p.size * 1.8, 0, Math.PI * 2); ctx.globalAlpha *= 0.35; ctx.fill(); ctx.globalAlpha = Math.min(1, a * 2.5); ctx.beginPath(); ctx.arc(p.x, p.y, p.size * 0.8, 0, Math.PI * 2); ctx.fill(); continue; }
      if (p.kind === 'fire') { const k = p.t / p.life; ctx.fillStyle = k < 0.3 ? p.c0 || '#fff2a8' : k < 0.6 ? p.color : p.c1 || '#5a1a08'; ctx.beginPath(); ctx.arc(p.x, p.y, p.size * (1 + k), 0, Math.PI * 2); ctx.fill(); continue; }
      ctx.fillStyle = p.color;
      if (p.kind === 'chunk') { ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot); ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.7); ctx.restore(); }
      else if (p.kind === 'coin') { ctx.save(); ctx.translate(p.x, p.y); ctx.scale(Math.abs(Math.cos(p.rot)) + 0.15, 1); ctx.beginPath(); ctx.arc(0, 0, p.size, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = '#fff6d0'; ctx.beginPath(); ctx.arc(-p.size * 0.3, -p.size * 0.3, p.size * 0.35, 0, Math.PI * 2); ctx.fill(); ctx.restore(); }
      else { ctx.beginPath(); ctx.arc(p.x, p.y, p.size * (p.kind === 'dust' ? 1 + p.t * 3 : Math.max(0.2, a)), 0, Math.PI * 2); ctx.fill(); }
    }
    ctx.globalAlpha = 1;
  }
}
export { skinOf };
