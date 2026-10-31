// Board renderer: tiles, pieces, telegraphs, particles, camera, juice.
import { SIZE, PLAYER_COLORS } from './data.js';
import { drawPiece, skinOf, PIECE_TOP } from './pieces.js';
import { ringOf, stats, unitById } from './engine.js';

const ease = (t) => 1 - Math.pow(1 - t, 3);
const lerp = (a, b, t) => a + (b - a) * t;

export class Renderer {
  constructor(canvas) {
    this.c = canvas; this.x = canvas.getContext('2d');
    this.cam = { x: SIZE / 2, y: SIZE / 2, z: 40, tx: SIZE / 2, ty: SIZE / 2, tz: 40 };
    this.disp = new Map(); this.dying = [];
    this.parts = []; this.floats = []; this.flashT = []; this.rings = []; this.beams = [];
    this.shake = 0; this.time = 0; this.state = null; this.overlay = null; this.myId = null;
    this.hitFlash = new Map();
    this.follow = true;
    this.resize();
    addEventListener('resize', () => this.resize());
  }
  resize() {
    const dpr = Math.min(2, devicePixelRatio || 1);
    const r = this.c.getBoundingClientRect();
    this.W = r.width; this.H = r.height; this.dpr = dpr;
    this.c.width = Math.round(r.width * dpr); this.c.height = Math.round(r.height * dpr);
    this.pad = this.pad || { t: 0, b: 0 };
    this.VH = Math.max(120, this.H - this.pad.t - this.pad.b); this.CY = this.pad.t + this.VH / 2;
    this.fitZoom = Math.min(this.W, this.VH) / (SIZE + 1.2);
    this.minZ = this.fitZoom * 0.9; this.maxZ = Math.max(this.fitZoom * 3, 70);
    if (!this.zoomSet) { this.cam.z = this.cam.tz = this.defaultZoom(); }
  }
  setPad(t, b) { this.pad = { t, b }; this.resize(); }
  defaultZoom() { return Math.max(this.fitZoom, Math.min(this.W, this.VH) / 10.5); }
  toScreen(wx, wy) { return [(wx - this.cam.x) * this.cam.z + this.W / 2, (wy - this.cam.y) * this.cam.z + this.CY]; }
  toWorld(sx, sy) { return [(sx - this.W / 2) / this.cam.z + this.cam.x, (sy - this.CY) / this.cam.z + this.cam.y]; }
  tileAtScreen(sx, sy) { const [wx, wy] = this.toWorld(sx, sy); const x = Math.floor(wx), y = Math.floor(wy); return x >= 0 && y >= 0 && x < SIZE && y < SIZE ? { x, y } : null; }
  focus(x, y) { this.cam.tx = x + 0.5; this.cam.ty = y + 0.5; }
  zoomBy(f, sx = this.W / 2, sy = this.H / 2) {
    const [wx, wy] = this.toWorld(sx, sy);
    this.cam.z = this.cam.tz = Math.max(this.minZ, Math.min(this.maxZ, this.cam.z * f));
    this.zoomSet = true;
    const [nx, ny] = this.toWorld(sx, sy);
    this.cam.x += wx - nx; this.cam.y += wy - ny; this.cam.tx = this.cam.x; this.cam.ty = this.cam.y;
  }
  pan(dx, dy) { this.cam.x -= dx / this.cam.z; this.cam.y -= dy / this.cam.z; this.cam.tx = this.cam.x; this.cam.ty = this.cam.y; this.follow = false; }
  overview() { this.cam.tz = this.fitZoom; this.cam.tx = SIZE / 2; this.cam.ty = SIZE / 2; this.zoomSet = true; }
  closeup() { this.cam.tz = this.defaultZoom(); this.follow = true; this.zoomSet = true; }

  setState(s, events = []) {
    const now = this.time;
    for (const u of s.units) {
      let d = this.disp.get(u.id);
      if (!d) { d = { x: u.x, y: u.y, sx: u.x, sy: u.y, tx: u.x, ty: u.y, t0: -9, dur: 0.2, how: 'step', piece: u.piece, pop: 0 }; this.disp.set(u.id, d); }
      if (d.piece !== u.piece) { d.pop = 1; d.piece = u.piece; }
      if (!u.alive && d.alive !== false) { this.dying.push({ u: { ...u }, d: { ...d }, t: 0 }); }
      d.alive = u.alive;
    }
    // queue visuals from events, ordered with small delays so they read clearly
    let delay = 0;
    for (const e of events) {
      if (e.e === 'move') {
        const d = this.disp.get(e.id); if (!d) continue;
        const dist = Math.hypot(e.to.x - d.tx, e.to.y - d.ty);
        d.sx = d.tx; d.sy = d.ty; d.tx = e.to.x; d.ty = e.to.y; d.t0 = now + delay; d.how = e.how;
        d.dur = e.how === 'jump' ? 0.38 : e.how === 'blink' || e.how === 'swap' ? 0.25 : e.how === 'dash' ? 0.16 + dist * 0.03 : 0.14 + dist * 0.05;
        if (e.how === 'dash') this.beams.push({ a: e.from, b: e.to, t: 0, life: 0.5, color: this.colorOf(e.id) });
        if (e.how === 'blink' || e.how === 'swap') { this.burst(e.from.x + 0.5, e.from.y + 0.6, this.glowOf(e.id), 14, 2.5); }
        if (e.how === 'jump') this.later(delay + d.dur, () => { this.burst(e.to.x + 0.5, e.to.y + 0.85, '#d9cfb8', 10, 2, 'dust'); this.kick(3); });
        delay += d.dur * 0.75;
      } else this.later(delay, () => this.fx(e));
    }
    for (const u of s.units) {
      const d = this.disp.get(u.id);
      if (d && (d.tx !== u.x || d.ty !== u.y)) { d.sx = d.x; d.sy = d.y; d.tx = u.x; d.ty = u.y; d.t0 = now; d.dur = 0.2; d.how = 'step'; }
    }
    this.state = s;
  }
  later(t, fn) { (this.timers ||= []).push({ at: this.time + t, fn }); }
  colorOf(id) { const u = this.state && unitById(this.state, id); return u ? u.color : '#fff'; }
  glowOf(id) { const u = this.state && unitById(this.state, id); return u ? skinOf(u.skin).glow : '#fff'; }
  kick(n) { this.shake = Math.min(14, this.shake + n); }

  fx(e) {
    const s = this.state; if (!s) return;
    const at = (id) => { const d = this.disp.get(id); return d ? [d.x + 0.5, d.y] : [0, 0]; };
    switch (e.e) {
      case 'dmg': {
        const [x, y] = at(e.id);
        const big = e.crit || e.n >= 25;
        this.floats.push({ x, y: y - 0.9, text: String(e.n), t: 0, life: 1.1, color: e.storm ? '#ff6b6b' : e.thorns ? '#b6ff7a' : e.crit ? '#ffd24d' : '#ffffff', size: big ? 1.35 : 1, crit: e.crit });
        this.hitFlash.set(e.id, 1);
        this.burst(x, y + 0.5, e.storm ? '#ff3b3b' : '#fff1d6', big ? 18 : 10, big ? 4 : 3);
        this.kick(e.crit ? 9 : Math.min(7, 2 + e.n / 8));
        break;
      }
      case 'heal': { const [x, y] = at(e.id); this.floats.push({ x, y: y - 0.9, text: '+' + e.n, t: 0, life: 1, color: '#6dffa8', size: 0.9 }); this.burst(x, y + 0.4, '#6dffa8', 10, 1.5, 'up'); break; }
      case 'aoe': for (const t of e.tiles) this.flashT.push({ x: t.x, y: t.y, t: 0, life: 0.45, color: e.kind === 'hit' ? '#ff5d5d' : '#7fe0ff' }); break;
      case 'death': {
        this.burst(e.x + 0.5, e.y + 0.5, '#ffffff', 30, 5); this.burst(e.x + 0.5, e.y + 0.5, this.glowOf(e.id), 26, 4);
        this.rings.push({ x: e.x + 0.5, y: e.y + 0.6, t: 0, life: 0.7, color: '#ffffff', r: 1.8 });
        this.kick(12); break;
      }
      case 'crate': this.burst(e.x + 0.5, e.y + 0.5, '#c9934d', 16, 3.5, 'chunk'); this.kick(3); break;
      case 'rubble': this.burst(e.x + 0.5, e.y + 0.5, '#8d8aa0', e.broke ? 16 : 6, 3, 'chunk'); break;
      case 'impact': this.burst(e.x + 0.5, e.y + 0.6, '#ffe2a8', 14, 3.5); this.kick(6); break;
      case 'pickup': {
        const [x, y] = at(e.id);
        const col = e.k === 'shard' ? '#9df3ff' : e.k === 'potion' ? '#ff6b8b' : '#ffe04d';
        this.burst(x, y + 0.2, col, 14, 2, 'up');
        this.floats.push({ x, y: y - 1.1, text: e.k === 'shard' ? `+${e.n} shard${e.n > 1 ? 's' : ''}` : e.k === 'potion' ? 'Potion' : 'Haste', t: 0, life: 1.2, color: col, size: 0.7 });
        break;
      }
      case 'promote': case 'crowned': {
        const [x, y] = at(e.id);
        this.rings.push({ x, y: y + 0.6, t: 0, life: 0.9, color: '#ffd76a', r: 2.4 });
        this.rings.push({ x, y: y + 0.6, t: -0.15, life: 0.9, color: this.glowOf(e.id), r: 1.6 });
        this.pillar = { x, y, t: 0, life: 1.1, color: e.e === 'crowned' ? '#ffd24d' : this.glowOf(e.id) };
        this.burst(x, y, '#ffe9a8', 40, 4, 'up'); this.kick(8); break;
      }
      case 'shrine': this.rings.push({ x: e.x + 0.5, y: e.y + 0.6, t: 0, life: 0.9, color: '#7fe0ff', r: 2 }); break;
      case 'storm': this.kick(e.phase === 'collapse' ? 12 : 5); break;
      case 'stagger': { const [x, y] = at(e.id); this.floats.push({ x, y: y - 1.2, text: 'Staggered', t: 0, life: 1, color: '#c9a6ff', size: 0.65 }); break; }
      case 'buff': { const [x, y] = at(e.id); this.rings.push({ x, y: y + 0.6, t: 0, life: 0.6, color: e.k === 'def' ? '#7fb6ff' : e.k === 'spd' ? '#ffe04d' : e.k === 'heal' ? '#6dffa8' : '#ffffff', r: 1.3 }); break; }
      case 'rampart': this.burst(e.x + 0.5, e.y + 0.6, '#b8b2c8', 14, 3, 'chunk'); this.kick(4); break;
      case 'crownSpawn': this.rings.push({ x: e.x + 0.5, y: e.y + 0.6, t: 0, life: 1.4, color: '#ffd24d', r: 3 }); break;
      case 'mark': this.rings.push({ x: e.x + 0.5, y: e.y + 0.6, t: 0, life: 0.7, color: '#c9a6ff', r: 1.2 }); break;
    }
  }

  burst(x, y, color, n, sp, kind = 'spark') {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, v = (0.4 + Math.random()) * sp;
      this.parts.push({
        x, y, vx: Math.cos(a) * v, vy: kind === 'up' ? -Math.random() * sp - 0.5 : Math.sin(a) * v - (kind === 'chunk' ? 2 : 0.6),
        g: kind === 'up' ? -0.5 : kind === 'chunk' ? 9 : kind === 'dust' ? 0.5 : 3, life: 0.4 + Math.random() * 0.5, t: 0, color,
        size: kind === 'chunk' ? 0.07 + Math.random() * 0.06 : kind === 'dust' ? 0.09 : 0.035 + Math.random() * 0.04, kind,
      });
    }
  }

  frame(dt) {
    this.time += dt;
    if (this.timers) { const due = this.timers.filter((t) => t.at <= this.time); this.timers = this.timers.filter((t) => t.at > this.time); due.forEach((t) => t.fn()); }
    const cam = this.cam;
    const k = 1 - Math.pow(0.0015, dt);
    cam.x = lerp(cam.x, cam.tx, k); cam.y = lerp(cam.y, cam.ty, k); cam.z = lerp(cam.z, cam.tz, k);
    // clamp camera to board
    const clamp = (v, span) => { const h = span / cam.z / 2; return SIZE + 1 <= h * 2 ? SIZE / 2 : Math.max(h - 0.5, Math.min(SIZE + 0.5 - h, v)); };
    cam.x = clamp(cam.x, this.W); cam.y = clamp(cam.y, this.VH);
    cam.tx = clamp(cam.tx, this.W); cam.ty = clamp(cam.ty, this.VH);
    for (const d of this.disp.values()) {
      const t = Math.max(0, Math.min(1, (this.time - d.t0) / d.dur));
      const e = d.how === 'jump' ? t : ease(t);
      d.x = lerp(d.sx, d.tx, e); d.y = lerp(d.sy, d.ty, e);
      d.lift = d.how === 'jump' ? Math.sin(t * Math.PI) * 0.9 : 0;
      d.moving = t < 1;
      d.pop = Math.max(0, d.pop - dt * 1.6);
    }
    this.shake *= Math.pow(0.002, dt);
    for (const [id, f] of this.hitFlash) { const v = f - dt * 5; if (v <= 0) this.hitFlash.delete(id); else this.hitFlash.set(id, v); }
    const step = (arr) => arr.filter((p) => (p.t += dt) < p.life);
    this.parts.forEach((p) => { p.x += p.vx * dt; p.y += p.vy * dt; p.vy += p.g * dt; p.vx *= 0.98; });
    this.parts = step(this.parts); this.floats = step(this.floats); this.flashT = step(this.flashT); this.rings = step(this.rings); this.beams = step(this.beams);
    this.dying = this.dying.filter((d) => (d.t += dt) < 0.8);
    if (this.pillar && (this.pillar.t += dt) > this.pillar.life) this.pillar = null;
    this.draw();
  }

  draw() {
    const { x: ctx, W, H, dpr } = this;
    const s = this.state;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // background
    const bg = ctx.createRadialGradient(W / 2, H * 0.45, 10, W / 2, H / 2, Math.max(W, H) * 0.8);
    bg.addColorStop(0, '#1a1626'); bg.addColorStop(1, '#07060b');
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
    if (!s) return;
    const z = this.cam.z;
    const sh = this.shake;
    const ox = (Math.random() - 0.5) * sh, oy = (Math.random() - 0.5) * sh;
    ctx.save();
    ctx.translate(W / 2 + ox, this.CY + oy); ctx.scale(z, z); ctx.translate(-this.cam.x, -this.cam.y);
    const T = this.time;

    // board frame
    ctx.fillStyle = '#0d0b13'; ctx.fillRect(-0.35, -0.35, SIZE + 0.7, SIZE + 0.7);
    ctx.strokeStyle = 'rgba(214,176,92,0.55)'; ctx.lineWidth = 0.05; ctx.strokeRect(-0.3, -0.3, SIZE + 0.6, SIZE + 0.6);
    ctx.strokeStyle = 'rgba(214,176,92,0.18)'; ctx.lineWidth = 0.02; ctx.strokeRect(-0.18, -0.18, SIZE + 0.36, SIZE + 0.36);

    // floor
    for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
      const ring = ringOf(x, y);
      if (ring < s.storm.ring) { this.drawVoid(x, y, T); continue; }
      const light = (x + y) % 2 === 0;
      ctx.fillStyle = light ? '#2a2638' : '#1c1928';
      ctx.fillRect(x, y, 1, 1);
      // marble vein
      const h = (x * 73 + y * 151) % 7;
      if (h < 2) { ctx.strokeStyle = 'rgba(255,255,255,0.035)'; ctx.lineWidth = 0.02; ctx.beginPath(); ctx.moveTo(x + 0.1, y + 0.2 + h * 0.2); ctx.quadraticCurveTo(x + 0.5, y + 0.6, x + 0.9, y + 0.4 + h * 0.15); ctx.stroke(); }
      const t = s.tiles[y * SIZE + x];
      if (t.t === 'bramble') this.drawBramble(x, y);
      else if (t.t === 'shrine') this.drawShrine(x, y, t.cd === 0, T);
      if (s.storm.crack && ring === s.storm.ring) this.drawCrack(x, y, T);
    }
    // grid
    ctx.strokeStyle = 'rgba(214,176,92,0.07)'; ctx.lineWidth = 0.015;
    ctx.beginPath(); for (let i = 0; i <= SIZE; i++) { ctx.moveTo(i, 0); ctx.lineTo(i, SIZE); ctx.moveTo(0, i); ctx.lineTo(SIZE, i); } ctx.stroke();

    // tile flashes
    for (const f of this.flashT) { ctx.globalAlpha = (1 - f.t / f.life) * 0.6; ctx.fillStyle = f.color; ctx.fillRect(f.x + 0.04, f.y + 0.04, 0.92, 0.92); }
    ctx.globalAlpha = 1;

    // overlays (moves / ability options / preview)
    this.drawOverlay(T);

    // blink marks
    for (const u of s.units) if (u.alive && u.mark) { ctx.strokeStyle = '#c9a6ff'; ctx.lineWidth = 0.04; ctx.setLineDash([0.1, 0.08]); ctx.beginPath(); ctx.arc(u.mark.x + 0.5, u.mark.y + 0.5, 0.32, T, T + Math.PI * 2); ctx.stroke(); ctx.setLineDash([]); }

    // dash beams
    for (const b of this.beams) {
      const a = 1 - b.t / b.life; ctx.globalAlpha = a;
      ctx.strokeStyle = b.color; ctx.lineWidth = 0.35 * a; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(b.a.x + 0.5, b.a.y + 0.55); ctx.lineTo(b.b.x + 0.5, b.b.y + 0.55); ctx.stroke();
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 0.1 * a; ctx.stroke();
    }
    ctx.globalAlpha = 1; ctx.lineCap = 'butt';

    // items
    for (const it of s.items) this.drawItem(it, T);

    // depth-sorted solids + units
    const draws = [];
    for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
      const t = s.tiles[y * SIZE + x];
      if ((t.t === 'wall' || t.t === 'rubble' || t.t === 'crate') && ringOf(x, y) >= s.storm.ring) draws.push({ y: y + 0.5, fn: () => this.drawSolid(t, x, y) });
    }
    for (const u of s.units) { if (!u.alive) continue; const d = this.disp.get(u.id); if (d) draws.push({ y: d.y + 0.6, fn: () => this.drawUnit(u, d, T) }); }
    for (const dd of this.dying) draws.push({ y: dd.d.y + 0.6, fn: () => this.drawUnit(dd.u, dd.d, T, 1 - dd.t / 0.8) });
    draws.sort((a, b) => a.y - b.y).forEach((d) => d.fn());

    // pillar of light on promote
    if (this.pillar) {
      const p = this.pillar, a = Math.sin((p.t / p.life) * Math.PI);
      const g = ctx.createLinearGradient(0, p.y - 6, 0, p.y + 0.8);
      g.addColorStop(0, p.color + '00'); g.addColorStop(1, p.color);
      ctx.globalAlpha = a * 0.8; ctx.fillStyle = g; ctx.fillRect(p.x - 0.35 * a, p.y - 6, 0.7 * a, 6.8); ctx.globalAlpha = 1;
    }
    // rings
    for (const r of this.rings) {
      if (r.t < 0) continue;
      const k = r.t / r.life, rad = ease(k) * r.r * 0.5;
      ctx.globalAlpha = 1 - k; ctx.strokeStyle = r.color; ctx.lineWidth = 0.08 * (1 - k) + 0.01;
      ctx.beginPath(); ctx.ellipse(r.x, r.y, rad, rad * 0.55, 0, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.globalAlpha = 1;
    // particles
    for (const p of this.parts) {
      const a = 1 - p.t / p.life; ctx.globalAlpha = a; ctx.fillStyle = p.color;
      if (p.kind === 'chunk') ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
      else { ctx.beginPath(); ctx.arc(p.x, p.y, p.size * (p.kind === 'dust' ? 1 + p.t * 3 : a), 0, Math.PI * 2); ctx.fill(); }
    }
    ctx.globalAlpha = 1;
    ctx.restore();

    // floating text in screen space for crispness
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const f of this.floats) {
      const k = f.t / f.life;
      const [sx, sy] = this.toScreen(f.x, f.y - ease(Math.min(1, k * 1.4)) * 0.7);
      const pop = k < 0.15 ? 1 + (1 - k / 0.15) * 0.6 : 1;
      const px = Math.max(12, z * 0.42) * f.size * pop;
      ctx.globalAlpha = k > 0.7 ? (1 - k) / 0.3 : 1;
      ctx.font = `800 ${px}px "Chakra Petch", system-ui, sans-serif`;
      ctx.lineWidth = Math.max(3, px * 0.18); ctx.strokeStyle = 'rgba(8,6,14,0.9)'; ctx.strokeText(f.text, sx + ox, sy + oy);
      ctx.fillStyle = f.color; ctx.fillText(f.text, sx + ox, sy + oy);
    }
    ctx.globalAlpha = 1;
    // vignette
    const vg = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.max(W, H) * 0.75);
    vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,0.55)');
    ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H);
  }

  drawVoid(x, y, T) {
    const ctx = this.x;
    ctx.fillStyle = '#050307'; ctx.fillRect(x, y, 1, 1);
    const f = 0.5 + 0.5 * Math.sin(T * 1.5 + x * 0.7 + y * 0.9);
    ctx.fillStyle = `rgba(255,60,40,${0.05 + f * 0.07})`; ctx.fillRect(x, y, 1, 1);
    const seed = (x * 31 + y * 17) % 10;
    const ey = y + 1 - ((T * 0.3 + seed * 0.1) % 1);
    ctx.fillStyle = `rgba(255,120,60,${0.6 * f})`; ctx.fillRect(x + 0.2 + seed * 0.06, ey, 0.04, 0.04);
  }
  drawCrack(x, y, T) {
    const ctx = this.x;
    const a = 0.45 + 0.35 * Math.sin(T * 6);
    ctx.fillStyle = `rgba(255,50,40,${0.12 + a * 0.12})`; ctx.fillRect(x, y, 1, 1);
    ctx.strokeStyle = `rgba(255,110,70,${a})`; ctx.lineWidth = 0.03;
    const h = (x * 13 + y * 7) % 5;
    ctx.beginPath(); ctx.moveTo(x + 0.1, y + 0.3 + h * 0.08); ctx.lineTo(x + 0.4, y + 0.5); ctx.lineTo(x + 0.55, y + 0.3); ctx.lineTo(x + 0.9, y + 0.6 - h * 0.05);
    ctx.moveTo(x + 0.4, y + 0.5); ctx.lineTo(x + 0.45, y + 0.9); ctx.stroke();
  }
  drawBramble(x, y) {
    const ctx = this.x;
    ctx.fillStyle = 'rgba(60,20,70,0.55)'; ctx.fillRect(x + 0.03, y + 0.03, 0.94, 0.94);
    ctx.strokeStyle = '#6e3a7a'; ctx.lineWidth = 0.035; ctx.lineCap = 'round';
    for (let i = 0; i < 4; i++) {
      const a = (x * 3 + y * 5 + i * 1.7);
      ctx.beginPath(); ctx.moveTo(x + 0.15 + (i % 2) * 0.5, y + 0.15 + i * 0.2);
      ctx.bezierCurveTo(x + 0.5 + Math.sin(a) * 0.3, y + 0.2, x + 0.3, y + 0.8, x + 0.85 - (i % 2) * 0.5, y + 0.85 - i * 0.15); ctx.stroke();
    }
    ctx.fillStyle = '#c66bd8';
    for (let i = 0; i < 5; i++) { const px = x + 0.15 + ((x * 7 + i * 13) % 7) / 9, py = y + 0.15 + ((y * 5 + i * 11) % 7) / 9; ctx.beginPath(); ctx.moveTo(px, py - 0.05); ctx.lineTo(px + 0.03, py + 0.02); ctx.lineTo(px - 0.03, py + 0.02); ctx.fill(); }
    ctx.lineCap = 'butt';
  }
  drawShrine(x, y, on, T) {
    const ctx = this.x, cx = x + 0.5, cy = y + 0.5;
    const p = on ? 0.6 + 0.4 * Math.sin(T * 2.5) : 0.15;
    if (on) { const g = ctx.createRadialGradient(cx, cy, 0.05, cx, cy, 0.6); g.addColorStop(0, `rgba(127,224,255,${0.45 * p})`); g.addColorStop(1, 'rgba(127,224,255,0)'); ctx.fillStyle = g; ctx.fillRect(x - 0.2, y - 0.2, 1.4, 1.4); }
    ctx.strokeStyle = on ? `rgba(160,236,255,${0.5 + p * 0.5})` : 'rgba(120,120,150,0.4)'; ctx.lineWidth = 0.03;
    ctx.beginPath(); ctx.arc(cx, cy, 0.36, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.arc(cx, cy, 0.24, T * (on ? 0.8 : 0), T * (on ? 0.8 : 0) + Math.PI * 1.5); ctx.stroke();
    ctx.save(); ctx.translate(cx, cy); ctx.rotate(-T * 0.5 * (on ? 1 : 0));
    for (let i = 0; i < 4; i++) { ctx.rotate(Math.PI / 2); ctx.beginPath(); ctx.moveTo(0, -0.36); ctx.lineTo(0.05, -0.44); ctx.lineTo(-0.05, -0.44); ctx.closePath(); ctx.fillStyle = ctx.strokeStyle; ctx.fill(); }
    ctx.restore();
  }
  drawSolid(t, x, y) {
    const ctx = this.x;
    if (t.t === 'wall') {
      const h = 0.42;
      ctx.fillStyle = 'rgba(0,0,0,0.4)'; ctx.fillRect(x + 0.05, y + 0.92, 0.98, 0.14);
      ctx.fillStyle = '#272335'; ctx.fillRect(x, y + 1 - h, 1, h); // front face
      ctx.fillStyle = 'rgba(255,255,255,0.04)'; ctx.fillRect(x, y + 1 - h, 1, 0.04);
      const g = ctx.createLinearGradient(x, y - h, x + 1, y + 1 - h);
      g.addColorStop(0, '#4b4560'); g.addColorStop(1, '#353047');
      ctx.fillStyle = g; ctx.fillRect(x, y - h, 1, 1); // top face
      ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 0.02; ctx.strokeRect(x + 0.08, y - h + 0.08, 0.84, 0.84);
      ctx.strokeStyle = 'rgba(214,176,92,0.16)'; ctx.beginPath(); ctx.moveTo(x, y + 1 - h); ctx.lineTo(x + 1, y + 1 - h); ctx.stroke();
    } else if (t.t === 'rubble') {
      const stones = t.built ? [[0.5, 0.55, 0.36]] : [[0.32, 0.62, 0.2], [0.66, 0.6, 0.22], [0.5, 0.38, 0.18]];
      for (const [sx, sy, r] of stones) {
        ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.beginPath(); ctx.ellipse(x + sx, y + sy + r * 0.6, r, r * 0.4, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = t.built ? '#5b5672' : '#4a4658';
        ctx.beginPath(); ctx.moveTo(x + sx - r, y + sy + r * 0.4); ctx.lineTo(x + sx - r * 0.7, y + sy - r * 0.6); ctx.lineTo(x + sx + r * 0.3, y + sy - r * 0.8); ctx.lineTo(x + sx + r, y + sy - r * 0.1); ctx.lineTo(x + sx + r * 0.8, y + sy + r * 0.5); ctx.closePath(); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.12)'; ctx.beginPath(); ctx.moveTo(x + sx - r * 0.7, y + sy - r * 0.6); ctx.lineTo(x + sx + r * 0.3, y + sy - r * 0.8); ctx.lineTo(x + sx, y + sy - r * 0.2); ctx.closePath(); ctx.fill();
      }
      if (t.built) { ctx.strokeStyle = 'rgba(214,176,92,0.4)'; ctx.lineWidth = 0.03; ctx.strokeRect(x + 0.22, y + 0.3, 0.56, 0.4); }
    } else if (t.t === 'crate') {
      const b = 0.14, h = 0.24, w = 1 - b * 2;
      ctx.fillStyle = 'rgba(0,0,0,0.4)'; ctx.fillRect(x + b + 0.04, y + 1 - b - 0.02, w, 0.12);
      ctx.fillStyle = '#5a3a1e'; ctx.fillRect(x + b, y + 1 - b - h, w, h);
      ctx.fillStyle = '#8a5a2e'; ctx.fillRect(x + b, y + b - h + 0.1, w, w - 0.1);
      ctx.strokeStyle = '#d6b05c'; ctx.lineWidth = 0.035; ctx.strokeRect(x + b + 0.02, y + b - h + 0.12, w - 0.04, w - 0.14);
      ctx.beginPath(); ctx.moveTo(x + b + 0.02, y + b - h + 0.12); ctx.lineTo(x + 1 - b - 0.02, y + 1 - b - h - 0.02); ctx.stroke();
      ctx.fillStyle = '#d6b05c'; ctx.fillRect(x + 0.46, y + 1 - b - h, 0.08, h);
    }
  }
  drawItem(it, T) {
    const ctx = this.x, cx = it.x + 0.5, cy = it.y + 0.5;
    const bob = Math.sin(T * 3 + it.x + it.y) * 0.06;
    ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.beginPath(); ctx.ellipse(cx, cy + 0.28, 0.18, 0.06, 0, 0, Math.PI * 2); ctx.fill();
    if (it.k === 'shard') {
      const g = ctx.createRadialGradient(cx, cy, 0.02, cx, cy, 0.5); g.addColorStop(0, 'rgba(157,243,255,0.5)'); g.addColorStop(1, 'rgba(157,243,255,0)');
      ctx.fillStyle = g; ctx.fillRect(cx - 0.5, cy - 0.5, 1, 1);
      const w = 0.14 * Math.abs(Math.cos(T * 2 + it.x)) + 0.04;
      ctx.save(); ctx.translate(cx, cy - 0.05 + bob);
      ctx.fillStyle = '#5fd8ff'; ctx.beginPath(); ctx.moveTo(0, -0.26); ctx.lineTo(w, -0.04); ctx.lineTo(0, 0.2); ctx.lineTo(-w, -0.04); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#d8fbff'; ctx.beginPath(); ctx.moveTo(0, -0.26); ctx.lineTo(w * 0.4, -0.04); ctx.lineTo(0, 0.2); ctx.closePath(); ctx.fill();
      ctx.restore();
      if (it.n > 1) this.badge(cx + 0.25, cy - 0.25, 'x' + it.n);
    } else if (it.k === 'potion') {
      ctx.save(); ctx.translate(cx, cy + bob);
      ctx.fillStyle = '#ff4d74'; ctx.beginPath(); ctx.arc(0, 0.04, 0.15, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#ffd0db'; ctx.fillRect(-0.05, -0.22, 0.1, 0.12);
      ctx.fillStyle = 'rgba(255,255,255,0.6)'; ctx.beginPath(); ctx.arc(-0.05, -0.01, 0.04, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    } else if (it.k === 'haste') {
      ctx.save(); ctx.translate(cx, cy + bob);
      ctx.fillStyle = '#ffe04d'; ctx.beginPath(); ctx.moveTo(0.06, -0.26); ctx.lineTo(-0.12, 0.03); ctx.lineTo(0, 0.03); ctx.lineTo(-0.06, 0.26); ctx.lineTo(0.13, -0.05); ctx.lineTo(0.01, -0.05); ctx.closePath(); ctx.fill();
      ctx.restore();
    } else if (it.k === 'crown') {
      const g = ctx.createRadialGradient(cx, cy, 0.05, cx, cy, 1.1); g.addColorStop(0, 'rgba(255,210,77,0.6)'); g.addColorStop(1, 'rgba(255,210,77,0)');
      ctx.fillStyle = g; ctx.fillRect(cx - 1.1, cy - 1.1, 2.2, 2.2);
      ctx.save(); ctx.translate(cx, cy - 0.1 + bob * 1.5);
      ctx.strokeStyle = 'rgba(255,230,140,0.5)'; ctx.lineWidth = 0.03;
      for (let i = 0; i < 8; i++) { const a = T * 0.6 + i * Math.PI / 4; ctx.beginPath(); ctx.moveTo(Math.cos(a) * 0.3, Math.sin(a) * 0.3); ctx.lineTo(Math.cos(a) * 0.55, Math.sin(a) * 0.55); ctx.stroke(); }
      ctx.fillStyle = '#ffd24d'; ctx.strokeStyle = '#7a5208'; ctx.lineWidth = 0.025;
      ctx.beginPath(); ctx.moveTo(-0.24, 0.12); ctx.lineTo(-0.26, -0.14); ctx.lineTo(-0.12, -0.02); ctx.lineTo(0, -0.2); ctx.lineTo(0.12, -0.02); ctx.lineTo(0.26, -0.14); ctx.lineTo(0.24, 0.12); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#ff4d6d'; ctx.beginPath(); ctx.arc(0, 0.04, 0.04, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
  }
  badge(x, y, text) {
    const ctx = this.x;
    ctx.fillStyle = '#0d0b13'; ctx.beginPath(); ctx.arc(x, y, 0.13, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#9df3ff'; ctx.font = '700 0.15px "Chakra Petch", sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(text, x, y + 0.01);
  }

  drawUnit(u, d, T, fade = 1) {
    const ctx = this.x, s = this.state;
    const cx = d.x + 0.5, base = d.y + 0.86;
    const active = s.active === u.id && !s.over;
    const mine = u.id === this.myId;
    const sk = skinOf(u.skin);
    // shadow
    ctx.globalAlpha = fade;
    ctx.fillStyle = 'rgba(0,0,0,0.45)'; ctx.beginPath(); ctx.ellipse(cx, base, 0.32 - d.lift * 0.1, 0.1, 0, 0, Math.PI * 2); ctx.fill();
    // player ring
    if (u.kind === 'player') {
      ctx.strokeStyle = u.color; ctx.lineWidth = active ? 0.07 : 0.045;
      ctx.globalAlpha = fade * (active ? 0.75 + 0.25 * Math.sin(T * 6) : 0.85);
      ctx.beginPath(); ctx.ellipse(cx, base, 0.38, 0.13, 0, 0, Math.PI * 2); ctx.stroke();
      if (active) { ctx.globalAlpha = fade * 0.25; ctx.fillStyle = u.color; ctx.fill(); }
      ctx.globalAlpha = fade;
    }
    // aura for kings / hone glow
    const hone = u.hone ? (u.hone[u.piece] || 0) : 0;
    if (u.piece === 'king' || hone > 0) {
      const g = ctx.createRadialGradient(cx, base - 0.5, 0.05, cx, base - 0.5, 0.75);
      const c = u.piece === 'king' ? '255,210,77' : '157,243,255';
      g.addColorStop(0, `rgba(${c},${0.22 + 0.08 * Math.sin(T * 3)})`); g.addColorStop(1, `rgba(${c},0)`);
      ctx.fillStyle = g; ctx.fillRect(cx - 0.8, base - 1.3, 1.6, 1.6);
    }
    const bob = d.moving ? 0 : Math.sin(T * 2.2 + u.id) * 0.015;
    const pop = d.pop > 0 ? 1 + Math.sin(d.pop * Math.PI) * 0.25 : 1;
    const sq = d.how === 'jump' && d.moving ? 1 + d.lift * 0.08 : 1;
    ctx.save();
    ctx.translate(cx, base - d.lift + bob);
    ctx.scale(0.92 * pop / sq, 0.92 * pop * sq);
    if (u.kind === 'hollow') { ctx.translate(0, Math.sin(T * 3 + u.id) * 0.04); }
    drawPiece(ctx, u.piece, u.skin, { flash: this.hitFlash.get(u.id) || 0, alpha: fade, t: T, outline: mine ? 'rgba(255,255,255,0.18)' : null });
    ctx.restore();
    // skin trail particles
    if (Math.random() < 0.06 && fade === 1 && u.kind === 'player' && sk.fx !== 'dust') {
      const col = sk.fx === 'ember' ? '#ff8a3d' : sk.fx === 'frost' ? '#d6f7ff' : sk.fx === 'leaf' ? '#8de37a' : sk.fx === 'spark' ? '#00f0ff' : sk.fx === 'star' ? '#d6a6ff' : '#ffe9a8';
      this.parts.push({ x: cx + (Math.random() - 0.5) * 0.4, y: base - 0.3 - Math.random() * 0.5, vx: (Math.random() - 0.5) * 0.2, vy: -0.4, g: -0.1, life: 0.9, t: 0, color: col, size: 0.025, kind: 'spark' });
    }
    // HP bar + name
    if (fade === 1) {
      const top = base + (PIECE_TOP[u.piece] || -1) * 0.92 - 0.14 - d.lift;
      const mx = stats(u).maxHp, r = Math.max(0, u.hp / mx);
      const w = 0.7, bx = cx - w / 2;
      ctx.fillStyle = 'rgba(8,6,14,0.85)'; ctx.fillRect(bx - 0.02, top - 0.02, w + 0.04, 0.11);
      ctx.fillStyle = r > 0.5 ? '#5cff9d' : r > 0.25 ? '#ffd24d' : '#ff4d6d';
      if (u.kind === 'hollow') ctx.fillStyle = '#a7a4d6';
      ctx.fillRect(bx, top, w * r, 0.07);
      if (u.kind === 'player') {
        ctx.fillStyle = u.color; ctx.fillRect(bx - 0.02, top - 0.05, 0.12, 0.03);
        if (this.cam.z > 34) {
          ctx.font = `700 0.17px "Chakra Petch", sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
          ctx.fillStyle = 'rgba(8,6,14,0.8)'; ctx.fillText(u.name, cx + 0.01, top - 0.03 + 0.01);
          ctx.fillStyle = mine ? '#ffffff' : '#d8d2e8'; ctx.fillText(u.name, cx, top - 0.03);
        }
        if (u.shards > 0) this.badge(cx + 0.42, top + 0.03, String(u.shards));
      }
    }
    ctx.globalAlpha = 1;
  }

  drawOverlay(T) {
    const ov = this.overlay; if (!ov) return;
    const ctx = this.x;
    const pulse = 0.5 + 0.5 * Math.sin(T * 5);
    if (ov.moves) for (const m of ov.moves) {
      ctx.fillStyle = `rgba(93,200,255,${0.12 + pulse * 0.08})`; ctx.fillRect(m.x + 0.06, m.y + 0.06, 0.88, 0.88);
      ctx.strokeStyle = 'rgba(127,224,255,0.75)'; ctx.lineWidth = 0.03; ctx.strokeRect(m.x + 0.1, m.y + 0.1, 0.8, 0.8);
      ctx.fillStyle = 'rgba(200,240,255,0.9)'; ctx.beginPath(); ctx.arc(m.x + 0.5, m.y + 0.5, 0.07, 0, Math.PI * 2); ctx.fill();
    }
    if (ov.opts) {
      for (const o of ov.opts) {
        const sel = ov.preview === o;
        if (!sel) { for (const t of o.tiles) { ctx.fillStyle = 'rgba(255,93,93,0.07)'; ctx.fillRect(t.x + 0.06, t.y + 0.06, 0.88, 0.88); } }
        const a = o.anchor;
        ctx.strokeStyle = o.mult > 0 ? `rgba(255,120,100,${0.6 + pulse * 0.4})` : `rgba(201,166,255,${0.6 + pulse * 0.4})`;
        ctx.lineWidth = 0.05;
        const inset = 0.08 + pulse * 0.04;
        this.corners(a.x + inset, a.y + inset, 1 - inset * 2);
        if (o.hits && o.hits.length) { ctx.fillStyle = 'rgba(255,80,80,0.9)'; ctx.beginPath(); ctx.arc(a.x + 0.5, a.y + 0.5, 0.06, 0, Math.PI * 2); ctx.fill(); }
      }
      if (ov.preview) {
        const o = ov.preview;
        for (const t of o.tiles) {
          ctx.fillStyle = o.mult > 0 ? `rgba(255,70,70,${0.35 + pulse * 0.15})` : `rgba(180,140,255,${0.35 + pulse * 0.15})`;
          ctx.fillRect(t.x + 0.04, t.y + 0.04, 0.92, 0.92);
          ctx.strokeStyle = o.mult > 0 ? '#ff8a7a' : '#d9c6ff'; ctx.lineWidth = 0.035; ctx.strokeRect(t.x + 0.06, t.y + 0.06, 0.88, 0.88);
        }
      }
    }
  }
  corners(x, y, w) {
    const ctx = this.x, l = w * 0.28;
    ctx.beginPath();
    ctx.moveTo(x, y + l); ctx.lineTo(x, y); ctx.lineTo(x + l, y);
    ctx.moveTo(x + w - l, y); ctx.lineTo(x + w, y); ctx.lineTo(x + w, y + l);
    ctx.moveTo(x + w, y + w - l); ctx.lineTo(x + w, y + w); ctx.lineTo(x + w - l, y + w);
    ctx.moveTo(x + l, y + w); ctx.lineTo(x, y + w); ctx.lineTo(x, y + w - l);
    ctx.stroke();
  }
}

export { PLAYER_COLORS };
