// Board renderer: themed tiles, pieces, telegraphs, sequenced combat VFX, camera juice.
import { SIZE, BOARDS, ABILITIES, TRAILS } from './data.js';
import { drawPiece, skinOf, PIECE_TOP } from './pieces.js';
import { hiSprite } from './fx.js';
import { ringOf, stats, unitById, previewDamage } from './engine.js';
import { FX } from './fx.js';

const ease = (t) => 1 - Math.pow(1 - t, 3);
const easeBack = (t) => { const c = 1.7; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); };
const lerp = (a, b, t) => a + (b - a) * t;
const MELEE = new Set(['pawnStrike', 'hollowClaw', 'royalStrike', 'pickpocket', 'shove', 'execute', 'tstrike', 'stagger', 'slam']);
const IMPACT = { pawnStrike: 0.12, hollowClaw: 0.12, royalStrike: 0.14, pickpocket: 0.12, shove: 0.12, execute: 0.16, tstrike: 0.12, stagger: 0.12, slam: 0.12, ray: 0.08, siege: 0.25, cross: 0.1, checkmate: 0.1, starburst: 0.1, dominion: 0.1, trample: 0.1, charge: 0.04, decree: 0.04 };

export class Renderer {
  constructor(canvas, hooks = {}) {
    this.c = canvas; this.x = canvas.getContext('2d');
    this.hooks = hooks;
    this.cam = { x: SIZE / 2, y: SIZE / 2, z: 40, tx: SIZE / 2, ty: SIZE / 2, tz: 40 };
    this.fx = new FX();
    this.disp = new Map(); this.floats = []; this.bubbles = [];
    this.shake = 0; this.time = 0; this.real = 0; this.state = null; this.overlay = null; this.myId = null;
    this.hitFlash = new Map(); this.follow = true; this.hs = 0; this.slow = null; this.punch = 0;
    this.theme = BOARDS.hall; this.shakeOn = true; this.timers = [];
    this.motes = Array.from({ length: 46 }, () => ({ x: Math.random() * SIZE, y: Math.random() * SIZE, v: 0.05 + Math.random() * 0.15, p: Math.random() * 6, s: 0.015 + Math.random() * 0.03 }));
    this.intro = null; this.bounds = null; this.marks = [];
    this.resize();
    addEventListener('resize', () => this.resize());
  }
  setQuality(q) { this.quality = q || 'auto'; this.lowQ = q === 'low'; this.ftAvg = 16; this.ftT = 0; this.resize(); }
  setTheme(id) { this.theme = BOARDS[id] || BOARDS.hall; }
  resize() {
    const dpr = this.lowQ ? 1 : Math.min(2, devicePixelRatio || 1);
    const r = this.c.getBoundingClientRect();
    this.W = r.width || innerWidth; this.H = r.height || innerHeight; this.dpr = dpr;
    this.c.width = Math.round(this.W * dpr); this.c.height = Math.round(this.H * dpr);
    this.pad = this.pad || { t: 0, b: 0 };
    this.VH = Math.max(120, this.H - this.pad.t - this.pad.b); this.CY = this.pad.t + this.VH / 2;
    const bw = this.bounds ? this.bounds.x1 - this.bounds.x0 + 1 : SIZE, bh = this.bounds ? this.bounds.y1 - this.bounds.y0 + 1 : SIZE;
    this.fitZoom = Math.min(this.W / (bw + 1.2), this.VH / (bh + 1.2));
    this.minZ = this.fitZoom * 0.9; this.maxZ = Math.max(this.fitZoom * 3, 70);
    if (!this.zoomSet) { this.cam.z = this.cam.tz = this.defaultZoom(); }
  }
  setPad(t, b) { this.pad = { t, b }; this.resize(); }
  defaultZoom() { return this.bounds ? this.fitZoom : Math.max(this.fitZoom, Math.min(this.W, this.VH) / 10.5); }
  setBounds(b) { this.bounds = b; this.zoomSet = false; this.resize(); if (b) { this.cam.x = this.cam.tx = (b.x0 + b.x1 + 1) / 2; this.cam.y = this.cam.ty = (b.y0 + b.y1 + 1) / 2; } }
  get z() { return this.cam.z * (1 + this.punch); }
  toScreen(wx, wy) { return [(wx - this.cam.x) * this.z + this.W / 2, (wy - this.cam.y) * this.z + this.CY]; }
  toWorld(sx, sy) { return [(sx - this.W / 2) / this.z + this.cam.x, (sy - this.CY) / this.z + this.cam.y]; }
  tileAtScreen(sx, sy) { const [wx, wy] = this.toWorld(sx, sy); const x = Math.floor(wx), y = Math.floor(wy); return x >= 0 && y >= 0 && x < SIZE && y < SIZE ? { x, y } : null; }
  focus(x, y) { this.cam.tx = x + 0.5; this.cam.ty = y + 0.5; }
  zoomBy(f, sx = this.W / 2, sy = this.CY) {
    const [wx, wy] = this.toWorld(sx, sy);
    this.cam.z = this.cam.tz = Math.max(this.minZ, Math.min(this.maxZ, this.cam.z * f));
    this.zoomSet = true;
    const [nx, ny] = this.toWorld(sx, sy);
    this.cam.x += wx - nx; this.cam.y += wy - ny; this.cam.tx = this.cam.x; this.cam.ty = this.cam.y;
  }
  pan(dx, dy) { this.cam.x -= dx / this.z; this.cam.y -= dy / this.z; this.cam.tx = this.cam.x; this.cam.ty = this.cam.y; this.follow = false; }
  overview() { this.cam.tz = this.fitZoom; const b = this.bounds; this.cam.tx = b ? (b.x0 + b.x1 + 1) / 2 : SIZE / 2; this.cam.ty = b ? (b.y0 + b.y1 + 1) / 2 : SIZE / 2; this.zoomSet = true; }
  closeup() { this.cam.tz = this.defaultZoom(); this.follow = true; this.zoomSet = true; }
  reset() { this.disp.clear(); this.fx.reset(); this.floats = []; this.bubbles = []; this.timers = []; this.state = null; this.zoomSet = false; this.follow = true; this.hs = 0; this.slow = null; this.punch = 0; this.intro = null; this.marks = []; this.overlay = null; this.cine = null; this.hurt = 0; this.shake = 0; this.hitFlash.clear(); this.seqEnd = 0; this.bgCache = null; }

  kick(n) { if (this.shakeOn && !this.reduced) this.shake = Math.min(16, this.shake + n); }
  hitstop(t) { if (!this.reduced) this.hs = Math.max(this.hs, t); }
  slowmo(scale, dur) { if (!this.reduced) this.slow = { scale, dur, t: 0 }; }
  later(t, fn) { this.timers.push({ at: (this.base ?? this.time) + t, fn }); }
  flush() {
    const due = this.timers.sort((a, b) => a.at - b.at); this.timers = [];
    const saveBase = this.base; this.base = this.time;
    for (const t of due) t.fn();
    this.base = saveBase;
    this.seqEnd = this.time;
    for (const d of this.disp.values()) { d.t0 = -9; d.x = d.sx = d.tx; d.y = d.sy = d.ty; d.lunge = null; }
  }
  sfx(n) { this.hooks.sfx && this.hooks.sfx(n); }
  haptic(p) { this.hooks.haptic && this.hooks.haptic(p); }
  colorOf(id) { const u = this.state && unitById(this.state, id); return u ? u.color : '#fff'; }
  glowOf(id) { const u = this.state && unitById(this.state, id); return u ? skinOf(u.skin).glow : '#fff'; }
  emote(id, text) { this.bubbles = this.bubbles.filter((b) => b.id !== id); this.bubbles.push({ id, text, t: 0, life: 2.8 }); }

  startIntro(s, myId) {
    this.intro = { t: 0 };
    this.cam.x = this.cam.tx = SIZE / 2; this.cam.y = this.cam.ty = SIZE / 2; this.cam.z = this.cam.tz = this.fitZoom * 0.92;
    const players = s.units.filter((u) => u.alive);
    players.forEach((u, i) => {
      const d = this.disp.get(u.id); if (!d) return;
      d.drop = { t0: this.time + 0.7 + i * 0.09, dur: 0.42, landed: false };
    });
    this.later(0.7 + players.length * 0.09 + 0.6, () => {
      const me = unitById(this.state, myId);
      if (me) { this.cam.tz = this.defaultZoom(); this.focus(me.x, me.y); }
    });
  }

  setState(s, events = [], first = false) {
    const now = this.time;
    for (const u of s.units) {
      let d = this.disp.get(u.id);
      if (!d) { d = { face: u.x > SIZE / 2 ? -1 : 1, x: u.x, y: u.y, sx: u.x, sy: u.y, tx: u.x, ty: u.y, t0: -9, dur: 0.2, how: 'step', piece: u.piece, pop: 0, hp: u.hp, ghost: u.hp, lunge: null, deathAt: null, drop: null }; this.disp.set(u.id, d); }
      if (d.piece !== u.piece) { d.pop = 1; d.piece = u.piece; }
    }
    this.state = s;
    if (first) return;
    if ((this.seqEnd || 0) - this.time > 0.9) this.flush();
    this.base = Math.max(this.time, this.seqEnd || 0);
    const now0 = this.base;
    let t = 0; let hits = 0; let lastAb = null;
    for (const e of events) {
      if (e.e === 'move') {
        const d = this.disp.get(e.id); if (!d) continue;
        const dist = Math.hypot(e.to.x - d.tx, e.to.y - d.ty);
        const dur = e.how === 'jump' ? 0.38 : e.how === 'blink' || e.how === 'swap' ? 0.22 : e.how === 'dash' ? 0.12 + dist * 0.025 : e.how === 'push' ? 0.16 : 0.13 + dist * 0.045;
        const start = t;
        this.later(start, () => {
          d.sx = d.x; d.sy = d.y; d.tx = e.to.x; d.ty = e.to.y; d.t0 = this.time; d.how = e.how; d.dur = dur;
          if (e.how !== 'push' && e.to.x !== e.from.x) d.face = e.to.x < e.from.x ? -1 : 1;
          if (e.how === 'dash') this.fx.beam({ x: e.from.x + 0.5, y: e.from.y + 0.55 }, { x: e.to.x + 0.5, y: e.to.y + 0.55 }, this.colorOf(e.id), 0.4, 0.5);
          if (e.how === 'blink' || e.how === 'swap') this.fx.burst(e.from.x + 0.5, e.from.y + 0.5, this.glowOf(e.id), 14, 2.5);
          this.sfx(e.how === 'jump' ? 'jump' : e.how === 'step' || e.how === 'push' ? 'step' : e.how === 'dash' ? 'whoosh' : e.how === 'blink' || e.how === 'swap' ? 'blink' : 'slide');
        });
        if (e.how === 'jump') this.later(start + dur, () => { this.fx.burst(e.to.x + 0.5, e.to.y + 0.85, '#d9cfb8', 12, 2, 'dust'); this.fx.ring(e.to.x + 0.5, e.to.y + 0.86, '#ffffff', 1.2, 0.35, 0.05); d.squash = 1; this.kick(3); this.sfx('land'); });
        else if (e.how !== 'push') this.later(start + dur, () => { d.squash = 0.5; });
        t += e.how === 'push' ? dur * 0.6 : dur * 0.8;
      } else if (e.e === 'ability') {
        hits = 0; lastAb = e.ab;
        const d = this.disp.get(e.id);
        if (e.slot === 'ult') {
          const st = t;
          this.later(st, () => {
            const u = unitById(this.state, e.id);
            this.cine = { t: 0, life: 1.05, name: ABILITIES[e.ab].name, color: u ? u.color : '#ffd24d', who: u ? u.name : '' };
            this.focus(e.from.x, e.from.y); this.punch = Math.max(this.punch, 0.3);
            this.fx.ring(e.from.x + 0.5, e.from.y + 0.8, '#ffd24d', 2.4, 0.8, 0.1); this.fx.burst(e.from.x + 0.5, e.from.y + 0.4, '#ffe9a8', 30, 2, 'up');
            this.sfx('ultcharge'); this.haptic([20, 30, 20, 30, 20]);
          });
          t += 0.8;
        }
        const start = t;
        this.later(start, () => {
          if (d && e.anchor.x !== e.from.x) d.face = e.anchor.x < e.from.x ? -1 : 1;
          if (d && MELEE.has(e.ab)) { const dx = e.anchor.x - e.from.x, dy = e.anchor.y - e.from.y, l = Math.hypot(dx, dy) || 1; d.lunge = { t0: this.time, dx: dx / l, dy: dy / l, dur: 0.26 }; }
          this.fx.ability(e, this.colorOf(e.id), this.glowOf(e.id));
          this.sfx('ab:' + e.ab);
        });
        t += IMPACT[e.ab] ?? 0.06;
      } else if (e.e === 'dmg') {
        hits++;
        const n = hits;
        this.later(t, () => this.onDmg(e, n));
        t += 0.025;
      } else if (e.e === 'death') {
        const d = this.disp.get(e.id); if (d) d.deathAt = now0 + t + 0.06;
        this.later(t + 0.06, () => this.onDeath(e));
        t += 0.2;
      } else if (e.e === 'world' && e.kind === 'meteor' && e.phase === 'strike') {
        this.later(t, () => this.onFx(e));
        t += 0.75;
      } else {
        this.later(t, () => this.onFx(e));
      }
    }
    if (hits >= 2 && lastAb) this.later(t, () => { const a = events.find((q) => q.e === 'ability'); if (a) this.floats.push({ x: a.anchor.x + 0.5, y: a.anchor.y - 1, text: `${hits} HITS`, t: 0, life: 1.1, color: '#ffd24d', size: 0.75 }); });
    // safety sync after the sequence plays
    this.later(t + 0.15, () => {
      for (const u of this.state.units) {
        const d = this.disp.get(u.id); if (!d) continue;
        d.hp = u.alive ? u.hp : 0;
        if (u.alive && !d.moving && (d.tx !== u.x || d.ty !== u.y)) { d.sx = d.x; d.sy = d.y; d.tx = u.x; d.ty = u.y; d.t0 = this.time; d.dur = 0.2; d.how = 'step'; }
      }
    });
    this.seqEnd = this.base + t + 0.05;
    this.base = null;
  }

  onDmg(e, n) {
    const d = this.disp.get(e.id); if (!d) return;
    const x = d.x + 0.5, y = d.y;
    d.hp = Math.max(0, d.hp - e.n);
    const big = e.crit || e.n >= 25;
    this.floats.push({ x: x + (n > 1 ? (Math.random() - 0.5) * 0.4 : 0), y: y - 0.9, text: String(e.n), t: 0, life: 1.15, color: e.storm ? '#ff6b6b' : e.thorns ? '#b6ff7a' : e.crit ? '#ffd24d' : '#ffffff', size: big ? 1.4 : 1, crit: e.crit, rot: (Math.random() - 0.5) * 0.3 });
    if (e.crit) this.floats.push({ x, y: y - 1.45, text: 'CRITICAL', t: 0, life: 0.9, color: '#ffd24d', size: 0.55 });
    this.hitFlash.set(e.id, 1);
    d.recoil = { t0: this.time, src: e.src };
    this.fx.burst(x, y + 0.5, e.storm ? '#ff3b3b' : '#fff1d6', big ? 18 : 9, big ? 4 : 3);
    this.kick(e.crit ? 10 : Math.min(7, 2 + e.n / 8));
    if (e.crit) { this.hitstop(0.09); this.punch = Math.max(this.punch, 0.05); }
    else if (e.n >= 20) this.hitstop(0.045);
    this.sfx(e.crit ? 'crit' : e.storm ? 'burn' : 'hit');
    if (e.id === this.myId) { this.haptic(e.crit ? [30, 40, 60] : 25); this.hurt = 1; }
  }
  onDeath(e) {
    const s = this.state; const v = unitById(s, e.id); if (!v) return;
    const d = this.disp.get(e.id); if (!d) return;
    const killer = e.by ? unitById(s, e.by) : null;
    const fin = killer && killer.kind === 'player' ? killer.finisher || 'shatter' : 'shatter';
    this.fx.finisher(v.kind === 'hollow' ? 'shatter' : fin, d.x + 0.5, d.y + 0.86, v.piece, v.skin, skinOf(v.skin).glow);
    this.kick(v.kind === 'player' ? 14 : 8);
    this.sfx(v.kind === 'player' ? 'kill:' + fin : 'shatter');
    if (v.kind === 'player') {
      this.hitstop(0.12);
      const final = s.over;
      this.slowmo(final ? 0.18 : 0.35, final ? 1.6 : 0.7);
      this.punch = Math.max(this.punch, final ? 0.22 : 0.1);
      if (this.follow || final) this.focus(d.x, d.y);
      if (e.by === this.myId || e.id === this.myId) this.haptic([40, 30, 80]);
      if (e.streak) this.hooks.streak && this.hooks.streak(e);
    }
  }
  onFx(e) {
    const fx = this.fx, s = this.state;
    const at = (id) => { const d = this.disp.get(id); return d ? [d.x + 0.5, d.y] : [0, 0]; };
    switch (e.e) {
      case 'heal': { const [x, y] = at(e.id); const d = this.disp.get(e.id); if (d) d.hp += e.n; this.floats.push({ x, y: y - 0.9, text: '+' + e.n, t: 0, life: 1, color: '#6dffa8', size: 0.9 }); fx.burst(x, y + 0.4, '#6dffa8', 10, 1.5, 'up'); if (e.id === this.myId) this.sfx('heal'); break; }
      case 'aoe': for (const t of e.tiles) fx.flashTile(t.x, t.y, e.kind === 'hit' ? '#ff5d5d' : '#7fe0ff'); break;
      case 'crate': fx.burst(e.x + 0.5, e.y + 0.5, '#c9934d', 14, 3.5, 'chunk'); fx.burst(e.x + 0.5, e.y + 0.5, '#d6b05c', 6, 3, 'chunk'); this.kick(3); this.sfx('crate'); break;
      case 'rubble': fx.burst(e.x + 0.5, e.y + 0.5, '#8d8aa0', e.broke ? 16 : 6, 3, 'chunk'); this.sfx('rubble'); break;
      case 'impact': fx.burst(e.x + 0.5, e.y + 0.6, '#ffe2a8', 14, 3.5); fx.shock(e.x + 0.5, e.y + 0.6, 'rgba(255,220,160,0.5)', 1, 0.3); this.kick(7); this.hitstop(0.05); this.sfx('impact'); break;
      case 'pickup': {
        const [x, y] = at(e.id);
        const col = e.k === 'shard' ? '#9df3ff' : e.k === 'potion' ? '#ff6b8b' : '#ffe04d';
        fx.burst(x, y + 0.2, col, 14, 2, 'up'); fx.ring(x, y + 0.8, col, 1.2, 0.4);
        this.floats.push({ x, y: y - 1.15, text: e.k === 'shard' ? `+${e.n} SHARD${e.n > 1 ? 'S' : ''}` : e.k === 'potion' ? 'POTION' : 'HASTE', t: 0, life: 1.2, color: col, size: 0.62 });
        this.sfx('pickup');
        if (e.id === this.myId && e.k === 'shard' && this.hooks.shard) { const [sx, sy] = this.toScreen(x, y + 0.3); this.hooks.shard(sx, sy, e.n); }
        break;
      }
      case 'promote': case 'crowned': {
        const [x, y] = at(e.id);
        fx.flash(0.5, e.e === 'crowned' ? '#ffe7a0' : '#ffffff');
        fx.pillar(x, y + 0.86, e.e === 'crowned' ? '#ffd24d' : this.glowOf(e.id), 0.9, 1.2);
        fx.ring(x, y + 0.86, '#ffd76a', 3, 0.9, 0.12); fx.ring(x, y + 0.86, this.glowOf(e.id), 2, 0.9, 0.1, 0.15);
        fx.shock(x, y + 0.6, 'rgba(255,240,200,0.4)', 2, 0.5);
        fx.burst(x, y, '#ffe9a8', 44, 4.5, 'up');
        this.kick(9); this.hitstop(0.1); this.punch = Math.max(this.punch, 0.1);
        if (e.id === this.myId) { this.slowmo(0.4, 0.6); this.haptic([20, 40, 20, 40, 60]); }
        this.sfx(e.e === 'crowned' ? 'crown' : 'promote');
        break;
      }
      case 'shrine': fx.ring(e.x + 0.5, e.y + 0.7, '#7fe0ff', 2.4, 0.9); fx.pillar(e.x + 0.5, e.y + 0.86, '#7fe0ff', 0.6, 0.8, 4); this.sfx('shrine'); break;
      case 'storm':
        if (e.phase === 'collapse') {
          const ring = e.ring - 1;
          for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) if (ringOf(x, y) === ring) {
            const ang = Math.atan2(y - SIZE / 2 + 0.5, x - SIZE / 2 + 0.5);
            fx.fallTile(x, y, (x + y) % 2 ? this.theme.dark : this.theme.light, ((ang + Math.PI) / (Math.PI * 2)) * 0.9);
          }
          this.kick(14); this.sfx('storm'); this.haptic([60, 40, 120]);
        } else { this.kick(5); this.sfx('warn'); }
        break;
      case 'stagger': { const [x, y] = at(e.id); this.floats.push({ x, y: y - 1.25, text: 'STAGGERED', t: 0, life: 1, color: '#c9a6ff', size: 0.55 }); break; }
      case 'buff': { const [x, y] = at(e.id); fx.ring(x, y + 0.8, e.k === 'def' ? '#7fb6ff' : e.k === 'spd' || e.k === 'move' ? '#ffe04d' : e.k === 'heal' ? '#6dffa8' : '#ffffff', 1.5, 0.6); this.sfx('buff'); break; }
      case 'rampart': fx.burst(e.x + 0.5, e.y + 0.6, '#b8b2c8', 14, 3, 'chunk'); fx.shock(e.x + 0.5, e.y + 0.6, 'rgba(200,190,220,0.4)', 0.9); this.kick(5); this.sfx('rampart'); break;
      case 'crownSpawn': fx.ring(e.x + 0.5, e.y + 0.6, '#ffd24d', 4, 1.4, 0.14); fx.pillar(e.x + 0.5, e.y + 0.8, '#ffd24d', 1, 1.6, 9); fx.flash(0.35, '#ffe7a0'); this.kick(6); break;
      case 'mark': fx.ring(e.x + 0.5, e.y + 0.6, '#c9a6ff', 1.2, 0.7); break;
      case 'attune': {
        const [x, y] = at(e.id);
        const d = this.disp.get(e.id);
        if (e.milestone) {
          fx.ring(x, y + 0.86, '#9df3ff', 3.2, 0.8, 0.12); fx.shock(x, y + 0.6, 'rgba(157,243,255,0.45)', 1.8, 0.45); fx.burst(x, y, '#d8fbff', 30, 3.5, 'up'); fx.pillar(x, y + 0.86, '#9df3ff', 0.6, 0.8, 5);
          this.floats.push({ x, y: y - 1.5, text: `ATTUNEMENT ${['I', 'II', 'III', 'IV', 'V', 'VI'][e.tier - 1] || e.tier}`, t: 0, life: 1.6, color: '#9df3ff', size: 0.75 });
          this.kick(5); this.sfx('attune'); if (e.id === this.myId) this.haptic([20, 30, 40]);
        } else this.floats.push({ x: x + 0.35, y: y - 0.6, text: `+ATTUNE`, t: 0, life: 0.9, color: '#7fe0ff', size: 0.45 });
        if (d) d.attunePulse = 1;
        break;
      }
      case 'ultReady': { const [x, y] = at(e.id); fx.ring(x, y + 0.86, '#ffd24d', 2, 0.6, 0.1); if (e.id === this.myId) { this.floats.push({ x, y: y - 1.5, text: 'ULTIMATE READY', t: 0, life: 1.5, color: '#ffd24d', size: 0.6 }); this.sfx('ultready'); this.haptic([30, 40, 30]); } break; }
      case 'chest': fx.burst(e.x + 0.5, e.y + 0.5, '#ffd24d', e.broke ? 30 : 10, 4, 'coin'); fx.burst(e.x + 0.5, e.y + 0.5, '#c9934d', 10, 3, 'chunk'); this.kick(e.broke ? 8 : 3); if (e.broke) { fx.ring(e.x + 0.5, e.y + 0.7, '#ffd24d', 3, 0.7, 0.12); fx.flash(0.3, '#ffe7a0'); this.floats.push({ x: e.x + 0.5, y: e.y - 0.6, text: 'CACHE OPENED', t: 0, life: 1.3, color: '#ffd24d', size: 0.6 }); } this.sfx(e.broke ? 'promote' : 'crate'); break;
      case 'world':
        if (e.kind === 'meteor' && e.phase === 'strike') {
          e.centers.forEach((c, i) => fx.meteor(c.x + 0.5, c.y + 0.6, i * 0.08, '#ff8a3d', () => { this.kick(9); this.sfx('impact'); }));
          this.later(0.55, () => { for (const t of e.tiles) fx.flashTile(t.x, t.y, '#ff6a2a', 0.6); this.haptic([60, 30, 60]); });
          this.sfx('meteorfall');
        } else if (e.kind === 'meteor') { this.sfx('warn'); }
        else if (e.kind === 'shardRain') { e.tiles.forEach((t, i) => fx.meteor(t.x + 0.5, t.y + 0.5, i * 0.12, '#9df3ff')); this.sfx('pickup'); }
        else if (e.kind === 'supply') { fx.pillar(e.x + 0.5, e.y + 0.86, '#ffd24d', 1, 1.4, 9); fx.meteor(e.x + 0.5, e.y + 0.6, 0, '#ffd24d', () => { this.kick(10); this.sfx('land'); }); }
        else if (e.kind === 'bloodMoon') { fx.flash(0.4, '#ff2a2a'); this.sfx('dark'); }
        break;
      case 'over': {
        const w = unitById(s, e.winner); const d = w && this.disp.get(w.id);
        if (d) {
          this.later(0.9, () => { this.focus(d.x, d.y); this.cam.tz = this.defaultZoom() * 1.5; this.follow = false; this.fx.pillar(d.x + 0.5, d.y + 0.86, '#ffd24d', 1.2, 2.2, 9); });
          for (let i = 0; i < 9; i++) this.later(1.2 + i * 0.32, () => { const cols = ['#ffd24d', '#7fe0ff', '#ff4d6d', '#5cff9d', '#c77dff']; this.fx.firework(d.x + 0.5 + (Math.random() - 0.5) * 3, d.y - 1.5 - Math.random() * 2, cols[i % cols.length]); this.sfx('firework'); });
        }
        break;
      }
      case 'steadfast': { const [x, y] = at(e.id); this.floats.push({ x, y: y - 1.5, text: 'STEADFAST', t: 0, life: 1.4, color: '#9df3ff', size: 0.6 }); fx.glyph(x, y - 0.3, '#9df3ff', 'shield', 1); fx.ring(x, y + 0.8, '#9df3ff', 1.8, 0.6); break; }
      case 'bramble': { const [x, y] = at(e.id); this.floats.push({ x, y: y - 1.2, text: 'SLOWED', t: 0, life: 0.9, color: '#d58bea', size: 0.5 }); break; }
    }
    void s;
  }

  frame(realDt) {
    this.real += realDt;
    if (this.quality === 'auto' && !this.lowQ) { this.ftAvg = (this.ftAvg || 16) * 0.95 + realDt * 1000 * 0.05; this.ftT = (this.ftT || 0) + realDt; if (this.ftT > 4 && this.ftAvg > 27) { this.lowQ = true; this.resize(); } }
    if (this.reduced) this.punch = 0;
    this.fx.cap = this.lowQ ? 260 : 600;
    let dt = realDt;
    if (this.hs > 0) { this.hs -= realDt; dt = realDt * 0.04; }
    else if (this.slow) { this.slow.t += realDt; const k = Math.min(1, this.slow.t / this.slow.dur); dt = realDt * lerp(this.slow.scale, 1, k * k); if (k >= 1) this.slow = null; }
    this.time += dt;
    if (this.intro) this.intro.t += dt;
    if (this.timers.length) { const due = this.timers.filter((t) => t.at <= this.time); this.timers = this.timers.filter((t) => t.at > this.time); due.forEach((t) => t.fn()); }
    this.fx.update(dt);
    if (this.fx.impactKick) { this.kick(this.fx.impactKick); this.fx.impactKick = 0; }
    if (this.cine) { this.cine.t += realDt; if (this.cine.t > this.cine.life) this.cine = null; }
    const cam = this.cam;
    const k = 1 - Math.pow(0.0015, realDt);
    cam.x = lerp(cam.x, cam.tx, k); cam.y = lerp(cam.y, cam.ty, k); cam.z = lerp(cam.z, cam.tz, k);
    const z = this.z;
    const B = this.bounds || { x0: 0, y0: 0, x1: SIZE - 1, y1: SIZE - 1 };
    const clamp = (v, span, lo, hi, zz) => { const h = span / zz / 2, len = hi - lo + 1; return len + 1 <= h * 2 ? lo + len / 2 : Math.max(lo + h - 0.5, Math.min(hi + 1.5 - h, v)); };
    cam.x = clamp(cam.x, this.W, B.x0, B.x1, z); cam.y = clamp(cam.y, this.VH, B.y0, B.y1, z);
    cam.tx = clamp(cam.tx, this.W, B.x0, B.x1, cam.tz); cam.ty = clamp(cam.ty, this.VH, B.y0, B.y1, cam.tz);
    this.punch *= Math.pow(0.02, realDt);
    for (const d of this.disp.values()) {
      const t = Math.max(0, Math.min(1, (this.time - d.t0) / d.dur));
      const e = d.how === 'jump' ? t : d.how === 'push' ? easeBack(t) : ease(t);
      d.x = lerp(d.sx, d.tx, e); d.y = lerp(d.sy, d.ty, e);
      d.lift = d.how === 'jump' ? Math.sin(t * Math.PI) * 0.9 : 0;
      d.moving = t < 1;
      d.pop = Math.max(0, d.pop - dt * 1.6);
      d.squash = Math.max(0, (d.squash || 0) - dt * 5);
      d.ghost = d.ghost > d.hp ? Math.max(d.hp, d.ghost - dt * 40) : d.hp;
    }
    for (const b of this.bubbles) b.t += realDt;
    this.bubbles = this.bubbles.filter((b) => b.t < b.life);
    this.shake *= Math.pow(0.002, realDt);
    this.hurt = Math.max(0, (this.hurt || 0) - realDt * 2);
    for (const [id, f] of this.hitFlash) { const v = f - dt * 6; if (v <= 0) this.hitFlash.delete(id); else this.hitFlash.set(id, v); }
    this.floats = this.floats.filter((p) => (p.t += dt) < p.life);
    for (const m of this.motes) { m.y -= m.v * realDt; m.p += realDt; if (m.y < -0.5) { m.y = SIZE + 0.5; m.x = Math.random() * SIZE; } }
    this.draw();
  }

  tileVisible(x, y) {
    if (!this.intro || this.intro.t > 1.6) return 1;
    const d = Math.hypot(x - SIZE / 2 + 0.5, y - SIZE / 2 + 0.5);
    return Math.max(0, Math.min(1, (this.intro.t * 12 - d) / 3));
  }

  draw() {
    const { x: ctx, W, H, dpr } = this;
    const s = this.state, th = this.theme;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const bk = W + 'x' + H + th.name + this.CY;
    if (!this.bgCache || this.bgCache.k !== bk) {
      const bg = ctx.createRadialGradient(W / 2, this.CY, 10, W / 2, this.CY, Math.max(W, H) * 0.8);
      bg.addColorStop(0, th.bg[0]); bg.addColorStop(1, th.bg[1]);
      const vg0 = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.32, W / 2, H / 2, Math.max(W, H) * 0.75);
      vg0.addColorStop(0, 'rgba(0,0,0,0)'); vg0.addColorStop(1, 'rgba(0,0,0,0.55)');
      this.bgCache = { k: bk, bg, vg0 };
    }
    ctx.fillStyle = this.bgCache.bg; ctx.fillRect(0, 0, W, H);
    if (!s) return;
    if (s.bloodMoon) { const mx = W * 0.8, my = this.pad.t + 70; const g2 = ctx.createRadialGradient(mx, my, 10, mx, my, 160); g2.addColorStop(0, 'rgba(255,60,40,0.55)'); g2.addColorStop(1, 'rgba(255,60,40,0)'); ctx.fillStyle = g2; ctx.fillRect(mx - 160, my - 160, 320, 320); ctx.fillStyle = '#ff5a40'; ctx.beginPath(); ctx.arc(mx, my, 34, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = 'rgba(120,10,10,0.5)'; ctx.beginPath(); ctx.arc(mx + 8, my - 6, 30, 0, Math.PI * 2); ctx.fill(); }
    const z = this.z, T = this.time;
    const sh = this.shake;
    const ox = (Math.random() - 0.5) * sh, oy = (Math.random() - 0.5) * sh;
    ctx.save();
    ctx.translate(W / 2 + ox, this.CY + oy); ctx.scale(z, z); ctx.translate(-this.cam.x, -this.cam.y);

    // frame
    const fa = this.tileVisible(0, 0) > 0 ? 1 : 0;
    ctx.globalAlpha = this.intro && this.intro.t < 1.6 ? Math.min(1, this.intro.t * 1.5) : 1;
    const FB = this.bounds || { x0: 0, y0: 0, x1: SIZE - 1, y1: SIZE - 1 };
    const fw = FB.x1 - FB.x0 + 1, fh = FB.y1 - FB.y0 + 1;
    ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(FB.x0 - 0.45, FB.y0 - 0.25, fw + 0.9, fh + 0.9);
    ctx.fillStyle = '#0d0b13'; ctx.fillRect(FB.x0 - 0.35, FB.y0 - 0.35, fw + 0.7, fh + 0.7);
    ctx.strokeStyle = th.frame; ctx.globalAlpha *= 0.6; ctx.lineWidth = 0.05; ctx.strokeRect(FB.x0 - 0.3, FB.y0 - 0.3, fw + 0.6, fh + 0.6);
    ctx.globalAlpha *= 0.4; ctx.lineWidth = 0.02; ctx.strokeRect(FB.x0 - 0.18, FB.y0 - 0.18, fw + 0.36, fh + 0.36);
    ctx.globalAlpha = 1; void fa;

    // floor
    for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
      const vis = this.tileVisible(x, y);
      if (vis <= 0) continue;
      const ring = ringOf(x, y);
      if (s.tiles[y * SIZE + x].t === 'out') continue;
      if (ring < s.storm.ring) { this.drawVoid(x, y, T); continue; }
      ctx.globalAlpha = vis;
      const inset = (1 - vis) * 0.5;
      ctx.fillStyle = (x + y) % 2 === 0 ? th.light : th.dark;
      ctx.fillRect(x + inset, y + inset, 1 - inset * 2, 1 - inset * 2);
      const h = (x * 73 + y * 151) % 7;
      if (h < 3) { ctx.strokeStyle = th.vein; ctx.lineWidth = 0.02; ctx.beginPath(); ctx.moveTo(x + 0.1, y + 0.2 + h * 0.2); ctx.quadraticCurveTo(x + 0.5, y + 0.6, x + 0.9, y + 0.4 + h * 0.15); ctx.stroke(); }
      if (th.stars && (x * 7 + y * 13) % 5 === 0) { const tw = 0.3 + 0.7 * Math.abs(Math.sin(T * 1.5 + x * 3 + y)); ctx.fillStyle = `rgba(220,240,255,${tw * 0.7})`; ctx.fillRect(x + 0.2 + ((x * 31) % 6) / 10, y + 0.2 + ((y * 17) % 6) / 10, 0.035, 0.035); }
      if (th.lava && h === 1) { const a = 0.35 + 0.3 * Math.sin(T * 2 + x + y); ctx.strokeStyle = `rgba(255,110,30,${a})`; ctx.lineWidth = 0.035; ctx.beginPath(); ctx.moveTo(x + 0.15, y + 0.7); ctx.lineTo(x + 0.45, y + 0.55); ctx.lineTo(x + 0.6, y + 0.75); ctx.lineTo(x + 0.88, y + 0.6); ctx.stroke(); }
      const t = s.tiles[y * SIZE + x];
      if (t.t === 'bramble') this.drawBramble(x, y);
      else if (t.t === 'shrine') this.drawShrine(x, y, t.cd === 0, T);
      if (s.storm.crack && ring === s.storm.ring) this.drawCrack(x, y, T);
    }
    ctx.globalAlpha = 1;
    // grid
    ctx.strokeStyle = th.grid; ctx.lineWidth = th.glowGrid ? 0.025 : 0.015;
    ctx.beginPath(); for (let i = FB.x0; i <= FB.x1 + 1; i++) { ctx.moveTo(i, FB.y0); ctx.lineTo(i, FB.y1 + 1); } for (let i = FB.y0; i <= FB.y1 + 1; i++) { ctx.moveTo(FB.x0, i); ctx.lineTo(FB.x1 + 1, i); } ctx.stroke();
    if (th.glowGrid) {
      const sweep = (T * 3) % (SIZE + 6) - 3;
      ctx.strokeStyle = 'rgba(0,240,255,0.5)'; ctx.lineWidth = 0.04;
      ctx.beginPath(); ctx.moveTo(0, sweep); ctx.lineTo(SIZE, sweep); ctx.stroke();
    }
    this.fx.drawFalls(ctx, th);
    this.fx.drawGround(ctx);

    // active spotlight
    const act = s.active && unitById(s, s.active);
    if (act && act.alive && !s.over) {
      const d = this.disp.get(act.id);
      if (d) { const g = ctx.createRadialGradient(d.x + 0.5, d.y + 0.6, 0.1, d.x + 0.5, d.y + 0.6, 1.6); g.addColorStop(0, `rgba(255,240,200,${0.13 + 0.05 * Math.sin(T * 4)})`); g.addColorStop(1, 'rgba(255,240,200,0)'); ctx.fillStyle = g; ctx.fillRect(d.x - 1.2, d.y - 1, 3.4, 3.4); }
    }

    this.drawOverlay(T);
    for (const m of this.marks) {
      const p = 0.5 + 0.5 * Math.sin(T * 5);
      const g = ctx.createRadialGradient(m.x + 0.5, m.y + 0.5, 0.05, m.x + 0.5, m.y + 0.5, 0.75);
      g.addColorStop(0, `rgba(255,215,110,${0.35 + p * 0.25})`); g.addColorStop(1, 'rgba(255,215,110,0)');
      ctx.fillStyle = g; ctx.fillRect(m.x - 0.3, m.y - 0.3, 1.6, 1.6);
      ctx.strokeStyle = '#ffd76a'; ctx.lineWidth = 0.06; ctx.strokeRect(m.x + 0.08, m.y + 0.08, 0.84, 0.84);
      const ay = m.y - 0.55 - Math.abs(Math.sin(T * 4)) * 0.3;
      ctx.fillStyle = '#ffd76a'; ctx.beginPath(); ctx.moveTo(m.x + 0.3, ay); ctx.lineTo(m.x + 0.7, ay); ctx.lineTo(m.x + 0.5, ay + 0.25); ctx.closePath(); ctx.fill();
      if (m.label) { ctx.font = '700 0.2px "Chakra Petch", sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom'; const w = ctx.measureText(m.label).width + 0.14; ctx.fillStyle = 'rgba(10,9,15,0.9)'; ctx.fillRect(m.x + 0.5 - w / 2, ay - 0.3, w, 0.26); ctx.fillStyle = '#ffe3a1'; ctx.fillText(m.label, m.x + 0.5, ay - 0.06); }
    }
    if (s.meteors && s.meteors.length) {
      for (const m of s.meteors) {
        const p = 0.5 + 0.5 * Math.sin(T * 8);
        for (const [dx, dy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) { const x = m.x + dx, y = m.y + dy; if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) continue; ctx.fillStyle = `rgba(255,80,30,${0.18 + p * 0.18})`; ctx.fillRect(x + 0.04, y + 0.04, 0.92, 0.92); }
        ctx.strokeStyle = `rgba(255,140,60,${0.6 + p * 0.4})`; ctx.lineWidth = 0.06;
        ctx.beginPath(); ctx.arc(m.x + 0.5, m.y + 0.5, 0.42 + p * 0.08, 0, Math.PI * 2); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(m.x - 0.1, m.y + 0.5); ctx.lineTo(m.x + 1.1, m.y + 0.5); ctx.moveTo(m.x + 0.5, m.y - 0.1); ctx.lineTo(m.x + 0.5, m.y + 1.1); ctx.stroke();
      }
    }

    for (const u of s.units) if (u.alive && u.mark) { ctx.strokeStyle = '#c9a6ff'; ctx.lineWidth = 0.04; ctx.setLineDash([0.1, 0.08]); ctx.beginPath(); ctx.arc(u.mark.x + 0.5, u.mark.y + 0.5, 0.32, T, T + Math.PI * 2); ctx.stroke(); ctx.setLineDash([]); }
    for (const it of s.items) if (this.tileVisible(it.x, it.y) >= 1) this.drawItem(it, T);

    const draws = [];
    for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
      const t = s.tiles[y * SIZE + x];
      if ((t.t === 'wall' || t.t === 'rubble' || t.t === 'crate' || t.t === 'chest') && ringOf(x, y) >= s.storm.ring) { const vis = this.tileVisible(x, y); if (vis > 0) draws.push({ y: y + 0.5, fn: () => this.drawSolid(t, x, y, vis) }); }
    }
    for (const u of s.units) {
      const d = this.disp.get(u.id); if (!d) continue;
      const showing = u.alive || (d.deathAt != null && this.time < d.deathAt);
      if (!showing) continue;
      if (d.drop && this.time < d.drop.t0) continue;
      draws.push({ y: d.y + 0.6, fn: () => this.drawUnit(u, d, T) });
    }
    this.labelQ = [];
    draws.sort((a, b) => a.y - b.y).forEach((d) => d.fn());
    for (const f of this.labelQ) f();
    this.labelQ = [];

    this.drawWeather(ctx, T);
    this.fx.drawAbove(ctx);
    ctx.restore();

    if (s.bloodMoon) { ctx.globalAlpha = 0.16 + 0.04 * Math.sin(this.real * 2); ctx.fillStyle = '#ff1a1a'; ctx.fillRect(0, 0, W, H); ctx.globalAlpha = 1; }
    this.drawScreenText(ox, oy);

    // screen flash / vignettes
    if (this.fx.screenFlash > 0.01 && !this.reduced) { ctx.globalAlpha = this.fx.screenFlash * 0.7; ctx.fillStyle = this.fx.flashColor; ctx.fillRect(0, 0, W, H); ctx.globalAlpha = 1; }
    const me = this.myId && unitById(s, this.myId);
    let red = 0;
    if (me && me.alive) {
      const d = this.disp.get(me.id); const r = d ? d.hp / stats(me).maxHp : 1;
      if (r < 0.3) red = 0.25 + 0.2 * Math.max(0, Math.sin(this.real * 6));
      if (ringOf(me.x, me.y) < s.storm.ring || (s.storm.crack && ringOf(me.x, me.y) === s.storm.ring)) red = Math.max(red, 0.3 + 0.15 * Math.sin(this.real * 8));
    }
    red = Math.max(red, this.hurt * 0.45);
    let vg = this.bgCache.vg0;
    if (red > 0) { vg = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.32, W / 2, H / 2, Math.max(W, H) * 0.75); vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, `rgba(120,0,10,${0.45 + red})`); }
    ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H);
    if (this.cine) this.drawCine(ctx, W, H);
    if (this.slow) { ctx.globalAlpha = 0.25 * (1 - this.slow.t / this.slow.dur); ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H * 0.08); ctx.fillRect(0, H * 0.92, W, H * 0.08); ctx.globalAlpha = 1; }
  }

  drawScreenText(ox, oy) {
    const ctx = this.x, z = this.z, s = this.state;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const f of this.floats) {
      const k = f.t / f.life;
      const [sx, sy] = this.toScreen(f.x, f.y - ease(Math.min(1, k * 1.4)) * 0.7);
      const pop = k < 0.12 ? 1 + (1 - k / 0.12) * 0.8 : 1;
      const px = Math.max(12, z * 0.42) * f.size * pop;
      ctx.save(); ctx.translate(sx + ox, sy + oy); ctx.rotate((f.rot || 0) * (1 - k));
      ctx.globalAlpha = k > 0.7 ? (1 - k) / 0.3 : 1;
      ctx.font = `800 ${px}px "Chakra Petch", system-ui, sans-serif`;
      ctx.lineWidth = Math.max(3, px * 0.2); ctx.strokeStyle = 'rgba(8,6,14,0.92)'; ctx.lineJoin = 'round'; ctx.strokeText(f.text, 0, 0);
      ctx.fillStyle = f.color; ctx.fillText(f.text, 0, 0);
      ctx.restore();
    }
    ctx.globalAlpha = 1;
    // damage preview labels
    const ov = this.overlay;
    const me = this.myId && unitById(s, this.myId);
    if (ov && ov.preview && me) {
      for (const id of ov.preview.hits || []) {
        const v = unitById(s, id); const d = this.disp.get(id); if (!v || !d) continue;
        const [lo, hi] = previewDamage(me, v, ov.preview.mult);
        const ko = lo >= v.hp, maybe = !ko && hi >= v.hp;
        const [sx, sy] = this.toScreen(d.x + 0.5, d.y + 0.86 + (PIECE_TOP[v.piece] || -1) * 0.92 - 0.55);
        const text = ko ? 'KO' : `${lo}-${hi}${maybe ? ' KO?' : ''}`;
        const px = Math.max(11, z * 0.28);
        ctx.font = `800 ${px}px "Chakra Petch", sans-serif`;
        const w = ctx.measureText(text).width + px;
        const bob = Math.sin(this.real * 6) * 2;
        ctx.fillStyle = ko ? '#ffd24d' : 'rgba(150,20,30,0.92)';
        roundRect(ctx, sx - w / 2, sy - px * 0.75 + bob, w, px * 1.5, px * 0.4); ctx.fill();
        ctx.fillStyle = ko ? '#1a1205' : '#fff'; ctx.fillText(text, sx, sy + bob);
      }
    }
    // emote bubbles
    for (const b of this.bubbles) {
      const d = this.disp.get(b.id); const u = unitById(s, b.id); if (!d || !u || !u.alive) continue;
      const k = b.t / b.life; const pop = k < 0.08 ? easeBack(k / 0.08) : 1;
      const [sx, sy] = this.toScreen(d.x + 0.5, d.y + 0.86 + (PIECE_TOP[u.piece] || -1) * 0.92 - 0.7);
      const px = Math.max(12, z * 0.3);
      ctx.font = `700 ${px}px "Chakra Petch", sans-serif`;
      const w = ctx.measureText(b.text).width + px * 1.2, h = px * 1.7;
      ctx.save(); ctx.translate(sx, sy - h * 0.5); ctx.scale(pop, pop); ctx.globalAlpha = k > 0.85 ? (1 - k) / 0.15 : 1;
      ctx.fillStyle = '#f6f1ff'; roundRect(ctx, -w / 2, -h / 2, w, h, h * 0.4); ctx.fill();
      ctx.beginPath(); ctx.moveTo(-6, h / 2 - 1); ctx.lineTo(0, h / 2 + 7); ctx.lineTo(6, h / 2 - 1); ctx.fill();
      ctx.fillStyle = u.color; ctx.fillRect(-w / 2 + 4, -h / 2 + 3, 3, h - 6);
      ctx.fillStyle = '#1a1626'; ctx.fillText(b.text, 3, 1);
      ctx.restore();
    }
  }

  drawWeather(ctx, T) {
    const th = this.theme, w = th.weather || 'dust';
    for (let mi = 0; mi < this.motes.length; mi += this.lowQ ? 2 : 1) {
      const m = this.motes[mi];
      const a = 0.5 + 0.5 * Math.sin(m.p * 2);
      if (w === 'petals') {
        const x = m.x + Math.sin(m.p * 0.7) * 0.8, y = SIZE - m.y;
        ctx.globalAlpha = 0.55; ctx.fillStyle = m.s > 0.03 ? '#ffd1dc' : '#fff6f0';
        ctx.save(); ctx.translate(x, y); ctx.rotate(m.p); ctx.beginPath(); ctx.ellipse(0, 0, m.s * 2.2, m.s * 1.1, 0, 0, Math.PI * 2); ctx.fill(); ctx.restore();
      } else if (w === 'pixels') {
        ctx.globalAlpha = a * 0.6; ctx.fillStyle = m.s > 0.03 ? '#ff3df2' : '#00f0ff'; ctx.fillRect(m.x, m.y, m.s * 1.8, m.s * 1.8);
      } else if (w === 'embers') {
        ctx.globalAlpha = a * 0.8; ctx.fillStyle = a > 0.6 ? '#ffd27a' : '#ff6a1f'; ctx.beginPath(); ctx.arc(m.x + Math.sin(m.p * 1.7) * 0.4, m.y, m.s * 1.2, 0, Math.PI * 2); ctx.fill();
      } else if (w === 'fireflies') {
        const x = m.x + Math.sin(m.p * 0.9) * 0.9, y = m.y + Math.cos(m.p * 0.6) * 0.9 + (SIZE - m.y) * 0;
        const blink = Math.max(0, Math.sin(m.p * 2.5 + m.x));
        ctx.globalAlpha = blink * 0.9;
        ctx.fillStyle = 'rgba(220,255,140,0.25)'; ctx.beginPath(); ctx.arc(x, y, 0.16, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = 'rgba(240,255,190,0.95)'; ctx.beginPath(); ctx.arc(x, y, 0.045, 0, Math.PI * 2); ctx.fill();
      } else if (w === 'snow') {
        const x = m.x + Math.sin(m.p * 0.8) * 0.5, y = SIZE - m.y;
        ctx.globalAlpha = 0.75; ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(x, y, m.s * 1.4, 0, Math.PI * 2); ctx.fill();
      } else if (w === 'bubbles') {
        ctx.globalAlpha = 0.35 + a * 0.3; ctx.strokeStyle = '#9dfff6'; ctx.lineWidth = 0.012; ctx.beginPath(); ctx.arc(m.x + Math.sin(m.p * 1.3) * 0.25, m.y, m.s * 2.2, 0, Math.PI * 2); ctx.stroke();
      } else if (w === 'stars') {
        ctx.globalAlpha = a * 0.7; ctx.fillStyle = '#e8f6ff'; ctx.fillRect(m.x, m.y, m.s, m.s);
      } else {
        ctx.globalAlpha = 0.15 + 0.15 * Math.sin(m.p * 2); ctx.fillStyle = th.mote; ctx.beginPath(); ctx.arc(m.x + Math.sin(m.p) * 0.3, m.y, m.s, 0, Math.PI * 2); ctx.fill();
      }
    }
    if (w === 'stars' && Math.random() < 0.006) this.fx.beam({ x: Math.random() * SIZE, y: Math.random() * 4 }, { x: Math.random() * SIZE, y: 4 + Math.random() * 6 }, '#d8f6ff', 0.05, 0.6);
    ctx.globalAlpha = 1;
  }
  drawCine(ctx, W, H) {
    const c = this.cine, k = c.t / c.life;
    const inA = Math.min(1, k * 6), outA = k > 0.8 ? (1 - k) / 0.2 : 1, a = inA * outA;
    ctx.globalAlpha = 0.45 * a; ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
    ctx.globalAlpha = a; ctx.fillRect(0, 0, W, H * 0.1 * inA); ctx.fillRect(0, H - H * 0.1 * inA, W, H * 0.1 * inA);
    const by = this.pad.t + 30, bh = Math.min(110, H * 0.13);
    const slide = (1 - Math.min(1, k * 4)) * W;
    ctx.save(); ctx.translate(slide, 0);
    ctx.globalAlpha = 0.85 * a; ctx.fillStyle = c.color;
    ctx.beginPath(); ctx.moveTo(0, by + 14); ctx.lineTo(W, by - 14); ctx.lineTo(W, by - 14 + bh); ctx.lineTo(0, by + 14 + bh); ctx.closePath(); ctx.fill();
    ctx.globalAlpha = a; ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fill();
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    let px = Math.min(52, W / 9);
    ctx.font = `900 ${px}px Cinzel, serif`;
    const tw = ctx.measureText(c.name.toUpperCase()).width;
    if (tw > W * 0.9) { px *= (W * 0.9) / tw; ctx.font = `900 ${px}px Cinzel, serif`; } ctx.lineWidth = 6; ctx.strokeStyle = '#000';
    ctx.strokeText(c.name.toUpperCase(), W / 2, by + bh / 2 - 6); ctx.fillStyle = '#ffe9a8'; ctx.fillText(c.name.toUpperCase(), W / 2, by + bh / 2 - 6);
    ctx.font = `700 ${Math.max(11, px * 0.28)}px "Chakra Petch", sans-serif`; ctx.fillStyle = c.color; ctx.fillText(('ULTIMATE - ' + c.who).toUpperCase(), W / 2, by + bh / 2 + px * 0.55);
    ctx.restore(); ctx.globalAlpha = 1;
  }
  drawVoid(x, y, T) {
    const ctx = this.x;
    ctx.fillStyle = '#050307'; ctx.fillRect(x, y, 1, 1);
    const f = 0.5 + 0.5 * Math.sin(T * 1.5 + x * 0.7 + y * 0.9);
    ctx.fillStyle = `rgba(255,60,40,${0.04 + f * 0.07})`; ctx.fillRect(x, y, 1, 1);
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
    if (Math.random() < 0.01) this.fx.burst(x + 0.5, y + 0.5, '#ff6a3d', 1, 0.6, 'up');
  }
  drawBramble(x, y) {
    const ctx = this.x;
    ctx.fillStyle = 'rgba(60,20,70,0.55)'; ctx.fillRect(x + 0.03, y + 0.03, 0.94, 0.94);
    ctx.strokeStyle = '#6e3a7a'; ctx.lineWidth = 0.035; ctx.lineCap = 'round';
    for (let i = 0; i < 4; i++) {
      const a = (x * 3 + y * 5 + i * 1.7) + Math.sin(this.time * 1.2 + i) * 0.15;
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
    if (on) { const g = ctx.createRadialGradient(cx, cy, 0.05, cx, cy, 0.7); g.addColorStop(0, `rgba(127,224,255,${0.5 * p})`); g.addColorStop(1, 'rgba(127,224,255,0)'); ctx.fillStyle = g; ctx.fillRect(x - 0.3, y - 0.3, 1.6, 1.6); if (Math.random() < 0.05) this.fx.burst(cx, cy + 0.2, '#9df3ff', 1, 0.5, 'up'); }
    ctx.strokeStyle = on ? `rgba(160,236,255,${0.5 + p * 0.5})` : 'rgba(120,120,150,0.4)'; ctx.lineWidth = 0.03;
    ctx.beginPath(); ctx.arc(cx, cy, 0.36, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.arc(cx, cy, 0.24, T * (on ? 0.8 : 0), T * (on ? 0.8 : 0) + Math.PI * 1.5); ctx.stroke();
    ctx.save(); ctx.translate(cx, cy); ctx.rotate(-T * 0.5 * (on ? 1 : 0));
    for (let i = 0; i < 4; i++) { ctx.rotate(Math.PI / 2); ctx.beginPath(); ctx.moveTo(0, -0.36); ctx.lineTo(0.05, -0.44); ctx.lineTo(-0.05, -0.44); ctx.closePath(); ctx.fillStyle = ctx.strokeStyle; ctx.fill(); }
    ctx.restore();
  }
  drawSolid(t, x, y, vis = 1) {
    const ctx = this.x, th = this.theme;
    ctx.globalAlpha = vis;
    const rise = (1 - vis) * 0.6;
    if (t.t === 'wall') {
      const h = 0.42 * vis;
      ctx.fillStyle = 'rgba(0,0,0,0.4)'; ctx.fillRect(x + 0.05, y + 0.92, 0.98, 0.14);
      ctx.fillStyle = th.wallFront; ctx.fillRect(x, y + 1 - h, 1, h);
      ctx.fillStyle = 'rgba(255,255,255,0.05)'; ctx.fillRect(x, y + 1 - h, 1, 0.04);
      const g = ctx.createLinearGradient(x, y - h, x + 1, y + 1 - h);
      g.addColorStop(0, th.wallTop[0]); g.addColorStop(1, th.wallTop[1]);
      ctx.fillStyle = g; ctx.fillRect(x, y - h, 1, 1);
      ctx.strokeStyle = 'rgba(0,0,0,0.3)'; ctx.lineWidth = 0.02; ctx.strokeRect(x + 0.08, y - h + 0.08, 0.84, 0.84);
      ctx.strokeStyle = th.frame + '33'; ctx.beginPath(); ctx.moveTo(x, y + 1 - h); ctx.lineTo(x + 1, y + 1 - h); ctx.stroke();
      if (th.glowGrid) { ctx.strokeStyle = 'rgba(255,61,242,0.6)'; ctx.lineWidth = 0.03; ctx.strokeRect(x + 0.03, y - h + 0.03, 0.94, 0.94); }
    } else if (t.t === 'rubble') {
      const stones = t.built ? [[0.5, 0.55, 0.36]] : [[0.32, 0.62, 0.2], [0.66, 0.6, 0.22], [0.5, 0.38, 0.18]];
      for (const [sx, sy0, r] of stones) {
        const sy = sy0 - rise;
        ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.beginPath(); ctx.ellipse(x + sx, y + sy0 + r * 0.6, r, r * 0.4, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = t.built ? '#5b5672' : '#4a4658';
        ctx.beginPath(); ctx.moveTo(x + sx - r, y + sy + r * 0.4); ctx.lineTo(x + sx - r * 0.7, y + sy - r * 0.6); ctx.lineTo(x + sx + r * 0.3, y + sy - r * 0.8); ctx.lineTo(x + sx + r, y + sy - r * 0.1); ctx.lineTo(x + sx + r * 0.8, y + sy + r * 0.5); ctx.closePath(); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.12)'; ctx.beginPath(); ctx.moveTo(x + sx - r * 0.7, y + sy - r * 0.6); ctx.lineTo(x + sx + r * 0.3, y + sy - r * 0.8); ctx.lineTo(x + sx, y + sy - r * 0.2); ctx.closePath(); ctx.fill();
      }
      if (t.built) { ctx.strokeStyle = 'rgba(214,176,92,0.4)'; ctx.lineWidth = 0.03; ctx.strokeRect(x + 0.22, y + 0.3, 0.56, 0.4); }
      if (t.hp === 1 && !t.built) { ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = 0.025; ctx.beginPath(); ctx.moveTo(x + 0.4, y + 0.3); ctx.lineTo(x + 0.5, y + 0.5); ctx.lineTo(x + 0.45, y + 0.65); ctx.stroke(); }
    } else if (t.t === 'chest') {
      const T = this.time, b = 0.1, w = 0.8;
      const g0 = ctx.createRadialGradient(x + 0.5, y + 0.5, 0.05, x + 0.5, y + 0.5, 0.9); g0.addColorStop(0, `rgba(255,210,77,${0.35 + 0.15 * Math.sin(T * 3)})`); g0.addColorStop(1, 'rgba(255,210,77,0)');
      ctx.fillStyle = g0; ctx.fillRect(x - 0.4, y - 0.4, 1.8, 1.8);
      ctx.fillStyle = 'rgba(0,0,0,0.45)'; ctx.fillRect(x + b + 0.04, y + 0.9, w, 0.12);
      ctx.fillStyle = '#3d2a6e'; ctx.fillRect(x + b, y + 0.55, w, 0.38);
      ctx.fillStyle = '#5a3fa0'; ctx.beginPath(); ctx.moveTo(x + b, y + 0.55); ctx.quadraticCurveTo(x + 0.5, y + 0.1, x + 1 - b, y + 0.55); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = '#ffd24d'; ctx.lineWidth = 0.05; ctx.strokeRect(x + b, y + 0.55, w, 0.38);
      ctx.beginPath(); ctx.moveTo(x + 0.5, y + 0.33); ctx.lineTo(x + 0.5, y + 0.93); ctx.stroke();
      ctx.fillStyle = '#ffd24d'; ctx.fillRect(x + 0.42, y + 0.6, 0.16, 0.14);
      for (let i = 0; i < 3; i++) { ctx.fillStyle = i < t.hp ? '#ffd24d' : 'rgba(255,255,255,0.15)'; ctx.fillRect(x + 0.3 + i * 0.15, y + 1.0, 0.1, 0.05); }
      if (Math.random() < 0.05) this.fx.burst(x + 0.5, y + 0.4, '#ffe9a8', 1, 0.6, 'up');
    } else if (t.t === 'crate') {
      const b = 0.14, h = 0.24, w = 1 - b * 2;
      const wob = Math.sin(this.time * 2 + x * 3 + y) * 0.01;
      ctx.fillStyle = 'rgba(0,0,0,0.4)'; ctx.fillRect(x + b + 0.04, y + 1 - b - 0.02, w, 0.12);
      ctx.fillStyle = '#5a3a1e'; ctx.fillRect(x + b, y + 1 - b - h - rise, w, h);
      ctx.fillStyle = '#8a5a2e'; ctx.fillRect(x + b, y + b - h + 0.1 - rise + wob, w, w - 0.1);
      ctx.strokeStyle = '#d6b05c'; ctx.lineWidth = 0.035; ctx.strokeRect(x + b + 0.02, y + b - h + 0.12 - rise + wob, w - 0.04, w - 0.14);
      ctx.beginPath(); ctx.moveTo(x + b + 0.02, y + b - h + 0.12 - rise); ctx.lineTo(x + 1 - b - 0.02, y + 1 - b - h - 0.02 - rise); ctx.stroke();
      ctx.fillStyle = '#d6b05c'; ctx.fillRect(x + 0.46, y + 1 - b - h - rise, 0.08, h);
    }
    ctx.globalAlpha = 1;
  }
  drawItem(it, T) {
    const ctx = this.x, cx = it.x + 0.5, cy = it.y + 0.5;
    const bob = Math.sin(T * 3 + it.x + it.y) * 0.06;
    ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.beginPath(); ctx.ellipse(cx, cy + 0.28, 0.18 - bob, 0.06, 0, 0, Math.PI * 2); ctx.fill();
    if (it.k === 'shard') {
      const g = ctx.createRadialGradient(cx, cy, 0.02, cx, cy, 0.5); g.addColorStop(0, 'rgba(157,243,255,0.5)'); g.addColorStop(1, 'rgba(157,243,255,0)');
      ctx.fillStyle = g; ctx.fillRect(cx - 0.5, cy - 0.5, 1, 1);
      const w = 0.14 * Math.abs(Math.cos(T * 2 + it.x)) + 0.04;
      ctx.save(); ctx.translate(cx, cy - 0.05 + bob);
      ctx.fillStyle = '#5fd8ff'; ctx.beginPath(); ctx.moveTo(0, -0.26); ctx.lineTo(w, -0.04); ctx.lineTo(0, 0.2); ctx.lineTo(-w, -0.04); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#d8fbff'; ctx.beginPath(); ctx.moveTo(0, -0.26); ctx.lineTo(w * 0.4, -0.04); ctx.lineTo(0, 0.2); ctx.closePath(); ctx.fill();
      ctx.restore();
      if (Math.random() < 0.02) this.fx.burst(cx, cy, '#d8fbff', 1, 0.4, 'up');
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
      this.crownShape(ctx);
      ctx.restore();
      if (Math.random() < 0.08) this.fx.burst(cx, cy, '#ffe9a8', 1, 0.8, 'up');
    }
  }
  crownShape(ctx) {
    ctx.fillStyle = '#ffd24d'; ctx.strokeStyle = '#7a5208'; ctx.lineWidth = 0.025;
    ctx.beginPath(); ctx.moveTo(-0.24, 0.12); ctx.lineTo(-0.26, -0.14); ctx.lineTo(-0.12, -0.02); ctx.lineTo(0, -0.2); ctx.lineTo(0.12, -0.02); ctx.lineTo(0.26, -0.14); ctx.lineTo(0.24, 0.12); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#ff4d6d'; ctx.beginPath(); ctx.arc(0, 0.04, 0.04, 0, Math.PI * 2); ctx.fill();
  }
  badge(x, y, text) {
    const ctx = this.x;
    ctx.fillStyle = '#0d0b13'; ctx.beginPath(); ctx.arc(x, y, 0.13, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#5fd8ff'; ctx.lineWidth = 0.015; ctx.stroke();
    ctx.fillStyle = '#9df3ff'; ctx.font = '700 0.15px "Chakra Petch", sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(text, x, y + 0.01);
  }

  drawUnit(u, d, T) {
    const ctx = this.x, s = this.state;
    let cx = d.x + 0.5, base = d.y + 0.86;
    // lunge / recoil offsets
    if (d.lunge) { const k = (this.time - d.lunge.t0) / d.lunge.dur; if (k >= 1) d.lunge = null; else { const a = k < 0.4 ? -Math.sin(k / 0.4 * Math.PI) * 0.08 : Math.sin((k - 0.4) / 0.6 * Math.PI) * 0.38; cx += d.lunge.dx * a; base += d.lunge.dy * a; } }
    if (d.recoil) { const k = (this.time - d.recoil.t0) / 0.25; if (k >= 1) d.recoil = null; else { const src = unitById(s, d.recoil.src); if (src) { const dx = d.x - src.x, dy = d.y - src.y, l = Math.hypot(dx, dy) || 1; const a = Math.sin(k * Math.PI) * 0.14; cx += dx / l * a; base += dy / l * a; } } }
    let dropY = 0;
    if (d.drop) {
      const k = (this.time - d.drop.t0) / d.drop.dur;
      if (k >= 1) { if (!d.drop.landed) { d.drop.landed = true; d.squash = 1; this.fx.burst(cx, base, '#d9cfb8', 14, 2.5, 'dust'); this.fx.ring(cx, base, u.color, 1.6, 0.45, 0.06); this.kick(2.5); this.sfx('land'); } d.drop = null; }
      else dropY = -(1 - k * k) * 8;
    }
    const active = s.active === u.id && !s.over;
    const mine = u.id === this.myId;
    const sk = skinOf(u.skin);
    const dying = !u.alive;
    ctx.fillStyle = 'rgba(0,0,0,0.45)'; ctx.beginPath(); ctx.ellipse(cx, base, Math.max(0.08, 0.32 - d.lift * 0.1 + dropY * 0.02), 0.1, 0, 0, Math.PI * 2); ctx.fill();
    if (this.threats && this.threats.includes(u.id) && !dying) {
      const k = 0.5 + 0.5 * Math.sin(T * 7); ctx.strokeStyle = `rgba(255,50,70,${0.5 + k * 0.5})`; ctx.lineWidth = 0.06;
      ctx.beginPath(); ctx.ellipse(cx, base, 0.5 + k * 0.06, 0.18 + k * 0.02, 0, 0, Math.PI * 2); ctx.stroke();
    }
    if (u.kind === 'player') {
      ctx.strokeStyle = u.color; ctx.lineWidth = active ? 0.07 : 0.045;
      ctx.globalAlpha = active ? 0.75 + 0.25 * Math.sin(T * 6) : 0.85;
      ctx.beginPath(); ctx.ellipse(cx, base, 0.38, 0.13, 0, 0, Math.PI * 2); ctx.stroke();
      if (active) { ctx.globalAlpha = 0.25; ctx.fillStyle = u.color; ctx.fill(); ctx.globalAlpha = 0.5 * (1 - ((T * 1.2) % 1)); const rr = 0.38 + ((T * 1.2) % 1) * 0.3; ctx.beginPath(); ctx.ellipse(cx, base, rr, rr * 0.34, 0, 0, Math.PI * 2); ctx.stroke(); }
      ctx.globalAlpha = 1;
    }
    const hone = u.hone ? (u.hone[u.piece] || 0) : 0;
    if (u.piece === 'king' || hone > 0) {
      const g = ctx.createRadialGradient(cx, base - 0.5, 0.05, cx, base - 0.5, 0.8);
      const c = u.piece === 'king' ? '255,210,77' : '157,243,255';
      g.addColorStop(0, `rgba(${c},${0.2 + 0.08 * Math.sin(T * 3)})`); g.addColorStop(1, `rgba(${c},0)`);
      ctx.fillStyle = g; ctx.fillRect(cx - 0.9, base - 1.4, 1.8, 1.8);
      if (Math.random() < 0.08) this.fx.burst(cx + (Math.random() - 0.5) * 0.5, base - 0.4, u.piece === 'king' ? '#ffe9a8' : '#9df3ff', 1, 0.5, 'up');
    }
    const bob = d.moving ? 0 : Math.sin(T * 2.2 + u.id) * 0.015;
    const pop = d.pop > 0 ? 1 + Math.sin(d.pop * Math.PI) * 0.3 : 1;
    const sq = d.squash > 0 ? Math.sin(d.squash * Math.PI) * 0.18 : 0;
    const stretch = d.how === 'jump' && d.moving ? d.lift * 0.08 : dropY < 0 ? 0.12 : 0;
    ctx.save();
    ctx.translate(cx, base - d.lift + bob + dropY);
    if (!d.moving && !dying && !this.reduced) {
      const ph = T + u.id * 1.7;
      if (u.piece === 'knight') ctx.rotate(Math.sin(ph * 1.3) * 0.035 * (d.face || 1));
      else if (u.piece === 'bishop') ctx.rotate(Math.sin(ph * 0.9) * 0.03);
      else if (u.piece === 'queen' || u.piece === 'king') ctx.translate(0, -Math.abs(Math.sin(ph * 1.1)) * 0.02);
      else if (u.piece === 'pawn' && (ph % 6) < 0.35) ctx.translate(0, -Math.sin(((ph % 6) / 0.35) * Math.PI) * 0.06);
    }
    const breathe = u.piece === 'rook' && !d.moving ? Math.sin(T * 1.6 + u.id) * 0.012 : 0;
    ctx.scale(0.92 * pop * (1 + sq - stretch * 0.5) * (u.piece === 'knight' ? (d.face || 1) : 1), 0.92 * pop * (1 - sq + stretch + breathe));
    if (u.kind === 'hollow') ctx.translate(0, Math.sin(T * 3 + u.id) * 0.04);
    const fl = this.hitFlash.get(u.id) || (dying ? 1 : 0);
    if (sk.wire || sk.fx === 'aurora' || sk.fx === 'star' || sk.fx === 'glint') drawPiece(ctx, u.piece, u.skin, { flash: fl, alpha: 1, t: T, outline: mine ? 'rgba(255,255,255,0.22)' : null });
    else {
      const sp = hiSprite(u.piece, u.skin), S = 1 / 160;
      if (mine) { ctx.globalAlpha = 0.22; ctx.drawImage(hiSprite(u.piece, u.skin, 'white'), -96 * S * 1.06, -224 * S * 1.03, 192 * S * 1.06, 240 * S * 1.03); ctx.globalAlpha = 1; }
      ctx.drawImage(sp, -96 * S, -224 * S, 192 * S, 240 * S);
      if (fl > 0) { ctx.globalAlpha = Math.min(1, fl); ctx.drawImage(hiSprite(u.piece, u.skin, 'white'), -96 * S, -224 * S, 192 * S, 240 * S); ctx.globalAlpha = 1; }
    }
    ctx.restore();
    if (Math.random() < 0.07 && u.kind === 'player' && sk.fx !== 'dust') {
      const col = sk.fx === 'ember' ? '#ff8a3d' : sk.fx === 'frost' ? '#d6f7ff' : sk.fx === 'leaf' ? '#8de37a' : sk.fx === 'spark' ? '#00f0ff' : sk.fx === 'star' ? '#d6a6ff' : '#ffe9a8';
      this.fx.parts.push({ x: cx + (Math.random() - 0.5) * 0.4, y: base - 0.3 - Math.random() * 0.5, vx: (Math.random() - 0.5) * 0.2, vy: -0.4, g: -0.1, life: 0.9, t: 0, color: col, size: 0.025, kind: 'spark', rot: 0, vr: 0 });
    }
    if (u.trail && u.trail !== 'none' && (d.moving || d.lunge) && TRAILS[u.trail]) {
      const cols = TRAILS[u.trail].colors;
      for (let i = 0; i < (this.lowQ ? 1 : 2); i++) this.fx.parts.push({ x: cx + (Math.random() - 0.5) * 0.3, y: base - 0.15 - d.lift - Math.random() * 0.4, vx: (Math.random() - 0.5) * 0.4, vy: -0.2 - Math.random() * 0.4, g: u.trail === 'royal' ? 2 : -0.2, life: 0.6 + Math.random() * 0.4, t: 0, color: cols[(Math.random() * cols.length) | 0], size: u.trail === 'petals' ? 0.05 : 0.035, kind: u.trail === 'royal' ? 'coin' : u.trail === 'petals' ? 'chunk' : 'spark', rot: Math.random() * 6, vr: (Math.random() - 0.5) * 8, floor: u.trail === 'royal' ? base : null });
    }
    if (u.kind === 'hollow' && Math.random() < 0.1) this.fx.parts.push({ x: cx + (Math.random() - 0.5) * 0.3, y: base - 0.1, vx: 0, vy: -0.3, g: -0.1, life: 0.8, t: 0, color: '#8f8cff', size: 0.03, kind: 'spark', rot: 0, vr: 0 });
    // attunement crystals orbit
    const tier = Math.floor((u.attune || 0) / 5);
    if (tier > 0 && !dying) {
      d.attunePulse = Math.max(0, (d.attunePulse || 0) - 0.03);
      for (let i = 0; i < tier; i++) {
        const a = T * 1.6 + (i / tier) * Math.PI * 2, rx = 0.46, ry = 0.16;
        const ox = Math.cos(a) * rx, oy = Math.sin(a) * ry;
        const behind = Math.sin(a) < 0;
        ctx.globalAlpha = behind ? 0.45 : 1;
        ctx.save(); ctx.translate(cx + ox, base - 0.45 + oy - d.lift + dropY); const sc = (1 + (d.attunePulse || 0) * 0.6) * (behind ? 0.8 : 1); ctx.scale(sc, sc);
        ctx.fillStyle = '#5fd8ff'; ctx.beginPath(); ctx.moveTo(0, -0.09); ctx.lineTo(0.05, 0); ctx.lineTo(0, 0.08); ctx.lineTo(-0.05, 0); ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#e8fdff'; ctx.beginPath(); ctx.moveTo(0, -0.09); ctx.lineTo(0.02, 0); ctx.lineTo(0, 0.08); ctx.closePath(); ctx.fill();
        ctx.restore();
      }
      ctx.globalAlpha = 1;
    }
    if (u.kind === 'player' && (u.ult || 0) >= 100 && !dying && Math.random() < 0.18) this.fx.parts.push({ x: cx + (Math.random() - 0.5) * 0.5, y: base - Math.random() * 0.9, vx: 0, vy: -0.6, g: -0.2, life: 0.7, t: 0, color: '#ffd24d', size: 0.03, kind: 'spark', rot: 0, vr: 0 });
    // HP bar + name (deferred so labels sit above everything)
    if (!dying && !(dropY < -0.5)) (this.labelQ ||= []).push(() => {
      const top = base + (PIECE_TOP[u.piece] || -1) * 0.92 - 0.14 - d.lift;
      const mx = stats(u).maxHp, r = Math.max(0, Math.min(1, d.hp / mx)), gr = Math.max(0, Math.min(1, d.ghost / mx));
      const w = 0.72, bx = cx - w / 2;
      ctx.fillStyle = 'rgba(8,6,14,0.88)'; ctx.fillRect(bx - 0.025, top - 0.025, w + 0.05, 0.12);
      ctx.fillStyle = '#ffffff'; ctx.fillRect(bx, top, w * gr, 0.07);
      ctx.fillStyle = r > 0.5 ? '#5cff9d' : r > 0.25 ? '#ffd24d' : '#ff4d6d';
      if (u.kind === 'hollow') ctx.fillStyle = '#a7a4d6';
      ctx.fillRect(bx, top, w * r, 0.07);
      ctx.fillStyle = 'rgba(255,255,255,0.25)'; ctx.fillRect(bx, top, w * r, 0.02);
      if (u.kind === 'player') {
        ctx.fillStyle = u.color; ctx.fillRect(bx - 0.025, top - 0.055, 0.14, 0.03);
        if (this.z > 34) {
          ctx.font = `700 0.17px "Chakra Petch", sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
          ctx.fillStyle = 'rgba(8,6,14,0.85)'; ctx.fillText(u.name, cx + 0.012, top - 0.03 + 0.012);
          ctx.fillStyle = mine ? '#ffffff' : '#d8d2e8'; ctx.fillText(u.name, cx, top - 0.03);
        }
        if (u.shards > 0) this.badge(cx + 0.44, top + 0.03, String(u.shards));
        if (u.piece === 'king') { ctx.save(); ctx.translate(cx, top - (this.z > 34 ? 0.34 : 0.16) + Math.sin(T * 2) * 0.03); ctx.scale(0.7, 0.7); this.crownShape(ctx); ctx.restore(); }
      }
      if (active && mine) {
        const ay = top - (this.z > 34 ? 0.45 : 0.25) - Math.abs(Math.sin(T * 4)) * 0.12 - (u.piece === 'king' ? 0.2 : 0);
        ctx.fillStyle = '#ffe3a1'; ctx.beginPath(); ctx.moveTo(cx - 0.12, ay - 0.1); ctx.lineTo(cx + 0.12, ay - 0.1); ctx.lineTo(cx, ay + 0.04); ctx.closePath(); ctx.fill();
      }
    });
  }

  drawOverlay(T) {
    const ov = this.overlay ? { ...this.overlay } : (this.danger ? {} : null); if (!ov) return;
    if (this.danger) ov.danger = this.danger;
    const ctx = this.x;
    const pulse = 0.5 + 0.5 * Math.sin(T * 5);
    if (ov.moves) for (const m of ov.moves) {
      const wave = 0.5 + 0.5 * Math.sin(T * 4 - (Math.abs(m.x - (ov.from ? ov.from.x : 0)) + Math.abs(m.y - (ov.from ? ov.from.y : 0))) * 0.8);
      ctx.fillStyle = `rgba(93,200,255,${0.1 + wave * 0.12})`; ctx.fillRect(m.x + 0.06, m.y + 0.06, 0.88, 0.88);
      ctx.strokeStyle = 'rgba(127,224,255,0.75)'; ctx.lineWidth = 0.03; ctx.strokeRect(m.x + 0.1, m.y + 0.1, 0.8, 0.8);
      ctx.fillStyle = 'rgba(200,240,255,0.9)'; ctx.beginPath(); ctx.arc(m.x + 0.5, m.y + 0.5, 0.06 + wave * 0.03, 0, Math.PI * 2); ctx.fill();
    }
    if (ov.danger) for (const t of ov.danger) { ctx.fillStyle = 'rgba(255,60,80,0.16)'; ctx.fillRect(t.x + 0.03, t.y + 0.03, 0.94, 0.94); ctx.strokeStyle = 'rgba(255,90,100,0.35)'; ctx.lineWidth = 0.02; ctx.beginPath(); ctx.moveTo(t.x + 0.1, t.y + 0.9); ctx.lineTo(t.x + 0.9, t.y + 0.1); ctx.moveTo(t.x + 0.1, t.y + 0.5); ctx.lineTo(t.x + 0.5, t.y + 0.1); ctx.moveTo(t.x + 0.5, t.y + 0.9); ctx.lineTo(t.x + 0.9, t.y + 0.5); ctx.stroke(); }
    if (ov.hover) { ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 0.05; this.corners(ov.hover.x + 0.05, ov.hover.y + 0.05, 0.9); }
    if (ov.opts) {
      for (const o of ov.opts) {
        const sel = ov.preview === o;
        if (!sel) for (const t of o.tiles) { ctx.fillStyle = o.mult > 0 ? 'rgba(255,93,93,0.07)' : 'rgba(180,140,255,0.07)'; ctx.fillRect(t.x + 0.06, t.y + 0.06, 0.88, 0.88); }
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
          const g = ctx.createLinearGradient(t.x, t.y, t.x + 1, t.y + 1);
          const c = o.mult > 0 ? '255,70,70' : '180,140,255';
          g.addColorStop(0, `rgba(${c},${0.25 + pulse * 0.2})`); g.addColorStop(1, `rgba(${c},${0.45 + pulse * 0.15})`);
          ctx.fillStyle = g; ctx.fillRect(t.x + 0.04, t.y + 0.04, 0.92, 0.92);
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
function roundRect(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
