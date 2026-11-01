// Chess Complex — app shell: menus, loadout, armory, sessions, in-game HUD, progression.
import { TRAILS, PIECES, ABILITIES, PASSIVES, PRESETS, STAT_POINTS, STAT_GAIN, SKINS, DEFAULT_SKINS, MAX_PLAYERS, TURN_MS, BOARDS, DEFAULT_BOARDS, FINISHERS, DEFAULT_FINISHERS, EMOTES, xpForLevel, titleFor, PLAYER_COLORS, QUESTS, WORLD_EVENTS, DISCOVERIES, RARITY, BUNDLES, MODES, SEASON, SEASON_REWARDS, ACHIEVEMENTS, TEAM_COLORS, MUTATORS } from './data.js';
import { ensureProgress, seasonTier, seasonProgress, rewardLabel, addSeasonXp, checkAchievements, recordMatch, dailySeed, dailyScore, achievementValue, addMastery, masteryLevel } from './progression.js';
import { previewDamage, legalMoves, abilityOptions, canMove, canAct, canUse, slotAbility, stats, effSpd, promoteOptions, predictOrder, unitById, alivePlayers, STORM, createTutorial, ARENA, isVoid, isCracked, ally } from './engine.js';
import { LESSONS, Tutorial } from './tutorial.js';
import { renderCodex, diagram } from './codex.js';
import { KINDS, ensureStore, item, listKind, featured, bundleInfo, grant, equip, activeEmotes, makePreview, drawPreview } from './store.js';
import { Renderer } from './render.js';
import { pieceIcon, drawPiece } from './pieces.js';
import { FX } from './fx.js';
import { sfx, playNamed, unlockAudio, settings, saveSettings, haptic } from './audio.js';
Object.assign(settings, Object.assign({ motion: !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches), onetap: false, quality: 'auto', cb: false, bigtext: false }, settings));
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
    board: 'hall', ownedBoards: [...DEFAULT_BOARDS], finisher: 'shatter', ownedFinishers: [...DEFAULT_FINISHERS], xp: 0, level: 1, botLevel: 'normal', quests: null, bestAttune: 0, crowns: 0, tutorial: [], discovered: [],
  };
}
let profile = defaultProfile();
try { const raw = localStorage.getItem(PKEY); if (raw) { const d = defaultProfile(); profile = { ...d, ...JSON.parse(raw) }; for (const k of ['ownedBoards', 'ownedFinishers', 'owned', 'tutorial', 'discovered']) if (!Array.isArray(profile[k])) profile[k] = d[k]; } } catch {}
const own = (T, k) => typeof k === 'string' && Object.prototype.hasOwnProperty.call(T, k);
function normalizeProfile(d) {
  const def = defaultProfile();
  const p = { ...def, ...(d && typeof d === 'object' ? d : {}) };
  for (const k of ['owned', 'ownedBoards', 'ownedFinishers', 'tutorial', 'discovered', 'played']) if (!Array.isArray(p[k])) p[k] = def[k] || [];
  p.owned = p.owned.filter((k) => own(SKINS, k)); p.ownedBoards = p.ownedBoards.filter((k) => own(BOARDS, k)); p.ownedFinishers = p.ownedFinishers.filter((k) => own(FINISHERS, k));
  for (const k of DEFAULT_SKINS) if (!p.owned.includes(k)) p.owned.push(k);
  if (typeof p.marks !== 'number' || !isFinite(p.marks)) p.marks = def.marks;
  if (typeof p.name !== 'string' || !p.name) p.name = def.name;
  const b = p.build && typeof p.build === 'object' ? p.build : def.build;
  const pts = { hp: 0, atk: 0, def: 0, spd: 0 }; let left = STAT_POINTS;
  for (const k of Object.keys(pts)) { const v = Math.max(0, Math.min(left, Math.floor(+((b.pts || {})[k]) || 0))); pts[k] = v; left -= v; }
  const equips = {}; for (const pc of PIECE_ORDER) equips[pc] = PIECES[pc].equips.includes(b.equips && b.equips[pc]) ? b.equips[pc] : def.build.equips[pc];
  p.build = { preset: own(PRESETS, b.preset) ? b.preset : null, pts, passive: own(PASSIVES, b.passive) ? b.passive : def.build.passive, equips };
  if (!own(SKINS, p.skin)) p.skin = 'ivory'; if (!own(BOARDS, p.board)) p.board = 'hall'; if (!own(FINISHERS, p.finisher)) p.finisher = 'shatter';
  if (!own(MODES, p.mode)) p.mode = 'royale';
  if (typeof p.name !== 'string') p.name = def.name; p.name = p.name.replace(/[<>]/g, '').slice(0, 14) || def.name;
  if (typeof p.title !== 'string') p.title = '';
  for (const k of ['level', 'xp']) if (typeof p[k] !== 'number' || !isFinite(p[k]) || p[k] < 0) p[k] = def[k] ?? 0;
  p.level = Math.max(1, Math.floor(p.level)); p.marks = Math.max(0, Math.floor(p.marks));
  if (!['easy', 'normal', 'hard'].includes(p.botLevel)) p.botLevel = 'normal';
  if (p.quests && (!Array.isArray(p.quests.list) || p.quests.list.some((q) => !q || !QUESTS[q.id]))) p.quests = null;
  if (p.daily && (typeof p.daily !== 'object' || !Array.isArray(p.daily.days))) p.daily = null;
  ensureProgress(p); ensureStore(p);
  if (!own(TRAILS, p.trail)) p.trail = 'none';
  return p;
}
profile = normalizeProfile(profile);
const save = () => { try { localStorage.setItem(PKEY, JSON.stringify(profile)); } catch {} };
const CB_COLORS = ['#E69F00', '#56B4E9', '#009E73', '#F0E442', '#0072B2', '#D55E00', '#CC79A7', '#FFFFFF'];
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
    const val = { revive: ms.revives || 0, waves: ms.cleared || 0, win: ms.win ? 1 : 0, kills: ms.kills, rook: ms.rook ? 1 : 0, queen: ms.queen ? 1 : 0, crown: ms.crown ? 1 : 0, shards: ms.shards, top3: ms.place <= 3 ? 1 : 0, damage: ms.dmg, ults: ms.ults, hollows: ms.hollows, attune: Math.floor(ms.shards / 5) }[q.id] || 0;
    q.prog = Q.best ? Math.max(q.prog, val) : q.prog + val;
    if (q.prog >= Q.goal) { q.prog = Q.goal; q.done = true; profile.marks += Q.reward; done.push(Q); }
  }
  save();
  return done;
}
function renderQuests() {
  const list = dailyQuests();
  profile.quests.seen = profile.quests.date; save();
  renderProfile();
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
  $('#q-badge').textContent = profile.quests && profile.quests.seen === profile.quests.date ? '' : dailyQuests().filter((q) => !q.done).length || '';
  $('#t-badge').textContent = profile.tutorial.length ? '' : 'NEW';
  $('#s-badge').textContent = profile.storeSeen === today() ? '' : '!';
  $('#p-badge').textContent = seasonTier(profile) > (profile.season.seen || 0) ? '!' : '';
  ['#marks-play', '#marks-path'].forEach((k) => { const el = $(k); if (el) el.textContent = profile.marks; });
  let np = $('#new-player');
  if (!profile.tutorial.length && !profile.games) { if (!np) { np = document.createElement('div'); np.id = 'new-player'; np.className = 'new-player'; np.dataset.go = 'tutorial'; np.textContent = 'New here? Learn the ropes'; $('.logo-line').after(np); } }
  else if (np) np.remove();
  $('#t-lvl').textContent = profile.level; $('#t-title').textContent = profile.title || titleFor(profile.level);
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
  const loop = (now) => { requestAnimationFrame(loop); try { loopBody(now); } catch (err) { console.error(err); } };
  const loopBody = (now) => {
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    bg.acc = (bg.acc || 0) + dt;
    const modalUp = !!document.querySelector('.modal.global:not(.hidden)');
    if (bg.on && !modalUp && bg.acc >= 1 / 30) {
      const dt2 = bg.acc; bg.acc = 0;
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
        p.y -= p.v * dt2; p.ph += dt2;
        if (p.y < -0.2) Object.assign(p, spawn());
        x.setTransform(bg.d, 0, 0, bg.d, 0, 0);
        x.globalAlpha = p.a;
        x.translate(p.x * innerWidth + Math.sin(p.ph * 0.5) * 12 - mx * 40 * p.depth, p.y * innerHeight - my * 30 * p.depth);
        x.rotate(p.r + Math.sin(p.ph * 0.3) * 0.08); x.scale(p.s, p.s);
        drawPiece(x, p.piece, p.skin, { t: now / 1000 });
        x.globalAlpha = 1;
      }
      // hero showcase: your equipped set on a pedestal below the menu
      if (typeof screen !== 'undefined' && screen === 'title') {
        const mb = (bg.menuEl ||= document.querySelector('.menu')).getBoundingClientRect().bottom;
        const room = innerHeight - mb - 24;
        if (room > 90) {
          const sz = Math.min(room * 0.8, 180), cx0 = innerWidth / 2, by = innerHeight - Math.max(16, (room - sz) / 2);
          const T = now / 1000;
          x.setTransform(bg.d, 0, 0, bg.d, 0, 0);
          const g2 = x.createRadialGradient(cx0, by, 4, cx0, by, sz * 0.9); g2.addColorStop(0, 'rgba(255,215,120,0.32)'); g2.addColorStop(1, 'rgba(255,215,120,0)');
          x.fillStyle = g2; x.fillRect(cx0 - sz, by - sz * 1.2, sz * 2, sz * 1.5);
          x.strokeStyle = 'rgba(255,215,120,0.55)'; x.lineWidth = 1.5; x.beginPath(); x.ellipse(cx0, by, sz * 0.42, sz * 0.1, 0, 0, Math.PI * 2); x.stroke();
          x.strokeStyle = 'rgba(255,215,120,0.25)'; x.beginPath(); x.ellipse(cx0, by, sz * 0.42 + (T * 20) % 30, sz * 0.1 + ((T * 20) % 30) * 0.24, 0, 0, Math.PI * 2); x.stroke();
          x.translate(cx0, by - 4 + Math.sin(T * 1.6) * 3); x.scale(sz * 0.78, sz * 0.78);
          drawPiece(x, 'king', profile.skin, { t: T });
          const tr = TRAILS[profile.trail];
          if (tr && tr.colors.length && Math.random() < 0.5) (bg.hp ||= []).push({ x: cx0 + (Math.random() - 0.5) * sz * 0.5, y: by - Math.random() * sz * 0.8, vy: -20 - Math.random() * 20, life: 1, c: tr.colors[(Math.random() * tr.colors.length) | 0] });
          x.setTransform(bg.d, 0, 0, bg.d, 0, 0);
          bg.hp = (bg.hp || []).filter((q) => (q.life -= dt2) > 0);
          for (const q of bg.hp) { q.y += q.vy * dt2; x.globalAlpha = q.life; x.fillStyle = q.c; x.beginPath(); x.arc(q.x, q.y, 2.2, 0, Math.PI * 2); x.fill(); }
          x.globalAlpha = 1;
        }
      }
    }

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
  if (name === 'play') renderPlay();
  if (name === 'path') renderPath();
  if (name === 'trophies') renderTrophies();
  if (name === 'host') startHostLobby();
  if (name === 'title') { const a = checkAchievements(profile); if (a.length) { save(); setTimeout(() => toast(`Trophy unlocked: ${a[0].name}`), 400); } }
  if (name === 'title') renderProfile();
  if (name === 'quests') renderQuests();
  if (name === 'tutorial') renderLessons();
  if (name === 'codex') renderCodexTab();
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
      <div class="choice-list">${p.equips.map((e) => `<button class="choice with-dia ${profile.build.equips[pc] === e ? 'on' : ''}" data-equip="${pc}:${e}"><i class="dot"></i><img class="dia" src="${diagram(pc, e, 64, profile.skin)}" alt=""><div><b>${ABILITIES[e].name}</b><span>${ABILITIES[e].desc} Cooldown ${ABILITIES[e].cd}.</span></div></button>`).join('')}</div>
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

// ---------- store ----------
let armoryTab = 'featured';
const armoryPreviews = { list: [], active: false };
const TAB_KIND = { pieces: 'skin', boards: 'board', finishers: 'finisher', trails: 'trail', emotes: 'emote' };
function priceTag(n) { return `<i class="mark-ico"></i>${n}`; }
function storeCard(it, opts = {}) {
  const col = RARITY[it.rarity].color;
  const price = opts.final ?? it.price;
  const btn = it.equipped && KINDS[it.kind].equip ? `<button class="btn small" disabled>Equipped</button>`
    : it.owned ? (KINDS[it.kind].equip ? `<button class="btn small" data-equip="${it.kind}:${it.id}">Equip</button>` : `<button class="btn small" disabled>Owned</button>`)
    : it.season ? `<button class="btn small" disabled>Crown Path reward</button>`
    : `<button class="btn small gold" data-buy="${it.kind}:${it.id}" data-price="${price}">${opts.off ? `<s>${it.price}</s> ` : ''}${priceTag(price)}</button>`;
  const visual = it.kind === 'skin' && !opts.canvas ? `<div class="row"><img src="${pieceIcon('knight', it.id, null, 48)}" alt=""><img class="mid" src="${pieceIcon('queen', it.id, null, 72)}" alt=""><img src="${pieceIcon('rook', it.id, null, 48)}" alt=""></div>` : `<canvas class="preview" data-kind="${it.kind}" data-id="${it.id}"></canvas>`;
  return `<div class="skin r-${it.rarity} ${opts.hero ? 'hero' : ''} ${it.equipped && KINDS[it.kind].equip ? 'equipped' : ''} ${it.owned ? '' : 'locked'}" data-card="${it.kind}:${it.id}" style="--rc:${col}">
    ${opts.deal ? '<div class="deal">DEAL OF THE DAY -30%</div>' : ''}<div class="glow" style="background:${col}"></div>
    ${visual}<div class="rar">${RARITY[it.rarity].name} ${KINDS[it.kind].label}</div><h4>${it.name}</h4>${opts.off && !it.owned ? `<div class="save">You save ${it.price - price}</div>` : ''}${(it.id === 'none' || it.id === 'basic') ? '<div class="desc">Default</div>' : ''}${it.kind === 'finisher' ? `<div class="desc">${FINISHERS[it.id].desc}</div>` : ''}${btn}</div>`;
}
function renderArmory() {
  renderProfile();
  $$('#armory-tabs .tab').forEach((t) => { t.classList.toggle('on', t.dataset.tab === armoryTab); const k = TAB_KIND[t.dataset.tab]; if (k) { const all = listKind(profile, k); t.innerHTML = `${t.dataset.label || (t.dataset.label = t.textContent)}<em>${all.filter((i) => i.owned).length}/${all.length}</em>`; } });
  armoryPreviews.list = [];
  const el = $('#skins'); const hint = $('#armory-hint');
  if (armoryTab === 'featured') {
    const now = new Date(), mid = new Date(now); mid.setHours(24, 0, 0, 0);
    const hrs = Math.floor((mid - now) / 3600000), mins = Math.floor(((mid - now) % 3600000) / 60000);
    hint.innerHTML = `New offers in ${hrs}h ${mins}m`;
    const feat = featured(profile, today());
    if (profile.storeSeen !== today()) { profile.storeSeen = today(); save(); }
    el.innerHTML = feat.map((it) => storeCard(it, { canvas: true, off: it.off, final: it.final, deal: it.deal, hero: it.deal })).join('')
      + `<div class="supporter"><div class="sup-h"><b>Founder's Pack</b><span>Support the game</span></div><p>An exclusive Founder piece set, 2,000 Marks and a Founder title. Coming with the app store release.</p><button class="btn small" disabled>Coming soon</button></div>`;
  } else if (armoryTab === 'bundles') {
    hint.textContent = 'Bundles only charge for the items you do not own yet.';
    el.innerHTML = Object.keys(BUNDLES).map((k) => {
      const b = bundleInfo(profile, k);
      return `<div class="bundle ${b.owned ? 'owned' : ''}"><div class="b-h"><b>${b.name}</b>${b.owned ? '' : `<span class="off">-${Math.round(b.off * 100)}%</span>`}</div>
        <div class="b-items">${b.items.map((i) => `<div class="b-it ${i.owned ? 'have' : ''}" style="--rc:${RARITY[i.rarity].color}"><canvas class="preview" data-kind="${i.kind}" data-id="${i.id}"></canvas><span>${i.name}</span></div>`).join('')}</div>
        ${b.owned ? '<button class="btn small" disabled>Owned</button>' : `<button class="btn small gold" data-bundle="${k}" data-price="${b.price}"><s>${b.full}</s> ${priceTag(b.price)}</button>`}</div>`;
    }).join('');
  } else {
    const kind = TAB_KIND[armoryTab];
    hint.textContent = { skin: 'Piece sets change how your pieces look to everyone.', board: 'Boards change the arena you see.', finisher: 'Finishers play when you eliminate someone. Everyone sees them.', trail: 'Trails follow your piece whenever it moves.', emote: 'Emote packs add phrases to your emote menu.' }[kind];
    el.innerHTML = listKind(profile, kind).filter((i) => !(kind === 'trail' && i.id === 'none' && false)).map((i) => storeCard(i)).join('');
  }
  $$('#skins canvas.preview').forEach((cv) => armoryPreviews.list.push(makePreview(cv, cv.dataset.kind, cv.dataset.id, { skin: profile.skin })));
}
function reveal(kind, id) {
  const it = item(profile, kind, id);
  $('#rv-rar').textContent = `${RARITY[it.rarity].name} ${KINDS[kind].label}`; $('#rv-rar').style.color = RARITY[it.rarity].color;
  $('#rv-name').textContent = it.name;
  $('#rv-equip').dataset.equip = KINDS[kind].equip ? `${kind}:${id}` : '';
  $('#rv-equip').textContent = KINDS[kind].equip ? 'Equip now' : 'Awesome';
  $('#m-reveal [data-act=close-reveal]').textContent = armoryPreviews.queue && armoryPreviews.queue.length ? `Next (${armoryPreviews.queue.length} more)` : 'Later';
  const m = $('#m-reveal'); m.style.setProperty('--rc', RARITY[it.rarity].color); m.classList.remove('hidden');
  armoryPreviews.reveal = makePreview($('#rv-canvas'), kind, id, { skin: profile.skin, big: true, rays: true });
  sfx.buy(); if (it.rarity === 'legendary' || it.rarity === 'epic') setTimeout(() => sfx.levelup(), 250); uiFlash(); haptic([20, 30, 40, 30, 60]);
}
function onArmoryClick(e) {
  const tab = e.target.closest('.tab'); if (tab) { armoryTab = tab.dataset.tab; sfx.tap(); renderArmory(); $('#s-armory .scroll').scrollTop = 0; return; }
  const b = e.target.closest('button'); if (!b) return;
  const confirmStep = (price) => {
    if (profile.marks < price) { sfx.error(); toast(`You need ${price - profile.marks} more Marks`); return false; }
    if (!b.classList.contains('confirm-buy')) { $$('.confirm-buy').forEach((x) => { x.classList.remove('confirm-buy'); x.innerHTML = x.dataset.lbl; }); b.dataset.lbl = b.innerHTML; b.innerHTML = `Confirm: ${profile.marks - price} left`; b.classList.add('confirm-buy'); sfx.select(); return false; }
    return true;
  };
  if (b.dataset.buy) {
    const [kind, id] = b.dataset.buy.split(':'); const price = +b.dataset.price;
    if (!confirmStep(price)) return;
    profile.marks -= price; grant(profile, kind, id); save(); renderArmory(); reveal(kind, id);
  } else if (b.dataset.bundle) {
    const info = bundleInfo(profile, b.dataset.bundle); const price = info.price;
    if (!confirmStep(price)) return;
    profile.marks -= price; for (const i of info.missing) grant(profile, i.kind, i.id); save(); renderArmory();
    const best = info.missing.slice().sort((a, b2) => ['common', 'rare', 'epic', 'legendary'].indexOf(b2.rarity) - ['common', 'rare', 'epic', 'legendary'].indexOf(a.rarity))[0];
    const q = info.missing.slice().sort((a, b2) => ['common', 'rare', 'epic', 'legendary'].indexOf(b2.rarity) - ['common', 'rare', 'epic', 'legendary'].indexOf(a.rarity));
    armoryPreviews.queue = q.slice(1).map((i) => [i.kind, i.id]);
    if (best) reveal(best.kind, best.id); toast(`${info.name} unlocked`);
  } else if (b.dataset.equip) {
    const [kind, id] = b.dataset.equip.split(':'); equip(profile, kind, id); save(); sfx.select(); renderArmory();
  }
}
function renderPlay() {
  const ICON = { royale: ['king', 'gilded'], blitz: ['knight', 'ember'], duel: ['rook', 'glacier'], squads: ['bishop', 'jade'], siege: ['rook', 'obsidian'], daily: ['queen', 'celestial'] };
  const dailyDone = profile.daily.date === today();
  $('#modes').innerHTML = Object.entries(MODES).map(([k, m]) => `<button class="mode ${profile.mode === k ? 'on' : ''}" data-mode="${k}"><img class="mi" src="${pieceIcon(ICON[k][0], ICON[k][1], null, 74)}" alt=""><b>${m.name}</b><p>${m.desc}</p>${k === 'daily' && !dailyDone ? '<span class="chip">NEW</span>' : k === 'squads' || k === 'siege' ? '<span class="chip">5.0</span>' : ''}</button>`).join('');
  const M = profile.mode;
  const rb = $('#in-bots'), lb = $('#opt-bots .lbl');
  const cfg = M === 'siege' ? { min: 0, max: 3, step: 1, def: 3, label: 'Bot Allies' } : M === 'squads' ? { min: 3, max: 7, step: 2, def: 7, label: 'Bots (you get a bot teammate)' } : { min: 1, max: 7, step: 1, def: 7, label: 'Opponents' };
  if (rb.dataset.mode !== M) { rb.min = cfg.min; rb.max = cfg.max; rb.step = cfg.step; rb.value = cfg.def; rb.dataset.mode = M; }
  lb.firstChild.textContent = cfg.label + ' '; $('#bot-n').textContent = rb.value;
  $('#opt-bots').classList.toggle('hidden', M === 'duel' || M === 'daily');
  $('#opt-diff').classList.toggle('hidden', M === 'daily');
  $('#opt-daily').classList.toggle('hidden', M !== 'daily');
  $('#btn-host').classList.toggle('hidden', M === 'daily');
  $('#btn-solo').textContent = M === 'daily' ? 'Start Challenge' : M === 'duel' ? 'Duel a Bot' : 'Play vs Bots';
  if (M === 'daily') {
    const L = dailyLoadout();
    $('#opt-daily').innerHTML = `<b>Today's loadout: ${PRESETS[L.preset].name} - ${PASSIVES[L.passive].name}</b><p>Everyone plays the same map, the same build, against 7 Hard bots. Score = placement + eliminations + damage.</p><div class="best"><div><b>${profile.daily.date === today() ? profile.daily.best : 0}</b><span>Today's best</span></div><div><b>${profile.daily.days.length}</b><span>Days played</span></div></div>`;
  }
  renderSoloMini();
}
function dailyLoadout() {
  const seed = dailySeed(today()); const keys = Object.keys(PRESETS); const preset = keys[seed % keys.length];
  const equips = {}; PIECE_ORDER.forEach((pc, i) => { equips[pc] = PIECES[pc].equips[(seed >>> (i * 2)) % 3]; });
  return { preset, pts: { ...PRESETS[preset].pts }, passive: PRESETS[preset].passive, equips, seed };
}
function renderSoloMini() {
  const b = profile.build;
  $$('#seg-diff button').forEach((x) => x.classList.toggle('on', x.dataset.diff === profile.botLevel));
  $('#solo-loadout').innerHTML = `<img src="${pieceIcon('pawn', profile.skin, '#d6b05c', 64)}" alt=""><div class="lm-t"><b>${esc(profile.name)}</b><span>${b.preset ? PRESETS[b.preset].name : 'Custom'} build - ${PASSIVES[b.passive].name} - ${SKINS[profile.skin].name} - ${FINISHERS[profile.finisher].name}</span></div>`;
}

// ---------- crown path ----------
function rewardThumb(r) {
  if (r.skin) return `<img src="${pieceIcon('queen', r.skin, null, 52)}" alt="">`;
  if (r.board) return `<span style="width:100%;height:100%;background:linear-gradient(135deg, ${BOARDS[r.board].light} 50%, ${BOARDS[r.board].dark} 50%)"></span>`;
  if (r.finisher) return `<img src="${pieceIcon('king', 'gilded', '#ffd24d', 52)}" alt="">`;
  if (r.title) return `<span class="ttl">T</span>`;
  return `<i class="mark-ico"></i>`;
}
function renderPath() {
  renderProfile();
  const tier = seasonTier(profile);
  $('#season-name').textContent = SEASON.name;
  $('#season-tier').textContent = tier;
  $('#season-tier-label').textContent = tier >= SEASON.tiers ? 'Path complete' : `Tier ${tier} - next: Tier ${tier + 1}`;
  $('#season-bar').style.width = (tier >= SEASON.tiers ? 100 : seasonProgress(profile) * 100) + '%';
  $('#season-xp').textContent = tier >= SEASON.tiers ? 'Every reward claimed' : `${profile.season.xp % SEASON.tierXp} / ${SEASON.tierXp} XP`;
  $('#season-track').innerHTML = Array.from({ length: SEASON.tiers }, (_, i) => {
    const t = i + 1, r = SEASON_REWARDS[t], L = rewardLabel(r), big = !!(r.skin || r.board || r.finisher);
    return `<div class="tier ${t <= tier ? 'got' : 'locked'} ${big ? 'big' : ''} ${t === tier + 1 ? 'next' : ''}" ${t === tier + 1 ? 'id="tier-next"' : ''}><div class="tn">${t}</div><div class="rw">${rewardThumb(r)}</div><div><b>${L.name}</b><span>${L.kind}${big ? ' - Season exclusive' : ''}</span></div></div>`;
  }).join('');
  profile.season.seen = tier; save(); renderProfile();
  setTimeout(() => { const n = $('#tier-next'); if (n) n.scrollIntoView({ block: 'center', behavior: 'smooth' }); }, 300);
}
function renderTrophies() {
  checkAchievements(profile); save();
  const ids = Object.keys(ACHIEVEMENTS);
  $('#ach-count').textContent = `${profile.achievements.length}/${ids.length}`;
  $('#ach-list').innerHTML = ids.map((id) => { const a = ACHIEVEMENTS[id], done = profile.achievements.includes(id), v = Math.min(a.goal, achievementValue(profile, a)); return `<div class="ach ${done ? 'done' : ''}"><div class="ai"><svg><use href="#i-trophy"/></svg></div><div><b>${a.name}</b><p>${a.desc}</p>${done ? '' : `<div class="qbar"><i style="width:${(v / a.goal) * 100}%"></i></div>`}</div><div class="rw"><i class="mark-ico"></i>${a.reward}</div></div>`; }).join('');
  $('#title-count').textContent = `${profile.titles.length} unlocked`;
  $('#title-list').innerHTML = [`<button class="${!profile.title ? 'on' : ''}" data-title="">None</button>`, ...profile.titles.map((t) => `<button class="${profile.title === t ? 'on' : ''}" data-title="${esc(t)}">${esc(t)}</button>`)].join('') + (profile.titles.length ? '' : '<p class="hint" style="margin:6px 0 0">Earn titles from trophies and the Crown Path.</p>');
  $('#mastery-list').innerHTML = [...PIECE_ORDER, 'king'].map((pc) => { const m = masteryLevel(profile.mastery[pc] || 0); const pct = m.need ? Math.round(m.into / m.need * 100) : 100; return `<div class="ms-row ${m.lv >= 10 ? 'max' : ''}"><img src="${pieceIcon(pc, profile.skin, null, 34)}" alt=""><div><b>${PIECES[pc].name}</b><span>Level ${m.lv}${m.lv >= 10 ? ' - Master' : ` - ${m.into}/${m.need}`}</span><div class="xpbar"><i style="width:${pct}%"></i></div></div></div>`; }).join('');
  const st = profile.stats;
  $('#career2').innerHTML = `<div><b>${st.games}</b><span>Games</span></div><div><b>${st.wins}</b><span>Wins</span></div><div><b>${st.kills}</b><span>KOs</span></div><div><b>${st.bestStreak}</b><span>Best streak</span></div>`;
}

// ---------- tutorial ----------
let tutorial = null;
function renderLessons() {
  $('#mentor-img').src = pieceIcon('king', 'gilded', '#d6b05c', 64);
  const done = profile.tutorial;
  const nextIdx = LESSONS.findIndex((l) => !done.includes(l.id));
  $('#lesson-list').innerHTML = LESSONS.map((l, i) => `<button class="lesson ${done.includes(l.id) ? 'done' : ''} ${i === nextIdx ? 'next' : ''}" data-lesson="${l.id}" style="animation-delay:${i * 0.05}s"><div class="num"><span>${i + 1}</span></div><div><b>${l.name}</b><p>${l.blurb}</p></div><span class="st">${done.includes(l.id) ? 'Done' : i === nextIdx ? 'Start' : 'Play'}</span></button>`).join('')
    + `<button class="lesson grad ${done.includes('graduation') ? 'done' : ''} ${nextIdx === -1 && !done.includes('graduation') ? 'next' : ''}" data-lesson="graduation"><div class="num"><span>G</span></div><div><b>Graduation</b><p>A real match against 2 easy bots. 100 Marks for finishing.</p></div><span class="st">${done.includes('graduation') ? 'Done' : 'Play'}</span></button>`;
}
const coachUI = {
  coach(text, obj, next) {
    const el = $('#coach'); el.classList.remove('hidden');
    $('#coach-img').src = pieceIcon('king', 'gilded', null, 44);
    const p = $('#coach-text'); clearInterval(coachUI.tw); p.textContent = ''; let i = 0;
    coachUI.full = text;
    coachUI.tw = setInterval(() => { i += 2; p.textContent = text.slice(0, i); if (i % 6 === 0) sfx.tick(); if (i >= text.length) clearInterval(coachUI.tw); }, 16);
    const o = $('#coach-obj'); o.classList.toggle('hidden', !obj); o.classList.remove('ok'); o.querySelector('span').textContent = obj || '';
    $('#coach-next').classList.toggle('hidden', !next);
    el.style.animation = 'none'; void el.offsetWidth; el.style.animation = '';
    setTimeout(() => game.fitPad(), 30);
  },
  glow(sel) { $$('.tut-glow').forEach((e) => e.classList.remove('tut-glow')); if (sel) $$(sel).forEach((e) => e.classList.add('tut-glow')); },
  marks(m) { game.r.marks = m || []; },
  objDone() { $('#coach-obj').classList.add('ok'); sfx.quest(); haptic(30); },
  complete(lesson) {
    $('#coach').classList.add('hidden');
    let reward = 0;
    if (!profile.tutorial.includes(lesson.id)) { profile.tutorial.push(lesson.id); profile.marks += 50; reward = 50; save(); }
    $('#lesson-name').textContent = lesson.name;
    $('#lesson-reward').innerHTML = reward ? `<i class="mark-ico"></i>+${reward} Marks` : '';
    const idx = LESSONS.indexOf(lesson);
    $('#btn-next-lesson').textContent = idx < LESSONS.length - 1 ? 'Next Lesson' : 'Graduation Match';
    $('#btn-next-lesson').dataset.next = idx < LESSONS.length - 1 ? LESSONS[idx + 1].id : 'graduation';
    $('#m-lesson').classList.remove('hidden');
    sfx.levelup(); uiFlash(); confetti();
  },
};
function startLesson(id) {
  endSession();
  coachUI.glow(null);
  $('#m-lesson').classList.add('hidden');
  if (id === 'graduation') {
    const keep = profile.botLevel; profile.botLevel = 'easy';
    matchKey = 'm' + Date.now(); startSolo(2, 'royale'); profile.botLevel = keep; session.graduation = true;
    return;
  }
  const lesson = LESSONS.find((l) => l.id === id);
  const sess = { mode: 'tutorial', myPid: 'me', lesson: id };
  session = sess;
  const state = createTutorial(me());
  sess.host = new GameHost([], (m) => { game.onMsg(m); if (tutorial && session === sess) tutorial.onState(m.ev); }, { state, noTimer: true });
  sess.send = (a) => sess.host.act('me', a);
  sess.emote = (k) => hostEmote(sess, 'me', k);
  game.enter();
  $('#s-game').classList.add('tut');
  game.r.setBounds(ARENA);
  tutorial = new Tutorial(lesson, sess.host, coachUI);
  sess.host.start();
  setTimeout(() => { if (session === sess) tutorial.begin(); }, 1300);
}
let codexTab = 'pieces';
function renderCodexTab() {
  $$('#codex-tabs .tab').forEach((t) => t.classList.toggle('on', t.dataset.ctab === codexTab));
  renderCodex(codexTab, $('#codex-body'), profile);
  $('#codex-body').scrollTop = 0;
}

// ---------- discoveries ----------
function discover(id) {
  if (!session || session.mode === 'tutorial' || profile.discovered.includes(id)) return;
  profile.discovered.push(id); profile.marks += 60; save();
  const d = DISCOVERIES[id], el = $('#discovery');
  el.innerHTML = `<small>Combo Discovered</small><b>${d.name}</b><span>${d.desc}</span><em>+60 Marks</em>`;
  el.classList.remove('show'); void el.offsetWidth; el.classList.add('show');
  sfx.levelup(); haptic([30, 40, 30, 40, 80]);
}

// ---------- bots ----------
function botPlayer(i, used) {
  const names = BOT_NAMES.filter((n) => !used.includes(n));
  const name = names[Math.floor(Math.random() * names.length)] || 'Bot' + i;
  const keys = Object.keys(PRESETS), p = PRESETS[keys[Math.floor(Math.random() * keys.length)]];
  const equips = {}; for (const pc of PIECE_ORDER) { const list = PIECES[pc].equips; equips[pc] = list[Math.floor(Math.random() * list.length)]; }
  const pks = Object.keys(PASSIVES), passive = Math.random() < 0.3 ? pks[Math.floor(Math.random() * pks.length)] : p.passive;
  const skins = Object.keys(SKINS).filter((k) => k !== profile.skin && SKINS[k].price != null), fins = Object.keys(FINISHERS).filter((k) => FINISHERS[k].price != null);
  const trails = Object.keys(TRAILS);
  return { trail: trails[Math.floor(Math.random() * trails.length)], pid: 'bot' + i + Math.random().toString(36).slice(2, 6), name, isBot: true, botLevel: profile.botLevel || 'normal', skin: skins[Math.floor(Math.random() * skins.length)], finisher: fins[Math.floor(Math.random() * fins.length)], build: { pts: { ...p.pts }, passive, equips } };
}
const me = () => ({ pid: 'me', name: profile.name || 'Player', title: profile.title, skin: profile.skin, finisher: profile.finisher, trail: profile.trail, build: { pts: { ...profile.build.pts }, passive: profile.build.passive, equips: { ...profile.build.equips } } });

// ---------- sessions ----------
let session = null;
function endSession() {
  if (tutorial) tutorial.dead = true;
  tutorial = null; $('#coach').classList.add('hidden'); coachUI && coachUI.glow && coachUI.glow(null);
  if (!session) return;
  try { session.host && session.host.stop(); } catch {}
  try { session.server && session.server.close(); } catch {}
  try { session.client && session.client.close(); } catch {}
  session = null;
}
// Hidden traps stay hidden: each friend only receives traps owned by their own side.
function hostEmit(sess, m) {
  const hasTraps = m.t === 'state' && m.state && m.state.items.some((i) => i.k === 'trap');
  for (const c of sess.conns ? sess.conns.values() : []) {
    if (!hasTraps) { c.send(m); continue; }
    const u = m.state.units.find((v) => v.pid === c.pid);
    const items = m.state.items.filter((i) => i.k !== 'trap' || (u && (i.owner === u.id || (u.team != null && i.team === u.team))));
    const ev = (m.ev || []).filter((e) => e.e !== 'trapSet' || (u && (e.id === u.id || (u.team != null && (m.state.units.find((v) => v.id === e.id) || {}).team === u.team))));
    c.send({ ...m, state: { ...m.state, items }, ev });
  }
  game.onMsg(m);
}
function hostEmote(sess, pid, k) {
  if (!own(EMOTES, k) || !sess.host) return;
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
    if (k && k.bot && Math.random() < 0.45) setTimeout(() => session === sess && hostEmote(sess, k.pid, ['check', 'gg', 'come', 'nice'][Math.floor(Math.random() * 4)]), 900);
  }
}

function startSolo(bots = null, modeArg = null) {
  endSession();
  const mode = modeArg || profile.mode || 'royale';
  let n = bots ?? +$('#in-bots').value;
  if (mode === 'duel') n = 1;
  if (mode === 'daily') n = 7;
  if (mode === 'squads') { n = Math.max(3, Math.min(7, n)); if (n % 2 === 0) n++; }
  if (mode === 'siege') n = Math.max(0, Math.min(3, n));
  const players = [me()];
  let seed;
  const keepLvl = profile.botLevel;
  if (mode === 'daily') { const L = dailyLoadout(); players[0].build = { pts: L.pts, passive: L.passive, equips: L.equips }; seed = L.seed; profile.botLevel = 'hard'; }
  if (mode === 'daily') { const rr = Math.random; let st = seed >>> 0; Math.random = () => { st = (Math.imul(st, 1664525) + 1013904223) >>> 0; return st / 4294967296; }; try { for (let i = 0; i < n; i++) players.push(botPlayer(i, players.map((p) => p.name))); } finally { Math.random = rr; } }
  else for (let i = 0; i < n; i++) players.push(botPlayer(i, players.map((p) => p.name)));
  profile.botLevel = keepLvl;
  const sess = { mode: 'solo', myPid: 'me', bots: n, gameMode: mode, hard: mode === 'daily' || profile.botLevel === 'hard' };
  session = sess;
  sess.host = new GameHost(players, (m) => { game.onMsg(m); botChatter(sess, m); }, { mode, seed, noTimer: mode !== 'blitz' });
  sess.send = (a) => sess.host.act('me', a);
  sess.emote = (k) => hostEmote(sess, 'me', k);
  game.enter();
  sess.host.start();
}

function lobbyHTML(players, host, gm = 'royale') {
  const T = (MODES[gm] || {}).teams;
  return players.map((p, i) => `<li style="--c:${T ? TEAM_COLORS[Math.floor(i / T) % 4] : (settings.cb ? CB_COLORS : PLAYER_COLORS)[i]}">${T ? `<span class="team-tag">Team ${Math.floor(i / T) + 1}</span>` : gm === 'siege' ? '<span class="team-tag">Ally</span>' : ''}<img src="${pieceIcon('pawn', p.skin, null, 34)}" alt=""><b>${esc(p.name)}${p.title ? `<span class="ttl">${esc(p.title)}</span>` : ''}</b><em>${p.pid === 'me' ? 'Host' : p.isBot ? 'Bot' : 'Player'}</em>${host && p.pid !== 'me' ? `<button data-kick="${p.pid}">Remove</button>` : ''}</li>`).join('');
}
function startHostLobby() {
  if (session && session.mode === 'host' && session.rematch) { session.rematch = false; session.players = session.players.filter((p) => p.isBot || p.pid === 'me' || session.conns.has(p.pid)); session.renderLobby(); return; }
  endSession();
  if (!window.Peer && !location.search.includes('net=local')) { $('#host-status').textContent = 'Online play could not load. Check your connection and reload.'; $('#host-status').classList.add('err'); return; }
  const code = makeCode();
  const gm = profile.mode === 'daily' ? 'royale' : profile.mode;
  session = { mode: 'host', myPid: 'me', code, players: [me()], conns: new Map(), started: false, gameMode: gm, maxP: MODES[gm].players[1] };
  $('#host-code').textContent = code;
  $('#host-status').textContent = 'Opening room...'; $('#host-status').classList.remove('err');
  const sess = session;
  const renderLobby = () => {
    $('#host-lobby').innerHTML = lobbyHTML(sess.players, true, sess.gameMode);
    $('#lobby-count').textContent = `${MODES[sess.gameMode].short} - ${sess.players.length}/${sess.maxP}`;
    $('#btn-start-host').disabled = sess.players.length < Math.max(2, MODES[sess.gameMode].players[0]);
    const pub = sess.players.map(({ pid, name, skin, isBot, title }) => ({ pid, name, skin, isBot, title }));
    for (const c of sess.conns.values()) c.send({ t: 'lobby', players: pub, code, mode: sess.gameMode });
  };
  sess.renderLobby = renderLobby;
  sess.emote = (k) => hostEmote(sess, 'me', k);
  sess.server = openServer(code, {
    onReady: () => { if (session !== sess) return; $('#host-status').textContent = 'Room open. Share the code with friends.'; sfx.select(); },
    onError: (t) => {
      if (session !== sess) return;
      if (t === 'unavailable-id') { try { sess.server.close(); } catch {} session = null; startHostLobby(); return; }
      if (['network', 'server-error', 'socket-error', 'socket-closed'].includes(t)) { $('#host-status').textContent = 'Lost connection to the matchmaking server. Go back and try again.'; $('#host-status').classList.add('err'); }
    },
    onConn: (conn) => {
      conn.onData((m) => {
        if (!m || typeof m !== 'object') return;
        if (m.t === 'join') {
          if (conn.pid) return;
          const tok = typeof m.token === 'string' ? m.token.slice(0, 40) : '';
          const back = tok && Object.entries(sess.tokens || {}).find(([pid, t]) => t === tok && !sess.conns.has(pid) && sess.players.some((p) => p.pid === pid));
          if (back) {
            const pid = back[0]; conn.pid = pid; sess.conns.set(pid, conn);
            conn.send({ t: 'welcome', pid });
            if (sess.started && sess.host) { const u = sess.host.s.units.find((v) => v.pid === pid); if (u) u.bot = false; conn.send({ t: 'start', pid }); sess.host.publish([]); sess.host.schedule(); if (u) game.feed(`<b>${esc(u.name)}</b> reconnected`); }
            else renderLobby();
            return;
          }
          if (sess.started || sess.players.length >= sess.maxP) { conn.send({ t: 'bye', reason: sess.started ? 'started' : 'full' }); setTimeout(() => conn.close(), 200); return; }
          const pid = 'c' + Math.random().toString(36).slice(2, 8);
          conn.pid = pid; sess.conns.set(pid, conn);
          (sess.tokens ||= {})[pid] = tok;
          const b = m.build || {};
          const equips = {}; for (const pc of PIECE_ORDER) equips[pc] = PIECES[pc].equips.includes(b.equips && b.equips[pc]) ? b.equips[pc] : PIECES[pc].equips[0];
          sess.players.push({ pid, title: (typeof m.title === 'string' ? m.title : '').replace(/[<>]/g, '').slice(0, 24), name: (typeof m.name === 'string' && m.name.trim() ? m.name : 'Player').replace(/[<>]/g, '').slice(0, 14), skin: own(SKINS, m.skin) ? m.skin : 'ivory', finisher: own(FINISHERS, m.finisher) ? m.finisher : 'shatter', trail: own(TRAILS, m.trail) ? m.trail : 'none', build: { pts: sanitizePts(b.pts), passive: own(PASSIVES, b.passive) ? b.passive : 'regen', equips } });
          conn.send({ t: 'welcome', pid });
          sfx.select(); renderLobby();
        } else if (m.t === 'act' && sess.host && conn.pid && m.a && typeof m.a === 'object') { try { sess.host.act(conn.pid, m.a); } catch (err) { console.warn('bad action', err); } }
        else if (m.t === 'emote' && conn.pid) hostEmote(sess, conn.pid, m.k);
        else if (m.t === 'leave' && conn.pid && sess.host) { conn.left = true; sess.host.setBot(conn.pid); const u = sess.host.s.units.find((v) => v.pid === conn.pid); if (u) game.feed(`<b>${esc(u.name)}</b> forfeited - a bot takes over`); }
      });
      conn.onClose(() => {
        if (!conn.pid) return;
        sess.conns.delete(conn.pid);
        if (!sess.started) { sess.players = sess.players.filter((p) => p.pid !== conn.pid); renderLobby(); }
        else if (sess.host && !conn.left) { sess.host.setBot(conn.pid); const u = sess.host.s.units.find((v) => v.pid === conn.pid); if (u && u.alive && !sess.host.s.over) game.feed(`<b>${esc(u.name)}</b> disconnected - a bot takes over`); }
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
  if (!session || session.mode !== 'host' || session.players.length >= session.maxP) { sfx.error(); return; }
  session.players.push(botPlayer(session.players.length, session.players.map((p) => p.name))); sfx.tap(); session.renderLobby();
}
function startHost() {
  const sess = session; if (!sess || sess.players.length < 2) return;
  sess.players = sess.players.filter((p) => p.isBot || p.pid === 'me' || sess.conns.has(p.pid));
  const minP = Math.max(2, MODES[sess.gameMode].players[0]);
  if (sess.players.length < minP) { toast(`${MODES[sess.gameMode].name} needs at least ${minP} players. Add bots to fill.`); sess.renderLobby(); return; }
  sess.started = true;
  sess.players[0] = { ...me() };
  sess.host = new GameHost(sess.players, (m) => { hostEmit(sess, m); botChatter(sess, m); }, { mode: sess.gameMode });
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
    onOpen: () => { st.textContent = 'Connected. Joining lobby...'; let tok = ''; try { tok = localStorage.getItem('cc_tok_' + code) || Math.random().toString(36).slice(2) + Date.now().toString(36); localStorage.setItem('cc_tok_' + code, tok); } catch {} sess.client.send({ token: tok, t: 'join', name: profile.name, title: profile.title, trail: profile.trail, skin: profile.skin, finisher: profile.finisher, build: profile.build }); },
    onData: (m) => {
      if (session !== sess) return;
      if (m.t === 'welcome') { sess.myPid = m.pid; st.textContent = 'In the lobby.'; sfx.select(); }
      else if (m.t === 'lobby') { $('#join-lobby-panel').classList.remove('hidden'); $('#join-lobby').innerHTML = lobbyHTML(m.players, false, m.mode); $('#join-lobby-panel .lbl').textContent = `Lobby - ${(MODES[m.mode] || MODES.royale).name}`; }
      else if (m.t === 'full' || m.t === 'bye') { sess.byeReason = m.reason || 'full'; st.textContent = { full: 'That lobby is full.', started: 'That match has already started.', kicked: 'The host removed you from the lobby.', ended: 'The host ended the match.' }[sess.byeReason] || 'Disconnected.'; st.classList.add('err'); $('#join-lobby-panel').classList.add('hidden'); $('#join-lobby').innerHTML = ''; if (screen === 'game') { toast(st.textContent); game.showResults(true, 'hostleft'); } }
      else if (m.t === 'start') { sess.myPid = m.pid; matchKey = 'm' + Date.now(); game.enter(); }
      else if (m.t === 'state' || m.t === 'emote') game.onMsg(m);
    },
    onClose: () => {
      if (session !== sess) return;
      if (screen === 'game' && game.s && !game.s.over) { toast('The host left the match'); game.showResults(true, 'hostleft'); }
      else if (screen === 'join' && !sess.byeReason) { st.textContent = 'Disconnected from host.'; st.classList.add('err'); $('#join-lobby-panel').classList.add('hidden'); }
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
    const loop = (now) => { requestAnimationFrame(loop); try { loopBody(now); } catch (err) { console.error(err); } };
    const loopBody = (now) => {
      const dt = Math.min(0.05, (now - last) / 1000); last = now;
      if (screen === 'game') { if (this.potmOn && this.potmR) this.potmR.frame(dt); else this.r.frame(dt); this.tickTimer(); this.heartbeat(dt); }
      if (armoryPreviews.active) for (const p of armoryPreviews.list) drawPreview(p, dt);
      if (armoryPreviews.reveal && !$('#m-reveal').classList.contains('hidden')) drawPreview(armoryPreviews.reveal, dt);

    };
    requestAnimationFrame(loop);
    this.bindInput();
    addEventListener('resize', () => { if (screen === 'game') this.fitPad(); });
    $('#h-actions').addEventListener('click', (e) => { const b = e.target.closest('.act'); if (!b) return; if (this.suppress) { this.suppress = false; return; } this.onAction(b.dataset.slot); });
    const lp = (el, slotOf) => {
      let t = null;
      el.addEventListener('pointerdown', (e) => { this.suppress = false; const slot = slotOf(e); if (!slot || slot === 'end' || slot === 'promote') return; t = setTimeout(() => { this.suppress = true; this.showAbInfo(slot); }, 420); });
      const end = () => { clearTimeout(t); if (!$('#abinfo').classList.contains('hidden')) setTimeout(() => $('#abinfo').classList.add('hidden'), 60); };
      el.addEventListener('pointerup', end); el.addEventListener('pointerleave', end); el.addEventListener('pointercancel', end);
      el.addEventListener('contextmenu', (e) => e.preventDefault());
    };
    lp($('#h-actions'), (e) => { const b = e.target.closest('.act'); return b && b.dataset.slot; });
    lp($('#ult-btn'), () => 'ult');
    $('#promo-opts').addEventListener('click', (e) => {
      const b = e.target.closest('.popt'); if (!b || b.disabled) return;
      session.send({ type: 'promote', to: b.dataset.to }); $('#m-promote').classList.add('hidden');
    });
    this.renderEmotes = () => { $('#emote-menu').innerHTML = Object.entries(activeEmotes(profile)).map(([k, t]) => `<button data-emote="${k}">${t}</button>`).join(''); };
    this.renderEmotes();
    $('#h-portrait').parentElement.addEventListener('click', () => { const u = this.me; if (u) { this.r.closeup(); this.r.follow = false; this.r.focus(u.x, u.y); sfx.tap(); } });
    $('#ult-btn').addEventListener('click', () => { if (this.suppress) { this.suppress = false; return; } this.onAction('ult'); });
    $('#gm-tip').addEventListener('click', () => $('#gm-tip').classList.add('hidden'));
    $('#emote-menu').addEventListener('click', (e) => { const b = e.target.closest('[data-emote]'); if (!b || !session || !session.emote) return; session.emote(b.dataset.emote); $('#emote-menu').classList.add('hidden'); sfx.tap(); });
  },
  after(fn, ms) { const g = this.gen; return setTimeout(() => { if (g === this.gen) fn(); }, ms); },
  enter() {
    this.gen = (this.gen || 0) + 1;
    this.ms = { kills: 0, hollows: 0, ults: 0, crown: false, rook: false, queen: false, pieces: ["pawn"], revives: 0, colossi: 0 }; this.best = null; this.potmOn = false; this.minHp = 1; this.taken = {}; this.since = {}; this.killedBy = null; this.danger = false; this.r.danger = null; $('#btn-danger').classList.remove('on');
    this.r.reduced = settings.motion; this.r.setQuality(settings.quality);
    document.body.classList.toggle('bigtext', !!settings.bigtext);
    this.s = null; this.mode = 'move'; this.preview = null; this.lastTurnNo = -1; this.resultsShown = false; this.lastHp = null; this.lastAlive = 99;
    this.forfeited = false;
    $('#s-game').classList.remove('tut'); $('#s-game').classList.remove('spectating'); $('#spec-bar').classList.add('hidden'); this.spec = null;
    this.r.reset(); this.r.setBounds(null); this.r.setTheme(profile.board); this.turnVault = false;
    $('#coach').classList.add('hidden'); $('#abinfo').classList.add('hidden'); this.r.shakeOn = settings.shake; this.r.resize();
    $$('#s-game .modal').forEach((m) => m.classList.add('hidden'));
    $('#h-feed').innerHTML = ''; $('#emote-menu').classList.add('hidden');
    go('game');
    music.set(1, 'fight');
    requestAnimationFrame(() => this.fitPad());
  },
  fitPad() {
    const coach = $('#coach');
    const top = coach.classList.contains('hidden') ? $('.hud-top').getBoundingClientRect().bottom : coach.getBoundingClientRect().bottom;
    const bot = $('.hud-bottom').getBoundingClientRect();
    const ub = $('#ult-btn').getBoundingClientRect();
    const side = bot.top < innerHeight * 0.5 && bot.left > innerWidth * 0.3; // landscape: HUD is a right-hand column
    if (side) { this.r.setPad(top + 4, 4, Math.max(0, innerWidth - bot.left + 4)); $('#s-game').style.setProperty('--hb', '0px'); return; }
    const lowest = Math.min(bot.top, ub.top > 0 ? ub.top : bot.top);
    this.r.setPad(top + 4, Math.max(0, innerHeight - lowest - 4));
    $('#s-game').style.setProperty('--hb', Math.round(innerHeight - bot.top) + 'px');
  },
  get me() { return this.s && session ? this.s.units.find((u) => u.pid === session.myPid) : null; },
  myTurn() { const m = this.me; return !!(m && m.alive && this.s.active === m.id && !this.s.over); },
  onMsg(m) {
    if (!session) return;
    if (m.t === 'emote') { const u = this.s && unitById(this.s, m.id); if (u) { this.r.emote(m.id, EMOTES[m.k]); sfx.emote(); } return; }
    if (m.t !== 'state') return;
    const first = !this.s;
    const prevS = this.s;
    this.s = m.state;
    if (settings.cb) for (const u of this.s.units) if (u.kind === 'player') u.color = CB_COLORS[(this.s.teams ? u.team * 2 : u.slot) % 8];
    { const mu = this.s.units.find((u) => session && u.pid === session.myPid); if (mu && mu.alive) this.minHp = Math.min(this.minHp ?? 1, mu.hp / stats(mu).maxHp); }
    this.deadline = m.dl < 0 ? 0 : Date.now() + m.dl;
    const mine = this.me;
    this.r.myId = mine ? mine.id : null;
    this.r.setState(this.s, m.ev, first);
    if (first && this.s.arena) this.r.setBounds(this.s.arena);
    if (first) { this.r.startIntro(this.s, this.r.myId); this.after(() => this.fitPad(), 50); }
    this.handleEvents(m.ev, first);
    if (!first) this.scoreMoment(prevS, this.s, m.ev);
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
    const boss = this.s.siege && this.s.units.some((v) => v.alive && v.boss);
    if (!this.resultsShown) { if (this.s.siege) music.set(boss ? 3 : this.s.siege.wave >= 7 ? 2 : 1, boss ? 'boss' : 'siege'); else music.set(lvl, lvl === 3 ? 'final' : 'fight'); }
    if (this.spec) this.updateSpec();
    if (first) this.lastAlive = alive;
    if (alive === 2 && this.lastAlive > 2 && !this.s.over) this.after(() => this.banner('Final Two', 'Only one walks away', 'red'), 900);
    this.lastAlive = alive;
    this.refresh();
  },
  handleEvents(ev, first) {
    const s = this.s, myId = this.r.myId;
    const tut = session && session.mode === 'tutorial';
    if (first) {
      if (!tut) {
        this.showContenders();
        this.after(() => s.siege ? this.banner('Hold the Line', `${s.siege.waves} waves. Survive together.`, 'cyan') : this.banner('Round 1', s.teams ? 'Last team standing wins' : 'Last piece standing wins', ''), 2900);
        if (s.mutator && s.mutator !== 'none') this.after(() => this.banner(MUTATORS[s.mutator].name, MUTATORS[s.mutator].desc, 'cyan'), 4900);
      }
      return;
    }
    if (!tut) this.checkDiscoveries(ev);
    if (!tut) this.tips(ev);
    for (const e of ev) {
      if (e.e === 'dmg' && e.id === myId) { if (e.self) continue; const src = e.storm ? 'The storm' : e.meteor ? 'Meteors' : e.lava ? 'Lava' : e.trap ? 'A trap' : (unitById(s, e.src) || {}).name || 'Unknown'; this.taken[src] = (this.taken[src] || 0) + e.n; this.since[src] = (this.since[src] || 0) + e.n; }
      if (e.e === 'timeout' && e.id === myId) { toast('Time ran out - turn skipped'); sfx.error(); }
      if (e.e === 'turn' && e.id === myId) { const lines = Object.entries(this.since).sort((a, b) => b[1] - a[1]); if (lines.length) this.after(() => this.feed(`<span class="x">Since your last turn:</span> ${lines.map(([n, v]) => `<b>${esc(n)}</b> -${v}`).join(', ')}`), 600); this.since = {}; const mu = unitById(s, myId); if (mu) { this.r.follow = true; this.after(() => this.r.focus(mu.x, mu.y), 350); } }
      if (e.e === 'turn' && e.id === myId) this.after(() => { if (!tut) this.banner('Your Turn', '', ''); sfx.turn(); $('#h-actions').classList.remove('myturn'); void $('#h-actions').offsetWidth; $('#h-actions').classList.add('myturn'); }, 250);
      if (e.e === 'storm') this.after(() => e.phase === 'crack' ? this.banner('The Storm Gathers', 'The outer ring collapses next round', 'red') : this.banner('Collapse', s.storm.ring >= STORM.maxRing ? 'Sudden death - everyone burns' : 'Stay inside the ring', 'red'), 200);
      if (e.e === 'crownSpawn') this.banner('The Crown', 'Has appeared at the centre', '');
      if (e.e === 'world' && !(e.kind === 'meteor' && e.phase === 'strike')) { const W = WORLD_EVENTS[e.kind]; this.after(() => this.banner(W.name, W.desc, e.kind === 'meteor' || e.kind === 'bloodMoon' ? 'red' : 'cyan'), 300); }
      if (e.e === 'ability' && e.id === myId && e.slot === 'ult') this.ms.ults++;
      if (e.e === 'crowned' && e.id === myId) { this.ms.crown = true; this.ms.pieces.push('king'); }
      if (e.e === 'promote' && e.id === myId && e.type === 'evolve') this.ms.pieces.push(e.piece);
      if (e.e === 'revive' && e.by === myId) this.ms.revives++;
      if (e.e === 'death' && (unitById(s, e.id) || {}).boss && this.me && (this.me.alive || s.siege)) this.ms.colossi++;
      if (e.e === 'promote' && e.id === myId && e.piece === 'rook') this.ms.rook = true;
      if (e.e === 'promote' && e.id === myId && e.piece === 'queen') this.ms.queen = true;
      if (e.e === 'attune' && e.id === myId) { const p = $('#h-attune'); p.classList.remove('bump'); void p.offsetWidth; p.classList.add('bump'); }
      if (e.e === 'death' && e.by === myId) { const v = unitById(s, e.id); if (v && v.kind === 'hollow') this.ms.hollows++; else if (v) this.ms.kills++; }
      if (e.e === 'crowned') { const u = unitById(s, e.id); this.banner(u.id === myId ? 'You Are King' : 'A New King', u.id === myId ? 'Everyone is coming for you' : `${u.name} wears the Crown`, ''); }
      if (e.e === 'promote' && e.id === myId) this.after(() => this.banner(e.type === 'evolve' ? PIECES[e.piece].name : 'Honed', e.type === 'evolve' ? 'Evolution complete' : `${PIECES[e.piece].name} level ${e.hone}`, 'cyan'), 300);
      if (e.e === 'death') {
        const v = unitById(s, e.id); if (!v || v.kind !== 'player') continue;
        const k = e.by ? unitById(s, e.by) : null;
        const ico = (u) => `<img src="${pieceIcon(u.piece, u.skin, null, 18)}" alt="">`;
        this.after(() => this.feed(k && k.id !== v.id ? `${ico(k)}<b style="color:${k.color}">${esc(k.name)}</b><span class="x">took</span>${ico(v)}<b style="color:${v.color}">${esc(v.name)}</b>` : `${ico(v)}<b style="color:${v.color}">${esc(v.name)}</b><span class="x">${e.cause === 'meteor' ? 'was crushed by a meteor' : e.cause === 'lava' ? 'burned in the lava' : e.cause === 'trap' ? 'was caught in a trap' : k && k.kind === 'hollow' ? 'was overrun by Hollows' : 'fell to the storm'}</span>`), 400);
        if (e.shutdown && k) this.after(() => this.announce('Shutdown', `${k.name} ended ${v.name}'s streak`, k.color, 'shutdown'), 700);
        if (e.regicide && k) this.after(() => this.announce('Regicide', `${k.name} toppled the King`, '#ffd24d', 'regicide'), 700);
        if (s.teams && !s.over && e.id !== myId && this.me && ally(this.me, v) && this.me.alive) this.after(() => this.banner('Ally Down', 'Step on their soul within 3 rounds to revive them', 'red'), 900);
        if (e.id === myId) { this.killedBy = k && k.id !== myId ? k : null; if (!s.over) this.after(() => this.showDead(), 1700); }
      }
      if (e.e === 'multi') { const k = unitById(s, e.id); if (k) this.after(() => this.announce(e.n >= 4 ? 'Massacre' : e.n === 3 ? 'Triple Take' : 'Double Take', `${k.name} - ${e.n} in one move`, k.color, 'multi'), 900); }
      if (e.e === 'final') this.after(() => this.announce(e.teams ? 'Final Two Teams' : 'Final Two', 'One move from glory', '#ff6b6b', 'final'), 1300);
      if (e.e === 'revive') { const v = unitById(s, e.id), b = unitById(s, e.by); if (v && b) { this.after(() => this.feed(`<b style="color:${b.color}">${esc(b.name)}</b><span class="x">revived</span><b style="color:${v.color}">${esc(v.name)}</b>`), 300); if (e.id === myId || e.by === myId) this.after(() => this.announce(e.id === myId ? 'You Are Back' : 'Revived', e.id === myId ? `${b.name} pulled you back` : `${v.name} rejoins the fight`, '#6dffa8', 'revive'), 500); if (e.id === myId) { $('#m-dead').classList.add('hidden'); if (this.spec) this.stopSpectate(); } } }
      if ((e.e === 'soulDeny' || e.e === 'soulFade') && e.of === myId) this.after(() => this.showDead(true), 700);
      if (e.e === 'death' && this.me && !this.me.alive && e.id !== myId && ally(this.me, unitById(s, e.id) || {})) this.after(() => this.showDead(true), 1900);
      if (e.e === 'soulDeny') { const k = unitById(s, e.id), v = unitById(s, e.of); if (k && v) this.after(() => this.feed(`<b style="color:${k.color}">${esc(k.name)}</b><span class="x">shattered the soul of</span><b style="color:${v.color}">${esc(v.name)}</b>`), 300); }
      if (e.e === 'trap' && e.id === myId) this.after(() => toast('Trapped! You lost initiative.'), 300);
      if (e.e === 'wave' && e.phase === 'start') this.after(() => e.boss ? this.announce(`Wave ${e.n}`, (s.units.find((u) => u.alive && u.boss) || { name: 'The Colossus' }).name + ' has come', '#b98cff', 'boss') : this.banner(`Wave ${e.n} of ${e.of}`, 'Hollows incoming from the edges', 'red'), 300);
      if (e.e === 'wave' && e.phase === 'clear') this.after(() => this.banner('Wave Cleared', e.boss ? 'A Colossus comes next. Evolve and heal.' : 'Everyone heals 20%. Next wave soon.', 'cyan'), 400);
      if (e.e === 'over') this.after(() => { if (this.resultsShown) this.refreshFinal(); else this.showResults(); }, 4800);
    }
  },
  // Play of the Match: keep the single most dramatic action (before/after states + its events).
  scoreMoment(prev, next, ev) {
    if (!prev || !ev || !ev.length || (session && session.mode === 'tutorial')) return;
    const ab = ev.find((e) => e.e === 'ability');
    const actorId = ab ? ab.id : null;
    const actor = actorId && unitById(next, actorId);
    if (!actor || actor.kind !== 'player') return;
    let sc = 0, dmg = 0, kos = 0;
    for (const e of ev) {
      if (e.e === 'dmg' && e.src === actorId && !e.self) { sc += e.n; dmg += e.n; if (e.crit) sc += 15; }
      if (e.e === 'death' && e.by === actorId) { const v = unitById(next, e.id); if (v && v.kind === 'player') { sc += 90; kos++; } else sc += v && v.boss ? 120 : 20; if (e.shutdown) sc += 40; if (e.regicide) sc += 60; }
      if (e.e === 'multi') sc += 80 * e.n;
      if (e.e === 'revive' && e.by === actorId) sc += 70;
      if (e.e === 'over') sc += 50;
      if (e.e === 'ability' && e.slot === 'ult') sc += 30;
    }
    if (sc >= 60 && (!this.best || sc > this.best.score)) this.best = { score: sc, prev, next, ev, actor: actorId, name: actor.name, color: actor.color, piece: actor.piece, ab: ABILITIES[ab.ab].name, dmg, kos };
  },
  playPotm() {
    const B = this.best; if (!B) return;
    $('#m-results').classList.add('hidden'); $('#m-potm').classList.remove('hidden');
    $('#potm-name').textContent = B.name; $('#potm-name').style.color = B.color;
    $('#potm-sub').textContent = `${B.ab} - ${B.dmg} damage${B.kos ? ` - ${B.kos} elimination${B.kos > 1 ? 's' : ''}` : ''}`;
    if (!this.potmR) this.potmR = new Renderer($('#potm-c'), { sfx: (n) => playNamed(n), haptic: () => {}, streak: () => {}, shard: () => {} });
    const r = this.potmR;
    if (r.reset) r.reset();
    r.setBounds(B.prev.arena || null); r.setTheme(profile.board); r.resize();
    r.myId = this.r.myId;
    r.setState(structuredClone(B.prev), [], true);
    const a = unitById(B.prev, B.actor); if (a) r.focus(a.x, a.y);
    this.potmOn = true; sfx.whoosh();
    clearTimeout(this.potmT);
    this.potmT = setTimeout(() => { if (!this.potmOn) return; if (r.slowmo) r.slowmo(0.55, 2.4); r.setState(structuredClone(B.next), B.ev); }, 900);
  },
  closePotm() { this.potmOn = false; clearTimeout(this.potmT); $('#m-potm').classList.add('hidden'); $('#m-results').classList.remove('hidden'); },
  refreshFinal() {
    const s = this.s, u = this.me; if (!s || !u) return;
    const top3 = s.units.filter((v) => v.kind === 'player').sort((a, b) => (a.alive ? 1 : a.place) - (b.alive ? 1 : b.place)).slice(0, 3);
    const order = [top3[1], top3[0], top3[2]];
    $('#podium').innerHTML = order.map((v, i) => v ? `<div class="pod p${[2, 1, 3][i]} ${v.id === u.id ? 'me' : ''}" style="--c:${v.color}"><img src="${pieceIcon(v.piece, v.skin, null, [2, 1, 3][i] === 1 ? 78 : 60)}" alt=""><span>${esc(v.name)}</span><div class="blk"><b>${(v.alive && s.over ? 1 : v.place) || [2, 1, 3][i]}</b></div></div>` : '<div class="pod empty"></div>').join('');
    $('#podium').classList.toggle('hidden', !!s.siege);
    const ranked = s.units.filter((v) => v.kind === 'player').sort((a, b) => (s.siege ? (b.hk || 0) - (a.hk || 0) : (a.alive ? 1 : a.place) - (b.alive ? 1 : b.place)));
    $('#r-board').innerHTML = ranked.map((v, i) => `<li class="${v.id === u.id ? 'me' : ''}" style="--c:${v.color};animation-delay:${0.2 + i * 0.05}s"><b>${s.siege ? i + 1 : (v.alive ? 1 : v.place)}</b><img src="${pieceIcon(v.piece, v.skin, null, 26)}" alt=""><span>${esc(v.name)}${v.title ? `<span class="ttl">${esc(v.title)}</span>` : ''}</span><em>${s.siege ? (v.hk || 0) + ' Hollows' : v.kills + ' KO'}</em></li>`).join('');
    $('#btn-keepspec').classList.add('hidden'); $('#btn-menu').textContent = 'Menu';
    $('#btn-potm').classList.toggle('hidden', !this.best);
    if (this.best) $('#btn-potm').innerHTML = `Play of the Match <small style="color:${this.best.color}">${esc(this.best.name)}</small>`;
    $('#btn-rematch').classList.toggle('hidden', !!(session && session.mode === 'client'));
    $('#spec-bar').classList.add('hidden');
    $('#m-results').classList.remove('hidden');
  },
  startSpectate() {
    const me = this.me; if (!this.s || (me && me.alive && !this.s.over && !this.forfeited)) return;
    this.spec = { id: null };
    $('#s-game').classList.add('spectating');
    $('#spec-bar').classList.remove('hidden');
    this.r.follow = true; this.updateSpec();
  },
  cycleSpec(d) {
    const alive = this.s.units.filter((u) => u.alive && u.kind === 'player');
    if (!alive.length) return;
    const ids = [null, ...alive.map((u) => u.id)];
    let i = ids.indexOf(this.spec ? this.spec.id : null); i = (i + d + ids.length) % ids.length;
    this.spec = { id: ids[i] }; sfx.tap(); this.updateSpec();
  },
  updateSpec() {
    if (!this.spec || !this.s) return;
    let u = this.spec.id ? unitById(this.s, this.spec.id) : null;
    if (u && !u.alive) { this.spec.id = null; u = null; }
    const a = u || unitById(this.s, this.s.active);
    $('#spec-name').textContent = u ? u.name : `Auto${a && a.kind === 'player' ? ' - ' + a.name : ''}`;
    $('#spec-name').style.color = u ? u.color : '';
    $('#spec-label').textContent = this.s.over ? 'Match over' : `Spectating - ${alivePlayers(this.s).length} left`;
    const me = this.me, pending = !this.s.over && me && !me.alive && (this.s.siege || (this.s.teams && alivePlayers(this.s).some((w) => ally(w, me))));
    $('#spec-bar [data-act="results"]').classList.toggle('hidden', !!pending);
    if (a) this.r.focus(a.x, a.y);
  },
  showContenders() {
    const s = this.s, el = $('#contenders'); const ps = s.units.filter((u) => u.kind === 'player');
    const card = (u, i) => `<div class="ct ${session && u.pid === session.myPid ? 'me' : ''}" style="--c:${u.color};animation-delay:${0.1 + i * 0.08}s"><img src="${pieceIcon('pawn', u.skin, u.color, 56)}" alt=""><b>${esc(u.name)}</b>${u.title ? `<span>${esc(u.title)}</span>` : ''}</div>`;
    const M = MODES[s.mode] || MODES.royale;
    const teamsOf = s.teams ? [...new Set(ps.map((u) => u.team))].map((t) => ps.filter((u) => u.team === t)) : null;
    el.innerHTML = s.siege
      ? `<div class="ct-mode">${M.name}</div><div class="ct-grid">${ps.map(card).join('')}</div><div class="ct-sub">${ps.length === 1 ? 'One defender' : ps.length + ' defenders'}. ${s.siege.waves} waves. Hold the line.</div>`
      : teamsOf ? `<div class="ct-mode">${M.name}</div><div class="ct-teams">${teamsOf.map((tm, ti) => `<div class="ct-team" style="--c:${tm[0].color};animation-delay:${0.1 + ti * 0.12}s"><em>Team ${tm[0].team + 1}</em>${tm.map((u, j) => card(u, ti * 2 + j)).join('')}</div>`).join('')}</div><div class="ct-sub">${teamsOf.length} squads enter. One squad leaves.</div>`
      : ps.length === 2
      ? `<div class="ct-mode">${M.name}</div><div class="ct-duel">${card(ps[0], 0)}<div class="vs">VS</div>${card(ps[1], 2)}</div>`
      : `<div class="ct-mode">${M.name}</div><div class="ct-grid">${ps.map(card).join('')}</div><div class="ct-sub">${ps.length} enter. One leaves.</div>`;
    el.classList.remove('hidden'); el.style.animation = 'none'; void el.offsetWidth; el.style.animation = '';
    sfx.whoosh(); this.after(() => sfx.stinger(1), 400);
    clearTimeout(this.ctT); this.ctT = setTimeout(() => el.classList.add('hidden'), 2700);
    el.onclick = () => el.classList.add('hidden');
  },
  tip(id, html) {
    profile.tips = profile.tips || [];
    if (profile.tips.includes(id) || this.resultsShown || (session && session.mode === 'tutorial')) return;
    if ($('#h-banner').classList.contains('show') && performance.now() - (this.bannerAt || 0) < 1700) { this.after(() => this.tip(id, html), 1800); return; }
    profile.tips.push(id); save();
    const el = $('#gm-tip'); el.querySelector('img').src = pieceIcon('king', 'gilded', null, 34);
    el.querySelector('p').innerHTML = html; el.classList.remove('hidden');
    el.style.animation = 'none'; void el.offsetWidth; el.style.animation = '';
    clearTimeout(this.tipT); this.tipT = setTimeout(() => el.classList.add('hidden'), 6500);
  },
  tips(ev) {
    const s = this.s, me = this.me; if (!me) return;
    for (const e of ev) {
      if (e.e === 'turn' && e.id === me.id && s.turnNo <= 30) this.after(() => this.tip('first-turn', '<b>Your move.</b> Tap a blue tile to move, then pick an action. Hold any button to see what it hits.'), 900);
      if (e.e === 'storm' && e.phase === 'crack') this.after(() => this.tip('storm', '<b>The storm is coming.</b> Red cracked tiles collapse next round. Get toward the middle.'), 1800);
      if (e.e === 'world') this.after(() => this.tip('world', '<b>World event!</b> One hits every few rounds. Check the banner and adapt.'), 2000);
      if (e.e === 'ultReady' && e.id === me.id) this.after(() => this.tip('ult', '<b>Ultimate ready.</b> Tap the gold button on your turn. Save it for a crowd or a finishing blow.'), 1200);
      if (e.e === 'crownSpawn') this.after(() => this.tip('crown', '<b>The Crown appeared.</b> Whoever holds it is tougher, but slow, and everyone will hunt them. Kill the King and the Crown shatters into 4 shards.'), 1800);
      if (e.e === 'steadfast' && e.id === me.id) this.after(() => this.tip('steadfast', '<b>Steadfast!</b> Until round 6, a full-HP piece survives any single hit. After that, evolve early to stay safe.'), 900);
      if (e.e === 'pickup' && e.id === me.id && e.k === 'shard') this.after(() => this.tip('shard', '<b>Shard collected.</b> Two shards make you a Knight or Bishop: tap Promote. Every shard also Attunes you permanently.'), 900);
    }
    if (!profile.tips?.includes('hollow') && s.units.some((v) => v.kind === 'hollow' && v.alive && Math.max(Math.abs(v.x - me.x), Math.abs(v.y - me.y)) <= 3)) this.tip('hollow', '<b>A Hollow.</b> Neutral ghosts guard shard caches. They wake when you get close and drop 2 shards.');
  },
  checkDiscoveries(ev) {
    const s = this.s, myId = this.r.myId; if (!myId) return;
    const mine = ev.filter((e) => e.e === 'ability' && e.id === myId);
    for (const e of ev) if (e.e === 'turn' && e.id === myId) this.turnVault = false;
    for (const a of mine) {
      if (a.ab === 'vault') this.turnVault = true;
      if (a.ab === 'fork' && this.turnVault) discover('leap');
    }
    if (mine.length) {
      if (ev.some((e) => e.e === 'impact')) discover('wallbanger');
      const hit = new Set(ev.filter((e) => e.e === 'dmg' && e.src === myId).map((e) => e.id));
      if (hit.size >= 3) discover('collateral');
      if (mine.some((a) => a.slot === 'ult') && ev.filter((e) => e.e === 'death' && e.by === myId && unitById(s, e.id) && unitById(s, e.id).kind === 'player').length >= 2) discover('checkmate');
      if (mine.some((a) => a.ab === 'transpose')) for (const e of ev) if (e.e === 'move' && e.how === 'swap' && e.id !== myId && (isVoid(s, e.to.x, e.to.y) || isCracked(s, e.to.x, e.to.y))) discover('hostile');
    }
    for (const e of ev) {
      if (e.e === 'dmg' && e.src === myId && e.n >= 60) discover('overkill');
      if (e.e === 'pickup' && e.id === myId && e.steal) { const v = unitById(s, e.steal); if (v && v.piece === 'king') discover('tax'); }
      if (e.e === 'death' && e.by === myId) { const v = unitById(s, e.id); if (v && v.piece === 'king') discover('kingslayer'); }
      if (e.e === 'attune' && e.id === myId && e.lv >= 30) discover('ascended');
    }
  },
  showAbInfo(slot) {
    const u = this.me; if (!u || !this.s) return;
    const box = $('#abinfo');
    if (slot === 'move') { box.innerHTML = `<img src="${diagram(u.piece === 'king' ? 'king' : u.piece, 'move', 96, u.skin)}" alt=""><div><b>${PIECES[u.piece].name} Movement</b><p>${PIECES[u.piece].moveDesc}</p></div>`; }
    else {
      const id = slotAbility(u, slot); if (!id) return;
      const A = ABILITIES[id];
      const cd = slot === 'ult' ? `Charge ${Math.round(u.ult || 0)}/100` : A.cd ? `Cooldown ${A.cd}${u.cd[slot] ? ` - ready in ${u.cd[slot]}` : ''}` : 'Every turn';
      box.innerHTML = `<img src="${diagram(u.piece, id, 96, u.skin)}" alt=""><div><b>${A.name}</b><p>${A.desc}</p><em>${cd}${A.free ? ' - Free action' : ''}${A.honed ? `<br>Honed: ${A.honed}` : ''}</em></div>`;
    }
    box.classList.remove('hidden'); sfx.hover(); haptic(10);
  },
  onStreak(e) {
    const k = unitById(this.s, e.by); if (!k || k.kind !== 'player') return;
    const text = e.firstBlood ? 'First Blood' : STREAKS[Math.min(7, e.streak)];
    if (!text) return;
    this.announce(text, k.name, k.color, null, e.firstBlood ? 1 : e.streak);
  },
  // Announcer: big centre callouts, queued so they never trample each other.
  announce(text, sub, color, sting, level = 3) {
    this.annQ = this.annQ || []; this.annQ.push({ text, sub, color, sting, level });
    if (this.annQ.length > 3) this.annQ.splice(1, this.annQ.length - 3);
    if (!this.annBusy) this.nextAnnounce();
  },
  nextAnnounce() {
    const a = (this.annQ || []).shift();
    if (!a || !this.s) { this.annBusy = false; return; }
    this.annBusy = true;
    const el = $('#h-streak');
    el.innerHTML = `<span>${esc(a.text)}</span><small style="color:${a.color || '#fff'}">${esc(a.sub || '')}</small>`;
    el.style.setProperty('--ac', a.color || '#ffd24d');
    el.classList.remove('show'); void el.offsetWidth; el.classList.add('show');
    if (a.sting) playNamed('announce:' + a.sting); else sfx.stinger(a.level);
    haptic([20, 30, 40]);
    setTimeout(() => this.nextAnnounce(), 1500);
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
    void b.offsetWidth; b.classList.add('show'); this.bannerAt = performance.now();
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
  computeThreats() {
    const s = this.s, me = this.me; if (!s || !me || !me.alive) return [];
    const out = [];
    for (const v of s.units) {
      if (!v.alive || v.id === me.id || ally(me, v) || (v.kind !== 'player' && !(s.siege && v.boss))) continue;
      if (Math.max(Math.abs(v.x - me.x), Math.abs(v.y - me.y)) > 8) continue;
      const save = { x: v.x, y: v.y }; let best = 0;
      for (const p of [save, ...legalMoves(s, v)]) {
        v.x = p.x; v.y = p.y;
        for (const slot of ['atk', 'sig', 'eq', 'ult']) {
          if (slot === 'ult' ? (v.ult || 0) < 100 : slot !== 'atk' && v.cd && v.cd[slot] > 0) continue;
          let opts = []; try { opts = abilityOptions(s, v, slot); } catch {}
          for (const o of opts) if (o.mult > 0 && o.tiles.some((t) => t.x === me.x && t.y === me.y)) best = Math.max(best, previewDamage(v, me, o.mult)[1]);
        }
      }
      v.x = save.x; v.y = save.y;
      if (best >= me.hp) out.push({ id: v.id, dmg: best, sure: true });
      else if (best * 1.5 >= me.hp) out.push({ id: v.id, dmg: Math.round(best * 1.5), sure: false });
    }
    return out;
  },
  computeDanger() {
    const s = this.s, me = this.me; if (!s || !me) return null;
    const set = new Map();
    for (const v of s.units) {
      if (!v.alive || v.id === me.id) continue;
      if (v.kind !== 'player') continue;
      const save = { x: v.x, y: v.y };
      const spots = [save, ...legalMoves(s, v)];
      for (const p of spots) {
        v.x = p.x; v.y = p.y;
        for (const slot of ['atk']) {
          if (slot !== 'atk' && v.cd && v.cd[slot] > 0) continue;
          let opts = []; try { opts = abilityOptions(s, v, slot); } catch {}
          for (const o of opts) if (o.mult > 0) for (const t of o.tiles) set.set(t.y * 16 + t.x, t);
        }
      }
      v.x = save.x; v.y = save.y;
    }
    return [...set.values()];
  },
  refresh() {
    const s = this.s; if (!s) return;
    const u = this.me;
    this.r.danger = this.danger ? this.computeDanger() : null;
    const thr = this.myTurn() ? this.computeThreats() : (this.thrCache || []);
    if (this.myTurn()) this.thrCache = thr;
    this.r.threats = thr.map((t) => t.id);
    const lt = $('#lethal');
    if (thr.length && u && u.alive && !s.over) {
      const t0 = unitById(s, thr[0].id); const sure = thr.some((t) => t.sure);
      const pro = promoteOptions(u).filter((o) => o.type === 'evolve' && o.cost <= u.shards).pop();
      let extra = '';
      if (pro) { const gain = Math.round(PIECES[pro.to].hp - PIECES[u.piece === 'king' ? 'queen' : u.piece].hp); if (gain > 0) extra = ` Evolving to ${PIECES[pro.to].name} adds about ${gain} HP.`; }
      lt.innerHTML = `<b>${sure ? 'LETHAL RANGE' : 'DANGER'}</b> ${esc(t0 ? t0.name : 'An enemy')}${thr.length > 1 ? ` +${thr.length - 1}` : ''} can ${sure ? 'eliminate' : 'crit'} you next turn.${extra}`;
      lt.className = 'lethal ' + (sure ? 'sure' : '');
      if (sure && this.myTurn() && this.lethalWarned !== s.turnNo) { this.lethalWarned = s.turnNo; sfx.warn(); haptic([40, 40, 40]); }
    } else lt.className = 'lethal hidden';
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
    if (s.siege) { const nx = s.siege.next ? Math.max(0, s.siege.next - s.round) : s.siege.wave < s.siege.waves ? Math.max(0, s.siege.since + 6 - s.round) : -1; st.textContent = nx < 0 ? 'Final wave' : nx === 0 ? 'Wave now' : `Next wave ${nx}`; st.classList.toggle('hot', nx >= 0 && nx <= 1); }
    else if (s.storm.ring >= STORM.maxRing) { st.textContent = 'Sudden death'; st.classList.add('hot'); }
    else if (s.storm.crack) { st.textContent = 'Collapse!'; st.classList.add('hot'); }
    else { const R = s.rules || { first: STORM.firstCrack, every: STORM.every }; let next = R.first; while (next <= s.round) next += R.every; st.textContent = `Storm ${next - s.round}`; st.classList.toggle('hot', next - s.round <= 1); }
    if (s.siege) { const foes = s.units.filter((v) => v.alive && v.wave).length; $('#h-alive').textContent = s.siege.wave ? `Wave ${s.siege.wave}/${s.siege.waves} - ${foes} foe${foes === 1 ? '' : 's'}` : 'Wave 1 incoming'; }
    else if (s.teams) { const mate = this.me && s.units.find((w) => w.kind === 'player' && ally(this.me, w)); const nT = new Set(alivePlayers(s).map((w) => w.team)).size; $('#h-alive').innerHTML = `${nT} team${nT === 1 ? '' : 's'}${mate ? ` <span class="mate" style="color:${mate.color}">${esc(mate.name)} ${mate.alive ? Math.round(mate.hp / stats(mate).maxHp * 100) + '%' : s.items.some((i) => i.k === 'soul' && i.id === mate.id) ? 'DOWN' : 'OUT'}</span>` : ''}`; }
    else $('#h-alive').textContent = `${alivePlayers(s).length} left`;
    const order = predictOrder(s, 7);
    const oh = order.map((id) => { const v = unitById(s, id); if (!v) return ''; return `<div class="o ${u && v.id === u.id ? 'me' : ''}" style="--c:${v.kind === 'player' ? v.color : '#555'}"><img src="${pieceIcon(v.piece, v.skin, null, 36)}" alt=""></div>`; }).join('');
    const ok = order.map((id) => { const v = unitById(s, id); return v ? id + v.piece + v.skin + v.color : id; }).join(',');
    if ($('#h-order').dataset.k !== ok) { $('#h-order').innerHTML = oh; $('#h-order').dataset.k = ok; }
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
    const atkBuff = u.buffs.some((b) => b.k === 'atk') || (u.passive === 'laststand' && u.hp < stt.maxHp * 0.3); $('#h-stats').innerHTML = `<span class="${atkBuff ? 'up' : ''}">ATK <b>${stt.atk}${atkBuff ? '+' : ''}</b></span><span class="${defBuff ? 'up' : ''}">DEF <b>${stt.def}${defBuff ? '+' : ''}</b></span><span class="${spdBuff ? 'up' : ''}">SPD <b>${Math.round(effSpd(u) * 10) / 10}</b></span><span>${PASSIVES[u.passive].name}</span>`;
    const popts = promoteOptions(u);
    const minCost = popts.length ? Math.min(...popts.map((p) => p.cost)) : 0;
    const shEl = $('#h-shards');
    if (shEl.textContent !== String(u.shards)) { const prev = +shEl.textContent || 0; if (u.shards > prev) setTimeout(() => countUp(shEl, prev, u.shards, 500), 500); else shEl.textContent = u.shards; }
    const evos = popts.filter((p) => p.type === 'evolve');
    const affordable = evos.filter((p) => p.cost <= u.shards);
    const target = affordable.length ? affordable[affordable.length - 1] : evos[0] || popts.find((p) => p.type === 'hone');
    const nextEvo = target && target.type === 'evolve' ? target : null;
    $('#h-shardprog').style.width = (target ? Math.min(1, u.shards / target.cost) * 100 : 100) + '%';
    $('#h-attune').textContent = `ATT ${u.attune || 0}`;
    const ub = $('#ult-btn'), up = Math.min(100, Math.round(u.ult || 0));
    $('#ult-fg').style.strokeDashoffset = 176 * (1 - up / 100);
    $('#ult-pct').textContent = up >= 100 ? 'READY' : up + '%';
    ub.classList.toggle('ready', up >= 100 && u.alive);
    ub.classList.toggle('on', this.myTurn() && this.mode === 'ult');
    ub.classList.toggle('hidden-ult', !u.alive);
    const chip = $('#event-chip');
    if (s.meteors && s.meteors.length) { chip.textContent = 'Meteors incoming'; chip.className = 'event-chip red'; }
    else if (s.bloodMoon) { chip.textContent = 'Blood Moon - damage +30%'; chip.className = 'event-chip red'; }
    else if (s.siege && s.siege.next && s.siege.wave < s.siege.waves) { chip.textContent = `Wave ${s.siege.wave + 1} next round${s.siege.wave + 1 === s.siege.waves || s.siege.wave + 1 === Math.floor(s.siege.waves / 2) ? ' - Colossus' : ''}`; chip.className = 'event-chip cyan'; }
    else if (this.me && !this.me.alive && s.items.some((i) => i.k === 'soul' && i.id === this.me.id)) { chip.textContent = 'Downed - waiting for a revive'; chip.className = 'event-chip red'; }
    else if (s.mutator && s.mutator !== 'none') { chip.textContent = MUTATORS[s.mutator].name; chip.className = 'event-chip dim'; }
    else chip.className = 'event-chip hidden';
    $('#h-next').textContent = u.piece === 'king' ? 'Crowned' : target ? `${target.type === 'hone' ? 'Hone' : (affordable.length ? '' : evos.filter((p) => p.cost === target.cost).map((p) => PIECES[p.to].name).join(' / ')) || PIECES[target.to].name} ${target.cost}` : 'Max';
    const my = this.myTurn();
    $('#h-actions').classList.toggle('wait', !my);
    if (!my) $('#h-actions').classList.remove('myturn');
    const set = (slot, name) => { const el = $(`#a-${slot}`); if (el) el.textContent = name; };
    set('move', PIECES[u.piece] ? (u.piece === 'king' ? 'Step' : PIECES[u.piece].name) : '');
    set('atk', ABILITIES[slotAbility(u, 'atk')].name);
    set('sig', ABILITIES[slotAbility(u, 'sig')].name);
    const eqId = slotAbility(u, 'eq'); set('eq', eqId ? ABILITIES[eqId].name : 'None');
    set('promo', target ? `${u.shards}/${target.cost}` : '--');
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
    if (s.over) tip = 'Match over.';
    else if (!u.alive) tip = 'You are spectating.';
    else if (!my) tip = a ? (a.kind === 'hollow' ? 'A Hollow stirs...' : `<b>${esc(a.name)}</b> is taking their turn`) : '';
    else if (this.mode === 'move') tip = canMove(s, u) ? `<b>Move:</b> ${PIECES[u.piece].moveDesc} Tap a blue tile.` : canAct(s, u) ? 'Choose an action, or end your turn.' : '';
    else { const id = slotAbility(u, this.mode), ab = ABILITIES[id]; tip = `<b>${ab.name}:</b> ${ab.desc}${honedTip(u, id)} ${this.preview ? '<b>Tap again to confirm.</b>' : 'Tap a target.'}`; }
    $('#h-tip').innerHTML = tip;
  },
  tickTimer() {
    const t = $('#h-timer'); if (!this.s || this.s.over) { t.style.transform = 'scaleX(0)'; return; }
    const a = unitById(this.s, this.s.active);
    const human = a && a.kind === 'player' && !a.bot && this.deadline > 0;
    const left = Math.max(0, this.deadline - Date.now());
    t.style.transform = `scaleX(${human ? left / ((this.s.rules && this.s.rules.turnMs) || TURN_MS) : 0})`;
    t.classList.toggle('low', left < 8000);
    if (human && this.myTurn() && left < 5000 && Math.floor(left / 1000) !== this.lastTick) { this.lastTick = Math.floor(left / 1000); sfx.warn(); }
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
        if (o) { if (mouse || settings.onetap || (this.preview && this.preview.anchor.x === o.anchor.x && this.preview.anchor.y === o.anchor.y)) this.exec(o); else { this.preview = o; sfx.tap(); this.refresh(); } return; }
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
    const extra = v.dummy ? 'A training dummy. It will not fight back.' : v.kind === 'hollow' ? 'Guards a shard cache. Drops 2 shards.' : `${PASSIVES[v.passive].name} - ${v.shards} shard${v.shards === 1 ? '' : 's'} - Attune ${v.attune || 0} - Ult ${Math.round(v.ult || 0)}% - ${v.kills} KO`;
    box.innerHTML = `<img src="${pieceIcon(v.piece, v.skin, v.color, 46)}" alt=""><div>${v.title ? `<span style="color:var(--gold);font-size:10px;letter-spacing:.12em;text-transform:uppercase">${esc(v.title)}</span>` : ''}<b style="color:${v.kind === 'player' ? v.color : '#bbb'}">${esc(v.name)}${v.piece === 'king' ? ' - King' : v.kind === 'player' ? ' - ' + PIECES[v.piece].name : ''}</b><span>HP ${v.hp}/${st.maxHp} - ATK ${st.atk} - DEF ${st.def} - SPD ${st.spd}</span><span>${extra}</span></div>`;
    const co = $('#coach'); box.style.top = co.classList.contains('hidden') ? '' : (co.getBoundingClientRect().bottom + 6) + 'px';
    box.classList.remove('hidden'); sfx.tap();
    this.inspT = setTimeout(() => box.classList.add('hidden'), 3200);
  },
  openPromote() {
    const u = this.me; const opts = promoteOptions(u);
    if (!opts.length) { sfx.error(); return; }
    const hone = u.hone[u.piece] || 0;
    const LADDER = [['pawn'], ['knight', 'bishop'], ['rook'], ['queen']];
    const curTier = PIECES[u.piece].tier;
    const path = LADDER.map((row, i) => `<div class="pl-step ${i + 1 < curTier ? 'past' : i + 1 === curTier ? 'cur' : ''}">${row.map((pc) => `<img src="${pieceIcon(pc, u.skin, null, 34)}" alt="" class="${pc === u.piece ? 'me' : ''}">`).join('')}</div>`).join('<i class="pl-arrow"></i>');
    const card = (o) => {
      const piece = o.type === 'evolve' ? o.to : u.piece;
      const P = PIECES[piece], sig = ABILITIES[P.sig];
      const can = u.shards >= o.cost;
      const desc = o.type === 'evolve' ? `${P.moveDesc} Signature: ${sig.name}.` : `+15% stats. ${sig.honed && hone === 0 ? 'Signature upgrade: ' + sig.honed : 'Level ' + o.level + ' of 3.'}`;
      const tag = o.type === 'evolve' && o.steps > 1 ? `<em class="skip">Skips ${o.steps - 1} step${o.steps > 2 ? 's' : ''}</em>` : '';
      return `<button class="popt ${can ? '' : 'locked'}" data-to="${o.to}" ${can ? '' : 'disabled'}><img src="${pieceIcon(piece, u.skin, o.type === 'hone' ? '#7fe0ff' : null, 60)}" alt=""><div><b>${o.type === 'evolve' ? P.name : 'Hone ' + P.name}${tag}</b><span>${desc}</span>${can ? '' : `<span class="need">Need ${o.cost - u.shards} more shard${o.cost - u.shards > 1 ? 's' : ''}</span>`}</div><div class="cost"><span class="shard-ico"></span>${o.cost}</div></button>`;
    };
    const evo = opts.filter((o) => o.type === 'evolve'), hn = opts.find((o) => o.type === 'hone');
    $('#promo-opts').innerHTML = `<div class="promo-path">${path}</div><div class="promo-have"><span class="shard-ico"></span> You have <b>${u.shards}</b> shards</div><p class="hint center" style="margin:0 0 4px">Climbing step by step costs the same as jumping. Evolving early never wastes shards.</p>`
      + (evo.length ? `<div class="promo-sec">Evolve</div>${evo.map(card).join('')}` : '')
      + (hn ? `<div class="promo-sec">Or stay a ${PIECES[u.piece].name}</div>${card(hn)}` : '');
    $('#gm-tip').classList.add('hidden'); $('#h-inspect').classList.add('hidden'); $('#abinfo').classList.add('hidden');
    $('#m-promote').classList.remove('hidden'); sfx.select();
  },
  showDead(quiet = false) {
    const u = this.me; if (!u || this.resultsShown || u.alive || (this.s && this.s.over)) return;
    const soul = this.s && this.s.items.find((i) => i.k === 'soul' && i.id === u.id);
    $('#m-dead h3').textContent = soul ? 'Downed' : 'Eliminated';
    $('#dead-place').textContent = soul ? 'Soul' : this.s.siege ? `Wave ${this.s.siege.wave}` : u.place ? '#' + u.place : 'Out';
    $('#dead-by').textContent = soul ? `An ally can revive you by stepping on your soul. ${Math.max(0, soul.exp - this.s.round)} round${soul.exp - this.s.round === 1 ? '' : 's'} left.` : this.killedBy ? `Taken by ${this.killedBy.name}` : 'The board claimed you';
    if (!soul && !u.place && !this.s.siege) $('#dead-by').textContent = 'Your teammate is still fighting. Spectate to cheer them on.';
    $('#m-dead [data-act="results"]').classList.toggle('hidden', !!soul || !!this.s.siege || (this.s.teams && alivePlayers(this.s).some((w) => ally(w, u))));
    if (!quiet || !$('#m-dead').classList.contains('hidden') || !this.spec) $('#m-dead').classList.remove('hidden');
    if (!quiet) sfx.lose();
  },
  stopSpectate() {
    this.spec = null; $('#s-game').classList.remove('spectating'); $('#spec-bar').classList.add('hidden'); this.r.follow = true;
    const u = this.me; if (u) this.r.focus(u.x, u.y);
  },
  showResults(aborted = false, reason = '') {
    if (this.resultsShown) return;
    this.resultsShown = true;
    $('#gm-tip').classList.add('hidden'); $('#contenders').classList.add('hidden');
    $$('#s-game .modal').forEach((m) => m.classList.add('hidden'));
    const s = this.s, u = this.me;
    if (!s || !u) { go('title'); endSession(); return; }
    const place = u.alive ? (s.over ? 1 : alivePlayers(s).length) : u.place;
    const total0 = s.units.filter((v) => v.kind === 'player').length;
    const siege = s.siege, cleared = siege ? (s.siegeWon ? siege.waves : Math.max(0, siege.wave - 1)) : 0;
    const total = s.teams ? new Set(s.units.filter((v) => v.kind === 'player').map((v) => v.team)).size : total0;
    const win = place === 1 && s.over;
    const rankBonus = siege ? cleared * 9 : Math.max(0, total - place) * (s.teams ? 14 : 8);
    this.lastSummary = { win, place, total, siege: !!siege, cleared };
    const pod = $('#podium');
    if (s.over && !siege) {
      const top3 = s.units.filter((v) => v.kind === 'player').sort((a, b) => (a.alive ? 1 : a.place) - (b.alive ? 1 : b.place)).slice(0, 3);
      const order = [top3[1], top3[0], top3[2]];
      pod.innerHTML = order.map((v, i) => v ? `<div class="pod p${[2, 1, 3][i]} ${v.id === u.id ? 'me' : ''}" style="--c:${v.color}"><img src="${pieceIcon(v.piece, v.skin, null, [2, 1, 3][i] === 1 ? 78 : 60)}" alt=""><span>${esc(v.name)}</span><div class="blk"><b>${(v.alive && s.over ? 1 : v.place) || [2, 1, 3][i]}</b></div></div>` : '<div class="pod empty"></div>').join('');
      pod.classList.remove('hidden');
    } else pod.classList.add('hidden');
    const close = s.teams ? place === 2 : place <= 3;
    $('#r-title').textContent = siege && s.over ? (win ? 'The Line Held' : 'Overrun') : win ? (s.teams ? 'Squad Victory' : 'Checkmate') : reason === 'hostleft' ? 'Host Ended the Match' : aborted ? (u.alive && !s.over ? 'Forfeit' : 'Match Ended') : close ? 'So Close' : 'Defeated';
    $('#r-place').textContent = siege ? `Survived ${cleared} of ${siege.waves} waves` : `Placed ${place} of ${total}${s.teams ? ' teams' : ''}`;
    $('#r-stats').innerHTML = `<div><b id="rs-k">0</b><span>${siege ? 'Hollows' : 'Eliminations'}</span></div><div><b id="rs-d">0</b><span>Damage</span></div><div><b>${PIECES[u.piece].name}</b><span>Final piece</span></div>`;
    setTimeout(() => { countUp($('#rs-k'), 0, siege ? u.hk || 0 : u.kills, 600); countUp($('#rs-d'), 0, u.dmgDealt || 0, 900); }, 400);
    let earned = 0, xpGain = 0, levels = 0;
    const startLvl = profile.level, startXp = profile.xp;
    const quit = aborted && u.alive && !s.over;
    if (quit && session) { try { if (session.mode === 'host') session.host.setBot('me'); else if (session.mode === 'client') { if (reason !== 'hostleft') { session.client.send({ t: 'leave' }); setTimeout(() => endSession(), 300); } } else session.host.stop(); } catch {} }
    if (quit) { profile.played = [...profile.played.slice(-30), matchKey]; if (reason === 'hostleft') { profile.marks += 15; earned = 15; } else recordMatch(profile, { kills: 0, hollows: 0, ults: 0, shards: 0, crown: false, queen: false, win: false, hard: false, minHpRatio: 0, mode: (session && session.gameMode) || 'royale' }); save(); this.seasonGain = []; this.achGain = []; this.dailyScore = null; }
    if (!profile.played.includes(matchKey)) {
      earned = 20 + u.kills * 15 + (u.hk || 0) * 2 + rankBonus + (win ? 60 : 0);
      xpGain = 40 + u.kills * 30 + (u.hk || 0) * 5 + Math.round(rankBonus * 1.8) + Math.round((u.dmgDealt || 0) / 6) + (win ? 100 : 0);
      profile.marks += earned;
      const gmode = (session && session.gameMode) || s.mode || 'royale';
      recordMatch(profile, { kills: u.kills, hollows: this.ms.hollows, ults: this.ms.ults, shards: u.attune || 0, crown: this.ms.crown, queen: this.ms.queen, win, hard: !!(session && session.hard), minHpRatio: u.alive ? this.minHp ?? 0 : 0, mode: gmode, cleared, revives: this.ms.revives, colossi: this.ms.colossi });
      this.masteryGain = gmode === 'daily' ? [] : addMastery(profile, [...this.ms.pieces.filter((k) => k !== u.piece), u.piece], { kills: u.kills, hollows: this.ms.hollows, win, dmg: u.dmgDealt || 0 });
      this.seasonGain = addSeasonXp(profile, xpGain);
      if (gmode === 'daily') { const sc = dailyScore(place, u.kills, u.dmgDealt || 0, total); const t = today(); if (profile.daily.date !== t) { profile.daily.date = t; profile.daily.best = 0; } this.dailyNew = sc > profile.daily.best; this.dailyScore = sc; profile.daily.best = Math.max(profile.daily.best, sc); if (!profile.daily.days.includes(t)) profile.daily.days = [...profile.daily.days.slice(-60), t]; profile.stats.dailyDays = profile.daily.days.length; }
      else this.dailyScore = null;
      profile.bestAttune = Math.max(profile.bestAttune || 0, u.attune || 0);
      const qd = applyQuests({ ...this.ms, kills: this.ms.kills, shards: u.attune || 0, dmg: u.dmgDealt || 0, place: siege ? (win ? 1 : 9) : place, win, cleared });
      this.questsDone = qd; earned += qd.reduce((a, q) => a + q.reward, 0);
      profile.xp += xpGain;
      while (profile.xp >= xpForLevel(profile.level)) { profile.xp -= xpForLevel(profile.level); profile.level++; levels++; profile.marks += 50; earned += 50; }
      this.achGain = checkAchievements(profile);
      profile.played = [...profile.played.slice(-30), matchKey]; save();
    } else { this.seasonGain = []; this.achGain = []; this.dailyScore = null; }
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
    const tk = Object.entries(this.taken || {}).sort((a, b) => b[1] - a[1]).slice(0, 3);
    const rc = $('#r-recap');
    if (!win && tk.length) { rc.innerHTML = `${this.killedBy ? `Eliminated by <b>${esc(this.killedBy.name)}</b>${this.killedBy.kind === 'player' && PIECES[this.killedBy.piece] ? ` (${PIECES[this.killedBy.piece].name})` : ''}. ` : u.alive ? '' : 'The board claimed you. '}Damage taken: ${tk.map(([n, v]) => `<b>${esc(n)}</b> ${v}`).join(', ')}.`; rc.classList.remove('hidden'); }
    else rc.classList.add('hidden');
    $('#r-quests').innerHTML = (this.questsDone || []).map((q, i) => `<div style="animation-delay:${1 + i * 0.15}s"><span>Quest complete: ${q.text}</span><b>+${q.reward}</b></div>`).join('');
    if (this.questsDone && this.questsDone.length) setTimeout(() => sfx.quest(), 1100);
    this.questsDone = [];
    for (const m of this.masteryGain || []) if (m.piece === u.piece || m.to > m.from) $('#r-quests').insertAdjacentHTML('beforeend', `<div class="r-mastery ${m.to > m.from ? 'up' : ''}" style="animation-delay:1.2s"><img src="${pieceIcon(m.piece, profile.skin, null, 26)}" alt=""><span>${PIECES[m.piece].name} mastery ${m.to > m.from ? `<b>${m.from} &rarr; ${m.to}</b>` : m.to}${m.title ? ` - title unlocked: <b>${esc(m.title)}</b>` : ''}</span><em>+${m.gain}</em></div>`);
    this.masteryGain = [];
    const unlocks = [...(this.seasonGain || []).map((g) => { const L = rewardLabel(g); return `<div class="r-unlock" style="animation-delay:1.3s"><span>Crown Path tier ${g.tier}: ${L.name}</span><b>${L.kind}</b></div>`; }), ...(this.achGain || []).map((a) => `<div class="r-unlock" style="animation-delay:1.5s"><span>Trophy: ${a.name}</span><b>+${a.reward}</b></div>`)];
    const tier = seasonTier(profile);
    $('#r-quests').insertAdjacentHTML('beforeend', `<div class="r-season" style="animation:rise .4s 1.1s both">Crown Path - Tier ${tier}${tier < SEASON.tiers ? ` (${profile.season.xp % SEASON.tierXp}/${SEASON.tierXp})` : ''}<div class="xpbar"><i style="width:${tier >= SEASON.tiers ? 100 : seasonProgress(profile) * 100}%"></i></div></div>` + unlocks.join(''));
    if (this.dailyScore != null) $('#r-quests').insertAdjacentHTML('afterbegin', `<div class="r-unlock"><span>Daily score: ${this.dailyScore}${this.dailyNew ? ' - new best!' : ''}</span><b>Best ${profile.daily.best}</b></div>`);
    if (unlocks.length) setTimeout(() => { sfx.buy(); uiFlash(); }, 1400);
    const winner = s.units.find((v) => v.id === s.winner);
    const wmate = winner && s.teams ? s.units.find((v) => v.kind === 'player' && v !== winner && v.team === winner.team) : null;
    if (winner && !win && !siege) $('#r-place').innerHTML = `Placed ${place} of ${total}${s.teams ? ' teams' : ''} <div class="r-winner"><img src="${pieceIcon(winner.piece, winner.skin, winner.color, 54)}" alt=""><div><span>${wmate ? 'WINNERS' : 'WINNER'}</span><b style="color:${winner.color}">${esc(winner.name)}${wmate ? ' &amp; ' + esc(wmate.name) : ''}</b></div></div>`;
    $('#r-marks').innerHTML = earned ? `<i class="mark-ico"></i>+<span id="rm">0</span> Marks` : '';
    if (earned) setTimeout(() => countUp($('#rm'), 0, earned, 1000, true), 900);
    const rankOf = (v) => (siege ? 0 : v.id === u.id ? place : v.alive ? (s.over ? 1 : 0) : v.place);
    const ranked = s.units.filter((v) => v.kind === 'player').sort((a, b) => (siege ? (b.hk || 0) - (a.hk || 0) : (rankOf(a) || 0.5) - (rankOf(b) || 0.5)));
    $('#r-board').innerHTML = ranked.map((v, i) => `<li class="${v.id === u.id ? 'me' : ''}" style="--c:${v.color};animation-delay:${0.5 + i * 0.06}s"><b>${siege ? i + 1 : rankOf(v) || '-'}</b><img src="${pieceIcon(v.piece, v.skin, null, 26)}" alt=""><span>${esc(v.name)}${v.title ? `<span class="ttl">${esc(v.title)}</span>` : ''}</span><em>${siege ? (v.hk || 0) + ' Hollows' : v.kills + ' KO'}</em></li>`).join('');
    if (quit && session && session.mode === 'host') this.forfeited = true;
    const liveSpec = !s.over && (!u.alive || this.forfeited) && !(session && session.mode === 'client' && aborted);
    $('#btn-keepspec').classList.toggle('hidden', !liveSpec);
    $('#btn-potm').classList.toggle('hidden', !this.best);
    if (this.best) $('#btn-potm').innerHTML = `Play of the Match <small style="color:${this.best.color}">${esc(this.best.name)}</small>`;
    $('#btn-menu').textContent = liveSpec && session && session.mode === 'host' ? 'Leave' : 'Menu';
    $('#btn-rematch').classList.toggle('hidden', !!(liveSpec || (session && (session.mode === 'client' || (session.mode === 'host' && !s.over)))));
    $('#spec-bar').classList.add('hidden');
    $('#m-results').classList.remove('hidden');
    music.set(0, 'menu');
    if (win) { sfx.win(); confetti(); haptic([50, 50, 50, 50, 150]); } else sfx.lose();
    if (win && u.alive && u.hp / stats(u).maxHp < 0.1) setTimeout(() => discover('clutch'), 1500);
    if (!quit && session && session.graduation && !profile.tutorial.includes('graduation')) { profile.tutorial.push('graduation'); profile.marks += 100; save(); setTimeout(() => toast('Graduated! +100 Marks'), 1200); }
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
      if (screen !== 'game' || e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
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
  $('#set-motion').checked = !!settings.motion; $('#set-onetap').checked = !!settings.onetap; $('#set-cb').checked = !!settings.cb; $('#set-bigtext').checked = !!settings.bigtext;
  $$('#set-quality button').forEach((b) => b.classList.toggle('on', b.dataset.q === settings.quality));
  $('#set-shake').checked = settings.shake; $('#set-haptics').checked = settings.haptics;
  $('#m-settings').classList.remove('hidden');
}
$('#set-music').addEventListener('input', (e) => { settings.music = +e.target.value; saveSettings(); });
$('#set-sfx').addEventListener('input', (e) => { settings.sfx = +e.target.value; saveSettings(); });
$('#set-sfx').addEventListener('change', () => sfx.select());
$('#set-shake').addEventListener('change', (e) => { settings.shake = e.target.checked; saveSettings(); game.r.shakeOn = settings.shake; });
$('#set-motion').addEventListener('change', (e) => { settings.motion = e.target.checked; saveSettings(); game.r.reduced = settings.motion; document.body.classList.toggle('reduced', settings.motion); });
$('#set-onetap').addEventListener('change', (e) => { settings.onetap = e.target.checked; saveSettings(); });
$('#set-cb').addEventListener('change', (e) => { settings.cb = e.target.checked; saveSettings(); });
$('#set-bigtext').addEventListener('change', (e) => { settings.bigtext = e.target.checked; saveSettings(); document.body.classList.toggle('bigtext', settings.bigtext); });
$('#set-quality').addEventListener('click', (e) => { const b = e.target.closest('[data-q]'); if (!b) return; settings.quality = b.dataset.q; saveSettings(); game.r.setQuality(settings.quality); $$('#set-quality button').forEach((x) => x.classList.toggle('on', x === b)); sfx.tap(); });
function sig(str) { let h1 = 0x811c9dc5, h2 = 0x1b873593; for (let i = 0; i < str.length; i++) { const c = str.charCodeAt(i); h1 = Math.imul(h1 ^ c, 16777619); h2 = Math.imul(h2 ^ (c + i), 2246822519); } return ((h1 >>> 0).toString(36) + (h2 >>> 0).toString(36)).slice(0, 12); }
function info(title, html) { $('#info-title').textContent = title; $('#info-body').innerHTML = html; $('#m-info').classList.remove('hidden'); }
const WHATS_NEW = `<h4>5.0</h4><ul><li><b>Squads</b>: teams of two, no friendly fire, a Bond DEF bonus when you stick together, and revives: step on a fallen teammate's soul to bring them back.</li><li><b>Siege</b>: co-op against eight waves of hunting Hollows, with a Colossus boss on waves 4 and 8. The first Colossus drops the Crown.</li><li><b>Map hazards</b>: Magma Rift, Frostbite and Warpgates. Most matches roll one.</li><li><b>Five new abilities</b> (Tripwire, Lance, Penance, Quake, Gambit) and two new base abilities (Lifesteal, Last Stand).</li><li><b>The Announcer</b>: First Blood, Double Take, Shutdown, Regicide, Final Two and more.</li><li><b>Play of the Match</b>: the best move of every game, replayed in slow motion on the results screen.</li><li><b>Piece Mastery</b>: level each piece to 10 for titles and Marks.</li><li><b>Season 2: The Middlegame</b>: a fresh Crown Path with the Warden and Colossus sets, the Riftgate board and the Soulfire finisher.</li><li>Dozens of rules fixes, faster rendering, bigger tap targets and a landscape title screen.</li></ul><h4>3.1</h4><ul><li><b>Spectate properly</b>: getting eliminated online never ends the match, and you can follow any player. Hosts get a warning before leaving.</li><li><b>Rejoin</b> a match after a reload with the same code.</li><li><b>Cheaper, smarter promotions</b>: Knight or Bishop for 2, Rook +4, Queen +7, Hone from 1. Evolving early never wastes shards.</li><li><b>Steadfast</b>: before round 6 a full-HP piece survives any single hit.</li><li><b>Lethal Range</b> warnings, Knights that face their moves, and pieces with personality.</li></ul><h4>3.0</h4><ul><li><b>Full promotion ladder</b>: the Promote menu shows every rung and you can climb several at once (Pawn to Rook for 8, to Queen for 15).</li><li><b>The Store</b>: a daily Featured shop with a 30% Deal of the Day, discounted Bundles, rarity tiers, and an item reveal for every unlock.</li><li><b>New cosmetics</b>: 5 piece sets, 3 boards (with snow and bubbles), 3 finishers, Trails that follow your piece, and Emote packs.</li><li><b>Showtime</b>: a contender reveal before every match (VS for Duels), a podium on the results screen, and your piece on display on the title screen.</li></ul>
<h4>2.0 Modes</h4><ul><li><b>Blitz</b>: faster storm, 15 second turns, start with 2 shards.</li><li><b>Duel</b>: 1v1 in a tight arena.</li><li><b>Daily Challenge</b>: same map and build for everyone, chase your best score.</li></ul>
<h4>Progression</h4><ul><li><b>Crown Path</b>: a free 30-tier season track with exclusive cosmetics and titles.</li><li><b>Trophies</b>: 21 achievements, each with Marks and a title.</li><li>Pick a title to show in lobbies and results.</li></ul>
<h4>Balance</h4><ul><li>Heavy is the Head: the King no longer attunes, charges ultimates at half speed and takes 10% more damage. The Crown appears at a random safe spot.</li><li>Tank preset reworked. Regen scales with attunement.</li></ul>
<h4>Comfort</h4><ul><li>Graphics quality, reduced motion, one-tap attacks, colorblind colors, larger text.</li><li>Profile backup codes.</li></ul>
<h4>Fixes</h4><ul><li>Hollows no longer spawn stacked. The Crown can no longer be lost under a Rampart or inside a chest. Evolving can no longer leave you at negative HP. Thorns and pushes no longer change the result after the match ends. Lobby join exploit closed.</li></ul>`;
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
    case 'close-info': $('#m-info').classList.add('hidden'); sfx.tap(); break;
    case 'whatsnew': e.preventDefault(); info('What\'s New', WHATS_NEW); break;
    case 'credits': e.preventDefault(); info('Credits', `<p><b>Chess Complex</b><br>Created by Diante Clark.</p><p>Built with plain HTML, Canvas and the Web Audio API. Every sound and piece of art is generated in code.</p><p>Fonts: Cinzel and Chakra Petch (SIL Open Font License). Online play uses PeerJS (MIT).</p>`); break;
    case 'export-profile': { const body = btoa(unescape(encodeURIComponent(JSON.stringify(profile)))); const code = body + '.' + sig(body); copy(code, 'Backup code copied'); info('Backup Code', `<p>Keep this somewhere safe. Paste it into Restore Backup on any device.</p><textarea readonly>${code}</textarea>`); break; }
    case 'import-profile': info('Restore Backup', `<p>Paste a backup code. This replaces your current progress.</p><textarea id="import-code"></textarea><button class="btn wide gold" data-act="do-import">Restore</button>`); break;
    case 'do-import': try { const [body, mac] = $('#import-code').value.trim().split('.'); if (!mac || sig(body) !== mac) throw 0; const d = JSON.parse(decodeURIComponent(escape(atob(body)))); if (!d || typeof d !== 'object' || !d.build) throw 0; profile = normalizeProfile(d); save(); renderProfile(); $('#m-info').classList.add('hidden'); toast('Progress restored'); sfx.buy(); } catch { toast('That code did not work'); sfx.error(); } break;
    case 'start-solo': matchKey = 'm' + Date.now(); sfx.select(); uiFlash(); startSolo(null, profile.mode); break;
    case 'copy-code': copy(session && session.code, 'Code copied'); break;
    case 'copy-link': copy(session && `${location.origin}${location.pathname}?join=${session.code}`, 'Invite link copied'); break;
    case 'add-bot': hostAddBot(); break;
    case 'fill-bots': while (session && session.players && session.players.length < session.maxP) hostAddBot(); break;
    case 'start-host': matchKey = 'm' + Date.now(); sfx.select(); uiFlash(); startHost(); break;
    case 'join': joinGame(); break;
    case 'danger': game.danger = !game.danger; $('#btn-danger').classList.toggle('on', game.danger); game.refresh(); sfx.tap(); if (game.danger) toast('Red tiles: where enemy pieces can attack next turn'); break;
    case 'zoom': if (game.r.cam.tz > game.r.fitZoom * 1.05) game.r.overview(); else game.r.closeup(); sfx.tap(); break;
    case 'menu': $('#m-menu').classList.remove('hidden'); sfx.tap(); break;
    case 'close-menu': $('#m-menu').classList.add('hidden'); break;
    case 'close-promote': $('#m-promote').classList.add('hidden'); break;
    case 'emotes': game.renderEmotes(); $('#emote-menu').classList.toggle('hidden'); sfx.tap(); break;
    case 'close-reveal': $('#m-reveal').classList.add('hidden'); if (armoryPreviews.queue && armoryPreviews.queue.length) { const [k, id] = armoryPreviews.queue.shift(); setTimeout(() => reveal(k, id), 150); } break;
    case 'forfeit': if (session && session.mode === 'tutorial') { $('#m-menu').classList.add('hidden'); endSession(); go('tutorial'); break; }
      $('#m-menu').classList.add('hidden'); game.showResults(!!(game.s && !game.s.over && game.me && game.me.alive)); break;
    case 'spectate': $('#m-dead').classList.add('hidden'); game.startSpectate(); break;
    case 'potm': case 'potm-replay': sfx.select(); game.playPotm(); break;
    case 'potm-close': sfx.tap(); game.closePotm(); break;
    case 'keep-spectating': $('#m-results').classList.add('hidden'); game.startSpectate(); break;
    case 'spec-prev': game.cycleSpec(-1); break;
    case 'spec-next': game.cycleSpec(1); break;
    case 'results': if (game.resultsShown) { $('#m-results').classList.remove('hidden'); $('#spec-bar').classList.add('hidden'); } else game.showResults(); break;
    case 'to-title': leaveToTitle(); break;
    case 'next-lesson': startLesson(b.dataset.next); break;
    case 'to-tutorial': endSession(); go('tutorial'); break;
    case 'rematch':
      if (!session || session.mode === 'solo') { const n = session ? session.bots : 7; const gm = session ? session.gameMode : profile.mode; matchKey = 'm' + Date.now(); startSolo(n, gm); }
      else if (session.mode === 'host') { if (game.s && !game.s.over) { toast('Wait for the match to finish'); break; } try { session.host.stop(); } catch {} session.host = null; session.started = false; session.rematch = true; go('host'); }
      break;
  }
});
$('#host-lobby').addEventListener('click', (e) => {
  const b = e.target.closest('[data-kick]'); if (!b || !session) return;
  const pid = b.dataset.kick; const c = session.conns.get(pid);
  if (c) { c.send({ t: 'bye', reason: 'kicked' }); setTimeout(() => c.close(), 200); session.conns.delete(pid); }
  if (session.tokens) delete session.tokens[pid];
  session.players = session.players.filter((p) => p.pid !== pid); session.renderLobby();
});
function confirmBox(title, body, yes, no, onYes, onNo) {
  $('#cf-title').textContent = title; $('#cf-body').textContent = body; $('#cf-yes').textContent = yes; $('#cf-no').textContent = no;
  $('#m-confirm').classList.remove('hidden');
  $('#cf-yes').onclick = () => { $('#m-confirm').classList.add('hidden'); onYes(); };
  $('#cf-no').onclick = () => { $('#m-confirm').classList.add('hidden'); sfx.tap(); if (onNo) onNo(); };
}
function leaveToTitle() {
  const live = session && session.mode === 'host' && game.s && !game.s.over && screen === 'game';
  const friends = live ? [...session.conns.values()].length : 0;
  if (live && friends > 0) {
    confirmBox('End the match?', `You are hosting. The match runs on your device, so leaving ends it for ${friends === 1 ? 'your friend' : `all ${friends} friends`}. Keep spectating to let them finish.`, 'End match for everyone', 'Keep spectating', () => { for (const c of session.conns.values()) c.send({ t: 'bye', reason: 'ended' }); setTimeout(() => { endSession(); go('title'); }, 250); }, () => { $('#m-results').classList.add('hidden'); game.startSpectate(); });
    return;
  }
  endSession(); go('title');
}
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

$('#rv-equip').addEventListener('click', () => { const v = $('#rv-equip').dataset.equip; if (v) { const [k, id] = v.split(':'); equip(profile, k, id); save(); sfx.select(); } $('#m-reveal').classList.add('hidden'); if (screen === 'armory') renderArmory(); if (armoryPreviews.queue && armoryPreviews.queue.length) { const [k, id] = armoryPreviews.queue.shift(); setTimeout(() => reveal(k, id), 150); } });
$('#lesson-list').addEventListener('click', (e) => { const b = e.target.closest('[data-lesson]'); if (!b) return; sfx.select(); uiFlash(); startLesson(b.dataset.lesson); });
$('#codex-tabs').addEventListener('click', (e) => { const b = e.target.closest('[data-ctab]'); if (!b) return; codexTab = b.dataset.ctab; sfx.tap(); renderCodexTab(); });
$('#coach-next').addEventListener('click', () => { sfx.select(); if (tutorial) tutorial.next(); });
$('#coach-text').addEventListener('click', () => { clearInterval(coachUI.tw); $('#coach-text').textContent = coachUI.full || ''; });
$('#modes').addEventListener('click', (e) => { const b = e.target.closest('[data-mode]'); if (!b) return; profile.mode = b.dataset.mode; save(); sfx.select(); renderPlay(); });
$('#title-list').addEventListener('click', (e) => { const b = e.target.closest('[data-title]'); if (!b) return; profile.title = b.dataset.title; save(); sfx.select(); renderTrophies(); });
$('#seg-diff').addEventListener('click', (e) => { const b = e.target.closest('[data-diff]'); if (!b) return; profile.botLevel = b.dataset.diff; save(); sfx.select(); renderSoloMini(); });
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
addEventListener('keydown', (e) => { if (e.key !== 'Escape') return; const open = [...document.querySelectorAll('.modal:not(.hidden)')].pop(); if (open && open.id !== 'm-results' && open.id !== 'm-lesson') open.classList.add('hidden'); });
addEventListener('beforeunload', (e) => { if (session && session.mode === 'host' && game.s && !game.s.over && screen === 'game' && session.conns.size) { e.preventDefault(); e.returnValue = ''; } });
addEventListener('pagehide', () => endSession());
bgInit();
game.init();
renderProfile();
document.body.classList.toggle('bigtext', !!settings.bigtext); document.body.classList.toggle('reduced', !!settings.motion);
setTimeout(() => { $('#splash').classList.add('out'); if (profile.seenVersion !== '5.0' && (profile.games || profile.tutorial.length)) { info('What\'s New in 5.0', WHATS_NEW); } profile.seenVersion = '5.0'; save(); }, 700);
const q = new URLSearchParams(location.search);
if (q.get('join')) { go('join'); $('#in-code').value = q.get('join').toUpperCase().slice(0, 5); }
window.__cc = { game, profile, get session() { return session; }, startSolo };
