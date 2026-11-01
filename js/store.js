// Store catalog, daily featured shop, collections, wishlist, item previews, the showcase stage and the unlock reveal.
import { SKINS, BOARDS, FINISHERS, TRAILS, EMOTE_PACKS, BUNDLES, RARITY, RARITY_ORDER } from './data.js';
import { drawPiece } from './pieces.js';
import { FX, hiSprite } from './fx.js';
import { rarityOfAny, collectionDone } from './progression.js';

export const KINDS = {
  skin:     { label: 'Piece Set', table: SKINS,       owned: 'owned',          equip: 'skin',     tab: 'pieces' },
  board:    { label: 'Board',     table: BOARDS,      owned: 'ownedBoards',    equip: 'board',    tab: 'boards' },
  finisher: { label: 'Finisher',  table: FINISHERS,   owned: 'ownedFinishers', equip: 'finisher', tab: 'finishers' },
  trail:    { label: 'Trail',     table: TRAILS,      owned: 'ownedTrails',    equip: 'trail',    tab: 'trails' },
  emote:    { label: 'Emote Pack', table: EMOTE_PACKS, owned: 'ownedEmotes',   equip: null,       tab: 'emotes' },
};
const valid = (s) => { if (typeof s !== 'string') return false; const [k, id] = s.split(':'); return !!(KINDS[k] && Object.prototype.hasOwnProperty.call(KINDS[k].table, id)); };

export function ensureStore(p) {
  if (!Array.isArray(p.ownedTrails)) p.ownedTrails = ['none'];
  if (!p.ownedTrails.includes('none')) p.ownedTrails.unshift('none');
  if (!p.trail) p.trail = 'none';
  if (!Array.isArray(p.ownedEmotes)) p.ownedEmotes = ['basic'];
  if (!p.ownedEmotes.includes('basic')) p.ownedEmotes.unshift('basic');
  p.ownedTrails = p.ownedTrails.filter((k) => typeof k === 'string' && TRAILS[k]);
  p.ownedEmotes = p.ownedEmotes.filter((k) => typeof k === 'string' && EMOTE_PACKS[k]);
  p.wishlist = Array.isArray(p.wishlist) ? [...new Set(p.wishlist.filter(valid))].slice(0, 60) : [];
  p.showcase = Array.isArray(p.showcase) ? [...new Set(p.showcase.filter(valid))].slice(0, 4) : [];
  if (!Array.isArray(p.seenItems)) p.seenItems = [];
  return p;
}
export const rarityOf = (kind, id) => rarityOfAny(kind, id);
export const rarityColor = (kind, id) => (RARITY[rarityOf(kind, id)] || RARITY.common).color;
export const rarityRank = (r) => Math.max(0, RARITY_ORDER.indexOf(r));
export const isOwned = (p, kind, id) => (p[KINDS[kind].owned] || []).includes(id);
export const isEquipped = (p, kind, id) => (KINDS[kind].equip ? p[KINDS[kind].equip] === id : isOwned(p, kind, id));
export const isWished = (p, kind, id) => (p.wishlist || []).includes(`${kind}:${id}`);
export function toggleWish(p, kind, id) {
  const k = `${kind}:${id}`; const i = p.wishlist.indexOf(k);
  if (i >= 0) p.wishlist.splice(i, 1); else { p.wishlist.push(k); p.stats && (p.stats.wished = (p.stats.wished || 0) + 1); }
  return i < 0;
}
export function toggleShowcase(p, kind, id) {
  const k = `${kind}:${id}`; const i = p.showcase.indexOf(k);
  if (i >= 0) { p.showcase.splice(i, 1); return false; }
  if (p.showcase.length >= 4) p.showcase.shift();
  p.showcase.push(k); return true;
}

const DESC = {
  skin: (t) => t.mat ? `${t.mat[0].toUpperCase() + t.mat.slice(1)} finish${t.pattern ? `, ${t.pattern} detail` : ''}.` : 'A full piece set, pawn to king.',
  board: (t) => `Weather: ${t.weather || 'dust'}${t.weather2 ? ` and ${t.weather2}` : ''}.`,
  finisher: (t) => t.desc || '',
  trail: () => 'Follows your piece whenever it moves.',
  emote: (t) => Object.values(t.emotes).map((e) => `"${e}"`).join('  '),
};
export function item(p, kind, id) {
  const t = KINDS[kind].table[id];
  return { kind, id, name: t.name, price: t.price, rarity: rarityOf(kind, id), owned: isOwned(p, kind, id), equipped: isEquipped(p, kind, id), season: t.price == null, seasonNo: t.season || 0, wished: isWished(p, kind, id), desc: DESC[kind](t), def: t.price === 0 };
}
export function listKind(p, kind) {
  return Object.keys(KINDS[kind].table).map((id) => item(p, kind, id)).sort((a, b) => rarityRank(a.rarity) - rarityRank(b.rarity) || (a.price || 0) - (b.price || 0) || a.name.localeCompare(b.name));
}
export function allItems(p) { const out = []; for (const k of Object.keys(KINDS)) out.push(...listKind(p, k)); return out; }

function hash(str) { let h = 2166136261; for (const c of str) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
function rng(seed) { let h = seed >>> 0; return () => { h = (Math.imul(h, 1103515245) + 12345) >>> 0; return h; }; }
function pool() {
  const out = [];
  for (const kind of Object.keys(KINDS)) for (const id of Object.keys(KINDS[kind].table)) { const t = KINDS[kind].table[id]; if (t.price) out.push([kind, id]); }
  return out;
}
// Deal of the Day (30% off, always Epic or better) plus five featured offers. Fixed for the whole day; owned offers show as Owned.
export function featured(p, date) {
  const src = pool(); const r = rng(hash('feat-' + date));
  const premium = src.filter(([k, id]) => rarityRank(rarityOf(k, id)) >= 2);
  const deal = premium[r() % premium.length];
  const out = [deal]; const used = new Set([deal.join(':')]); const kinds = new Set();
  let guard = 0;
  while (out.length < Math.min(6, src.length) && guard++ < 500) {
    const c = src[r() % src.length]; const key = c.join(':');
    if (used.has(key)) continue;
    if (guard < 200 && kinds.has(c[0]) && kinds.size < 4) continue; // spread across item types first
    used.add(key); kinds.add(c[0]); out.push(c);
  }
  return out.map(([k, id], i) => { const it = item(p, k, id); it.off = i === 0 ? 0.3 : 0; it.deal = i === 0; it.final = Math.round(it.price * (1 - it.off)); return it; });
}
// Collection of the week: an extra 10% off a whole collection.
export function weeklyCollection(date) {
  const d = new Date(date.replace(/-(\d)(?=-|$)/g, '-0$1')); const wk = Math.floor((isNaN(d) ? Date.now() : d.getTime()) / (7 * 86400000));
  const keys = Object.keys(BUNDLES); return keys[hash('week-' + wk) % keys.length];
}
export function msToMidnight(now = new Date()) { const mid = new Date(now); mid.setHours(24, 0, 0, 0); return mid - now; }
export function bundleInfo(p, key, extraOff = 0) {
  const B = BUNDLES[key];
  const items = B.items.filter(([k, id]) => KINDS[k] && KINDS[k].table[id]).map(([k, id]) => item(p, k, id));
  const missing = items.filter((i) => !i.owned);
  const buyable = missing.filter((i) => i.price);
  const full = buyable.reduce((a, i) => a + (i.price || 0), 0);
  const off = Math.min(0.5, B.off + extraOff);
  return { key, name: B.name, blurb: B.blurb || '', color: B.color || '#d6b05c', theme: B.theme || '', reward: B.reward || null, claimed: (p.collections || []).includes(key), items, missing, buyable, full, price: Math.round(full * (1 - off)), off, owned: missing.length === 0, done: collectionDone(p, key), have: items.length - missing.length };
}
export function grant(p, kind, id) { const k = KINDS[kind].owned; if (!p[k].includes(id)) p[k].push(id); }
export function equip(p, kind, id) { const e = KINDS[kind].equip; if (e) p[e] = id; }
export function activeEmotes(p) { const out = {}; for (const id of p.ownedEmotes) Object.assign(out, EMOTE_PACKS[id] ? EMOTE_PACKS[id].emotes : {}); return out; }

// ---------- weather motes (shared by board cards, the stage and the reveal) ----------
const WX = {
  snow:      { c: '#ffffff', vy: 0.35, vx: 0.05, sz: 0.035 },
  petals:    { c: '#ffd1dc', vy: 0.25, vx: 0.2, sz: 0.045, petal: true },
  embers:    { c: '#ff8a3d', vy: -0.4, vx: 0.05, sz: 0.03, glow: true },
  ash:       { c: '#9a9090', vy: 0.18, vx: 0.08, sz: 0.03 },
  fireflies: { c: '#e8ff9a', vy: 0, vx: 0, sz: 0.035, glow: true, wander: true },
  bubbles:   { c: '#9dfff6', vy: -0.3, vx: 0, sz: 0.05, ring: true },
  stars:     { c: '#e8f6ff', vy: 0, vx: 0, sz: 0.025, twinkle: true },
  pixels:    { c: '#00f0ff', vy: -0.15, vx: 0, sz: 0.04, square: true },
  rain:      { c: 'rgba(190,215,255,0.7)', vy: 3.2, vx: -0.6, sz: 0.02, streak: true },
  sand:      { c: '#f0d6a0', vy: 0.05, vx: 1.2, sz: 0.022 },
  leaves:    { c: '#c8a03a', vy: 0.3, vx: 0.15, sz: 0.05, petal: true },
  void:      { c: '#b04dff', vy: -0.25, vx: 0, sz: 0.04, glow: true },
  aurora:    { c: '#7affc8', vy: 0, vx: 0, sz: 0.02, twinkle: true },
  fog:       { c: '#ffffff', vy: 0, vx: 0.1, sz: 0.02 },
  dust:      { c: null, vy: -0.05, vx: 0.03, sz: 0.025 },
};
function drawMotes(ctx, th, w, W, H, t, n) {
  const M = WX[w] || WX.dust; const col = M.c || th.mote || '#ffffff';
  for (let i = 0; i < n; i++) {
    const s1 = Math.sin(i * 12.9898) * 43758.5453, r1 = s1 - Math.floor(s1), s2 = Math.sin(i * 78.233) * 12543.21, r2 = s2 - Math.floor(s2);
    let x = (r1 * W + t * M.vx * (0.6 + r2)) % W, y = (r2 * H + t * M.vy * (0.6 + r1)) % H;
    if (x < 0) x += W; if (y < 0) y += H;
    if (M.wander) { x += Math.sin(t * 0.8 + i) * 0.3; y += Math.cos(t * 0.6 + i * 2) * 0.2; }
    const a = M.twinkle || M.wander ? Math.max(0, Math.sin(t * 2 + i * 1.7)) : 0.7;
    ctx.globalAlpha = a * 0.85; ctx.fillStyle = col; ctx.strokeStyle = col;
    if (M.streak) { ctx.lineWidth = M.sz; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + M.vx * 0.06, y + M.vy * 0.06); ctx.stroke(); }
    else if (M.ring) { ctx.lineWidth = 0.012; ctx.beginPath(); ctx.arc(x + Math.sin(t + i) * 0.1, y, M.sz * (0.6 + r1), 0, Math.PI * 2); ctx.stroke(); }
    else if (M.square) { ctx.fillStyle = i % 2 ? col : '#ff3df2'; ctx.fillRect(x, y, M.sz, M.sz); }
    else if (M.petal) { ctx.save(); ctx.translate(x + Math.sin(t + i) * 0.15, y); ctx.rotate(t * 1.5 + i); ctx.fillStyle = w === 'leaves' ? ['#7aff4a', '#c8a03a', '#ff7a3a'][i % 3] : col; ctx.beginPath(); ctx.ellipse(0, 0, M.sz, M.sz * 0.5, 0, 0, Math.PI * 2); ctx.fill(); ctx.restore(); }
    else { if (M.glow) { ctx.globalAlpha *= 0.3; ctx.beginPath(); ctx.arc(x, y, M.sz * 3, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = a * 0.9; } ctx.beginPath(); ctx.arc(x, y, M.sz, 0, Math.PI * 2); ctx.fill(); }
  }
  if (w === 'fog') { for (let i = 0; i < 3; i++) { const fx = ((t * 0.15 + i * 0.37) % 1.4 - 0.2) * W; const g = ctx.createRadialGradient(fx, H * (0.5 + i * 0.15), 0, fx, H * (0.5 + i * 0.15), W * 0.35); g.addColorStop(0, 'rgba(255,255,255,0.10)'); g.addColorStop(1, 'rgba(255,255,255,0)'); ctx.globalAlpha = 1; ctx.fillStyle = g; ctx.fillRect(0, 0, W, H); } }
  if (w === 'aurora') { ctx.globalAlpha = 0.18; for (let i = 0; i < 2; i++) { ctx.strokeStyle = i ? '#c99bff' : '#7affc8'; ctx.lineWidth = 0.25; ctx.beginPath(); for (let x = 0; x <= W; x += 0.25) { const y = 0.5 + i * 0.3 + Math.sin(x * 1.3 + t * 0.7 + i) * 0.2; x ? ctx.lineTo(x, y) : ctx.moveTo(x, y); } ctx.stroke(); } }
  ctx.globalAlpha = 1;
}

// A tiny board in local tile units: cols x rows from (0,0). Draws tiles, vein, grid, frame.
function drawMiniBoard(ctx, th, cols, rows, t) {
  ctx.fillStyle = th.frame; ctx.globalAlpha = 0.9; ctx.fillRect(-0.08, -0.08, cols + 0.16, rows + 0.16); ctx.globalAlpha = 1;
  ctx.fillStyle = th.wallFront; ctx.fillRect(-0.08, rows + 0.08, cols + 0.16, 0.22);
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    ctx.fillStyle = (x + y) % 2 ? th.dark : th.light; ctx.fillRect(x, y, 1, 1);
    if ((x * 7 + y * 3) % 4 === 0) { ctx.strokeStyle = th.vein; ctx.lineWidth = 0.03; ctx.beginPath(); ctx.moveTo(x + 0.1, y + 0.3); ctx.quadraticCurveTo(x + 0.5, y + 0.6, x + 0.9, y + 0.4); ctx.stroke(); }
    if (th.stars && (x * 7 + y * 13) % 3 === 0) { ctx.fillStyle = `rgba(220,240,255,${0.3 + 0.6 * Math.abs(Math.sin(t * 1.5 + x * 3 + y))})`; ctx.fillRect(x + 0.3 + ((x * 31) % 4) / 10, y + 0.3, 0.04, 0.04); }
    if (th.lava && (x * 5 + y * 3) % 4 === 1) { ctx.strokeStyle = `rgba(255,110,30,${0.45 + 0.3 * Math.sin(t * 2 + x + y)})`; ctx.lineWidth = 0.05; ctx.beginPath(); ctx.moveTo(x + 0.15, y + 0.7); ctx.lineTo(x + 0.45, y + 0.55); ctx.lineTo(x + 0.6, y + 0.75); ctx.lineTo(x + 0.88, y + 0.6); ctx.stroke(); }
  }
  ctx.strokeStyle = th.grid; ctx.lineWidth = th.glowGrid ? 0.04 : 0.02;
  for (let i = 0; i <= cols; i++) { ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, rows); ctx.stroke(); }
  for (let i = 0; i <= rows; i++) { ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(cols, i); ctx.stroke(); }
  if (th.glowGrid) { const sw = (t * 1.6) % rows; ctx.strokeStyle = th.light2 || 'rgba(0,240,255,0.7)'; ctx.globalAlpha = 0.7; ctx.lineWidth = 0.05; ctx.beginPath(); ctx.moveTo(0, sw); ctx.lineTo(cols, sw); ctx.stroke(); ctx.globalAlpha = 1; }
  if (th.light2) { const g = ctx.createRadialGradient(cols / 2, rows / 2, 0.2, cols / 2, rows / 2, cols * 0.6); g.addColorStop(0, th.light2 + '33'); g.addColorStop(1, th.light2 + '00'); ctx.fillStyle = g; ctx.fillRect(0, 0, cols, rows); }
}
function bgGrad(ctx, th, W, H) { const g = ctx.createLinearGradient(0, 0, 0, H); g.addColorStop(0, th.bg[0]); g.addColorStop(1, th.bg[1]); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H); }

function emitTrail(fx, id, x, y, n = 2) {
  const T = TRAILS[id]; if (!T || !T.colors.length) return;
  const kind = T.kind || (id === 'royal' ? 'coin' : id === 'petals' ? 'chunk' : 'spark');
  const g = T.g ?? (id === 'royal' ? 2 : -0.2), size = T.size || (id === 'petals' ? 0.05 : 0.045);
  for (let i = 0; i < n; i++) fx.parts.push({ x: x + (Math.random() - 0.5) * 0.3, y: y - 0.15 - Math.random() * 0.4, vx: (Math.random() - 0.5) * 0.4, vy: -0.2 - Math.random() * 0.3, g, life: 0.6 + Math.random() * 0.4, t: 0, color: T.colors[(Math.random() * T.colors.length) | 0], size, kind, rot: Math.random() * 6, vr: (Math.random() - 0.5) * 8, floor: T.floor || kind === 'coin' ? y : null, c0: T.colors[0], c1: T.colors[2] || T.colors[1] });
}

// ---------- card previews ----------
export function makePreview(cv, kind, id, opts = {}) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const r = cv.getBoundingClientRect(); cv.width = Math.max(10, (r.width || 150) * dpr); cv.height = Math.max(10, (r.height || 110) * dpr);
  return { cv, ctx: cv.getContext('2d'), dpr, kind, id, t: Math.random() * 2, cycle: Math.random() * 2.4, fx: new FX(), skin: opts.skin || 'ivory', board: opts.board || 'hall', big: !!opts.big, rays: !!opts.rays, color: rarityColor(kind, id), visible: true, still: !!opts.still };
}
export function drawPreview(p, dt) {
  const { ctx, cv, dpr } = p; const W = cv.width / dpr, H = cv.height / dpr;
  if (!W || !H) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  p.t += dt;
  ctx.clearRect(0, 0, W, H);
  if (p.rays) drawRays(ctx, W, H, p.t, p.color, 1);
  drawItem(ctx, W, H, p, dt);
}
function drawRays(ctx, W, H, t, color, a) {
  ctx.save(); ctx.globalAlpha = a; ctx.translate(W / 2, H / 2); ctx.rotate(t * 0.4);
  const L = Math.max(W, H) * 0.8;
  for (let i = 0; i < 12; i++) { ctx.rotate(Math.PI / 6); const g = ctx.createLinearGradient(0, 0, 0, -L); g.addColorStop(0, color + '66'); g.addColorStop(1, color + '00'); ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(-8, 0); ctx.lineTo(8, 0); ctx.lineTo(34, -L); ctx.lineTo(-34, -L); ctx.closePath(); ctx.fill(); }
  ctx.restore();
  const g = ctx.createRadialGradient(W / 2, H / 2, 4, W / 2, H / 2, W * 0.45); g.addColorStop(0, color + '55'); g.addColorStop(1, color + '00'); ctx.globalAlpha = a; ctx.fillStyle = g; ctx.fillRect(0, 0, W, H); ctx.globalAlpha = 1;
}
function drawItem(ctx, W, H, p, dt) {
  const k = p.kind;
  if (!p.rays && k !== 'board') { const g = ctx.createRadialGradient(W / 2, H * 0.62, 2, W / 2, H * 0.62, W * 0.6); g.addColorStop(0, p.color + '30'); g.addColorStop(1, '#0d0b1300'); ctx.fillStyle = '#0d0b13'; ctx.fillRect(0, 0, W, H); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H); }
  if (k === 'skin') {
    const ts = p.big ? Math.min(H / 1.9, W / 2.6) : H / 1.55; ctx.save(); ctx.translate(W / 2, H * 0.88 + Math.sin(p.t * 2) * 2); ctx.scale(ts, ts);
    ctx.fillStyle = 'rgba(0,0,0,0.45)'; ctx.beginPath(); ctx.ellipse(0, 0, 0.34, 0.08, 0, 0, Math.PI * 2); ctx.fill();
    if (p.big) { ctx.save(); ctx.translate(-0.55, 0.02); ctx.scale(0.62, 0.62); drawPiece(ctx, 'knight', p.id, { t: p.t }); ctx.restore(); ctx.save(); ctx.translate(0.55, 0.02); ctx.scale(0.62, 0.62); drawPiece(ctx, 'rook', p.id, { t: p.t }); ctx.restore(); }
    drawPiece(ctx, p.big ? 'queen' : 'knight', p.id, { t: p.t }); ctx.restore();
  } else if (k === 'board') {
    const th = BOARDS[p.id]; bgGrad(ctx, th, W, H);
    const cols = 4, rows = 3, SQb = 0.58, head = 1.25;
    const ts = Math.min(W / (cols + 0.5), H / (rows * SQb + head + 0.35));
    const ox = (W - ts * cols) / 2, oy = (H - ts * (rows * SQb + head + 0.35)) / 2 + head * ts;
    const hg = ctx.createRadialGradient(W / 2, oy, 2, W / 2, oy, W * 0.6); hg.addColorStop(0, (th.light2 || th.frame) + '44'); hg.addColorStop(1, (th.light2 || th.frame) + '00'); ctx.fillStyle = hg; ctx.fillRect(0, 0, W, H);
    ctx.save(); ctx.translate(ox, oy); ctx.scale(ts, ts);
    const g = ctx.createLinearGradient(0, -1.1, 0, 0); g.addColorStop(0, th.wallTop[0]); g.addColorStop(1, th.wallTop[1]);
    ctx.fillStyle = g; ctx.fillRect(-0.1, -0.9, 0.5, 0.9); ctx.fillRect(cols - 0.4, -0.9, 0.5, 0.9);
    ctx.save(); ctx.scale(1, SQb); drawMiniBoard(ctx, th, cols, rows, p.t); ctx.restore();
    ctx.fillStyle = th.wallFront; ctx.fillRect(-0.08, rows * SQb + 0.05, cols + 0.16, 0.24);
    if (th.fog) { ctx.fillStyle = th.fog; ctx.fillRect(-0.2, -0.3, cols + 0.4, rows * SQb + 0.6); }
    const by = 2.4 * SQb + 0.08;
    ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.beginPath(); ctx.ellipse(cols / 2, by, 0.3, 0.08, 0, 0, Math.PI * 2); ctx.fill();
    ctx.save(); ctx.translate(cols / 2, by + Math.sin(p.t * 2) * 0.02); drawPiece(ctx, 'knight', p.skin, { t: p.t }); ctx.restore();
    ctx.translate(0, -head);
    drawMotes(ctx, th, th.weather || 'dust', cols, rows * SQb + head + 0.3, p.t, p.big ? 26 : 14);
    if (th.weather2) drawMotes(ctx, th, th.weather2, cols, rows * SQb + head + 0.3, p.t * 0.8 + 5, 8);
    ctx.restore();
    if (th.tint) { ctx.fillStyle = th.tint; ctx.fillRect(0, 0, W, H); }
  } else if (k === 'finisher') {
    const ts = H / 2.2;
    ctx.save(); ctx.scale(ts, ts);
    const cx = W / ts / 2, by = 1.75;
    p.cycle += dt;
    if (p.cycle > 2.6) { p.cycle = 0; p.shown = false; }
    if (!p.shown && p.cycle > 0.4) { p.shown = true; try { p.fx.finisher(p.id, cx, by, 'rook', 'ivory', '#ffe7a8'); } catch { /* finisher still in development */ } }
    p.fx.update(dt);
    ctx.fillStyle = 'rgba(255,255,255,0.05)'; ctx.beginPath(); ctx.ellipse(cx, by, 0.6, 0.15, 0, 0, Math.PI * 2); ctx.fill();
    p.fx.drawGround(ctx);
    if (!p.shown || p.cycle > 2.0) { const a = p.shown ? Math.min(1, (p.cycle - 2.0) / 0.3) : 1; ctx.save(); ctx.globalAlpha = a; ctx.translate(cx, by - (p.shown ? (1 - a) * 0.6 : 0)); ctx.scale(0.92, 0.92); drawPiece(ctx, 'rook', 'ivory', { t: p.t, flash: p.shown ? 0 : Math.max(0, (p.cycle - 0.25) * 6) }); ctx.restore(); ctx.globalAlpha = 1; }
    p.fx.drawAbove(ctx);
    ctx.restore();
    if (p.fx.screenFlash > 0.01) { ctx.globalAlpha = p.fx.screenFlash * 0.6; ctx.fillStyle = p.fx.flashColor; ctx.fillRect(0, 0, W, H); ctx.globalAlpha = 1; }
  } else if (k === 'trail') {
    const ts = H / 2.2; ctx.save(); ctx.scale(ts, ts);
    const span = W / ts, x = 0.6 + ((Math.sin(p.t * 1.4) + 1) / 2) * (span - 1.2), by = 1.75;
    emitTrail(p.fx, p.id, x, by, p.big ? 3 : 2);
    p.fx.update(dt);
    p.fx.drawAbove(ctx);
    ctx.translate(x, by); ctx.scale(0.92, 0.92); drawPiece(ctx, 'knight', p.skin, { t: p.t });
    ctx.restore();
  } else if (k === 'emote') {
    const em = Object.values(EMOTE_PACKS[p.id].emotes);
    const i = Math.floor(p.t / 1.2) % em.length, kk = (p.t % 1.2) / 1.2;
    ctx.font = `700 ${Math.round(Math.min(H * 0.13, W * 0.075))}px "Chakra Petch", sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const w = Math.min(W - 10, ctx.measureText(em[i]).width + 24), h = H * 0.26, sc = kk < 0.1 ? kk / 0.1 : 1;
    ctx.save(); ctx.translate(W / 2, H * 0.36); ctx.scale(sc, sc); ctx.globalAlpha = kk > 0.85 ? (1 - kk) / 0.15 : 1;
    ctx.fillStyle = '#f6f1ff'; ctx.beginPath(); ctx.roundRect ? ctx.roundRect(-w / 2, -h / 2, w, h, h * 0.4) : ctx.rect(-w / 2, -h / 2, w, h); ctx.fill();
    ctx.beginPath(); ctx.moveTo(-6, h / 2 - 1); ctx.lineTo(0, h / 2 + 8); ctx.lineTo(6, h / 2 - 1); ctx.fill();
    ctx.fillStyle = '#1a1626'; ctx.fillText(em[i], 0, 1); ctx.restore(); ctx.globalAlpha = 1;
    const ts = H / 2.6; ctx.save(); ctx.translate(W / 2, H * 0.95); ctx.scale(ts, ts); drawPiece(ctx, 'pawn', p.skin, { t: p.t }); ctx.restore();
  }
}

// ---------- showcase stage: your loadout with one slot swapped (try on) ----------
// look = { skin, board, trail, finisher }. The piece hops across a small board leaving its trail; playFinisher() fires the finisher on a dummy.
const STAGE_PIECES = ['pawn', 'knight', 'bishop', 'rook', 'queen', 'king'];
export function makeStage(cv, look, opts = {}) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const st = { cv, ctx: cv.getContext('2d'), dpr, look: { ...look }, t: 0, fx: new FX(), piece: opts.piece || 'queen', hop: 0, from: 1, to: 2, fin: -1, kill: null, emote: opts.emote || null, reduced: !!opts.reduced, lowQ: !!opts.lowQ, cols: opts.cols || 0, reserve: opts.reserve || 0, solo: !!opts.solo };
  st.fx.lowQ = st.lowQ; st.fx.cap = st.lowQ ? 200 : 500;
  resizeStage(st); return st;
}
export function resizeStage(st) { const r = st.cv.getBoundingClientRect(); st.cv.width = Math.max(10, (r.width || 340) * st.dpr); st.cv.height = Math.max(10, (r.height || 240) * st.dpr); }
export function cyclePiece(st) { st.piece = STAGE_PIECES[(STAGE_PIECES.indexOf(st.piece) + 1) % STAGE_PIECES.length]; return st.piece; }
export function playFinisher(st) { st.fin = 0; st.kill = null; }
const SQ = 0.58; // board plane foreshortening
export function drawStage(st, dt) {
  const { ctx, dpr } = st; const W = st.cv.width / dpr, H = st.cv.height / dpr;
  if (!W || !H) return;
  const th = BOARDS[st.look.board] || BOARDS.hall;
  st.t += dt;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  bgGrad(ctx, th, W, H);
  const cols = st.cols || (W / H > 1.6 ? 5 : 4), rows = 3, head = 1.45;
  const availH = H * (1 - st.reserve) - 6;
  const ts = Math.min(W / (cols + 0.5), availH / (rows * SQ + head + 0.25));
  const ox = (W - ts * cols) / 2, oy = Math.max(4, (availH - ts * (rows * SQ + head + 0.25)) / 2) + head * ts;
  // horizon glow behind the board
  const hg = ctx.createRadialGradient(W / 2, oy, 4, W / 2, oy, W * 0.7); hg.addColorStop(0, (th.light2 || th.frame) + '40'); hg.addColorStop(1, (th.light2 || th.frame) + '00'); ctx.fillStyle = hg; ctx.fillRect(0, 0, W, H);
  ctx.save(); ctx.translate(ox, oy); ctx.scale(ts, ts);
  // back pillars
  const g = ctx.createLinearGradient(0, -1.3, 0, 0); g.addColorStop(0, th.wallTop[0]); g.addColorStop(1, th.wallTop[1]);
  ctx.fillStyle = g; ctx.fillRect(-0.1, -1.05, 0.55, 1.05); ctx.fillRect(cols - 0.45, -1.05, 0.55, 1.05);
  ctx.fillStyle = th.frame; ctx.globalAlpha = 0.8; ctx.fillRect(-0.12, -1.1, 0.59, 0.07); ctx.fillRect(cols - 0.47, -1.1, 0.59, 0.07); ctx.globalAlpha = 1;
  // board plane (foreshortened) + front lip
  ctx.save(); ctx.scale(1, SQ); drawMiniBoard(ctx, th, cols, rows, st.t); ctx.restore();
  const lip = ctx.createLinearGradient(0, rows * SQ, 0, rows * SQ + 0.32); lip.addColorStop(0, th.wallFront); lip.addColorStop(1, 'rgba(0,0,0,0.6)');
  ctx.fillStyle = lip; ctx.fillRect(-0.08, rows * SQ + 0.08 * SQ, cols + 0.16, 0.3);
  if (th.fog) { ctx.fillStyle = th.fog; ctx.fillRect(-0.2, -0.3, cols + 0.4, rows * SQ + 0.6); }
  st.fx.update(dt);
  st.fx.drawGround(ctx);
  // hero hops along the front row; target dummy stands on the back row
  const spots = st.solo ? [cols / 2 - 0.6, cols / 2 + 0.6, cols / 2, cols / 2 - 0.6] : [1.5, 2.5, 1.5, 0.5].map((x) => Math.min(cols - 1.5, x));
  if (!st.reduced) st.hop += dt / 0.95;
  if (st.hop >= 1) { st.hop = 0; st.from = st.to; st.to = (st.to + 1) % spots.length; }
  const k = Math.min(1, st.hop / 0.42), e = k * k * (3 - 2 * k);
  const hx = spots[st.from] + (spots[st.to] - spots[st.from]) * e, lift = Math.sin(k * Math.PI) * 0.4, base = 2.55 * SQ + 0.1;
  if (k < 1 && !st.reduced) emitTrail(st.fx, st.look.trail, hx, base - lift, st.lowQ ? 1 : 2);
  else if (Math.random() < 0.2) emitTrail(st.fx, st.look.trail, hx, base, 1);
  const dx = cols - 1.05, dy = 1.55 * SQ + 0.1;
  if (st.fin >= 0) {
    st.fin += dt;
    if (st.fin > 0.05 && !st.kill) { st.kill = true; try { st.fx.finisher(st.look.finisher, dx, dy, 'rook', 'obsidian', '#ff4d6d'); } catch { /* unknown finisher */ } }
    if (st.fin > 2.6) { st.fin = -1; st.kill = null; }
  }
  const pieces = [];
  if (!st.solo && (st.fin < 0 || st.fin > 2.1)) pieces.push({ x: dx, y: dy, pc: 'rook', skin: 'obsidian', a: st.fin > 2.1 ? Math.min(1, (st.fin - 2.1) / 0.4) : 1, sc: 0.92 });
  pieces.push({ x: hx, y: base - lift, gy: base, pc: st.piece, skin: st.look.skin, a: 1, hero: true, sc: 1.12 });
  pieces.sort((a, b) => (a.gy || a.y) - (b.gy || b.y));
  for (const p of pieces) {
    const gy = p.gy || p.y;
    ctx.fillStyle = 'rgba(0,0,0,0.38)'; ctx.beginPath(); ctx.ellipse(p.x, gy + 0.02, 0.32 - (p.hero ? lift * 0.25 : 0), 0.09, 0, 0, Math.PI * 2); ctx.fill();
    if (p.hero) { const pg = ctx.createRadialGradient(p.x, gy, 0.05, p.x, gy, 0.6); pg.addColorStop(0, (SKINS[p.skin] || SKINS.ivory).glow + '55'); pg.addColorStop(1, '#00000000'); ctx.fillStyle = pg; ctx.beginPath(); ctx.ellipse(p.x, gy, 0.6, 0.2, 0, 0, Math.PI * 2); ctx.fill(); }
    ctx.save(); ctx.globalAlpha = p.a; ctx.translate(p.x, p.y + (p.hero ? Math.sin(st.t * 2) * 0.015 : 0)); ctx.scale(p.sc, p.sc); drawPiece(ctx, p.pc, p.skin, { t: st.t }); ctx.restore();
  }
  st.fx.drawAbove(ctx);
  ctx.translate(0, -head);
  drawMotes(ctx, th, th.weather || 'dust', cols, rows * SQ + head + 0.3, st.t, st.lowQ ? 10 : 22);
  if (th.weather2 && !st.lowQ) drawMotes(ctx, th, th.weather2, cols, rows * SQ + head + 0.3, st.t * 0.8 + 3, 10);
  ctx.restore();
  if (th.tint) { ctx.fillStyle = th.tint; ctx.fillRect(0, 0, W, H); }
  if (st.emote) {
    const em = Object.values((EMOTE_PACKS[st.emote] || EMOTE_PACKS.basic).emotes), i = Math.floor(st.t / 1.4) % em.length, kk = (st.t % 1.4) / 1.4;
    ctx.font = `700 ${Math.round(Math.max(12, ts * 0.26))}px "Chakra Petch", sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const bw = ctx.measureText(em[i]).width + 22, bh = Math.max(24, ts * 0.42), bx = Math.max(bw / 2 + 4, Math.min(W - bw / 2 - 4, ox + hx * ts)), byy = oy + (base - 1.55) * ts;
    ctx.save(); ctx.globalAlpha = kk > 0.85 ? (1 - kk) / 0.15 : 1; ctx.translate(bx, byy); const s = kk < 0.08 ? kk / 0.08 : 1; ctx.scale(s, s);
    ctx.fillStyle = '#f6f1ff'; ctx.beginPath(); ctx.roundRect ? ctx.roundRect(-bw / 2, -bh / 2, bw, bh, bh * 0.45) : ctx.rect(-bw / 2, -bh / 2, bw, bh); ctx.fill();
    ctx.fillStyle = '#1a1626'; ctx.fillText(em[i], 0, 1); ctx.restore(); ctx.globalAlpha = 1;
  }
  if (st.fx.screenFlash > 0.01) { ctx.globalAlpha = st.fx.screenFlash * 0.55; ctx.fillStyle = st.fx.flashColor || '#fff'; ctx.fillRect(0, 0, W, H); ctx.globalAlpha = 1; }
  const v = ctx.createRadialGradient(W / 2, H * 0.5, Math.min(W, H) * 0.35, W / 2, H * 0.5, Math.max(W, H) * 0.75); v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,0.5)'); ctx.fillStyle = v; ctx.fillRect(0, 0, W, H);
}

// ---------- unlock reveal: charge -> burst -> item ----------
const CHARGE = { common: 0.55, rare: 0.8, epic: 1.1, legendary: 1.45, mythic: 1.9, season: 1.1 };
export function makeReveal(cv, kind, id, opts = {}) {
  const pv = makePreview(cv, kind, id, { skin: opts.skin, big: true, rays: true });
  const rar = rarityOf(kind, id);
  pv.rv = { t: 0, charge: opts.reduced ? 0.05 : CHARGE[rar] || 0.8, burst: false, rar, rank: rarityRank(rar), onBurst: opts.onBurst || null, sparks: [], reduced: !!opts.reduced };
  return pv;
}
export function skipReveal(pv) { if (pv && pv.rv && !pv.rv.burst) pv.rv.t = pv.rv.charge; }
export function drawReveal(pv, dt) {
  const { ctx, cv, dpr } = pv; const W = cv.width / dpr, H = cv.height / dpr; const R = pv.rv;
  if (!W || !H) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
  R.t += dt;
  const col = pv.color, cx = W / 2, cy = H * 0.5;
  if (!R.burst) {
    const k = Math.min(1, R.t / R.charge);
    // converging motes
    if (R.sparks.length < 60 && !R.reduced) for (let i = 0; i < 2 + R.rank; i++) { const a = Math.random() * 6.283, r = Math.max(W, H) * (0.45 + Math.random() * 0.2); R.sparks.push({ a, r, v: 0.9 + Math.random() * 1.2 }); }
    for (const s of R.sparks) { s.r *= 1 - dt * 2.6 * s.v; s.a += dt * 2; }
    R.sparks = R.sparks.filter((s) => s.r > 6);
    ctx.fillStyle = col; for (const s of R.sparks) { ctx.globalAlpha = Math.min(1, 40 / s.r); ctx.beginPath(); ctx.arc(cx + Math.cos(s.a) * s.r, cy + Math.sin(s.a) * s.r, 2, 0, Math.PI * 2); ctx.fill(); }
    ctx.globalAlpha = 1;
    // crest: a faceted gem that brightens and shakes
    const sh = (R.reduced ? 0 : k * k * (2 + R.rank * 1.5)), jx = (Math.random() - 0.5) * sh, jy = (Math.random() - 0.5) * sh;
    const sz = Math.min(W, H) * (0.2 + 0.05 * Math.sin(R.t * 18 * k));
    const gl = ctx.createRadialGradient(cx, cy, 2, cx, cy, sz * 2.4); gl.addColorStop(0, col + 'aa'); gl.addColorStop(1, col + '00'); ctx.fillStyle = gl; ctx.globalAlpha = 0.4 + 0.6 * k; ctx.fillRect(0, 0, W, H); ctx.globalAlpha = 1;
    ctx.save(); ctx.translate(cx + jx, cy + jy); ctx.rotate(Math.sin(R.t * 3) * 0.05);
    ctx.beginPath(); for (let i = 0; i < 6; i++) { const an = i / 6 * Math.PI * 2 - Math.PI / 2; ctx[i ? 'lineTo' : 'moveTo'](Math.cos(an) * sz * 0.8, Math.sin(an) * sz); } ctx.closePath();
    const fg = ctx.createLinearGradient(0, -sz, 0, sz); fg.addColorStop(0, '#ffffff'); fg.addColorStop(0.35, col); fg.addColorStop(1, '#0d0b13'); ctx.fillStyle = fg; ctx.fill();
    ctx.strokeStyle = '#ffffff'; ctx.globalAlpha = 0.5 + 0.5 * k; ctx.lineWidth = 2; ctx.stroke();
    ctx.globalAlpha = 0.35; ctx.beginPath(); ctx.moveTo(0, -sz); ctx.lineTo(0, sz); ctx.moveTo(-sz * 0.8, -sz * 0.5); ctx.lineTo(sz * 0.8, sz * 0.5); ctx.moveTo(sz * 0.8, -sz * 0.5); ctx.lineTo(-sz * 0.8, sz * 0.5); ctx.stroke();
    ctx.globalAlpha = k * 0.9; ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(0, 0, sz * 0.25 * k, 0, Math.PI * 2); ctx.fill();
    ctx.restore(); ctx.globalAlpha = 1;
    if (R.t >= R.charge) { R.burst = true; R.bt = 0; if (R.onBurst) R.onBurst(R.rar); }
    return;
  }
  R.bt += dt;
  const b = R.bt;
  drawRays(ctx, W, H, pv.t + b, col, Math.min(1, b * 3));
  // shock rings
  for (let i = 0; i < 1 + Math.min(2, R.rank); i++) { const kk = Math.min(1, (b - i * 0.12) / 0.7); if (kk <= 0 || kk >= 1) continue; ctx.globalAlpha = 1 - kk; ctx.strokeStyle = i ? '#ffffff' : col; ctx.lineWidth = 6 * (1 - kk) + 1; ctx.beginPath(); ctx.arc(cx, cy, Math.max(W, H) * 0.7 * kk, 0, Math.PI * 2); ctx.stroke(); }
  ctx.globalAlpha = 1;
  // item pops in with a slight overshoot
  const s = b < 0.35 ? 1 - Math.pow(1 - b / 0.35, 3) * 1.0 + Math.sin(b / 0.35 * Math.PI) * 0.12 : 1;
  const bs = pv.kind === 'board' ? 0.8 : 1;
  ctx.save(); ctx.translate(cx, cy); ctx.scale(Math.max(0.01, s * bs), Math.max(0.01, s * bs)); ctx.translate(-cx, -cy);
  if (bs < 1) { ctx.beginPath(); ctx.roundRect ? ctx.roundRect(0, 0, W, H, 18) : ctx.rect(0, 0, W, H); ctx.clip(); }
  pv.t += dt; drawItem(ctx, W, H, pv, dt); ctx.restore();
  if (bs < 1) { ctx.save(); ctx.translate(cx, cy); ctx.scale(s * bs, s * bs); ctx.strokeStyle = col; ctx.lineWidth = 3; ctx.beginPath(); ctx.roundRect ? ctx.roundRect(-W / 2, -H / 2, W, H, 18) : ctx.rect(-W / 2, -H / 2, W, H); ctx.stroke(); ctx.restore(); }
  // falling sparkles for epic+
  if (R.rank >= 2 && !R.reduced) {
    if (!R.fall) R.fall = Array.from({ length: 14 + R.rank * 6 }, (_, i) => ({ x: Math.random() * W, y: -Math.random() * H, v: 30 + Math.random() * 50, s: 1 + Math.random() * 2, c: i % 3 ? col : '#ffffff' }));
    for (const f of R.fall) { f.y += f.v * dt; if (f.y > H) { f.y = -5; f.x = Math.random() * W; } ctx.globalAlpha = 0.8; ctx.fillStyle = f.c; ctx.fillRect(f.x, f.y, f.s, f.s * 2.2); }
    ctx.globalAlpha = 1;
  }
  if (b < 0.25) { ctx.globalAlpha = (0.25 - b) / 0.25; ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, W, H); ctx.globalAlpha = 1; }
}
export { hiSprite };
