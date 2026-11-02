// Chess Complex — app shell: menus, loadout, armory, sessions, in-game HUD, progression.
import { TRAILS, PIECES, ABILITIES, PASSIVES, PRESETS, STAT_POINTS, STAT_GAIN, SKINS, DEFAULT_SKINS, MAX_PLAYERS, TURN_MS, BOARDS, DEFAULT_BOARDS, FINISHERS, DEFAULT_FINISHERS, EMOTES, xpForLevel, titleFor, PLAYER_COLORS, QUESTS, WORLD_EVENTS, DISCOVERIES, RARITY, BUNDLES, MODES, SEASON, SEASON_REWARDS, ACHIEVEMENTS, TEAM_COLORS, MUTATORS } from './data.js';
import { ensureProgress, seasonTier, seasonProgress, rewardLabel, addSeasonXp, checkAchievements, recordMatch, dailySeed, dailyScore, achievementValue, addMastery, masteryLevel } from './progression.js';
import { previewDamage, legalMoves, abilityOptions, canMove, canAct, canUse, slotAbility, stats, effSpd, promoteOptions, predictOrder, unitById, alivePlayers, STORM, createTutorial, ARENA, isVoid, isCracked, ally } from './engine.js';
import { LESSONS, Tutorial } from './tutorial.js';
import { renderCodex, diagram } from './codex.js';
import { KINDS, ensureStore, item, listKind, featured, bundleInfo, grant, equip, activeEmotes, makePreview, drawPreview } from './store.js';
import * as SUI from './storeui.js';
import { Renderer } from './render.js';
import * as TAP from './input.js'; // U 10.2: tap resolution, target assist, confirm loupe
import { pieceIcon, drawPiece } from './pieces.js';
import { FX } from './fx.js';
import { sfx, playNamed, unlockAudio, settings, saveSettings, haptic } from './audio.js';
Object.assign(settings, Object.assign({ motion: !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches), onetap: false, quality: 'auto', cb: false, bigtext: false }, settings));
import { music } from './music.js';
import { director } from './announcer.js';
import { initScene, sequelReveal, showroom, modeArt, newsFrom } from './menus.js';
import { GameHost, openServer, openClient, makeCode } from './net.js';
import { chat, hostCheck as chatHostCheck, BOT_LINES } from './chat.js';
import { voice } from './voice.js';

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
    const val = { revive: ms.revives || 0, waves: ms.cleared || 0, win: ms.win ? 1 : 0, kills: ms.kills, rook: ms.rook ? 1 : 0, queen: ms.queen ? 1 : 0, crown: ms.crown ? 1 : 0, shards: ms.shards, top3: ms.place <= 3 ? 1 : 0, damage: ms.dmg, ults: ms.ults, hollows: ms.hollows, attune: Math.floor(ms.shards / 5) }[q.id] || (Q.stat ? +ms[Q.stat] || 0 : 0);
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

function toast(msg) { if (screen === 'game' && director.mounted) return director.hint(esc(msg), { kind: 'toast' }); const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 2200); }
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
// 10.0 (A8): the cinematic scene (sky, light shafts, perspective board, drifting pieces, hero pedestal) lives in menus.js.
function bgInit() {
  initScene({ canvas: bg.c, bg, getProfile: () => profile, getScreen: () => screen, settings });
}

// ---------- navigation ----------
let screen = 'title';
const DEPTH = { title: 0, game: 3, host: 2 };
let loadoutFrom = 'title';
function go(name) {
  if (name !== 'title' && SUI.leaveLogin) SUI.leaveLogin();
  if (name === screen) return;
  // Loadout opened from the Play screen returns there.
  if (name === 'loadout') loadoutFrom = screen === 'play' ? 'play' : 'title';
  if (screen === 'loadout' && name === 'title' && loadoutFrom === 'play') name = 'play';
  const dir = name === 'game' ? 'game' : screen === 'game' ? 'out' : (DEPTH[name] ?? 1) >= (DEPTH[screen] ?? 1) ? 'fwd' : 'back';
  $('#app').dataset.dir = dir;
  const wipe = $('#ui-wipe'); if (wipe && dir !== 'game') { wipe.classList.remove('go'); void wipe.offsetWidth; wipe.classList.add('go'); }
  $$('.screen').forEach((s) => s.classList.toggle('active', s.id === 's-' + name));
  screen = name;
  bg.on = name !== 'game';
  if (name === 'loadout') { delete $('#sr-bars').dataset.on; renderLoadout(); }
  SUI.onScreen(name);
  if (name === 'armory') renderArmory();
  if (name === 'profile') SUI.renderProfileScreen();
  if (name === 'title') setTimeout(() => { if (screen === 'title') SUI.maybeLogin(); }, 900);
  if (name === 'play') renderPlay();
  if (name === 'path') renderPath();
  if (name === 'trophies') renderTrophies();
  if (name === 'host') startHostLobby();
  if (name === 'title') { const a = checkAchievements(profile); if (a.length) { save(); setTimeout(() => toast(`Trophy unlocked: ${a[0].name}`), 400); } }
  if (name === 'title') renderProfile();
  if (name === 'quests') renderQuests();
  if (name === 'tutorial') renderLessons();
  if (name === 'codex') renderCodexTab();
  if (name !== 'game') music.set(0, ['armory', 'store', 'path'].includes(name) ? 'armory' : 'title');
  armoryPreviews.active = name === 'armory';
}

// ---------- loadout ----------
// 10.0 (A8): a showroom loadout. One piece at a time on a spotlit turntable with animated stat bars;
// presets are illustrated cards; abilities are cards with their codex diagrams.
let loPiece = 'pawn';
const STAT_KEYS = ['hp', 'atk', 'def', 'spd'];
const STAT_COL = { hp: '#5cff9d', atk: '#ff6b6b', def: '#7fb6ff', spd: '#ffe04d' };
const STAT_ICO = { hp: 'm-heart', atk: 'm-sword', def: 'm-shield', spd: 'm-wing' };
const STAT_NAME = { hp: 'Health', atk: 'Attack', def: 'Defense', spd: 'Speed' };
const PRESET_ART = { bruiser: ['rook', 'ember'], scout: ['knight', 'jade'], tank: ['rook', 'glacier'], assassin: ['bishop', 'obsidian'] };
const pieceStat = (pc, k, pts = profile.build.pts) => { const p = PIECES[pc]; return k === 'def' ? Math.round(p.def + pts.def * STAT_GAIN.def) : p[k] + pts[k] * STAT_GAIN[k]; };
const statMax = (k) => Math.max(...PIECE_ORDER.map((pc) => pieceStat(pc, k, { hp: STAT_POINTS, atk: STAT_POINTS, def: STAT_POINTS, spd: STAT_POINTS })));
function renderLoadout() {
  if (!PIECE_ORDER.includes(loPiece)) loPiece = 'pawn';
  const skin = SKINS[profile.skin] ? profile.skin : 'ivory';
  $('#in-name').value = profile.name;
  // showroom
  showroom.attach($('#sr-canvas'), () => screen, settings); showroom.set(loPiece, skin);
  $('#sr-name').textContent = PIECES[loPiece].name;
  $('#sr-kicker').textContent = `${SKINS[skin].name} set`;
  const bars = $('#sr-bars');
  if (!bars.children.length) bars.innerHTML = STAT_KEYS.map((k) => `<div class="srb" data-k="${k}" style="--c:${STAT_COL[k]}"><svg><use href="#${STAT_ICO[k]}"/></svg><span>${k.toUpperCase()}</span><div class="srb-t"><em></em><i></i></div><b>0</b></div>`).join('');
  const fresh = !bars.dataset.on; bars.dataset.on = '1';
  for (const k of STAT_KEYS) {
    const row = bars.querySelector(`[data-k="${k}"]`), mx = statMax(k);
    const tot = pieceStat(loPiece, k), base = pieceStat(loPiece, k, { hp: 0, atk: 0, def: 0, spd: 0 });
    const set = () => { row.querySelector('i').style.width = (tot / mx) * 100 + '%'; row.querySelector('em').style.width = (base / mx) * 100 + '%'; };
    if (fresh) { row.querySelector('i').style.width = '0%'; row.querySelector('em').style.width = '0%'; requestAnimationFrame(() => requestAnimationFrame(set)); } else set();
    const bEl = row.querySelector('b'), from = +bEl.textContent || 0;
    if (from !== tot) countUp(bEl, from, tot, fresh ? 700 : 350);
    row.title = `${STAT_NAME[k]}: ${base} base + ${tot - base} from your points`;
  }
  const chips = PIECE_ORDER.map((pc) => `<button class="srp ${pc === loPiece ? 'on' : ''}" data-lopiece="${pc}" role="tab" aria-selected="${pc === loPiece}" aria-label="${PIECES[pc].name}"><img src="${pieceIcon(pc, skin, null, 40)}" alt=""><span>${PIECES[pc].name}</span></button>`).join('');
  $('#sr-pick').innerHTML = chips;
  // presets
  $('#presets').innerHTML = Object.entries(PRESETS).map(([k, p]) => {
    const art = PRESET_ART[k] || ['pawn', skin];
    return `<button class="preset ${profile.build.preset === k ? 'on' : ''}" data-preset="${k}"><img class="pa" src="${pieceIcon(art[0], SKINS[art[1]] ? art[1] : skin, null, 64)}" alt=""><b>${p.name}</b><span>${p.blurb}</span><div class="pmini">${STAT_KEYS.map((s) => `<i style="--c:${STAT_COL[s]};--v:${p.pts[s] / 5}"></i>`).join('')}</div>${profile.build.preset === k ? '<svg class="pcheck"><use href="#m-check"/></svg>' : ''}</button>`;
  }).join('');
  const left = STAT_POINTS - ptsUsed();
  $('#pts-left').textContent = `${left} point${left === 1 ? '' : 's'} left${profile.build.preset ? '' : ' - Custom'}`;
  $('#stat-alloc').innerHTML = STAT_KEYS.map((k) => {
    const v = profile.build.pts[k];
    return `<div class="alloc"><b><svg style="fill:${STAT_COL[k]}"><use href="#${STAT_ICO[k]}"/></svg>${k.toUpperCase()}</b><div class="pips" style="--c:${STAT_COL[k]}">${Array.from({ length: STAT_POINTS }, (_, i) => `<i class="${i < v ? 'on' : ''}"></i>`).join('')}</div><button class="step" data-stat="${k}" data-d="-1" aria-label="Less ${STAT_NAME[k]}">-</button><button class="step" data-stat="${k}" data-d="1" aria-label="More ${STAT_NAME[k]}">+</button></div>`;
  }).join('');
  $('#stat-preview').innerHTML = PIECE_ORDER.map((pc) => `<button class="sp ${pc === loPiece ? 'on' : ''}" data-lopiece="${pc}"><img src="${pieceIcon(pc, skin, null, 48)}" alt=""><div>HP <b>${pieceStat(pc, 'hp')}</b><br>ATK <b>${pieceStat(pc, 'atk')}</b><br>DEF <b>${pieceStat(pc, 'def')}</b><br>SPD <b>${pieceStat(pc, 'spd')}</b></div></button>`).join('');
  $('#passives').innerHTML = Object.entries(PASSIVES).map(([k, p]) => `<button class="choice ${profile.build.passive === k ? 'on' : ''}" data-passive="${k}"><i class="dot"></i><div><b>${p.name}</b><span>${p.desc}</span></div></button>`).join('');
  // abilities for the piece on the turntable
  const p = PIECES[loPiece], sig = ABILITIES[p.sig];
  $('#equips').innerHTML = `<div class="eq-tabs" role="tablist">${chips}</div>
    <div class="eq-sigcard"><img class="dia" src="${diagram(loPiece, p.sig, 72, skin)}" alt=""><div><span class="tag t-sig">Signature</span><b>${sig.name}</b><p>${sig.desc}</p></div></div>
    <div class="ab-grid">${p.equips.filter((e) => ABILITIES[e]).map((e) => { const A = ABILITIES[e], on = profile.build.equips[loPiece] === e; return `<button class="ab-card ${on ? 'on' : ''}" data-equip="${loPiece}:${e}" aria-pressed="${on}"><img class="dia" src="${diagram(loPiece, e, 96, skin)}" alt=""><b>${A.name}</b><span>${A.desc}</span><em><svg><use href="#m-clock"/></svg>Cooldown ${A.cd}</em>${on ? '<svg class="pcheck"><use href="#m-check"/></svg>' : ''}</button>`; }).join('')}</div>`;
}
function onLoadoutClick(e) {
  const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.lopiece) { if (b.dataset.lopiece !== loPiece) { loPiece = b.dataset.lopiece; sfx.tap(); renderLoadout(); } return; }
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
// 10.0 (A7): the Store, Crown Path, Trophies, Profile, reveal and daily login UI live in storeui.js.
const armoryPreviews = { list: [], active: false }; // kept for anything that still reads it
function renderArmory() { SUI.renderStore(); }
function reveal(kind, id) { SUI.revealItems([[kind, id]]); }
function renderPlay() {
  // 10.0 (A8): illustrated mode cards (art, glyph, tagline, player count) in a snap carousel, plus a detail strip.
  const dailyDone = profile.daily.date === today();
  const modesEl = $('#modes'), prevScroll = modesEl.scrollLeft;
  modesEl.innerHTML = Object.entries(MODES).map(([k, m], i) => {
    const a = modeArt(k, m, i), on = profile.mode === k;
    const chip = k === 'daily' && !dailyDone ? '<span class="chip">TODAY</span>' : m.icon ? '<span class="chip new">NEW</span>' : '';
    return `<button class="mode ${on ? 'on' : ''}" data-mode="${k}" aria-pressed="${on}" style="--m1:${a.c1};--m2:${a.c2}"><span class="m-art"><img class="mi" src="${pieceIcon(a.piece, a.skin, null, 120)}" alt=""></span><span class="m-glyph"><svg><use href="#${a.icon}"/></svg></span>${chip}<b>${m.name}</b><p>${esc(a.tag)}</p><span class="m-who">${a.who}</span>${on ? '<svg class="pcheck"><use href="#m-check"/></svg>' : ''}</button>`;
  }).join('');
  modesEl.scrollLeft = prevScroll;
  const cur = modesEl.querySelector('.mode.on');
  if (cur && !renderPlay.seen) { renderPlay.seen = true; requestAnimationFrame(() => cur.scrollIntoView({ inline: 'center', block: 'nearest' })); }
  {
    const m = MODES[profile.mode] || MODES.royale, a = modeArt(profile.mode, m), facts = [a.who];
    if (m.turnMs) facts.push(`${Math.round(m.turnMs / 1000)}s turns`);
    if (m.teams) facts.push(`Teams of ${m.teams}`);
    if (m.siege) facts.push(m.siege.gauntlet ? `${m.siege.waves} bosses` : `${m.siege.waves} waves`); else if (m.storm && m.storm.first < 900) facts.push(`Storm from round ${m.storm.first}`);
    $('#mode-detail').innerHTML = `<div class="md-glyph" style="--m1:${a.c1};--m2:${a.c2}"><svg><use href="#${a.icon}"/></svg></div><div class="md-body"><b>${m.name}</b><p>${m.desc}</p><div class="md-facts">${facts.map((f) => `<span>${f}</span>`).join('')}</div></div>`;
  }
  const M = profile.mode;
  const rb = $('#in-bots'), lb = $('#opt-bots .lbl');
  const cfg = (MODES[M] && MODES[M].bots) ? { step: 1, ...MODES[M].bots } : M === 'siege' ? { min: 0, max: 3, step: 1, def: 3, label: 'Bot Allies' } : M === 'squads' ? { min: 3, max: 7, step: 2, def: 7, label: 'Bots (you get a bot teammate)' } : { min: 1, max: 7, step: 1, def: 7, label: 'Opponents' };
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
  $('#solo-loadout').innerHTML = `<img src="${pieceIcon('pawn', profile.skin, '#d6b05c', 64)}" alt=""><div class="lm-t"><small>Your loadout</small><b>${esc(profile.name)}</b><span>${b.preset ? PRESETS[b.preset].name : 'Custom'} build - ${PASSIVES[b.passive].name} - ${SKINS[profile.skin].name} - ${FINISHERS[profile.finisher].name}</span></div><svg class="lm-go"><use href="#m-chev"/></svg>`;
}

// ---------- crown path ----------
function renderPath() { SUI.renderPath(); }
function renderTrophies() { SUI.renderTrophies(); }

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
    // B2 10.1: progress pips and a one-line preview of what comes next
    const nDone = LESSONS.filter((l) => profile.tutorial.includes(l.id)).length, nxt = LESSONS[idx + 1];
    $('#lesson-pips').innerHTML = LESSONS.map((l) => `<i class="${profile.tutorial.includes(l.id) ? 'on' : ''}"${l === lesson ? ' style="--c:var(--cyan)"' : ''}></i>`).join('');
    $('#lesson-count').textContent = `${nDone} of ${LESSONS.length} lessons complete`;
    const up = (n, b) => `<div style="font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--cyan)">Up next</div><div style="font-weight:700;font-size:16px;margin:2px 0">${n}</div><div style="font-size:13px;color:var(--mute)">${b}</div>`;
    $('#lesson-next').innerHTML = nxt ? up(nxt.name, nxt.blurb) : up('Graduation', 'A real match against 2 easy bots.');
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
  sess.emote = (k) => hostEmote(sess, 'me', k); sess.chat = (m) => hostChat(sess, 'me', m);
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
  const d = DISCOVERIES[id];
  director.say({ text: d.name, sub: d.desc, kicker: 'Combo discovered', tags: ['+60 Marks'], color: '#7fe0ff', tier: 'disc', prio: 56, key: 'disc' + id, ttl: 6000 });
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
  try { voice.stop(true); chat.clearMatch(); } catch {}
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
// 10.2 (N): quick chat. Everything a client sends is validated, cleaned and rate-limited here (js/chat.js hostCheck);
// team-only lines are routed to the sender's team; a throttled sender is told to slow down.
function hostChat(sess, pid, raw) {
  if (!sess || !sess.host) return;
  const r = chatHostCheck((sess.chatRL ||= {}), pid, raw, sess.host.s); if (!r) return;
  if (r.slow) { if (pid === sess.myPid) chat.slow(); else { const c = sess.conns && sess.conns.get(pid); if (c) c.send({ t: 'chat', a: 'slow' }); } return; }
  const out = r.out, team = out.team; delete out.team;
  const teamOf = (p) => { const u = sess.host.s.units.find((v) => v.pid === p && v.kind === 'player'); return u ? u.team : undefined; };
  for (const c of sess.conns ? sess.conns.values() : []) if (team == null || teamOf(c.pid) === team) c.send(out);
  if (team == null || teamOf(sess.myPid) === team) game.onMsg(out);
}
function hostEmote(sess, pid, k) { hostChat(sess, pid, { k }); }
const pick = (a) => a[Math.floor(Math.random() * a.length)];
function botChatter(sess, m) {
  if (!m.ev || !sess.host) return;
  for (const e of m.ev) {
    if (e.e !== 'death') continue;
    const k = e.by != null && sess.host.s.units.find((v) => v.id === e.by), d = sess.host.s.units.find((v) => v.id === e.id);
    if (k && k.bot && Math.random() < 0.4) setTimeout(() => session === sess && hostChat(sess, k.pid, { k: pick(BOT_LINES.kill) }), 900);
    else if (d && d.bot && d.kind === 'player' && Math.random() < 0.3) setTimeout(() => session === sess && hostChat(sess, d.pid, { k: pick(BOT_LINES.win) }), 1300);
  }
}

function startSolo(bots = null, modeArg = null) {
  endSession();
  const mode = modeArg || profile.mode || 'royale';
  let n = bots ?? +$('#in-bots').value;
  if (mode === 'duel') n = 1;
  if (mode === 'daily') n = 7;
  if (mode === 'squads') { n = Math.max(3, Math.min(7, n)); if (n % 2 === 0) n++; }
  if (mode === 'siege' || (MODES[mode] && MODES[mode].siege)) n = Math.max(0, Math.min(3, n));
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
  sess.emote = (k) => hostEmote(sess, 'me', k); sess.chat = (m) => hostChat(sess, 'me', m);
  game.enter();
  sess.host.start();
}

// 10.0 (A8): player cards in seats, with open seats shown (as divs, so `li` count stays the player count).
function lobbyHTML(players, host, gm = 'royale', maxP = 0) {
  const M = MODES[gm] || {}, T = M.teams;
  const col = (i) => (T ? TEAM_COLORS[Math.floor(i / T) % 4] : (settings.cb ? CB_COLORS : PLAYER_COLORS)[i % 8]);
  const cards = players.map((p, i) => `<li class="pcard ${p.pid === 'me' ? 'host' : ''} ${p.isBot ? 'bot' : ''}" data-pid="${esc(p.pid)}" style="--c:${col(i)};animation-delay:${i * 0.04}s">${T ? `<span class="team-tag">Team ${Math.floor(i / T) + 1}</span>` : M.siege || gm === 'siege' ? '<span class="team-tag">Ally</span>' : ''}<span class="pc-av"><img src="${pieceIcon('pawn', p.skin, null, 44)}" alt=""></span><b>${esc(p.name)}${p.title ? `<span class="ttl">${esc(p.title)}</span>` : ''}</b><em>${p.pid === 'me' ? '<svg><use href="#m-crown"/></svg>Host' : p.isBot ? '<svg><use href="#m-bot"/></svg>Bot' : 'Player'}</em>${host && p.pid !== 'me' ? `<button data-kick="${p.pid}" aria-label="Remove ${esc(p.name)}" title="Remove">&times;</button>` : ''}</li>`).join('');
  const open = Math.max(0, Math.min(8, maxP) - players.length);
  return cards + Array.from({ length: open }, (_, j) => { const i = players.length + j; return `<div class="pcard open" style="--c:${col(i)}"${T ? ` data-team="Team ${Math.floor(i / T) + 1}"` : ''}><span class="pc-av"><svg><use href="#m-plus"/></svg></span><b>Open seat</b><em>${host ? 'Waiting' : ''}</em></div>`; }).join('');
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
    $('#host-lobby').innerHTML = lobbyHTML(sess.players, true, sess.gameMode, sess.maxP);
    $('#lobby-count').textContent = `${MODES[sess.gameMode].short} - ${sess.players.length}/${sess.maxP}`;
    $('#btn-start-host').disabled = sess.players.length < Math.max(2, MODES[sess.gameMode].players[0]);
    const pub = sess.players.map(({ pid, name, skin, isBot, title }) => ({ pid, name, skin, isBot, title }));
    for (const c of sess.conns.values()) c.send({ t: 'lobby', players: pub, code, mode: sess.gameMode });
    voice.hostSync(sess); voice.changed();
  };
  sess.renderLobby = renderLobby;
  sess.emote = (k) => hostEmote(sess, 'me', k); sess.chat = (m) => hostChat(sess, 'me', m);
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
            conn.send({ t: 'welcome', pid }); voice.hostSync(sess);
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
        else if (m.t === 'chat' && conn.pid) hostChat(sess, conn.pid, m);
        else if (m.t === 'vc' && conn.pid) voice.hostMsg(sess, conn.pid, m);
        else if (m.t === 'leave' && conn.pid && sess.host) { conn.left = true; sess.host.setBot(conn.pid); const u = sess.host.s.units.find((v) => v.pid === conn.pid); if (u) game.feed(`<b>${esc(u.name)}</b> forfeited - a bot takes over`); }
      });
      conn.onClose(() => {
        if (!conn.pid) return;
        sess.conns.delete(conn.pid); voice.hostDrop(sess, conn.pid);
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
      else if (m.t === 'lobby') { sess.lobby = Array.isArray(m.players) ? m.players : []; voice.changed(); $('#join-lobby-panel').classList.remove('hidden'); $('#join-lobby').innerHTML = lobbyHTML(m.players, false, m.mode, ((MODES[m.mode] || MODES.royale).players || [2, 8])[1]); $('#join-lobby-panel .lbl').textContent = `Lobby - ${(MODES[m.mode] || MODES.royale).name}`; }
      else if (m.t === 'full' || m.t === 'bye') { sess.byeReason = m.reason || 'full'; st.textContent = { full: 'That lobby is full.', started: 'That match has already started.', kicked: 'The host removed you from the lobby.', ended: 'The host ended the match.' }[sess.byeReason] || 'Disconnected.'; st.classList.add('err'); $('#join-lobby-panel').classList.add('hidden'); $('#join-lobby').innerHTML = ''; if (screen === 'game') { toast(st.textContent); game.showResults(true, 'hostleft'); } }
      else if (m.t === 'start') { sess.myPid = m.pid; matchKey = 'm' + Date.now(); game.enter(); }
      else if (m.t === 'state' || m.t === 'emote' || m.t === 'chat') game.onMsg(m);
      else if (m.t === 'vc') voice.onMsg(m);
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
  sess.emote = (k) => sess.client.send({ t: 'chat', k }); sess.chat = (m) => sess.client.send({ ...m, t: 'chat' });
}

// ---------- game UI ----------
// Where the Crown spawned, in words (it lands on a random safe tile).
function crownWhere(s) {
  const c = s.items.find((i) => i.k === 'crown'); if (!c) return 'Has appeared on the board';
  const ns = c.y < 6 ? 'north' : c.y > 9 ? 'south' : '', ew = c.x < 6 ? 'west' : c.x > 9 ? 'east' : '';
  return ns || ew ? `Has appeared in the ${ns}${ns && ew ? '-' : ''}${ew}` : 'Has appeared near the centre';
}
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
    director.mount($('#s-game'), { cineLive: () => !!(this.r && this.r.cine), reduced: () => !!settings.motion, haptic: (p) => haptic(p), sound: (n, lvl) => (n === 'stinger' ? sfx.stinger(lvl || 1) : playNamed(n)) });
    this.r.dir = director; // canvas cine, banners and floats ask the Director where they may draw
    $('#ult-btn').insertAdjacentHTML('beforeend', '<i class="ult-sweep"></i>');
    let last = performance.now();
    const loop = (now) => { requestAnimationFrame(loop); try { loopBody(now); } catch (err) { console.error(err); } };
    const loopBody = (now) => {
      const dt = Math.min(0.05, (now - last) / 1000); last = now;
      if (screen === 'game') { director.tick(); if (this.potmOn && this.potmR) this.potmR.frame(dt); else { this.r.frame(dt); if (this.r.loupe) TAP.drawLoupe(this.r); } this.tickTimer(); this.heartbeat(dt); }
      SUI.frame(dt);

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
    // 10.2 (N): quick chat picker (js/chat.js) owns #emote-menu; voice (js/voice.js) adds the Talk button and lobby panels
    const names = () => { const n = {}; for (const p of (session && (session.players || session.lobby)) || []) n[p.pid] = p.name; if (this.s) for (const u of this.s.units) if (u.kind === 'player') n[u.pid] = u.name; return n; };
    chat.mount({ profile: () => profile, save, settings, saveSettings, activeEmotes, game: this, session: () => session, toast, sfx, director, voice });
    voice.mount({ session: () => session, toast, game: this, sfx, screen: () => screen, names, onChange: () => { if (!$('#emote-menu').classList.contains('hidden') && chat.tab === 'players') chat.render(); } });
    this.renderEmotes = () => chat.render();
    $('#h-portrait').parentElement.addEventListener('click', () => { const u = this.me; if (u) { this.r.closeup(); this.r.follow = false; this.r.focus(u.x, u.y); sfx.tap(); } });
    $('#ult-btn').addEventListener('click', () => { if (this.suppress) { this.suppress = false; return; } this.onAction('ult'); });
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
    $('#h-feed').innerHTML = ''; $('#emote-menu').classList.add('hidden'); chat.resetSession(session && (session.code || session)); chat.clearMatch(); voice.changed();
    director.reset(); this.juice = {}; this.hillWarned = {};
    go('game');
    music.newMatch();
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
    if (m.t === 'chat') { chat.receive(m); return; }
    if (m.t === 'emote') { const u = this.s && unitById(this.s, m.id); if (u && own(EMOTES, m.k)) chat.receive({ t: 'chat', id: m.id, pid: u.pid, k: m.k }); return; }
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
    if (!this.resultsShown) music.match(this.s, this.me); // A2: picks theme (royale/blitz/duel/squads/siege/boss/final/king) + stingers from state
    if (this.spec) this.updateSpec();
    if (first) this.lastAlive = alive;
    if (alive === 2 && this.lastAlive > 2 && !this.s.over) this.after(() => this.banner('Final Two', 'Only one walks away', 'red', { tier: 2, prio: 75, key: 'final', kicker: 'Endgame', level: 4, ttl: 4000 }), 900);
    this.lastAlive = alive;
    this.refresh();
  },
  handleEvents(ev, first) {
    const s = this.s, myId = this.r.myId;
    const tut = session && session.mode === 'tutorial';
    if (first) {
      if (!tut) {
        this.showContenders();
        this.after(() => s.siege ? this.banner('Hold the Line', `${s.siege.waves} waves. Survive together.`, 'cyan', { kicker: (MODES[s.mode] || {}).name, prio: 45, ttl: 4000 }) : this.banner('Round 1', s.teams ? 'Last team standing wins' : 'Last piece standing wins', '', { kicker: (MODES[s.mode] || {}).name, prio: 45, ttl: 4000 }), 2750);
        if (s.mutator && s.mutator !== 'none' && MUTATORS[s.mutator]) { const list = s.mutator === 'chaos' && Array.isArray(s.mutators) ? s.mutators.map((k) => (MUTATORS[k] || {}).name).filter(Boolean).join(' + ') : ''; this.after(() => this.banner(MUTATORS[s.mutator].name, list || MUTATORS[s.mutator].desc, 'cyan', { kicker: 'Hazard', prio: 38, ttl: 6000 }), 3000); }
        if (s.mirrorBuild && PASSIVES[s.mirrorBuild.passive]) this.after(() => this.banner('Mirror Match', `Everyone is ${PASSIVES[s.mirrorBuild.passive].name}`, 'cyan', { kicker: 'Same build for all', prio: 39, ttl: 6000 }), 3000);
      }
      return;
    }
    if (!tut) this.checkDiscoveries(ev);
    if (!tut) this.tips(ev);
    for (const e of ev) {
      if (e.e === 'dmg' && e.id === myId) { if (e.self) continue; const src = e.storm ? 'The storm' : e.meteor ? 'Meteors' : e.lava ? 'Lava' : e.trap ? 'A trap' : (unitById(s, e.src) || {}).name || 'Unknown'; this.taken[src] = (this.taken[src] || 0) + e.n; this.since[src] = (this.since[src] || 0) + e.n; }
      if (e.e === 'timeout' && e.id === myId) { toast('Time ran out - turn skipped'); sfx.error(); }
      if (e.e === 'turn' && e.id === myId) { const lines = Object.entries(this.since).sort((a, b) => b[1] - a[1]); if (lines.length) this.after(() => this.feed(`<span class="x">Since your last turn:</span> ${lines.map(([n, v]) => `<b>${esc(n)}</b> -${v}`).join(', ')}`), 600); this.since = {}; const mu = unitById(s, myId); if (mu) { this.r.follow = true; this.after(() => this.r.focus(mu.x, mu.y), 350); } }
      if (e.e === 'turn' && e.id === myId) this.after(() => { if (!tut) this.banner('Your Turn', 'Round ' + s.round, ''); sfx.turn(); $('#h-actions').classList.remove('myturn'); void $('#h-actions').offsetWidth; $('#h-actions').classList.add('myturn'); }, 250);
      if (e.e === 'storm') this.after(() => e.phase === 'crack' ? this.banner('The Storm Gathers', 'The outer ring collapses next round', 'red', { kicker: 'Storm', key: 'storm', prio: 48 }) : this.banner('Collapse', s.storm.ring >= STORM.maxRing ? 'Sudden death - everyone burns' : 'Stay inside the ring', 'red', { kicker: 'Storm', key: 'storm', prio: 52 }), 200);
      if (e.e === 'crownSpawn') this.banner('The Crown', crownWhere(s), '', { kicker: 'Round ' + s.round, prio: 50 });
      if (e.e === 'world' && !(e.kind === 'meteor' && e.phase === 'strike') && WORLD_EVENTS[e.kind]) { const W = WORLD_EVENTS[e.kind]; const mine = e.kind === 'bounty' && e.id === myId; this.after(() => this.banner(mine ? 'A Price On Your Head' : W.name, mine ? 'Whoever takes you gets 3 shards' : W.desc, e.kind === 'meteor' || e.kind === 'bloodMoon' || mine ? 'red' : 'cyan', { kicker: 'World event', key: 'world', prio: mine ? 58 : 50, tier: mine ? 2 : 1 }), 300); }
      if (e.e === 'ability' && e.id === myId && e.slot === 'ult') this.ms.ults++;
      if (e.e === 'crowned' && e.id === myId) { this.ms.crown = true; this.ms.pieces.push('king'); }
      if (e.e === 'promote' && e.id === myId && e.type === 'evolve') this.ms.pieces.push(e.piece);
      if (e.e === 'revive' && e.by === myId) this.ms.revives++;
      if (e.e === 'death' && (unitById(s, e.id) || {}).boss && this.me && (this.me.alive || s.siege)) this.ms.colossi++;
      if (e.e === 'promote' && e.id === myId && e.piece === 'rook') this.ms.rook = true;
      if (e.e === 'promote' && e.id === myId && e.piece === 'queen') this.ms.queen = true;
      if (e.e === 'attune' && e.id === myId) { const p = $('#h-attune'); p.classList.remove('bump'); void p.offsetWidth; p.classList.add('bump'); }
      if (e.e === 'death' && e.by === myId) { const v = unitById(s, e.id); if (v && v.kind === 'hollow') this.ms.hollows++; else if (v) this.ms.kills++; }
      if (e.e === 'crowned') { const u = unitById(s, e.id); if (u) this.banner(u.id === myId ? 'You Are King' : 'A New King', u.id === myId ? 'Everyone is coming for you' : `${u.name} wears the Crown`, '', { kicker: 'The Crown', key: 'crown', tier: u.id === myId ? 3 : 2, prio: u.id === myId ? 84 : 64, level: 3 }); }
      if (e.e === 'promote' && e.id === myId) this.after(() => this.banner(e.type === 'evolve' ? PIECES[e.piece].name : 'Honed', e.type === 'evolve' ? 'Evolution complete' : `${PIECES[e.piece].name} level ${e.hone}`, 'cyan', { kicker: e.type === 'evolve' ? 'Promotion' : 'Hone', key: 'promote', prio: 44 }), 300);
      if (e.e === 'death') {
        const v = unitById(s, e.id); if (!v || v.kind !== 'player') continue;
        const k = e.by ? unitById(s, e.by) : null;
        const ico = (u) => `<img src="${pieceIcon(u.piece, u.skin, null, 18)}" alt="">`;
        this.after(() => this.feed(k && k.id !== v.id ? `${ico(k)}<b style="color:${k.color}">${esc(k.name)}</b><span class="x">took</span>${ico(v)}<b style="color:${v.color}">${esc(v.name)}</b>` : `${ico(v)}<b style="color:${v.color}">${esc(v.name)}</b><span class="x">${e.cause === 'meteor' ? 'was crushed by a meteor' : e.cause === 'lava' ? 'burned in the lava' : e.cause === 'trap' ? 'was caught in a trap' : e.cause === 'geyser' ? 'was launched by a geyser' : e.cause === 'crumble' ? 'fell through the floor' : e.cause === 'earthquake' ? 'was swallowed by the quake' : k && k.kind === 'hollow' ? 'was overrun by Hollows' : 'fell to the storm'}</span>`, 'death' + e.id), 400);
        if (e.shutdown && k) this.after(() => this.announce('Shutdown', `${k.name} ended ${v.name}'s streak`, k.color, 'shutdown', 3, { group: 'k' + k.id, kicker: 'Streak ended', tier: 2, prio: 78 }), 700);
        if (e.regicide && k) this.after(() => this.announce('Regicide', `${k.name} toppled the King`, '#ffd24d', 'regicide', 5, { group: 'k' + k.id, kicker: 'The Crown shatters', tier: 3, prio: 88 }), 700);
        if (s.teams && !s.over && e.id !== myId && this.me && ally(this.me, v) && this.me.alive) this.after(() => this.banner('Ally Down', 'Step on their soul within 3 rounds to revive them', 'red', { kicker: v.name, prio: 60, key: 'ally' + v.id }), 900);
        if (e.id === myId) { this.killedBy = k && k.id !== myId ? k : null; if (!s.over) this.after(() => this.showDead(), 1700); }
      }
      if (e.e === 'multi') { const k = unitById(s, e.id); if (k) this.after(() => this.announce(e.n >= 4 ? 'Massacre' : e.n === 3 ? 'Triple Take' : 'Double Take', k.name, k.color, 'multi', e.n + 1, { group: 'k' + k.id, kicker: `${e.n} in one move`, tier: e.n >= 3 ? 3 : 2, prio: e.n >= 4 ? 92 : e.n === 3 ? 84 : 70, nameSub: true }), 900); }
      if (e.e === 'final') this.after(() => this.announce(e.teams ? 'Final Two Teams' : 'Final Two', 'One move from glory', '#ff6b6b', 'final', 4, { key: 'final', kicker: 'Endgame', tier: 2, prio: 75 }), 1300);
      if (e.e === 'revive') { const v = unitById(s, e.id), b = unitById(s, e.by); if (v && b) { this.after(() => this.feed(`<b style="color:${b.color}">${esc(b.name)}</b><span class="x">revived</span><b style="color:${v.color}">${esc(v.name)}</b>`), 300); if (e.id === myId || e.by === myId) this.after(() => this.announce(e.id === myId ? 'You Are Back' : 'Revived', e.id === myId ? `${b.name} pulled you back` : `${v.name} rejoins the fight`, '#6dffa8', 'revive', 3, { kicker: 'Revive', tier: 2, prio: 62, key: 'revive' + e.id }), 500); if (e.id === myId) { $('#m-dead').classList.add('hidden'); if (this.spec) this.stopSpectate(); } } }
      if ((e.e === 'soulDeny' || e.e === 'soulFade') && e.of === myId) this.after(() => this.showDead(true), 700);
      if (e.e === 'death' && this.me && !this.me.alive && e.id !== myId && ally(this.me, unitById(s, e.id) || {})) this.after(() => this.showDead(true), 1900);
      if (e.e === 'soulDeny') { const k = unitById(s, e.id), v = unitById(s, e.of); if (k && v) this.after(() => this.feed(`<b style="color:${k.color}">${esc(k.name)}</b><span class="x">shattered the soul of</span><b style="color:${v.color}">${esc(v.name)}</b>`), 300); }
      if (e.e === 'trap' && e.id === myId) this.after(() => toast('Trapped! You lost initiative.'), 300);
      if (e.e === 'wave' && e.phase === 'start') this.after(() => e.boss ? this.announce((s.units.find((u) => u.alive && u.boss) || { name: 'The Colossus' }).name, 'has come for the line', '#b98cff', 'boss', 5, { key: 'wave', kicker: `Wave ${e.n} - Boss`, tier: 3, prio: 85 }) : this.banner(`Wave ${e.n} of ${e.of}`, 'Hollows incoming from the edges', 'red', { kicker: 'Siege', key: 'wave', prio: 55 }), 300);
      if (e.e === 'wave' && e.phase === 'clear') this.after(() => this.banner('Wave Cleared', `Everyone heals ${s.siege && s.siege.gauntlet ? 35 : 20}%. ${e.boss ? 'A boss comes next.' : 'Next wave soon.'}`, 'cyan', { kicker: `Wave ${e.n || ''}`.trim(), key: 'wave', prio: 50 }), 400);
      // 10.0 content callouts (A9)
      if (e.e === 'msg' && e.text) this.after(() => this.banner(e.text, e.sub || '', e.tone || '', { prio: 46, key: 'msg' + e.text }), 250);
      if (e.e === 'hill' && (e.phase === 'score' || e.phase === 'contested') && s.hill) {
        const goal = e.goal || s.hill.goal, n = e.n ?? (s.hill.score || {})[e.id] ?? 0, u = unitById(s, e.id);
        if (e.id === myId) this.feed(`<b style="color:#ffd24d">+${e.add || 1} Throne</b><span class="x">${e.phase === 'contested' ? 'contested - ' : ''}${n} / ${goal}</span>`, 'hill-me' + n);
        this.hillWarned = this.hillWarned || {};
        if (u && goal && n >= goal - 2 && n < goal && !this.hillWarned[u.id]) { this.hillWarned[u.id] = 1; this.after(() => this.banner(u.id === myId ? 'Almost King Of The Hill' : `${u.name} Is Close`, u.id === myId ? `${n} of ${goal} - hold the throne` : `${n} of ${goal} - knock them off the throne`, u.id === myId ? '' : 'red', { kicker: 'King of the Hill', key: 'hill', tier: 2, prio: 66 }), 200); }
      }
      if (e.e === 'bountyClaim') { const k = unitById(s, e.id), v = unitById(s, e.of); if (k) this.feed(`<b style="color:${k.color}">${esc(k.name)}</b><span class="x">claimed the bounty${v ? ' on' : ''}</span>${v ? `<b style="color:${v.color}">${esc(v.name)}</b>` : ''}<span class="x">+${e.n || 0} shards</span>`, 'bounty'); if (e.id === myId) this.announce('Bounty Claimed', `+${e.n || 0} shards`, '#ffd24d', null, 3, { kicker: 'Payday', tier: 2, prio: 64, group: 'k' + e.id }); }
      if (e.e === 'enrage') { const u = unitById(s, e.id); if (u && !this.juice.enraged) { this.juice.enraged = 1; this.after(() => this.banner(`${u.name} Enrages`, 'Faster and stronger every round', 'red', { kicker: 'Boss', key: 'enrage', tier: 2, prio: 68 }), 300); } }
      if (e.e === 'shieldBreak') { const u = unitById(s, e.id); if (u) this.feed(`<b style="color:#9df3ff">Shield broken</b><span class="x">${esc(u.name)}</span>`, 'shield' + e.id); }
      if (e.e === 'summon') this.after(() => this.banner('The Dead Rise', `${(unitById(s, e.id) || { name: 'The Regent' }).name} raises the fallen`, 'violet', { kicker: 'Boss', key: 'summon', tier: 2, prio: 70 }), 300);
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
    clearTimeout(this.ctT); this.ctT = setTimeout(() => { el.classList.add('hidden'); director.release(); }, 2700);
    director.hold(2700);
    el.onclick = () => { el.classList.add('hidden'); director.release(); };
  },
  tip(id, html) {
    profile.tips = profile.tips || [];
    if (profile.tips.includes(id) || this.resultsShown || (session && session.mode === 'tutorial')) return;
    // queued in the Director's hint lane; only marked as seen once it is actually on screen
    const gen = this.gen;
    director.hint(html, { kind: 'tip', id, icon: pieceIcon('king', 'gilded', null, 34), onShow: () => { if (gen !== this.gen) return; profile.tips = profile.tips || []; if (!profile.tips.includes(id)) { profile.tips.push(id); save(); } } });
  },
  tips(ev) {
    const s = this.s, me = this.me; if (!me) return;
    for (const e of ev) {
      if (e.e === 'turn' && e.id === me.id && s.turnNo <= 30) this.after(() => this.tip('first-turn', '<b>Your move.</b> Tap a blue tile to move, then pick an action. Hold an action button to see what it does.'), 900);
      if (e.e === 'storm' && e.phase === 'crack') this.after(() => this.tip('storm', '<b>The storm is coming.</b> Red cracked tiles collapse next round. Get toward the middle.'), 1800);
      if (e.e === 'world') this.after(() => this.tip('world', '<b>World event!</b> One hits every few rounds. Check the banner and adapt.'), 2000);
      if (e.e === 'ultReady' && e.id === me.id) this.after(() => this.tip('ult', '<b>Ultimate ready.</b> Tap the gold button on your turn. Save it for a crowd or a finishing blow.'), 1200);
      if (e.e === 'crownSpawn') this.after(() => this.tip('crown', '<b>The Crown appeared.</b> Whoever holds it is tougher, but slow, and everyone will hunt them. Kill the King and the Crown shatters into 4 shards.'), 1800);
      if (e.e === 'steadfast' && e.id === me.id) this.after(() => this.tip('steadfast', '<b>Steadfast!</b> Before round 6, a full-HP piece survives any single hit. After that there is no safety net, so evolve early.'), 900);
      if (e.e === 'pickup' && e.id === me.id && e.k === 'shard') this.after(() => this.tip('shard', '<b>Shard collected.</b> Two shards make you a Knight or Bishop: tap Promote. Every shard also attunes you for the rest of the match.'), 900);
    }
    if (!profile.tips?.includes('hollow') && s.units.some((v) => v.kind === 'hollow' && v.alive && !v.hunt && !v.boss && Math.max(Math.abs(v.x - me.x), Math.abs(v.y - me.y)) <= 3)) this.tip('hollow', '<b>A Hollow.</b> Neutral ghosts guard shard caches. They wake when you get close and drop 2 shards.');
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
    const n = e.firstBlood ? 1 : e.streak;
    this.announce(text, k.name, k.color, null, n, { group: 'k' + k.id, kicker: e.firstBlood ? 'Opening kill' : `${e.streak} eliminations`, tier: n >= 4 ? 3 : 2, prio: e.firstBlood ? 66 : n >= 4 ? 78 + n : 66 + n * 2, nameSub: true });
  },
  // Announcer: every callout goes through the Director (js/announcer.js): one hero lane, prioritised, merged per killer.
  // o: { tier 1|2|3, prio, group, key, kicker, tags, nameSub (sub is a player name, tint it) }
  announce(text, sub, color, sting, level = 3, o = {}) {
    if (!this.s) return;
    const tier = o.tier || (level >= 4 ? 3 : 2);
    director.say({ text, sub, color, sting, level, tier, prio: o.prio ?? (50 + level * 6), group: o.group, key: o.key, kicker: o.kicker, tags: o.tags, ttl: o.ttl ?? 3600,
      subHtml: o.nameSub && sub ? `<b style="color:${color}">${esc(sub)}</b>` : o.subHtml, haptic: tier >= 2 ? [20, 30, 40] : null });
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
  // Screen banners (tier 1 information) share the Director's hero lane with callouts and the ultimate cine.
  banner(main, sub, tone, o = {}) {
    if (main === 'Your Turn') { director.turn('Your Turn', sub || ''); return; }
    const color = tone === 'red' ? '#ff5a6a' : tone === 'cyan' ? '#7fe0ff' : tone === 'violet' ? '#b98cff' : '#ffd24d';
    director.say({ text: main, sub, color, tone, tier: o.tier || 1, prio: o.prio ?? 40, key: o.key || main, kicker: o.kicker, ttl: o.ttl ?? 2600, level: o.level, sting: o.sting, group: o.group });
    this.bannerAt = performance.now();
  },
  feed(html, key) { director.feed(html, key); },
  // HUD micro-interaction: restart a one-shot CSS class (skipped with reduced motion)
  pulse(el, cls, ms = 800) { if (!el || settings.motion) return; el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls); clearTimeout(el['_p' + cls]); el['_p' + cls] = setTimeout(() => el.classList.remove(cls), ms); },
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
      if (pro) { const gain = Math.round(PIECES[pro.to].hp - PIECES[u.piece === 'king' ? 'queen' : u.piece].hp); if (gain > 0) extra = `<small>Evolve to ${PIECES[pro.to].name}: about +${gain} HP</small>`; }
      lt.innerHTML = `<b>${sure ? 'LETHAL' : 'DANGER'}</b>${esc(t0 ? t0.name : 'An enemy')}${thr.length > 1 ? ` +${thr.length - 1}` : ''} can ${sure ? 'KO' : 'crit'} you next turn${extra}`;
      lt.className = 'lethal ' + (sure ? 'sure' : '');
      if (sure && this.myTurn() && this.lethalWarned !== s.turnNo) { this.lethalWarned = s.turnNo; sfx.warn(); haptic([40, 40, 40]); }
    } else lt.className = 'lethal hidden';
    if (this.myTurn()) {
      if (this.mode === 'move') this.r.overlay = canMove(s, u) ? { moves: legalMoves(s, u), from: { x: u.x, y: u.y } } : null;
      else { const opts = this.options(); if (this.preview) this.preview = opts.find((o) => o.anchor.x === this.preview.anchor.x && o.anchor.y === this.preview.anchor.y) || null; this.r.overlay = { opts, preview: this.preview }; }
    } else this.r.overlay = null;
    this.syncPending();
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
    const oh = order.map((id) => { const v = unitById(s, id); if (!v) return ''; return `<div class="o ${u && v.id === u.id ? 'me' : u && ally(u, v) ? 'ally' : v.kind === 'hollow' ? 'foe-hollow' : ''}" style="--c:${v.kind === 'player' ? v.color : '#555'}"><img src="${pieceIcon(v.piece, v.skin, null, 36)}" alt=""></div>`; }).join('');
    const ok = order.map((id) => { const v = unitById(s, id); return v ? id + v.piece + v.skin + v.color : id; }).join(',');
    const ordEl = $('#h-order');
    if (ordEl.dataset.k !== ok) { const shifted = ordEl.dataset.first && ordEl.dataset.first !== String(order[0]); ordEl.innerHTML = oh; ordEl.dataset.k = ok; ordEl.dataset.first = order[0]; if (shifted && !settings.motion) { ordEl.classList.remove('shift'); void ordEl.offsetWidth; ordEl.classList.add('shift'); } }
    if (!u) return;
    const stt = stats(u);
    { const url = pieceIcon(u.piece, u.skin, u.color, 56), pe = $('#h-portrait'); if (pe._u !== url) { pe.src = url; pe._u = url; pe.style.setProperty('--c', u.color); } } // only re-decode when the icon changes (pieceIcon upgrades placeholders later)
    $('#h-name').textContent = u.name;
    const hone = u.hone[u.piece] || 0;
    $('#h-hone').innerHTML = '<i></i>'.repeat(hone);
    $('#h-piece').textContent = PIECES[u.piece] ? PIECES[u.piece].name : '';
    const r = Math.max(0, u.hp / stt.maxHp);
    const hp = $('#h-hp'); hp.style.width = r * 100 + '%'; hp.className = r > 0.5 ? '' : r > 0.25 ? 'mid' : 'low';
    $('#h-hpghost').style.width = r * 100 + '%';
    if (this.lastHp != null && u.hp < this.lastHp) { const c = $('#h-card'); c.classList.remove('hit'); void c.offsetWidth; c.classList.add('hit'); this.pulse(hp.parentElement, 'hit'); }
    if (this.lastHp != null && u.hp > this.lastHp && u.alive) this.pulse(hp.parentElement, 'heal');
    $('#h-card').classList.toggle('low', u.alive && r < 0.3);
    this.lastHp = u.hp;
    $('#h-hptext').textContent = `${Math.max(0, u.hp)} / ${stt.maxHp}`;
    const defBuff = u.buffs.some((b) => b.k === 'def'), spdBuff = u.buffs.some((b) => b.k === 'spd' && b.v > 0);
    const atkBuff = u.buffs.some((b) => b.k === 'atk') || (u.passive === 'laststand' && u.hp < stt.maxHp * 0.3); $('#h-stats').innerHTML = `<span class="${atkBuff ? 'up' : ''}">ATK <b>${stt.atk}${atkBuff ? '+' : ''}</b></span><span class="${defBuff ? 'up' : ''}">DEF <b>${stt.def}${defBuff ? '+' : ''}</b></span><span class="${spdBuff ? 'up' : ''}">SPD <b>${Math.round(effSpd(u) * 10) / 10}</b></span><span>${PASSIVES[u.passive].name}</span>`;
    const popts = promoteOptions(u);
    const minCost = popts.length ? Math.min(...popts.map((p) => p.cost)) : 0;
    const shEl = $('#h-shards');
    if (shEl.textContent !== String(u.shards)) { const prev = +shEl.textContent || 0; if (u.shards > prev) { const g = this.gen, n = u.shards - prev; setTimeout(() => { if (g !== this.gen) return; countUp(shEl, prev, u.shards, 500); this.pulse(shEl, 'pop'); const tag = document.createElement('span'); tag.className = 'sh-gain'; tag.textContent = '+' + n; shEl.parentElement.appendChild(tag); setTimeout(() => tag.remove(), 950); }, 500); } else shEl.textContent = u.shards; }
    const evos = popts.filter((p) => p.type === 'evolve');
    const affordable = evos.filter((p) => p.cost <= u.shards);
    const target = affordable.length ? affordable[affordable.length - 1] : evos[0] || popts.find((p) => p.type === 'hone');
    const nextEvo = target && target.type === 'evolve' ? target : null;
    $('#h-shardprog').style.width = (target ? Math.min(1, u.shards / target.cost) * 100 : 100) + '%';
    $('#h-attune').textContent = `ATT ${u.attune || 0}`;
    const ub = $('#ult-btn'), up = Math.min(100, Math.round(u.ult || 0));
    $('#ult-fg').style.strokeDashoffset = 176 * (1 - up / 100);
    { const J = this.juice || (this.juice = {}); if (J.ult != null && up > J.ult && u.alive) { this.pulse(ub, 'gain'); if (up >= 100 && J.ult < 100) this.pulse(ub, 'burst', 900); } J.ult = up; }
    $('#ult-pct').textContent = up >= 100 ? 'READY' : up + '%';
    ub.classList.toggle('ready', up >= 100 && u.alive);
    ub.classList.toggle('on', this.myTurn() && this.mode === 'ult');
    ub.classList.toggle('hidden-ult', !u.alive);
    const chip = $('#event-chip');
    if (s.meteors && s.meteors.length) { chip.textContent = 'Meteors incoming'; chip.className = 'event-chip red'; }
    else if (s.bloodMoon) { chip.textContent = 'Blood Moon - damage +30%'; chip.className = 'event-chip red'; }
    else if (s.siege && s.siege.next && s.siege.wave < s.siege.waves) { chip.textContent = `Wave ${s.siege.wave + 1} next round${s.siege.wave + 1 === s.siege.waves || s.siege.wave + 1 === Math.floor(s.siege.waves / 2) ? ' - Colossus' : ''}`; chip.className = 'event-chip cyan'; }
    else if (this.me && !this.me.alive && s.items.some((i) => i.k === 'soul' && i.id === this.me.id)) { chip.textContent = 'Downed - waiting for a revive'; chip.className = 'event-chip red'; }
    else if (s.hill && s.hill.goal) { const sc = s.hill.score || {}, mine = sc[u.id] || 0; let lead = null; for (const [id, n] of Object.entries(sc)) if (+id !== u.id && (!lead || n > lead.n)) lead = { id: +id, n }; const lu = lead && unitById(s, lead.id); chip.textContent = `Throne ${mine}/${s.hill.goal}${lu && lead.n > 0 ? ` - ${lu.name} ${lead.n}` : ''}`; chip.className = 'event-chip' + (lead && lead.n >= s.hill.goal - 2 ? ' red' : ''); }
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
        { const J = this.juice || (this.juice = {}), k = 'cd' + slot; if (J[k] > 0 && u.cd[slot] === 0 && u.alive) { this.pulse(b, 'cdready', 1250); playNamed('ui:cdready'); } J[k] = u.cd[slot]; }
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
  // U 10.2: a board tap at canvas point (px, py) with the camera mapping frozen at touch-down (G.view). See js/input.js.
  tapAt(px, py, G) {
    unlockAudio();
    if (!$('#emote-menu').classList.contains('hidden')) { if (chat.close) chat.close(); else $('#emote-menu').classList.add('hidden'); }
    if (!this.s) return;
    const r = this.r, mode = this.mode;
    let wx, wy, z = G.view.z;
    const lw = !G.mouse && r.loupe && TAP.loupeWorld(r, px, py); // taps inside the loupe resolve at loupe precision
    if (lw) { wx = lw.wx; wy = lw.wy; z = lw.z; } else [wx, wy] = r.toWorld(px, py, G.view);
    const pend = this.tapPending || (mode !== 'move' && this.preview ? { x: this.preview.anchor.x, y: this.preview.anchor.y, mode } : null);
    const res = TAP.pick(this, wx, wy, z, pend && pend.mode === mode ? pend : null);
    if (!res.tile) { if (pend) this.clearPending(); return; }
    if (this.myTurn() && res.cand) {
      const c = res.cand;
      const confirm = !G.mouse && !settings.onetap && (mode !== 'move' || G.view.z < TAP.SMALL || G.force);
      if (!confirm || (pend && pend.mode === mode && pend.x === c.x && pend.y === c.y)) { this.clearPending(true); if (mode === 'move') { sfx.tap(); session.send({ type: 'move', x: c.x, y: c.y }); } else this.exec(c.opt); return; }
      this.setPending(c, G.view.z < TAP.SMALL); return;
    }
    if (pend) { this.clearPending(); if (res.how !== 'unit') return; }
    this.inspect(res.tile);
  },
  setPending(c, loupe) {
    const mode = this.mode;
    this.tapPending = { x: c.x, y: c.y, mode };
    if (mode !== 'move') this.preview = c.opt;
    const hurt = c.opt && c.opt.mult > 0;
    TAP.setLoupe(this.r, loupe ? c : null, mode === 'move' ? 'Tap again to move' : 'Tap again to confirm', mode === 'move' ? '#7fe0ff' : hurt ? '#ff8a7a' : '#c9a6ff');
    sfx.tap(); haptic(8); this.refresh();
  },
  clearPending(quiet) { this.tapPending = null; this.r.loupe = null; if (this.mode !== 'move') this.preview = null; if (!quiet) this.refresh(); },
  // keep the pending target, the move-path preview and the loupe in step with the overlay (turn, mode or state changed)
  syncPending() {
    const p = this.tapPending, ov = this.r.overlay;
    const ok = p && ov && p.mode === this.mode && (this.mode === 'move' ? (ov.moves || []).some((m) => m.x === p.x && m.y === p.y) : this.preview && this.preview.anchor.x === p.x && this.preview.anchor.y === p.y);
    if (!ok) { this.tapPending = null; this.r.loupe = null; return; }
    if (this.mode === 'move') ov.hover = ov.moves.find((m) => m.x === p.x && m.y === p.y);
  },
  // a touch on an informational card over the board (hint, inspect) dismisses it and still reaches the board,
  // but only as a preview: it never commits on its own
  passThrough(x, y) {
    let hit = false;
    for (const el of [$('#gm-tip'), $('#h-inspect')]) {
      if (!el || el.classList.contains('hidden')) continue;
      const b = el.getBoundingClientRect();
      if (x < b.left || x > b.right || y < b.top || y > b.bottom || getComputedStyle(el).visibility === 'hidden') continue;
      hit = true; if (el.id === 'gm-tip') director.dismissHint(); else { clearTimeout(this.inspT); el.classList.add('hidden'); }
    }
    return hit;
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
    director.dismissHint(); $('#h-inspect').classList.add('hidden'); $('#abinfo').classList.add('hidden');
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
    director.clearHints(); director.release(); $('#contenders').classList.add('hidden');
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
    { // 10.0 (A8): rank medal reveal + tone for the results card
      const tone = siege ? (win ? 'gold' : 'steel') : win ? 'gold' : place === 2 ? 'silver' : place === 3 ? 'bronze' : 'steel';
      const n = siege ? cleared : place, ord = (k) => (k % 100 >= 11 && k % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][k % 10] || 'th');
      $('#r-rank').innerHTML = `<div class="rk rk-${tone}"><svg class="rk-laurel"><use href="#m-laurel"/></svg><div class="rk-medal"><small>${siege ? 'Waves' : s.teams ? 'Team' : 'Place'}</small><b>${n}</b><span>${siege ? `of ${siege.waves}` : ord(n)}</span></div></div>`;
      const box = $('#r-box'); box.dataset.tone = win ? 'win' : close ? 'close' : 'lose'; box.classList.remove('reveal'); void box.offsetWidth; box.classList.add('reveal'); box.scrollTop = 0;
    }
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
    $('#r-xptext').innerHTML = xpGain ? `+<span id="rx">0</span> XP` : '';
    if (xpGain) setTimeout(() => { const el = $('#rx'); if (el) countUp(el, 0, xpGain, 1100); }, 750);
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
    music.set(0, 'results');
    if (win) { sfx.win(); confetti(); haptic([50, 50, 50, 50, 150]); } else sfx.lose();
    if (win && u.alive && u.hp / stats(u).maxHp < 0.1) setTimeout(() => discover('clutch'), 1500);
    if (!quit && session && session.graduation && !profile.tutorial.includes('graduation')) { profile.tutorial.push('graduation'); profile.marks += 100; save(); setTimeout(() => toast('Graduated! +100 Marks'), 1200); }
  },
  bindInput() {
    const c = $('#board');
    // A click listener makes the canvas a tap target, so Chrome's touch adjustment stops moving board taps onto nearby buttons (chat, ULT).
    c.addEventListener('click', () => {});
    // U 10.2: one gesture per first finger. A tap resolves at its touch-down point with the camera mapping frozen at
    // touch-down; the finger may wander up to a DPR-scaled slop before the gesture becomes a pan; a second finger turns
    // it into a pinch and nothing in it can tap; a new first finger drops any pointer whose up was never delivered.
    const pts = new Map(); let g = null, pinch = null;
    const local = (x, y) => { const b = c.getBoundingClientRect(); return [(x - b.left) * (b.width ? this.r.W / b.width : 1), (y - b.top) * (b.height ? this.r.H / b.height : 1)]; };
    c.addEventListener('pointerdown', (e) => {
      if (e.isPrimary || !pts.size) { pts.clear(); pinch = null; g = null; }
      try { c.setPointerCapture(e.pointerId); } catch {}
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.size === 1) {
        const [px, py] = local(e.clientX, e.clientY);
        if (e.pointerType !== 'mouse') this.r.hold();
        g = { id: e.pointerId, x0: e.clientX, y0: e.clientY, px, py, t: e.timeStamp, view: this.r.view(), mouse: e.pointerType === 'mouse', slop: TAP.slopFor(e.pointerType), drag: false, force: this.passThrough(e.clientX, e.clientY) };
      } else {
        if (g) g.drag = true;
        const [a, b] = [...pts.values()]; pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1 };
      }
    });
    c.addEventListener('pointermove', (e) => {
      if (e.pointerType === 'mouse' && !pts.size) { const [px, py] = local(e.clientX, e.clientY); this.onHover(this.r.tileAtScreen(px, py)); return; }
      const p = pts.get(e.pointerId); if (!p) return;
      if (pts.size >= 2 && pinch) {
        p.x = e.clientX; p.y = e.clientY;
        const [a, b] = [...pts.values()]; const d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
        const [mx, my] = local((a.x + b.x) / 2, (a.y + b.y) / 2);
        this.r.zoomBy(d / pinch.d, mx, my); pinch.d = d; return;
      }
      const dx = e.clientX - p.x, dy = e.clientY - p.y;
      if (g && !g.drag && Math.hypot(e.clientX - g.x0, e.clientY - g.y0) > g.slop) g.drag = true;
      if (!g || g.drag) this.r.pan(dx, dy);
      p.x = e.clientX; p.y = e.clientY;
    });
    const up = (e) => {
      const had = pts.delete(e.pointerId);
      if (pts.size < 2) pinch = null;
      if (!had || !g || pts.size) return;
      const G = g; g = null;
      // no time limit: the old 600 ms cut-off dropped slow presses and taps delivered late by a janky frame
      if (!G.drag && G.id === e.pointerId) this.tapAt(G.px, G.py, G);
    };
    const cancel = (e) => { if (pts.delete(e.pointerId) && g) g.drag = true; if (pts.size < 2) pinch = null; if (!pts.size) g = null; };
    c.addEventListener('pointerup', up); c.addEventListener('pointercancel', cancel); c.addEventListener('lostpointercapture', cancel);
    c.addEventListener('contextmenu', (e) => e.preventDefault()); // a long press must not open a menu or cancel the gesture
    c.addEventListener('wheel', (e) => { e.preventDefault(); const [px, py] = local(e.clientX, e.clientY); this.r.zoomBy(e.deltaY < 0 ? 1.12 : 0.89, px, py); }, { passive: false });
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
  $$('#m-settings [data-vol]').forEach((r) => { r.value = settings[r.dataset.vol] ?? 1; });
  $('#m-settings').classList.remove('hidden');
  if (typeof sfx.open === 'function') try { sfx.open(); } catch {}
}
$$('#m-settings [data-vol]').forEach((r) => r.addEventListener('input', () => { settings[r.dataset.vol] = +r.value; saveSettings(); }));
$$('#m-settings .toggle input').forEach((t) => t.addEventListener('change', () => { const k = t.checked ? 'toggle:on' : 'toggle:off'; if (typeof sfx[k] === 'function') try { sfx[k](); } catch {} }));
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
const WHATS_NEW = `<h4>10.2.1</h4><ul><li><b>Voice chat microphone fix</b>: Join Voice asks for microphone permission properly on phones, retries with simpler settings when a phone rejects the voice-tuned ones, and explains exactly how to allow the microphone on iPhone, Android or desktop. A new Turn On Mic button asks again without leaving voice.</li></ul><h4>10.2</h4><ul><li><b>Accurate taps</b>: zoomed-out taps land where your finger first touched, snap to the nearest legal tile, and hold the camera still. On tiny tiles, the first tap previews with a magnifier and the second confirms (turn on One-Tap in Settings to skip).</li><li><b>Move in the storm</b>: collapsed ground is now open floor, so pieces caught in the storm can always move out. Moves into the storm show in red. It still burns 20% max HP each turn.</li><li><b>Quick Chat</b>: 87 phrases in six categories, favourites, recently used, up to 12 phrases of your own, and team-only callouts in Squads.</li><li><b>Safer chat</b>: custom phrases are cleaned and filtered, spam is rate-limited, and you can mute anyone or show only preset phrases.</li><li><b>Voice chat (beta)</b>: opt-in push-to-talk or open mic with friends online, per-player mute and volume, and speaking indicators.</li><li>Eliminated players can still chat and talk while spectating.</li></ul><h4>10.1</h4><ul><li><b>Smoother</b>: the title screen, store and matches run much faster on phones, and auto quality reacts sooner.</li><li><b>New hazard art</b>: a royal Throne dais, erupting geysers, industrial conveyors, collapsing floors and Rift Storm tears.</li><li><b>Tidier screens</b>: every label at least 11px, every button at least 40px, and layout fixes on small phones and in landscape.</li><li><b>Lesson Complete</b> now shows your progress and what the next lesson covers.</li><li><b>Accurate text everywhere</b>: tutorials, Codex, How to Play and ability descriptions match the rules. The bounty world event is now called Royal Bounty.</li><li>Fixed: clipped emote names in Collections, the Lessons button spacing, and the tutorial saying the Crown appears at the centre.</li></ul><h4>10.0</h4><ul><li><b>Four new modes</b>: King of the Hill, Chaos, Gauntlet (co-op boss rush) and Mirror Match.</li><li><b>A living world</b>: rebuilt boards with real materials, dynamic lighting, shadows, new weather (rain, ash, aurora, sandstorms, fog) and a cinematic camera.</li><li><b>All-new piece art</b>: every piece re-sculpted and lit in 3D, with real materials and animated premium sets.</li><li><b>New effects</b>: every ability rebuilt, plus 11 new finishers.</li><li><b>The Director</b>: callouts, banners, tips and ultimate cinematics take turns in fixed lanes, so nothing stacks.</li><li><b>New soundtrack and sound</b>: an adaptive score with a theme for every mode, and a layered sound for every ability and finisher, with an announcer voice.</li><li><b>New Siege enemies</b> (Stalker, Hexer, Splitter, Brute) and a new boss, the Wraith Regent.</li><li><b>New world events and hazards</b>: Eclipse, Earthquake, Mana Surge, Royal Bounty, War Drums, Restless Dead, geysers, conveyors, a crumbling floor and Rift Storms.</li><li><b>Six new abilities and two new base abilities</b> (Bastion and Predator).</li><li><b>A rebuilt Store</b>: Mythic rarity, 25 piece sets, 13 boards, 14 trails, Collections, try-on previews and a wishlist.</li><li><b>Season 3: The Endgame</b>: a free 40-tier Crown Path.</li><li><b>Daily login streaks, a Profile screen and 26 new trophies</b>.</li><li><b>A whole new look</b>: new menus, title screen, loadout showroom and cinematic results.</li></ul><h4>5.0</h4><ul><li><b>Squads</b>: teams of two, no friendly fire, a Bond DEF bonus when you stick together, and revives: step on a fallen teammate's soul to bring them back.</li><li><b>Siege</b>: co-op against eight waves of hunting Hollows, with a Colossus boss on waves 4 and 8. The first Colossus drops the Crown.</li><li><b>Map hazards</b>: Magma Rift, Frostbite and Warpgates. Most matches roll one.</li><li><b>Five new abilities</b> (Tripwire, Lance, Penance, Quake, Gambit) and two new base abilities (Lifesteal, Last Stand).</li><li><b>The Announcer</b>: First Blood, Double Take, Shutdown, Regicide, Final Two and more.</li><li><b>Play of the Match</b>: the best move of every game, replayed in slow motion on the results screen.</li><li><b>Piece Mastery</b>: level each piece to 10 for titles and Marks.</li><li><b>Season 2: The Middlegame</b>: a fresh Crown Path with the Warden and Colossus sets, the Riftgate board and the Soulfire finisher.</li><li>Dozens of rules fixes, faster rendering, bigger tap targets and a landscape title screen.</li></ul><h4>3.1</h4><ul><li><b>Spectate properly</b>: getting eliminated online never ends the match, and you can follow any player. Hosts get a warning before leaving.</li><li><b>Rejoin</b> a match after a reload with the same code.</li><li><b>Cheaper, smarter promotions</b>: Knight or Bishop for 2, Rook +4, Queen +7, Hone from 1. Evolving early never wastes shards.</li><li><b>Steadfast</b>: before round 6 a full-HP piece survives any single hit.</li><li><b>Lethal Range</b> warnings, Knights that face their moves, and pieces with personality.</li></ul><h4>3.0</h4><ul><li><b>Full promotion ladder</b>: the Promote menu shows every rung and you can climb several at once (Pawn to Rook for 8, to Queen for 15).</li><li><b>The Store</b>: a daily Featured shop with a 30% Deal of the Day, discounted Bundles, rarity tiers, and an item reveal for every unlock.</li><li><b>New cosmetics</b>: 5 piece sets, 3 boards (with snow and bubbles), 3 finishers, Trails that follow your piece, and Emote packs.</li><li><b>Showtime</b>: a contender reveal before every match (VS for Duels), a podium on the results screen, and your piece on display on the title screen.</li></ul>
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
// 10.0 (A8): range sliders show their filled portion
const rangeFill = (r) => { const mn = +r.min || 0, mx = +r.max || 1; r.style.setProperty('--p', ((+r.value - mn) / (mx - mn || 1)) * 100 + '%'); };
document.addEventListener('input', (e) => { if (e.target && e.target.type === 'range') rangeFill(e.target); });
const fillRanges = () => $$('input[type=range]').forEach(rangeFill);
document.addEventListener('keydown', (e) => { const t = e.target; if ((e.key === 'Enter' || e.key === ' ') && t && t.matches && t.matches('[role=button][tabindex]')) { e.preventDefault(); t.click(); } });
document.addEventListener('click', () => requestAnimationFrame(fillRanges), true);
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
    case 'emotes': chat.toggle(); sfx.tap(); break;
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
  const sess = session;
  const live = session && session.mode === 'host' && game.s && !game.s.over && screen === 'game';
  const friends = live ? [...session.conns.values()].length : 0;
  if (live && friends > 0) {
    confirmBox('End the match?', `You are hosting. The match runs on your device, so leaving ends it for ${friends === 1 ? 'your friend' : `all ${friends} friends`}. Keep spectating to let them finish.`, 'End match for everyone', 'Keep spectating', () => { if (sess && sess.conns) for (const c of sess.conns.values()) c.send({ t: 'bye', reason: 'ended' }); setTimeout(() => { endSession(); go('title'); }, 250); }, () => { $('#m-results').classList.add('hidden'); game.startSpectate(); });
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
SUI.init({ profile: () => profile, save: () => save(), sfx, haptic, toast: (m) => toast(m), uiFlash: () => uiFlash(), pieceIcon, renderProfile: () => renderProfile(), go: (n) => go(n), today: () => today(), settings });
$('#in-name').addEventListener('input', (e) => { profile.name = e.target.value.replace(/[<>]/g, '').slice(0, 14) || 'Player'; save(); });
$('#in-bots').addEventListener('input', (e) => { $('#bot-n').textContent = e.target.value; sfx.tick(); });
$('#in-code').addEventListener('input', (e) => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); });
$('#in-code').addEventListener('keydown', (e) => { if (e.key === 'Enter') joinGame(); });
document.addEventListener('pointerover', (e) => { if (e.pointerType === 'mouse' && e.target.closest && e.target.closest('.btn:not(:disabled), .tab, .preset, .choice')) { const el = e.target.closest('.btn, .tab, .preset, .choice'); if (el !== document.__lastHover) { document.__lastHover = el; sfx.hover(); } } });

$('#lesson-list').addEventListener('click', (e) => { const b = e.target.closest('[data-lesson]'); if (!b) return; sfx.select(); uiFlash(); startLesson(b.dataset.lesson); });
$('#codex-tabs').addEventListener('click', (e) => { const b = e.target.closest('[data-ctab]'); if (!b) return; codexTab = b.dataset.ctab; sfx.tap(); renderCodexTab(); });
$('#coach-next').addEventListener('click', () => { sfx.select(); if (tutorial) tutorial.next(); });
$('#coach-text').addEventListener('click', () => { clearInterval(coachUI.tw); $('#coach-text').textContent = coachUI.full || ''; });
$('#modes').addEventListener('click', (e) => { const b = e.target.closest('[data-mode]'); if (!b) return; profile.mode = b.dataset.mode; save(); sfx.select(); renderPlay(); });
$('#seg-diff').addEventListener('click', (e) => { const b = e.target.closest('[data-diff]'); if (!b) return; profile.botLevel = b.dataset.diff; save(); sfx.select(); renderSoloMini(); });
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
addEventListener('keydown', (e) => { if (e.key !== 'Escape') return; const open = [...document.querySelectorAll('.modal:not(.hidden)')].pop(); if (open && open.id !== 'm-results' && open.id !== 'm-lesson') open.classList.add('hidden'); });
addEventListener('beforeunload', (e) => { if (session && session.mode === 'host' && game.s && !game.s.over && screen === 'game' && session.conns.size) { e.preventDefault(); e.returnValue = ''; } });
addEventListener('pagehide', () => endSession());
bgInit();
game.init();
renderProfile();
document.body.classList.toggle('bigtext', !!settings.bigtext); document.body.classList.toggle('reduced', !!settings.motion);
// 10.0 (A8): the title news card reads its headlines from WHATS_NEW, and returning players get the sequel reveal once.
{ const n = newsFrom(WHATS_NEW); if (n.ver) $('#nc-head').textContent = `Chess Complex ${n.ver}`; if (n.items.length) $('#nc-body').textContent = n.items.slice(0, 3).join(', ') + (n.items.length > 3 ? ` and ${n.items.length - 3} more` : ''); }
const afterSplash = (showNew) => { if (!profile.seenReveal10 && (profile.games || profile.tutorial.length) && !q0.get('join')) { profile.seenReveal10 = true; save(); sequelReveal(showNew, { reduced: !!settings.motion, sfx }); } else showNew(); };
const q0 = new URLSearchParams(location.search);
setTimeout(() => { $('#splash').classList.add('out'); afterSplash(() => { if (profile.seenVersion !== '10.2.1' && (profile.games || profile.tutorial.length)) { info('What\'s New in 10.2.1', WHATS_NEW); } profile.seenVersion = '10.2.1'; save(); }); }, 700);
const q = new URLSearchParams(location.search);
if (q.get('join')) { go('join'); $('#in-code').value = q.get('join').toUpperCase().slice(0, 5); }
window.__cc = { game, profile, get session() { return session; }, startSolo };
