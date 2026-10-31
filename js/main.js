// Chess Complex — app shell: menus, loadout, armory, sessions, in-game HUD, progression.
import { PIECES, ABILITIES, PASSIVES, PRESETS, STAT_POINTS, STAT_GAIN, SKINS, DEFAULT_SKINS, MAX_PLAYERS, TURN_MS, BOARDS, DEFAULT_BOARDS, FINISHERS, DEFAULT_FINISHERS, EMOTES, xpForLevel, titleFor, PLAYER_COLORS, QUESTS, WORLD_EVENTS } from './data.js';
import { legalMoves, abilityOptions, canMove, canAct, canUse, slotAbility, stats, effSpd, promoteOptions, predictOrder, unitById, alivePlayers, STORM } from './engine.js';
import { Renderer } from './render.js';
import { pieceIcon, drawPiece } from './pieces.js';
import { FX } from './fx.js';
import { sfx, playNamed, unlockAudio, settings, saveSettings, haptic } from './audio.js';
import { music } from './music.js';
import { GameHost, openServer, openClient, makeCode } from './net.js';

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const PIECE_ORDER = ['pawn', 'knight', 'bishop', 'rook', 'queen'];
const BOT_NAMES = ['Morphy', 'Tal', 'Capablanca', 'Lasker', 'Alekhine', 'Petrosian', 'Botvinnik', 'Steinitz', 'Anderssen', 'Philidor', 'Nimzo', 'Reti', 'Polgar', 'Rubinstein'];
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---------- profile ----------
const PKEY = 'cc_profile_v1';
function defaultProfile() {
  const p = PRESETS.bruiser;
  return {
    name: 'Pawn' + Math.floor(100 + Math.random() * 900),
    build: { preset: 'bruiser', pts: { ...p.pts }, passive: p.passive, equips: { pawn: 'sprint', knight: 'trample', bishop: 'sanctuary', rook: 'rampart', queen: 'execute' } },
    skin: 'ivory', owned: [...DEFAULT_SKINS], marks: 100, played: [], wins: 0, games: 0, kills: 0,
    board: 'hall', ownedBoards: [...DEFAULT_BOARDS], finisher: 'shatter', ownedFinishers: [...DEFAULT_FINISHERS], xp: 0, level: 1, botLevel: 'normal', quests: null, bestAttune: 0, crowns: 0,
  };
}
let profile = defaultProfile();
try { const raw = localStorage.getItem(PKEY); if (raw) { const d = defaultProfile(); profile = { ...d, ...JSON.parse(raw) }; for (const k of ['ownedBoards', 'ownedFinishers', 'owned']) if (!Array.isArray(profile[k])) profile[k] = d[k]; } } catch {}
const save = () => { try { localStorage.setItem(PKEY, JSON.stringify(profile)); } catch {} };
const ptsUsed = () => Object.values(profile.build.pts).reduce((a, b) => a + b, 0);

// ---------- daily quests ----------
const today = () => { const d = new Date(); return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`; };
function dailyQuests() {
  const t = today();
  if (!profile.quests || profile.quests.date !== t) {
    let h = 0; for (const c of t) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    const keys = Object.keys(QUESTS); const pick = [];
    while (pick.length < 3) { h = (h * 1103515245 + 12345) >>> 0; const k = keys[h % keys.length]; if (!pick.includes(k)) pick.push(k); }
    profile.quests = { date: t, list: pick.map((id) => ({ id, prog: 0, done: false })) };
    save();
  }
  return profile.quests.list;
}
function applyQuests(ms) {
  const done = [];
  for (const q of dailyQuests()) {
    if (q.done) continue;
    const Q = QUESTS[q.id];
    const val = { win: ms.win ? 1 : 0, kills: ms.kills, rook: ms.rook ? 1 : 0, queen: ms.queen ? 1 : 0, crown: ms.crown ? 1 : 0, shards: ms.shards, top3: ms.place <= 3 ? 1 : 0, damage: ms.dmg, ults: ms.ults, hollows: ms.hollows, attune: Math.floor(ms.shards / 5) }[q.id] || 0;
    q.prog = Q.best ? Math.max(q.prog, val) : q.prog + val;
    if (q.prog >= Q.goal) { q.prog = Q.goal; q.done = true; profile.marks += Q.reward; done.push(Q); }
  }
  save();
  return done;
}
function renderQuests() {
  renderProfile();
  const list = dailyQuests();
  $('#quest-list').innerHTML = list.map((q) => { const Q = QUESTS[q.id]; return `<div class="quest ${q.done ? 'done' : ''}"><b>${Q.text}</b><div class="rw"><i class="mark-ico"></i>${Q.reward}</div><div class="qbar"><i style="width:${(q.prog / Q.goal) * 100}%"></i></div><span class="qp">${q.prog} / ${Q.goal}</span></div>`; }).join('');
  const now = new Date(), mid = new Date(now); mid.setHours(24, 0, 0, 0);
  const hrs = Math.floor((mid - now) / 3600000), mins = Math.floor(((mid - now) % 3600000) / 60000);
  $('#q-reset').textContent = `New quests in ${hrs}h ${mins}m`;
  $('#career').innerHTML = `<div><b>${profile.games}</b><span>Games</span></div><div><b>${profile.wins}</b><span>Wins</span></div><div><b>${profile.kills}</b><span>KOs</span></div><div><b>${profile.crowns || 0}</b><span>Crowns</span></div>`;
}

function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 2200); }
function uiFlash() { const f = $('#ui-flash'); f.classList.remove('go'); void f.offsetWidth; f.classList.add('go'); }
function renderProfile() {
  $('#marks-title').textContent = profile.marks; $('#marks-armory').textContent = profile.marks; $('#marks-quests').textContent = profile.marks;
  $('#q-badge').textContent = dailyQuests().filter((q) => !q.done).length || '';
  $('#t-lvl').textContent = profile.level; $('#t-title').textContent = titleFor(profile.level);
  $('#t-xp').style.width = Math.min(100, (profile.xp / xpForLevel(profile.level)) * 100) + '%';
}
function countUp(el, from, to, dur = 900, tick = false) {
  const t0 = performance.now();
  const step = (now) => { const k = Math.min(1, (now - t0) / dur); const v = Math.round(from + (to - from) * (1 - Math.pow(1 - k, 3))); if (el.textContent !== String(v) && tick) sfx.tick(); el.textContent = v; if (k < 1) requestAnimationFrame(step); };
  requestAnimationFrame(step);
}

// ---------- background ----------
const bg = { c: $('#bg'), parts: [], on: true };
function bgInit() {
  const c = bg.c, x = c.getContext('2d');
  const resize = () => { const d = Math.min(2, devicePixelRatio || 1); c.width = innerWidth * d; c.height = innerHeight * d; bg.d = d; };
  resize(); addEventListener('resize', resize);
  const spawn = (y) => {
    const pcs = PIECE_ORDER.concat(['king']);
    const skins = profile.owned.length ? profile.owned : DEFAULT_SKINS;
    const depth = Math.random();
    return { x: Math.random(), y: y ?? 1.15, s: 24 + depth * 90, v: 0.01 + depth * 0.025, piece: pcs[Math.floor(Math.random() * pcs.length)], skin: skins[Math.floor(Math.random() * skins.length)], r: (Math.random() - 0.5) * 0.4, a: 0.08 + depth * 0.28, ph: Math.random() * 6, depth };
  };
  for (let i = 0; i < 20; i++) bg.parts.push(spawn(Math.random() * 1.2));
  bg.parts.sort((a, b) => a.depth - b.depth);
  let last = performance.now(); let mx = 0, my = 0;
  addEventListener('pointermove', (e) => { mx = e.clientX / innerWidth - 0.5; my = e.clientY / innerHeight - 0.5; });
  const loop = (now) => {
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    if (bg.on) {
      const W = c.width, H = c.height;
      const g = x.createRadialGradient(W / 2, H * 0.4, 10, W / 2, H / 2, Math.max(W, H) * 0.7);
      g.addColorStop(0, '#1d1830'); g.addColorStop(0.6, '#0e0c16'); g.addColorStop(1, '#060509');
      x.setTransform(1, 0, 0, 1, 0, 0); x.fillStyle = g; x.fillRect(0, 0, W, H);
      x.strokeStyle = 'rgba(214,176,92,0.08)'; x.lineWidth = 1;
      const hz = H * 0.62;
      for (let i = -12; i <= 12; i++) { x.beginPath(); x.moveTo(W / 2 + i * W * 0.02 - mx * 30, hz); x.lineTo(W / 2 + i * W * 0.22 - mx * 120, H); x.stroke(); }
      for (let k = 0; k < 10; k++) { const t = ((k + (now / 4000) % 1) / 10); const y = hz + (H - hz) * t * t; x.beginPath(); x.moveTo(0, y); x.lineTo(W, y); x.stroke(); }
      const hg = x.createLinearGradient(0, hz - 60, 0, hz + 40); hg.addColorStop(0, 'rgba(214,176,92,0)'); hg.addColorStop(0.6, 'rgba(214,176,92,0.12)'); hg.addColorStop(1, 'rgba(214,176,92,0)');
      x.fillStyle = hg; x.fillRect(0, hz - 60, W, 100);
      for (const p of bg.parts) {
        p.y -= p.v * dt; p.ph += dt;
        if (p.y < -0.2) Object.assign(p, spawn());
        x.setTransform(bg.d, 0, 0, bg.d, 0, 0);
        x.globalAlpha = p.a;
        x.translate(p.x * innerWidth + Math.sin(p.ph * 0.5) * 12 - mx * 40 * p.depth, p.y * innerHeight - my * 30 * p.depth);
        x.rotate(p.r + Math.sin(p.ph * 0.3) * 0.08); x.scale(p.s, p.s);
        drawPiece(x, p.piece, p.skin, { t: now / 1000 });
        x.globalAlpha = 1;
      }
    }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}

// ---------- navigation ----------
let screen = 'title';
function go(name) {
  if (name === screen) return;
  $$('.screen').forEach((s) => s.classList.toggle('active', s.id === 's-' + name));
  screen = name;
  bg.on = name !== 'game';
  if (name === 'loadout') renderLoadout();
  if (name === 'armory') renderArmory();
  if (name === 'solo') renderSoloMini();
  if (name === 'host') startHostLobby();
  if (name === 'title') renderProfile();
  if (name === 'quests') renderQuests();
  if (name !== 'game') music.set(0, 'menu');
  armoryPreviews.active = name === 'armory';
}

// ---------- loadout ----------
function renderLoadout() {
  $('#in-name').value = profile.name;
  $('#presets').innerHTML = Object.entries(PRESETS).map(([k, p]) => `<button class="preset ${profile.build.preset === k ? 'on' : ''}" data-preset="${k}"><b>${p.name}</b><span>${p.blurb}</span></button>`).join('');
  const left = STAT_POINTS - ptsUsed();
  $('#pts-left').textContent = `${left} point${left === 1 ? '' : 's'} left${profile.build.preset ? '' : ' - Custom'}`;
  const colors = { hp: '#5cff9d', atk: '#ff6b6b', def: '#7fb6ff', spd: '#ffe04d' };
  $('#stat-alloc').innerHTML = ['hp', 'atk', 'def', 'spd'].map((k) => {
    const v = profile.build.pts[k];
    return `<div class="alloc"><b>${k.toUpperCase()}</b><div class="pips" style="--c:${colors[k]}">${Array.from({ length: STAT_POINTS }, (_, i) => `<i class="${i < v ? 'on' : ''}"></i>`).join('')}</div><button class="step" data-stat="${k}" data-d="-1">-</button><button class="step" data-stat="${k}" data-d="1">+</button></div>`;
  }).join('');
  $('#stat-preview').innerHTML = PIECE_ORDER.map((pc) => {
    const p = PIECES[pc], pts = profile.build.pts;
    return `<div class="sp"><img src="${pieceIcon(pc, profile.skin, null, 48)}" alt=""><div>HP <b>${p.hp + pts.hp * STAT_GAIN.hp}</b><br>ATK <b>${p.atk + pts.atk * STAT_GAIN.atk}</b><br>DEF <b>${Math.round(p.def + pts.def * STAT_GAIN.def)}</b><br>SPD <b>${p.spd + pts.spd}</b></div></div>`;
  }).join('');
  $('#passives').innerHTML = Object.entries(PASSIVES).map(([k, p]) => `<button class="choice ${profile.build.passive === k ? 'on' : ''}" data-passive="${k}"><i class="dot"></i><div><b>${p.name}</b><span>${p.desc}</span></div></button>`).join('');
  $('#equips').innerHTML = PIECE_ORDER.map((pc) => {
    const p = PIECES[pc], sig = ABILITIES[p.sig];
    return `<div class="eq-piece"><div><img src="${pieceIcon(pc, profile.skin, null, 52)}" alt="">${p.name}</div><div>
      <div class="eq-sig">Signature: ${sig.name} <em>- ${sig.desc}</em></div>
      <div class="choice-list">${p.equips.map((e) => `<button class="choice ${profile.build.equips[pc] === e ? 'on' : ''}" data-equip="${pc}:${e}"><i class="dot"></i><div><b>${ABILITIES[e].name}</b><span>${ABILITIES[e].desc} Cooldown ${ABILITIES[e].cd}.</span></div></button>`).join('')}</div>
    </div></div>`;
  }).join('');
}
function onLoadoutClick(e) {
  const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.preset) { const p = PRESETS[b.dataset.preset]; profile.build.preset = b.dataset.preset; profile.build.pts = { ...p.pts }; profile.build.passive = p.passive; sfx.select(); }
  else if (b.dataset.stat) {
    const k = b.dataset.stat, d = +b.dataset.d, v = profile.build.pts[k] + d;
    if (v < 0 || (d > 0 && ptsUsed() >= STAT_POINTS)) { sfx.error(); b.animate([{ transform: 'translateX(-4px)' }, { transform: 'translateX(4px)' }, { transform: 'none' }], 200); return; }
    profile.build.pts[k] = v; profile.build.preset = null; sfx.tap();
  } else if (b.dataset.passive) { profile.build.passive = b.dataset.passive; profile.build.preset = null; sfx.select(); }
  else if (b.dataset.equip) { const [pc, eq] = b.dataset.equip.split(':'); profile.build.equips[pc] = eq; sfx.select(); }
  else return;
  for (const [k, p] of Object.entries(PRESETS)) if (p.passive === profile.build.passive && ['hp', 'atk', 'def', 'spd'].every((s) => p.pts[s] === profile.build.pts[s])) profile.build.preset = k;
  save(); renderLoadout();
}

// ---------- armory ----------
let armoryTab = 'pieces';
const armoryPreviews = { list: [], active: false };
function renderArmory() {
  renderProfile();
  $$('#armory-tabs .tab').forEach((t) => t.classList.toggle('on', t.dataset.tab === armoryTab));
  const hints = { pieces: 'Piece sets change how your pieces look to everyone.', boards: 'Boards change the arena you see.', finishers: 'Finishers play when you eliminate someone. Everyone sees them.' };
  $('#armory-hint').textContent = hints[armoryTab];
  const tag = (price) => `<div class="price-tag"><i class="mark-ico"></i>${price}</div>`;
  const btn = (kind, k, owned, eq, price) => eq ? `<button class="btn small" disabled>Equipped</button>` : owned ? `<button class="btn small" data-equip-${kind}="${k}">Equip</button>` : `<button class="btn small gold" data-buy-${kind}="${k}" ${profile.marks < price ? 'disabled' : ''}>Unlock ${price}</button>`;
  armoryPreviews.list = [];
  if (armoryTab === 'pieces') {
    $('#skins').innerHTML = Object.entries(SKINS).map(([k, s]) => {
      const owned = profile.owned.includes(k), eq = profile.skin === k;
      return `<div class="skin ${eq ? 'equipped' : ''} ${owned ? '' : 'locked'}" data-card="${k}"><div class="glow" style="background:${s.glow}"></div>
        <div class="row"><img src="${pieceIcon('knight', k, null, 48)}" alt=""><img class="mid" src="${pieceIcon('queen', k, null, 72)}" alt=""><img src="${pieceIcon('rook', k, null, 48)}" alt=""></div>
        <h4>${s.name}</h4>${btn('skin', k, owned, eq, s.price)}</div>`;
    }).join('');
  } else if (armoryTab === 'boards') {
    $('#skins').innerHTML = Object.entries(BOARDS).map(([k, s]) => {
      const owned = profile.ownedBoards.includes(k), eq = profile.board === k;
      return `<div class="skin ${eq ? 'equipped' : ''} ${owned ? '' : 'locked'}" data-card="${k}"><div class="glow" style="background:${s.frame}"></div><canvas class="preview" data-board="${k}"></canvas><h4>${s.name}</h4>${btn('board', k, owned, eq, s.price)}</div>`;
    }).join('');
  } else {
    $('#skins').innerHTML = Object.entries(FINISHERS).map(([k, s]) => {
      const owned = profile.ownedFinishers.includes(k), eq = profile.finisher === k;
      return `<div class="skin ${eq ? 'equipped' : ''} ${owned ? '' : 'locked'}" data-card="${k}"><div class="glow" style="background:#ff8a3d"></div><canvas class="preview" data-fin="${k}"></canvas><h4>${s.name}</h4><div class="desc">${s.desc}</div>${btn('fin', k, owned, eq, s.price)}</div>`;
    }).join('');
  }
  $$('#skins canvas.preview').forEach((cv) => setupPreview(cv));
}
function setupPreview(cv) {
  const dpr = Math.min(2, devicePixelRatio || 1);
  const r = cv.getBoundingClientRect(); cv.width = (r.width || 150) * dpr; cv.height = (r.height || 110) * dpr;
  const p = { cv, ctx: cv.getContext('2d'), dpr, board: cv.dataset.board, fin: cv.dataset.fin, fx: new FX(), t: Math.random() * 2, cycle: 0 };
  armoryPreviews.list.push(p);
}
function drawPreview(p, dt) {
  const { ctx, cv, dpr } = p; const W = cv.width / dpr, H = cv.height / dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  p.t += dt;
  if (p.board) {
    const th = BOARDS[p.board]; const ts = W / 6;
    ctx.fillStyle = th.bg[1]; ctx.fillRect(0, 0, W, H);
    ctx.save(); ctx.scale(ts, ts); ctx.translate(0, (H / ts - 4) / 2);
    for (let y = 0; y < 4; y++) for (let x = 0; x < 6; x++) { ctx.fillStyle = (x + y) % 2 ? th.dark : th.light; ctx.fillRect(x, y, 1, 1); }
    ctx.strokeStyle = th.grid; ctx.lineWidth = 0.03; for (let i = 0; i <= 6; i++) { ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, 4); ctx.stroke(); }
    if (th.lava) { ctx.strokeStyle = `rgba(255,110,30,${0.5 + 0.3 * Math.sin(p.t * 2)})`; ctx.lineWidth = 0.05; ctx.beginPath(); ctx.moveTo(0.2, 2.6); ctx.lineTo(1.4, 2.3); ctx.lineTo(2, 2.8); ctx.stroke(); }
    if (th.glowGrid) { const sw = (p.t * 2) % 5; ctx.strokeStyle = 'rgba(0,240,255,0.6)'; ctx.beginPath(); ctx.moveTo(0, sw); ctx.lineTo(6, sw); ctx.stroke(); }
    const g = ctx.createLinearGradient(4, 0.6, 5, 1.6); g.addColorStop(0, th.wallTop[0]); g.addColorStop(1, th.wallTop[1]);
    ctx.fillStyle = th.wallFront; ctx.fillRect(4, 1.58, 1, 0.42); ctx.fillStyle = g; ctx.fillRect(4, 0.58, 1, 1);
    ctx.translate(2.5, 2.86 + Math.sin(p.t * 2) * 0.02); ctx.scale(0.92, 0.92); drawPiece(ctx, 'knight', profile.skin, { t: p.t });
    ctx.restore();
  } else {
    ctx.fillStyle = '#0d0b13'; ctx.fillRect(0, 0, W, H);
    const ts = H / 2.2;
    ctx.save(); ctx.scale(ts, ts);
    const cx = W / ts / 2, by = 1.75;
    p.cycle += dt;
    if (p.cycle > 2.6) { p.cycle = 0; p.shown = false; }
    if (!p.shown && p.cycle > 0.5) { p.shown = true; p.fx.finisher(p.fin, cx, by, 'rook', 'obsidian', '#7f6bff'); }
    p.fx.update(dt);
    ctx.fillStyle = 'rgba(255,255,255,0.04)'; ctx.beginPath(); ctx.ellipse(cx, by, 0.6, 0.15, 0, 0, Math.PI * 2); ctx.fill();
    p.fx.drawGround(ctx);
    if (!p.shown) { ctx.save(); ctx.translate(cx, by); ctx.scale(0.92, 0.92); drawPiece(ctx, 'rook', 'obsidian', { t: p.t, flash: Math.max(0, (p.cycle - 0.35) * 6) }); ctx.restore(); }
    p.fx.drawAbove(ctx);
    ctx.restore();
    if (p.fx.screenFlash > 0.01) { ctx.globalAlpha = p.fx.screenFlash * 0.6; ctx.fillStyle = p.fx.flashColor; ctx.fillRect(0, 0, W, H); ctx.globalAlpha = 1; }
  }
}
function onArmoryClick(e) {
  const tab = e.target.closest('.tab'); if (tab) { armoryTab = tab.dataset.tab; sfx.tap(); renderArmory(); return; }
  const b = e.target.closest('button'); if (!b) return;
  const d = b.dataset;
  const buy = (list, ownedKey, eqKey, k, label) => {
    const price = list[k].price;
    if (profile.marks < price) { sfx.error(); return; }
    profile.marks -= price; profile[ownedKey].push(k); profile[eqKey] = k; save(); sfx.buy(); uiFlash(); haptic([20, 30, 40]);
    toast(`${label} unlocked`); renderArmory();
    const card = $(`[data-card="${k}"]`); if (card) card.classList.add('unlocked-anim');
  };
  if (d.buySkin) buy(SKINS, 'owned', 'skin', d.buySkin, SKINS[d.buySkin].name);
  else if (d.buyBoard) buy(BOARDS, 'ownedBoards', 'board', d.buyBoard, BOARDS[d.buyBoard].name);
  else if (d.buyFin) buy(FINISHERS, 'ownedFinishers', 'finisher', d.buyFin, FINISHERS[d.buyFin].name);
  else if (d.equipSkin) { profile.skin = d.equipSkin; save(); sfx.select(); renderArmory(); }
  else if (d.equipBoard) { profile.board = d.equipBoard; save(); sfx.select(); renderArmory(); }
  else if (d.equipFin) { profile.finisher = d.equipFin; save(); sfx.select(); renderArmory(); }
}

function renderSoloMini() {
  const b = profile.build;
  $$('#seg-diff button').forEach((x) => x.classList.toggle('on', x.dataset.diff === profile.botLevel));
  $('#solo-loadout').innerHTML = `<img src="${pieceIcon('pawn', profile.skin, '#d6b05c', 64)}" alt=""><div class="lm-t"><b>${esc(profile.name)}</b><span>${b.preset ? PRESETS[b.preset].name : 'Custom'} build - ${PASSIVES[b.passive].name} - ${SKINS[profile.skin].name} - ${FINISHERS[profile.finisher].name}</span></div>`;
}

// ---------- bots ----------
function botPlayer(i, used) {
  const names = BOT_NAMES.filter((n) => !used.includes(n));
  const name = names[Math.floor(Math.random() * names.length)] || 'Bot' + i;
  const keys = Object.keys(PRESETS), p = PRESETS[keys[Math.floor(Math.random() * keys.length)]];
  const equips = {}; for (const pc of PIECE_ORDER) { const list = PIECES[pc].equips; equips[pc] = list[Math.floor(Math.random() * list.length)]; }
  const skins = Object.keys(SKINS), fins = Object.keys(FINISHERS);
  return { pid: 'bot' + i + Math.random().toString(36).slice(2, 6), name, isBot: true, botLevel: profile.botLevel || 'normal', skin: skins[Math.floor(Math.random() * skins.length)], finisher: fins[Math.floor(Math.random() * fins.length)], build: { pts: { ...p.pts }, passive: p.passive, equips } };
}
const me = () => ({ pid: 'me', name: profile.name || 'Player', skin: profile.skin, finisher: profile.finisher, build: { pts: { ...profile.build.pts }, passive: profile.build.passive, equips: { ...profile.build.equips } } });

// ---------- sessions ----------
let session = null;
function endSession() {
  if (!session) return;
  try { session.host && session.host.stop(); } catch {}
  try { session.server && session.server.close(); } catch {}
  try { session.client && session.client.close(); } catch {}
  session = null;
}
function hostEmit(sess, m) { for (const c of sess.conns ? sess.conns.values() : []) c.send(m); game.onMsg(m); }
function hostEmote(sess, pid, k) {
  if (!EMOTES[k] || !sess.host) return;
  const u = sess.host.s.units.find((v) => v.pid === pid && v.alive); if (!u) return;
  const now = Date.now(); sess.emoteAt = sess.emoteAt || {};
  if (now - (sess.emoteAt[pid] || 0) < 1500) return;
  sess.emoteAt[pid] = now;
  hostEmit(sess, { t: 'emote', id: u.id, k });
}
function botChatter(sess, m) {
  if (!m.ev || !sess.host) return;
  for (const e of m.ev) {
    if (e.e !== 'death' || !e.by) continue;
    const k = sess.host.s.units.find((v) => v.id === e.by);
    if (k && k.bot && Math.random() < 0.45) setTimeout(() => hostEmote(sess, k.pid, ['check', 'gg', 'come', 'nice'][Math.floor(Math.random() * 4)]), 900);
  }
}

function startSolo(bots = null) {
  endSession();
  const n = bots ?? +$('#in-bots').value;
  const players = [me()];
  for (let i = 0; i < n; i++) players.push(botPlayer(i, players.map((p) => p.name)));
  const sess = { mode: 'solo', myPid: 'me', bots: n };
  session = sess;
  sess.host = new GameHost(players, (m) => { game.onMsg(m); botChatter(sess, m); });
  sess.send = (a) => sess.host.act('me', a);
  sess.emote = (k) => hostEmote(sess, 'me', k);
  game.enter();
  sess.host.start();
}

function lobbyHTML(players, host) {
  return players.map((p, i) => `<li style="--c:${PLAYER_COLORS[i]}"><img src="${pieceIcon('pawn', p.skin, null, 34)}" alt=""><b>${esc(p.name)}</b><em>${p.pid === 'me' ? 'Host' : p.isBot ? 'Bot' : 'Player'}</em>${host && p.pid !== 'me' ? `<button data-kick="${p.pid}">Remove</button>` : ''}</li>`).join('');
}
function startHostLobby() {
  if (session && session.mode === 'host' && session.rematch) { session.rematch = false; session.renderLobby(); return; }
  endSession();
  if (!window.Peer && !location.search.includes('net=local')) { $('#host-status').textContent = 'Online play could not load. Check your connection and reload.'; $('#host-status').classList.add('err'); return; }
  const code = makeCode();
  session = { mode: 'host', myPid: 'me', code, players: [me()], conns: new Map(), started: false };
  $('#host-code').textContent = code;
  $('#host-status').textContent = 'Opening room...'; $('#host-status').classList.remove('err');
  const sess = session;
  const renderLobby = () => {
    $('#host-lobby').innerHTML = lobbyHTML(sess.players, true);
    $('#lobby-count').textContent = `${sess.players.length}/${MAX_PLAYERS}`;
    $('#btn-start-host').disabled = sess.players.length < 2;
    const pub = sess.players.map(({ pid, name, skin, isBot }) => ({ pid, name, skin, isBot }));
    for (const c of sess.conns.values()) c.send({ t: 'lobby', players: pub, code });
  };
  sess.renderLobby = renderLobby;
  sess.emote = (k) => hostEmote(sess, 'me', k);
  sess.server = openServer(code, {
    onReady: () => { if (session !== sess) return; $('#host-status').textContent = 'Room open. Share the code with friends.'; sfx.select(); },
    onError: (t) => {
      if (session !== sess) return;
      if (t === 'unavailable-id') { session = null; startHostLobby(); return; }
      if (['network', 'server-error', 'socket-error', 'socket-closed'].includes(t)) { $('#host-status').textContent = 'Lost connection to the matchmaking server. Go back and try again.'; $('#host-status').classList.add('err'); }
    },
    onConn: (conn) => {
      conn.onData((m) => {
        if (!m || typeof m !== 'object') return;
        if (m.t === 'join') {
          if (sess.started || sess.players.length >= MAX_PLAYERS) { conn.send({ t: 'full' }); return; }
          const pid = 'c' + Math.random().toString(36).slice(2, 8);
          conn.pid = pid; sess.conns.set(pid, conn);
          const b = m.build || {};
          const equips = {}; for (const pc of PIECE_ORDER) equips[pc] = PIECES[pc].equips.includes(b.equips && b.equips[pc]) ? b.equips[pc] : PIECES[pc].equips[0];
          sess.players.push({ pid, name: String(m.name || 'Player').replace(/[<>]/g, '').slice(0, 14), skin: SKINS[m.skin] ? m.skin : 'ivory', finisher: FINISHERS[m.finisher] ? m.finisher : 'shatter', build: { pts: sanitizePts(b.pts), passive: PASSIVES[b.passive] ? b.passive : 'regen', equips } });
          conn.send({ t: 'welcome', pid });
          sfx.select(); renderLobby();
        } else if (m.t === 'act' && sess.host && conn.pid) sess.host.act(conn.pid, m.a);
        else if (m.t === 'emote' && conn.pid) hostEmote(sess, conn.pid, m.k);
      });
      conn.onClose(() => {
        if (!conn.pid) return;
        sess.conns.delete(conn.pid);
        if (!sess.started) { sess.players = sess.players.filter((p) => p.pid !== conn.pid); renderLobby(); }
        else if (sess.host) { sess.host.setBot(conn.pid); const u = sess.host.s.units.find((v) => v.pid === conn.pid); if (u) game.feed(`<b>${esc(u.name)}</b> disconnected - a bot takes over`); }
      });
    },
  });
  renderLobby();
}
function sanitizePts(p) {
  const out = { hp: 0, atk: 0, def: 0, spd: 0 }; let left = STAT_POINTS;
  for (const k of Object.keys(out)) { const v = Math.max(0, Math.min(left, Math.floor(+((p || {})[k]) || 0))); out[k] = v; left -= v; }
  return out;
}
function hostAddBot() {
  if (!session || session.mode !== 'host' || session.players.length >= MAX_PLAYERS) { sfx.error(); return; }
  session.players.push(botPlayer(session.players.length, session.players.map((p) => p.name))); sfx.tap(); session.renderLobby();
}
function startHost() {
  const sess = session; if (!sess || sess.players.length < 2) return;
  sess.started = true;
  sess.players = sess.players.filter((p) => p.isBot || p.pid === 'me' || sess.conns.has(p.pid));
  sess.players[0] = { ...me() };
  sess.host = new GameHost(sess.players, (m) => { hostEmit(sess, m); botChatter(sess, m); });
  sess.send = (a) => sess.host.act('me', a);
  for (const c of sess.conns.values()) c.send({ t: 'start', pid: c.pid });
  game.enter();
  sess.host.start();
}

function joinGame() {
  const code = $('#in-code').value.trim().toUpperCase();
  const st = $('#join-status');
  if (code.length !== 5) { st.textContent = 'Codes are 5 characters.'; st.classList.add('err'); sfx.error(); return; }
  if (!window.Peer && !location.search.includes('net=local')) { st.textContent = 'Online play could not load. Check your connection and reload.'; st.classList.add('err'); return; }
  endSession();
  st.textContent = 'Connecting...'; st.classList.remove('err');
  const sess = { mode: 'client', myPid: null, code };
  session = sess;
  sess.client = openClient(code, {
    onOpen: () => { st.textContent = 'Connected. Joining lobby...'; sess.client.send({ t: 'join', name: profile.name, skin: profile.skin, finisher: profile.finisher, build: profile.build }); },
    onData: (m) => {
      if (session !== sess) return;
      if (m.t === 'welcome') { sess.myPid = m.pid; st.textContent = 'In the lobby.'; sfx.select(); }
      else if (m.t === 'lobby') { $('#join-lobby-panel').classList.remove('hidden'); $('#join-lobby').innerHTML = lobbyHTML(m.players, false); }
      else if (m.t === 'full') { st.textContent = 'That match is full or already started.'; st.classList.add('err'); }
      else if (m.t === 'start') { sess.myPid = m.pid; matchKey = 'm' + Date.now(); game.enter(); }
      else if (m.t === 'state' || m.t === 'emote') game.onMsg(m);
    },
    onClose: () => {
      if (session !== sess) return;
      if (screen === 'game' && game.s && !game.s.over) { toast('The host left the match'); game.showResults(true); }
      else if (screen === 'join') { st.textContent = 'Disconnected from host.'; st.classList.add('err'); }
    },
    onError: (t) => {
      if (session !== sess) return;
      st.textContent = t === 'peer-unavailable' ? 'No match found with that code.' : t === 'timeout' ? 'Could not reach that match. Check the code and try again.' : 'Connection error. Try again.';
      st.classList.add('err'); sfx.error();
    },
  });
  sess.send = (a) => sess.client.send({ t: 'act', a });
  sess.emote = (k) => sess.client.send({ t: 'emote', k });
}

// ---------- game UI ----------
const STREAKS = { 2: 'Double Take', 3: 'Triple Threat', 4: 'Rampage', 5: 'Grandmaster', 6: 'Unstoppable', 7: 'Checkmate Artist' };
const game = {
  r: null, s: null, mode: 'move', preview: null, deadline: 0, lastTurnNo: -1, resultsShown: false, lastHp: null, beatT: 0,
  init() {
    this.r = new Renderer($('#board'), {
      sfx: (n) => playNamed(n),
      haptic: (p) => haptic(p),
      streak: (e) => this.onStreak(e),
      shard: (x, y, n) => this.flyShards(x, y, n),
    });
    let last = performance.now();
    const loop = (now) => {
      const dt = Math.min(0.05, (now - last) / 1000); last = now;
      if (screen === 'game') { this.r.frame(dt); this.tickTimer(); this.heartbeat(dt); }
      if (armoryPreviews.active) for (const p of armoryPreviews.list) drawPreview(p, dt);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
    this.bindInput();
    addEventListener('resize', () => { if (screen === 'game') this.fitPad(); });
    $('#h-actions').addEventListener('click', (e) => { const b = e.target.closest('.act'); if (b) this.onAction(b.dataset.slot); });
    $('#promo-opts').addEventListener('click', (e) => {
      const b = e.target.closest('.popt'); if (!b || b.disabled) return;
      session.send({ type: 'promote', to: b.dataset.to }); $('#m-promote').classList.add('hidden');
    });
    $('#emote-menu').innerHTML = Object.entries(EMOTES).map(([k, t]) => `<button data-emote="${k}">${t}</button>`).join('');
    $('#ult-btn').addEventListener('click', () => this.onAction('ult'));
    $('#emote-menu').addEventListener('click', (e) => { const b = e.target.closest('[data-emote]'); if (!b || !session || !session.emote) return; session.emote(b.dataset.emote); $('#emote-menu').classList.add('hidden'); sfx.tap(); });
  },
  enter() {
    this.ms = { kills: 0, hollows: 0, ults: 0, crown: false, rook: false, queen: false };
    this.s = null; this.mode = 'move'; this.preview = null; this.lastTurnNo = -1; this.resultsShown = false; this.lastHp = null; this.lastAlive = 99;
    this.r.reset(); this.r.setTheme(profile.board); this.r.shakeOn = settings.shake; this.r.resize();
    $$('#s-game .modal').forEach((m) => m.classList.add('hidden'));
    $('#h-feed').innerHTML = ''; $('#emote-menu').classList.add('hidden');
    go('game');
    music.set(1, 'fight');
    requestAnimationFrame(() => this.fitPad());
  },
  fitPad() {
    const top = $('.hud-top').getBoundingClientRect().bottom;
    const bot = $('.hud-bottom').getBoundingClientRect();
    this.r.setPad(top + 4, Math.max(0, innerHeight - bot.top - 10));
    $('#s-game').style.setProperty('--hb', Math.round(innerHeight - bot.top) + 'px');
  },
  get me() { return this.s && session ? this.s.units.find((u) => u.pid === session.myPid) : null; },
  myTurn() { const m = this.me; return !!(m && m.alive && this.s.active === m.id && !this.s.over); },
  onMsg(m) {
    if (!session) return;
    if (m.t === 'emote') { const u = this.s && unitById(this.s, m.id); if (u) { this.r.emote(m.id, EMOTES[m.k]); sfx.emote(); } return; }
    if (m.t !== 'state') return;
    const first = !this.s;
    this.s = m.state;
    this.deadline = Date.now() + m.dl;
    const mine = this.me;
    this.r.myId = mine ? mine.id : null;
    this.r.setState(this.s, m.ev, first);
    if (first) { this.r.startIntro(this.s, this.r.myId); setTimeout(() => this.fitPad(), 50); }
    this.handleEvents(m.ev, first);
    if (this.s.turnNo !== this.lastTurnNo) {
      this.lastTurnNo = this.s.turnNo; this.mode = 'move'; this.preview = null;
      const a = unitById(this.s, this.s.active);
      if (!first && a && (this.myTurn() || (a.kind === 'player' && this.r.follow))) this.r.focus(a.x, a.y);
    }
    if (this.myTurn()) {
      const u = this.me;
      if (this.mode === 'move' && !canMove(this.s, u) && canAct(this.s, u)) this.mode = 'atk';
      if (this.mode !== 'move' && !canUse(this.s, u, this.mode)) this.mode = canMove(this.s, u) ? 'move' : 'atk';
      this.preview = null;
    }
    // music intensity
    const alive = alivePlayers(this.s).length;
    const lvl = this.s.over ? 1 : alive <= 2 ? 3 : (this.s.storm.ring > 0 || this.s.storm.crack || alive <= 4) ? 2 : 1;
    music.set(lvl, lvl === 3 ? 'final' : 'fight');
    if (alive === 2 && this.lastAlive > 2 && !this.s.over) setTimeout(() => this.banner('Final Two', 'Only one walks away', 'red'), 900);
    this.lastAlive = alive;
    this.refresh();
  },
  handleEvents(ev, first) {
    const s = this.s, myId = this.r.myId;
    if (first) { setTimeout(() => this.banner('Round 1', 'Last piece standing wins', ''), 1500); return; }
    for (const e of ev) {
      if (e.e === 'turn' && e.id === myId) setTimeout(() => { this.banner('Your Turn', '', ''); sfx.turn(); $('#h-actions').classList.remove('myturn'); void $('#h-actions').offsetWidth; $('#h-actions').classList.add('myturn'); }, 250);
      if (e.e === 'storm') setTimeout(() => e.phase === 'crack' ? this.banner('The Storm Gathers', 'The outer ring collapses next round', 'red') : this.banner('Collapse', s.storm.ring >= STORM.maxRing ? 'Sudden death - everyone burns' : 'Stay inside the ring', 'red'), 200);
      if (e.e === 'crownSpawn') this.banner('The Crown', 'Has appeared at the centre', '');
      if (e.e === 'world' && !(e.kind === 'meteor' && e.phase === 'strike')) { const W = WORLD_EVENTS[e.kind]; setTimeout(() => this.banner(W.name, W.desc, e.kind === 'meteor' || e.kind === 'bloodMoon' ? 'red' : 'cyan'), 300); }
      if (e.e === 'ability' && e.id === myId && e.slot === 'ult') this.ms.ults++;
      if (e.e === 'crowned' && e.id === myId) this.ms.crown = true;
      if (e.e === 'promote' && e.id === myId && e.piece === 'rook') this.ms.rook = true;
      if (e.e === 'promote' && e.id === myId && e.piece === 'queen') this.ms.queen = true;
      if (e.e === 'attune' && e.id === myId) { const p = $('#h-attune'); p.classList.remove('bump'); void p.offsetWidth; p.classList.add('bump'); }
      if (e.e === 'death' && e.by === myId) { const v = unitById(s, e.id); if (v && v.kind === 'hollow') this.ms.hollows++; else if (v) this.ms.kills++; }
      if (e.e === 'crowned') { const u = unitById(s, e.id); this.banner(u.id === myId ? 'You Are King' : 'A New King', u.id === myId ? 'Everyone is coming for you' : `${u.name} wears the Crown`, ''); }
      if (e.e === 'promote' && e.id === myId) setTimeout(() => this.banner(e.type === 'evolve' ? PIECES[e.piece].name : 'Honed', e.type === 'evolve' ? 'Evolution complete' : `${PIECES[e.piece].name} level ${e.hone}`, 'cyan'), 300);
      if (e.e === 'death') {
        const v = unitById(s, e.id); if (!v || v.kind !== 'player') continue;
        const k = e.by ? unitById(s, e.by) : null;
        const ico = (u) => `<img src="${pieceIcon(u.piece, u.skin, null, 18)}" alt="">`;
        setTimeout(() => this.feed(k && k.id !== v.id ? `${ico(k)}<b style="color:${k.color}">${esc(k.name)}</b><span class="x">took</span>${ico(v)}<b style="color:${v.color}">${esc(v.name)}</b>` : `${ico(v)}<b style="color:${v.color}">${esc(v.name)}</b><span class="x">${e.cause === 'meteor' ? 'was crushed by a meteor' : 'fell to the storm'}</span>`), 400);
        if (e.id === myId && !s.over) { this.killedBy = k; setTimeout(() => this.showDead(), 1700); }
      }
      if (e.e === 'over') setTimeout(() => this.showResults(), 4800);
    }
  },
  onStreak(e) {
    const k = unitById(this.s, e.by); if (!k) return;
    let text = e.firstBlood ? 'First Blood' : STREAKS[Math.min(7, e.streak)];
    if (!text) return;
    const el = $('#h-streak');
    el.innerHTML = `<span>${text}</span><small style="color:${k.color}">${esc(k.name)}</small>`;
    el.classList.remove('show'); void el.offsetWidth; el.classList.add('show');
    sfx.stinger(e.firstBlood ? 1 : e.streak);
  },
  flyShards(x, y, n) {
    const target = $('#h-shard-ico').getBoundingClientRect();
    const layer = $('#fx-layer');
    for (let i = 0; i < Math.min(6, n * 2); i++) {
      const d = document.createElement('div'); d.className = 'fly-shard'; layer.appendChild(d);
      const mx = x + (Math.random() - 0.5) * 120, my = y - 60 - Math.random() * 80;
      const a = d.animate([
        { transform: `translate(${x}px,${y}px) scale(.4)`, opacity: 0 },
        { transform: `translate(${mx}px,${my}px) scale(1.2)`, opacity: 1, offset: 0.35 },
        { transform: `translate(${target.left + target.width / 2}px,${target.top + target.height / 2}px) scale(.6)`, opacity: 1 },
      ], { duration: 650 + i * 70, easing: 'cubic-bezier(.5,0,.6,1)' });
      a.onfinish = () => { d.remove(); sfx.coin(); const ic = $('#h-shard-ico'); ic.classList.remove('bump'); void ic.offsetWidth; ic.classList.add('bump'); };
    }
  },
  banner(main, sub, tone) {
    const b = $('#h-banner'); b.className = 'banner ' + (tone || '');
    b.querySelector('.b-main').textContent = main; b.querySelector('.b-sub').textContent = sub;
    void b.offsetWidth; b.classList.add('show');
  },
  feed(html) { const d = document.createElement('div'); d.innerHTML = html; $('#h-feed').prepend(d); setTimeout(() => d.remove(), 5200); while ($('#h-feed').children.length > 4) $('#h-feed').lastChild.remove(); },
  heartbeat(dt) {
    const u = this.me; if (!u || !u.alive || !this.s || this.s.over) return;
    if (u.hp / stats(u).maxHp < 0.3) { this.beatT -= dt; if (this.beatT <= 0) { this.beatT = 1.1; sfx.heartbeat(); } }
  },

  options() {
    const u = this.me; if (!u || !this.myTurn()) return [];
    if (this.mode === 'move' || this.mode === 'promote') return [];
    if (!canUse(this.s, u, this.mode)) return [];
    return abilityOptions(this.s, u, this.mode);
  },
  refresh() {
    const s = this.s; if (!s) return;
    const u = this.me;
    if (this.myTurn()) {
      if (this.mode === 'move') this.r.overlay = canMove(s, u) ? { moves: legalMoves(s, u), from: { x: u.x, y: u.y } } : null;
      else { const opts = this.options(); if (this.preview) this.preview = opts.find((o) => o.anchor.x === this.preview.anchor.x && o.anchor.y === this.preview.anchor.y) || null; this.r.overlay = { opts, preview: this.preview }; }
    } else this.r.overlay = null;
    this.updateHud();
  },
  updateHud() {
    const s = this.s, u = this.me;
    $('#h-round').textContent = `Round ${s.round}`;
    const st = $('#h-storm');
    if (s.storm.ring >= STORM.maxRing) { st.textContent = 'Sudden death'; st.classList.add('hot'); }
    else if (s.storm.crack) { st.textContent = 'Collapse next round'; st.classList.add('hot'); }
    else { let next = STORM.firstCrack; while (next <= s.round) next += STORM.every; st.textContent = `Storm in ${next - s.round}`; st.classList.toggle('hot', next - s.round <= 1); }
    $('#h-alive').textContent = `${alivePlayers(s).length} left`;
    const order = predictOrder(s, 7);
    const oh = order.map((id) => { const v = unitById(s, id); if (!v) return ''; return `<div class="o ${u && v.id === u.id ? 'me' : ''}" style="--c:${v.kind === 'player' ? v.color : '#555'}"><img src="${pieceIcon(v.piece, v.skin, null, 36)}" alt=""></div>`; }).join('');
    if ($('#h-order').dataset.k !== order.join(',')) { $('#h-order').innerHTML = oh; $('#h-order').dataset.k = order.join(','); }
    if (!u) return;
    const stt = stats(u);
    $('#h-portrait').src = pieceIcon(u.piece, u.skin, u.color, 56); $('#h-portrait').style.setProperty('--c', u.color);
    $('#h-name').textContent = u.name;
    const hone = u.hone[u.piece] || 0;
    $('#h-hone').innerHTML = '<i></i>'.repeat(hone);
    $('#h-piece').textContent = PIECES[u.piece] ? PIECES[u.piece].name : '';
    const r = Math.max(0, u.hp / stt.maxHp);
    const hp = $('#h-hp'); hp.style.width = r * 100 + '%'; hp.className = r > 0.5 ? '' : r > 0.25 ? 'mid' : 'low';
    $('#h-hpghost').style.width = r * 100 + '%';
    if (this.lastHp != null && u.hp < this.lastHp) { const c = $('#h-card'); c.classList.remove('hit'); void c.offsetWidth; c.classList.add('hit'); }
    $('#h-card').classList.toggle('low', u.alive && r < 0.3);
    this.lastHp = u.hp;
    $('#h-hptext').textContent = `${Math.max(0, u.hp)} / ${stt.maxHp}`;
    const defBuff = u.buffs.some((b) => b.k === 'def'), spdBuff = u.buffs.some((b) => b.k === 'spd' && b.v > 0);
    $('#h-stats').innerHTML = `<span>ATK <b>${stt.atk}</b></span><span class="${defBuff ? 'up' : ''}">DEF <b>${stt.def}${defBuff ? '+' : ''}</b></span><span class="${spdBuff ? 'up' : ''}">SPD <b>${Math.round(effSpd(u) * 10) / 10}</b></span><span>${PASSIVES[u.passive].name}</span>`;
    const popts = promoteOptions(u);
    const minCost = popts.length ? Math.min(...popts.map((p) => p.cost)) : 0;
    const shEl = $('#h-shards');
    if (shEl.textContent !== String(u.shards)) { const prev = +shEl.textContent || 0; if (u.shards > prev) setTimeout(() => countUp(shEl, prev, u.shards, 500), 500); else shEl.textContent = u.shards; }
    $('#h-shardprog').style.width = (minCost ? Math.min(1, u.shards / minCost) * 100 : 100) + '%';
    const nextEvo = popts.find((p) => p.type === 'evolve');
    $('#h-attune').textContent = `ATT ${u.attune || 0}`;
    const ub = $('#ult-btn'), up = Math.min(100, Math.round(u.ult || 0));
    $('#ult-fg').style.strokeDashoffset = 176 * (1 - up / 100);
    $('#ult-pct').textContent = up >= 100 ? ABILITIES[slotAbility(u, 'ult')].name.split(' ')[0] : up + '%';
    ub.classList.toggle('ready', up >= 100 && u.alive);
    ub.classList.toggle('on', this.myTurn() && this.mode === 'ult');
    ub.classList.toggle('hidden-ult', !u.alive);
    const chip = $('#event-chip');
    if (s.meteors && s.meteors.length) { chip.textContent = 'Meteors incoming'; chip.className = 'event-chip red'; }
    else if (s.bloodMoon) { chip.textContent = 'Blood Moon - damage +30%'; chip.className = 'event-chip red'; }
    else chip.className = 'event-chip hidden';
    $('#h-next').textContent = u.piece === 'king' ? 'Crowned' : nextEvo ? `${popts.filter((p) => p.type === 'evolve').map((p) => PIECES[p.to].name).join(' / ')} ${nextEvo.cost}` : popts.length ? `Hone ${minCost}` : 'Max';
    const my = this.myTurn();
    $('#h-actions').classList.toggle('wait', !my);
    if (!my) $('#h-actions').classList.remove('myturn');
    const set = (slot, name) => { const el = $(`#a-${slot}`); if (el) el.textContent = name; };
    set('move', PIECES[u.piece] ? (u.piece === 'king' ? 'Step' : PIECES[u.piece].name) : '');
    set('atk', ABILITIES[slotAbility(u, 'atk')].name);
    set('sig', ABILITIES[slotAbility(u, 'sig')].name);
    const eqId = slotAbility(u, 'eq'); set('eq', eqId ? ABILITIES[eqId].name : 'None');
    set('promo', popts.length ? `${u.shards}/${minCost}` : '--');
    for (const b of $$('#h-actions .act')) {
      const slot = b.dataset.slot;
      b.classList.toggle('on', my && slot === this.mode);
      b.classList.remove('confirm');
      let used = false;
      if (slot === 'move') used = !canMove(s, u) || !legalMoves(s, u).length;
      else if (slot === 'atk') used = !canAct(s, u);
      else if (slot === 'sig' || slot === 'eq') {
        used = (!eqId && slot === 'eq') || (!canUse(s, u, slot) && u.cd[slot] === 0);
        b.classList.toggle('cooling', u.cd[slot] > 0);
        $('#cd-' + slot).textContent = u.cd[slot] > 0 ? u.cd[slot] : '';
        if (!used && u.cd[slot] === 0 && abilityOptions(s, u, slot).length === 0) used = true;
      } else if (slot === 'promote') { used = !popts.length; b.classList.toggle('ready', my && popts.some((p) => p.cost <= u.shards)); }
      b.classList.toggle('used', my && used);
      if (my && slot === this.mode && this.preview) b.classList.add('confirm');
    }
    const a = unitById(s, s.active);
    let tip = '';
    if (!u.alive) tip = 'You are spectating.';
    else if (!my) tip = a ? (a.kind === 'hollow' ? 'A Hollow stirs...' : `<b>${esc(a.name)}</b> is taking their turn`) : '';
    else if (this.mode === 'move') tip = canMove(s, u) ? `<b>Move:</b> ${PIECES[u.piece].moveDesc} Tap a blue tile.` : canAct(s, u) ? 'Choose an action, or end your turn.' : '';
    else { const id = slotAbility(u, this.mode), ab = ABILITIES[id]; tip = `<b>${ab.name}:</b> ${ab.desc}${honedTip(u, id)} ${this.preview ? '<b>Tap again to confirm.</b>' : 'Tap a target.'}`; }
    $('#h-tip').innerHTML = tip;
  },
  tickTimer() {
    const t = $('#h-timer'); if (!this.s || this.s.over) { t.style.transform = 'scaleX(0)'; return; }
    const a = unitById(this.s, this.s.active);
    const human = a && a.kind === 'player' && !a.bot;
    const left = Math.max(0, this.deadline - Date.now());
    t.style.transform = `scaleX(${human ? left / TURN_MS : 0})`;
    t.classList.toggle('low', left < 8000);
    if (this.myTurn() && left < 5000 && Math.floor(left / 1000) !== this.lastTick) { this.lastTick = Math.floor(left / 1000); sfx.warn(); }
  },
  onAction(slot) {
    unlockAudio();
    if (!this.myTurn()) { sfx.error(); return; }
    const u = this.me;
    if (slot === 'end') { sfx.tap(); session.send({ type: 'end' }); return; }
    if (slot === 'promote') { this.openPromote(); return; }
    if (slot === this.mode && this.preview) { this.exec(this.preview); return; }
    if (slot === 'move') { this.mode = 'move'; this.preview = null; sfx.tap(); this.refresh(); return; }
    if (slot !== 'atk' && u.cd[slot] > 0) { sfx.error(); toast(`Ready in ${u.cd[slot]} turn${u.cd[slot] > 1 ? 's' : ''}`); return; }
    if (!canUse(this.s, u, slot)) { sfx.error(); return; }
    this.mode = slot; this.preview = null;
    const opts = this.options();
    if (opts.length === 1 && opts[0].anchor.x === u.x && opts[0].anchor.y === u.y) this.preview = opts[0];
    sfx.select(); this.refresh();
  },
  exec(o) { sfx.tap(); session.send({ type: 'ability', slot: this.mode, x: o.anchor.x, y: o.anchor.y }); this.preview = null; },
  optAt(t) {
    const opts = this.options();
    let o = opts.find((q) => q.anchor.x === t.x && q.anchor.y === t.y);
    if (!o) { const c = opts.filter((q) => q.tiles.some((p) => p.x === t.x && p.y === t.y)); if (c.length === 1) o = c[0]; }
    return o;
  },
  onTap(t, mouse) {
    unlockAudio();
    $('#emote-menu').classList.add('hidden');
    if (!t || !this.s) return;
    if (this.myTurn()) {
      const u = this.me;
      if (this.mode === 'move') {
        if (canMove(this.s, u) && legalMoves(this.s, u).some((m) => m.x === t.x && m.y === t.y)) { session.send({ type: 'move', x: t.x, y: t.y }); return; }
      } else {
        const o = this.optAt(t);
        if (o) { if (mouse || (this.preview && this.preview.anchor.x === o.anchor.x && this.preview.anchor.y === o.anchor.y)) this.exec(o); else { this.preview = o; sfx.tap(); this.refresh(); } return; }
        if (this.preview) { this.preview = null; this.refresh(); return; }
      }
    }
    this.inspect(t);
  },
  onHover(t) {
    if (!this.myTurn() || !t) { if (this.r.overlay) this.r.overlay.hover = null; return; }
    if (this.mode === 'move') { if (this.r.overlay && this.r.overlay.moves) this.r.overlay.hover = this.r.overlay.moves.find((m) => m.x === t.x && m.y === t.y) || null; return; }
    const o = this.optAt(t) || null;
    const same = o && this.preview && o.anchor.x === this.preview.anchor.x && o.anchor.y === this.preview.anchor.y;
    if (!same && o !== this.preview) { this.preview = o; if (o) sfx.hover(); this.refresh(); }
  },
  inspect(t) {
    const v = this.s.units.find((q) => q.alive && q.x === t.x && q.y === t.y);
    const box = $('#h-inspect');
    clearTimeout(this.inspT);
    if (!v) { box.classList.add('hidden'); return; }
    const st = stats(v);
    const extra = v.kind === 'hollow' ? 'Guards a shard cache. Drops 2 shards.' : `${PASSIVES[v.passive].name} - ${v.shards} shard${v.shards === 1 ? '' : 's'} - Attune ${v.attune || 0} - Ult ${Math.round(v.ult || 0)}% - ${v.kills} KO`;
    box.innerHTML = `<img src="${pieceIcon(v.piece, v.skin, v.color, 46)}" alt=""><div><b style="color:${v.kind === 'player' ? v.color : '#bbb'}">${esc(v.name)}${v.piece === 'king' ? ' - King' : v.kind === 'player' ? ' - ' + PIECES[v.piece].name : ''}</b><span>HP ${v.hp}/${st.maxHp} - ATK ${st.atk} - DEF ${st.def} - SPD ${st.spd}</span><span>${extra}</span></div>`;
    box.classList.remove('hidden'); sfx.tap();
    this.inspT = setTimeout(() => box.classList.add('hidden'), 3200);
  },
  openPromote() {
    const u = this.me; const opts = promoteOptions(u);
    if (!opts.length) { sfx.error(); return; }
    const hone = u.hone[u.piece] || 0;
    $('#promo-opts').innerHTML = opts.map((o) => {
      const piece = o.type === 'evolve' ? o.to : u.piece;
      const P = PIECES[piece], sig = ABILITIES[P.sig];
      const desc = o.type === 'evolve' ? `${P.moveDesc} Signature: ${sig.name}.` : `+15% stats. ${sig.honed && hone === 0 ? 'Signature upgrade: ' + sig.honed : 'Level ' + o.level + ' of 3.'}`;
      return `<button class="popt" data-to="${o.to}" ${u.shards < o.cost ? 'disabled' : ''}><img src="${pieceIcon(piece, u.skin, o.type === 'hone' ? '#7fe0ff' : null, 60)}" alt=""><div><b>${o.type === 'evolve' ? P.name : 'Hone ' + P.name}</b><span>${desc}</span></div><div class="cost"><span class="shard-ico"></span>${o.cost}</div></button>`;
    }).join('');
    $('#m-promote').classList.remove('hidden'); sfx.select();
  },
  showDead() {
    const u = this.me; if (!u || this.resultsShown) return;
    $('#dead-place').textContent = '#' + u.place;
    $('#dead-by').textContent = this.killedBy ? `Taken by ${this.killedBy.name}` : 'The board claimed you';
    $('#m-dead').classList.remove('hidden');
    sfx.lose();
  },
  showResults(aborted = false) {
    if (this.resultsShown) return;
    this.resultsShown = true;
    $$('#s-game .modal').forEach((m) => m.classList.add('hidden'));
    const s = this.s, u = this.me;
    if (!s || !u) { go('title'); endSession(); return; }
    const place = u.alive ? (s.over ? 1 : alivePlayers(s).length) : u.place;
    const total = s.units.filter((v) => v.kind === 'player').length;
    const win = place === 1 && s.over;
    $('#r-title').textContent = win ? 'Checkmate' : aborted ? 'Match Ended' : place <= 3 ? 'So Close' : 'Defeated';
    $('#r-place').textContent = `Placed ${place} of ${total}`;
    $('#r-stats').innerHTML = `<div><b id="rs-k">0</b><span>Eliminations</span></div><div><b id="rs-d">0</b><span>Damage</span></div><div><b>${PIECES[u.piece].name}</b><span>Final piece</span></div>`;
    setTimeout(() => { countUp($('#rs-k'), 0, u.kills, 600); countUp($('#rs-d'), 0, u.dmgDealt || 0, 900); }, 400);
    let earned = 0, xpGain = 0, levels = 0;
    const startLvl = profile.level, startXp = profile.xp;
    if (!profile.played.includes(matchKey)) {
      earned = 20 + u.kills * 15 + Math.max(0, total - place) * 8 + (win ? 60 : 0);
      xpGain = 40 + u.kills * 30 + Math.max(0, total - place) * 15 + Math.round((u.dmgDealt || 0) / 6) + (win ? 100 : 0);
      profile.marks += earned; profile.games++; profile.kills += u.kills; if (win) profile.wins++; if (this.ms.crown) profile.crowns = (profile.crowns || 0) + 1;
      profile.bestAttune = Math.max(profile.bestAttune || 0, u.attune || 0);
      const qd = applyQuests({ ...this.ms, kills: this.ms.kills, shards: u.attune || 0, dmg: u.dmgDealt || 0, place, win });
      this.questsDone = qd; earned += qd.reduce((a, q) => a + q.reward, 0);
      profile.xp += xpGain;
      while (profile.xp >= xpForLevel(profile.level)) { profile.xp -= xpForLevel(profile.level); profile.level++; levels++; profile.marks += 50; earned += 50; }
      profile.played = [...profile.played.slice(-30), matchKey]; save();
    }
    $('#r-lvl').textContent = startLvl;
    $('#r-xptext').textContent = xpGain ? `+${xpGain} XP` : '';
    const bar = $('#r-xpbar'); bar.style.transition = 'none'; bar.style.width = (startXp / xpForLevel(startLvl)) * 100 + '%';
    $('#r-levelup').classList.add('hidden');
    setTimeout(() => {
      bar.style.transition = '';
      if (levels) {
        bar.style.width = '100%';
        setTimeout(() => { bar.style.transition = 'none'; bar.style.width = '0%'; $('#r-lvl').textContent = profile.level; void bar.offsetWidth; bar.style.transition = ''; bar.style.width = (profile.xp / xpForLevel(profile.level)) * 100 + '%'; $('#r-levelup').textContent = `Level ${profile.level} - ${titleFor(profile.level)}`; $('#r-levelup').classList.remove('hidden'); sfx.levelup(); uiFlash(); haptic([30, 50, 30, 50, 90]); }, 1250);
      } else bar.style.width = (profile.xp / xpForLevel(profile.level)) * 100 + '%';
    }, 700);
    $('#r-quests').innerHTML = (this.questsDone || []).map((q, i) => `<div style="animation-delay:${1 + i * 0.15}s"><span>Quest complete: ${q.text}</span><b>+${q.reward}</b></div>`).join('');
    if (this.questsDone && this.questsDone.length) setTimeout(() => sfx.quest(), 1100);
    this.questsDone = [];
    const winner = s.units.find((v) => v.id === s.winner);
    if (winner && !win) $('#r-place').innerHTML = `Placed ${place} of ${total} <div class="r-winner"><img src="${pieceIcon(winner.piece, winner.skin, winner.color, 54)}" alt=""><div><span>WINNER</span><b style="color:${winner.color}">${esc(winner.name)}</b></div></div>`;
    $('#r-marks').innerHTML = earned ? `<i class="mark-ico"></i>+<span id="rm">0</span> Marks` : '';
    if (earned) setTimeout(() => countUp($('#rm'), 0, earned, 1000, true), 900);
    const ranked = s.units.filter((v) => v.kind === 'player').sort((a, b) => (a.alive ? 0 : a.place) - (b.alive ? 0 : b.place));
    $('#r-board').innerHTML = ranked.map((v, i) => `<li class="${v.id === u.id ? 'me' : ''}" style="--c:${v.color};animation-delay:${0.5 + i * 0.06}s"><b>${v.alive ? 1 : v.place}</b><img src="${pieceIcon(v.piece, v.skin, null, 26)}" alt=""><span>${esc(v.name)}</span><em>${v.kills} KO</em></li>`).join('');
    $('#btn-rematch').classList.toggle('hidden', session && session.mode === 'client');
    $('#m-results').classList.remove('hidden');
    music.set(0, 'menu');
    if (win) { sfx.win(); confetti(); haptic([50, 50, 50, 50, 150]); } else sfx.lose();
  },
  bindInput() {
    const c = $('#board');
    const pts = new Map(); let drag = false, start = null, pinch = null;
    c.addEventListener('pointerdown', (e) => {
      c.setPointerCapture(e.pointerId);
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.size === 1) { drag = false; start = { x: e.clientX, y: e.clientY, t: performance.now() }; }
      if (pts.size === 2) { const [a, b] = [...pts.values()]; pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) }; drag = true; }
    });
    c.addEventListener('pointermove', (e) => {
      const rect = c.getBoundingClientRect();
      if (e.pointerType === 'mouse' && !pts.size) { this.onHover(this.r.tileAtScreen(e.clientX - rect.left, e.clientY - rect.top)); return; }
      const p = pts.get(e.pointerId); if (!p) return;
      if (pts.size === 2 && pinch) {
        p.x = e.clientX; p.y = e.clientY;
        const [a, b] = [...pts.values()]; const d = Math.hypot(a.x - b.x, a.y - b.y);
        this.r.zoomBy(d / pinch.d, (a.x + b.x) / 2 - rect.left, (a.y + b.y) / 2 - rect.top); pinch.d = d; return;
      }
      const dx = e.clientX - p.x, dy = e.clientY - p.y;
      if (!drag && Math.hypot(e.clientX - start.x, e.clientY - start.y) > 9) drag = true;
      if (drag) this.r.pan(dx, dy);
      p.x = e.clientX; p.y = e.clientY;
    });
    const up = (e) => {
      const had = pts.has(e.pointerId);
      pts.delete(e.pointerId);
      if (pts.size < 2) pinch = null;
      if (had && !drag && pts.size === 0 && start && performance.now() - start.t < 600) {
        const rect = c.getBoundingClientRect();
        this.onTap(this.r.tileAtScreen(e.clientX - rect.left, e.clientY - rect.top), e.pointerType === 'mouse');
      }
    };
    c.addEventListener('pointerup', up); c.addEventListener('pointercancel', (e) => { pts.delete(e.pointerId); drag = true; });
    c.addEventListener('wheel', (e) => { e.preventDefault(); const rect = c.getBoundingClientRect(); this.r.zoomBy(e.deltaY < 0 ? 1.12 : 0.89, e.clientX - rect.left, e.clientY - rect.top); }, { passive: false });
    addEventListener('keydown', (e) => {
      if (screen !== 'game' || e.target.tagName === 'INPUT') return;
      const map = { '1': 'move', '2': 'atk', '3': 'sig', '4': 'eq', p: 'promote', e: 'end', ' ': 'end' };
      if (e.key === 'Escape') { this.preview = null; this.mode = 'move'; this.refresh(); }
      else if (map[e.key.toLowerCase()]) { e.preventDefault(); this.onAction(map[e.key.toLowerCase()]); }
    });
  },
};
let matchKey = '';
function honedTip(u, id) { const ab = ABILITIES[id]; return ab.honed && (u.hone[u.piece] || 0) > 0 ? ` <b>Honed:</b> ${ab.honed}` : ''; }

// ---------- confetti ----------
function confetti() {
  const c = $('#confetti'), x = c.getContext('2d'), d = Math.min(2, devicePixelRatio || 1);
  c.width = innerWidth * d; c.height = innerHeight * d;
  const cols = ['#ffd24d', '#fff6dc', '#7fe0ff', '#ff4d6d', '#5cff9d', '#c77dff'];
  const ps = Array.from({ length: 160 }, () => ({ x: innerWidth / 2 + (Math.random() - 0.5) * 80, y: innerHeight * 0.35, vx: (Math.random() - 0.5) * 900, vy: -300 - Math.random() * 700, r: Math.random() * 6, vr: (Math.random() - 0.5) * 14, w: 6 + Math.random() * 6, h: 3 + Math.random() * 4, c: cols[Math.floor(Math.random() * cols.length)] }));
  let last = performance.now(), t = 0;
  const loop = (now) => {
    const dt = Math.min(0.04, (now - last) / 1000); last = now; t += dt;
    x.setTransform(d, 0, 0, d, 0, 0); x.clearRect(0, 0, innerWidth, innerHeight);
    for (const p of ps) { p.vy += 900 * dt; p.vx *= 0.99; p.vy *= 0.985; p.x += p.vx * dt; p.y += p.vy * dt; p.r += p.vr * dt; x.save(); x.translate(p.x, p.y); x.rotate(p.r); x.scale(1, Math.cos(p.r * 2)); x.fillStyle = p.c; x.fillRect(-p.w / 2, -p.h / 2, p.w, p.h); x.restore(); }
    if (t < 4) requestAnimationFrame(loop); else x.clearRect(0, 0, innerWidth, innerHeight);
  };
  requestAnimationFrame(loop);
}

// ---------- settings ----------
function openSettings() {
  $('#set-music').value = settings.music; $('#set-sfx').value = settings.sfx;
  $('#set-shake').checked = settings.shake; $('#set-haptics').checked = settings.haptics;
  $('#m-settings').classList.remove('hidden');
}
$('#set-music').addEventListener('input', (e) => { settings.music = +e.target.value; saveSettings(); });
$('#set-sfx').addEventListener('input', (e) => { settings.sfx = +e.target.value; saveSettings(); });
$('#set-sfx').addEventListener('change', () => sfx.select());
$('#set-shake').addEventListener('change', (e) => { settings.shake = e.target.checked; saveSettings(); game.r.shakeOn = settings.shake; });
$('#set-haptics').addEventListener('change', (e) => { settings.haptics = e.target.checked; saveSettings(); haptic(30); });

// ---------- wiring ----------
let audioStarted = false;
function startAudio() { if (audioStarted) return; audioStarted = true; unlockAudio(); music.start(); }
addEventListener('pointerdown', startAudio, { once: false, capture: true });
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-go],[data-act]'); if (!b) return;
  startAudio();
  const act = b.dataset.act;
  if (act === 'leave-lobby') endSession();
  if (b.dataset.go) { b.classList.contains('back') ? sfx.back() : sfx.tap(); go(b.dataset.go); }
  switch (act) {
    case 'settings': openSettings(); sfx.tap(); break;
    case 'close-settings': $('#m-settings').classList.add('hidden'); sfx.tap(); break;
    case 'start-solo': matchKey = 'm' + Date.now(); sfx.select(); uiFlash(); startSolo(); break;
    case 'copy-code': copy(session && session.code, 'Code copied'); break;
    case 'copy-link': copy(session && `${location.origin}${location.pathname}?join=${session.code}`, 'Invite link copied'); break;
    case 'add-bot': hostAddBot(); break;
    case 'fill-bots': while (session && session.players && session.players.length < MAX_PLAYERS) hostAddBot(); break;
    case 'start-host': matchKey = 'm' + Date.now(); sfx.select(); uiFlash(); startHost(); break;
    case 'join': joinGame(); break;
    case 'zoom': if (game.r.cam.tz > game.r.fitZoom * 1.05) game.r.overview(); else game.r.closeup(); sfx.tap(); break;
    case 'menu': $('#m-menu').classList.remove('hidden'); sfx.tap(); break;
    case 'close-menu': $('#m-menu').classList.add('hidden'); break;
    case 'close-promote': $('#m-promote').classList.add('hidden'); break;
    case 'emotes': $('#emote-menu').classList.toggle('hidden'); sfx.tap(); break;
    case 'forfeit': $('#m-menu').classList.add('hidden'); game.showResults(!!(game.s && !game.s.over && game.me && game.me.alive)); break;
    case 'spectate': $('#m-dead').classList.add('hidden'); game.r.overview(); break;
    case 'results': game.showResults(); break;
    case 'to-title': endSession(); go('title'); break;
    case 'rematch':
      if (!session || session.mode === 'solo' || !session) { const n = session ? session.bots : 7; matchKey = 'm' + Date.now(); startSolo(n); }
      else if (session.mode === 'host') { try { session.host.stop(); } catch {} session.host = null; session.started = false; session.rematch = true; go('host'); }
      break;
  }
});
$('#host-lobby').addEventListener('click', (e) => {
  const b = e.target.closest('[data-kick]'); if (!b || !session) return;
  const pid = b.dataset.kick; const c = session.conns.get(pid);
  if (c) { c.send({ t: 'full' }); c.close(); session.conns.delete(pid); }
  session.players = session.players.filter((p) => p.pid !== pid); session.renderLobby();
});
function copy(text, msg) {
  if (!text) return;
  (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject()).then(() => toast(msg), () => toast(text));
  sfx.select();
}
$('#s-loadout').addEventListener('click', onLoadoutClick);
$('#s-armory').addEventListener('click', onArmoryClick);
$('#in-name').addEventListener('input', (e) => { profile.name = e.target.value.replace(/[<>]/g, '').slice(0, 14) || 'Player'; save(); });
$('#in-bots').addEventListener('input', (e) => { $('#bot-n').textContent = e.target.value; sfx.tick(); });
$('#in-code').addEventListener('input', (e) => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); });
$('#in-code').addEventListener('keydown', (e) => { if (e.key === 'Enter') joinGame(); });
document.addEventListener('pointerover', (e) => { if (e.pointerType === 'mouse' && e.target.closest && e.target.closest('.btn:not(:disabled), .tab, .preset, .choice')) { const el = e.target.closest('.btn, .tab, .preset, .choice'); if (el !== document.__lastHover) { document.__lastHover = el; sfx.hover(); } } });

$('#seg-diff').addEventListener('click', (e) => { const b = e.target.closest('[data-diff]'); if (!b) return; profile.botLevel = b.dataset.diff; save(); sfx.select(); renderSoloMini(); });
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
addEventListener('pagehide', () => endSession());
bgInit();
game.init();
renderProfile();
const q = new URLSearchParams(location.search);
if (q.get('join')) { go('join'); $('#in-code').value = q.get('join').toUpperCase().slice(0, 5); }
window.__cc = { game, profile, get session() { return session; }, startSolo };
