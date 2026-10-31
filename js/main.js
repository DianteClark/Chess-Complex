// Chess Complex — app shell: menus, loadout, armory, sessions, in-game HUD.
import { PIECES, ABILITIES, PASSIVES, PRESETS, STAT_POINTS, STAT_GAIN, SKINS, DEFAULT_SKINS, MAX_PLAYERS, TURN_MS, EVOLVE_COST } from './data.js';
import { legalMoves, abilityOptions, canMove, canAct, canUse, slotAbility, stats, effSpd, promoteOptions, predictOrder, unitById, alivePlayers, STORM, CROWN_ROUND } from './engine.js';
import { Renderer } from './render.js';
import { pieceIcon, drawPiece, skinOf } from './pieces.js';
import { sfx, playEvents, unlockAudio, isMuted, setMuted } from './audio.js';
import { GameHost, openServer, openClient, makeCode } from './net.js';

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const PIECE_ORDER = ['pawn', 'knight', 'bishop', 'rook', 'queen'];
const BOT_NAMES = ['Morphy', 'Tal', 'Capablanca', 'Lasker', 'Alekhine', 'Petrosian', 'Botvinnik', 'Steinitz', 'Anderssen', 'Philidor', 'Nimzo', 'Reti'];

// ---------- profile ----------
const PKEY = 'cc_profile_v1';
function defaultProfile() {
  const p = PRESETS.bruiser;
  return {
    name: 'Pawn' + Math.floor(100 + Math.random() * 900),
    build: { preset: 'bruiser', pts: { ...p.pts }, passive: p.passive, equips: { pawn: 'sprint', knight: 'trample', bishop: 'sanctuary', rook: 'rampart', queen: 'execute' } },
    skin: 'ivory', owned: [...DEFAULT_SKINS], marks: 100, played: [], wins: 0, games: 0,
  };
}
let profile = defaultProfile();
try { const raw = localStorage.getItem(PKEY); if (raw) profile = { ...profile, ...JSON.parse(raw) }; } catch {}
const save = () => { try { localStorage.setItem(PKEY, JSON.stringify(profile)); } catch {} };
const ptsUsed = () => Object.values(profile.build.pts).reduce((a, b) => a + b, 0);

function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 2200); }
function renderMarks() { $('#marks-title').textContent = profile.marks; $('#marks-armory').textContent = profile.marks; }
document.body.classList.toggle('muted', isMuted());

// ---------- background ----------
const bg = { c: $('#bg'), parts: [], on: true };
function bgInit() {
  const c = bg.c, x = c.getContext('2d');
  const resize = () => { const d = Math.min(2, devicePixelRatio || 1); c.width = innerWidth * d; c.height = innerHeight * d; bg.d = d; };
  resize(); addEventListener('resize', resize);
  const spawn = (y) => {
    const pcs = PIECE_ORDER.concat(['king']);
    const skins = profile.owned.length ? profile.owned : DEFAULT_SKINS;
    return { x: Math.random(), y: y ?? 1.15, s: 30 + Math.random() * 70, v: 0.012 + Math.random() * 0.02, piece: pcs[Math.floor(Math.random() * pcs.length)], skin: skins[Math.floor(Math.random() * skins.length)], r: (Math.random() - 0.5) * 0.4, a: 0.12 + Math.random() * 0.25, ph: Math.random() * 6 };
  };
  for (let i = 0; i < 18; i++) bg.parts.push(spawn(Math.random() * 1.2));
  let last = performance.now();
  const loop = (now) => {
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    if (bg.on) {
      const W = c.width, H = c.height;
      const g = x.createRadialGradient(W / 2, H * 0.4, 10, W / 2, H / 2, Math.max(W, H) * 0.7);
      g.addColorStop(0, '#1d1830'); g.addColorStop(0.6, '#0e0c16'); g.addColorStop(1, '#060509');
      x.setTransform(1, 0, 0, 1, 0, 0); x.fillStyle = g; x.fillRect(0, 0, W, H);
      // perspective grid floor
      x.strokeStyle = 'rgba(214,176,92,0.08)'; x.lineWidth = 1;
      const hz = H * 0.62;
      for (let i = -12; i <= 12; i++) { x.beginPath(); x.moveTo(W / 2 + i * W * 0.02, hz); x.lineTo(W / 2 + i * W * 0.22, H); x.stroke(); }
      for (let k = 0; k < 10; k++) { const t = ((k + (now / 4000) % 1) / 10); const y = hz + (H - hz) * t * t; x.beginPath(); x.moveTo(0, y); x.lineTo(W, y); x.stroke(); }
      for (const p of bg.parts) {
        p.y -= p.v * dt; p.ph += dt;
        if (p.y < -0.2) Object.assign(p, spawn());
        x.setTransform(bg.d, 0, 0, bg.d, 0, 0);
        x.globalAlpha = p.a;
        x.translate(p.x * innerWidth + Math.sin(p.ph * 0.5) * 12, p.y * innerHeight);
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
  if (name === 'title') renderMarks();
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
  if (b.dataset.preset) {
    const p = PRESETS[b.dataset.preset];
    profile.build.preset = b.dataset.preset; profile.build.pts = { ...p.pts }; profile.build.passive = p.passive;
    sfx.select();
  } else if (b.dataset.stat) {
    const k = b.dataset.stat, d = +b.dataset.d, v = profile.build.pts[k] + d;
    if (v < 0 || (d > 0 && ptsUsed() >= STAT_POINTS)) { sfx.error(); return; }
    profile.build.pts[k] = v; profile.build.preset = null; sfx.tap();
  } else if (b.dataset.passive) { profile.build.passive = b.dataset.passive; profile.build.preset = null; sfx.select(); }
  else if (b.dataset.equip) { const [pc, eq] = b.dataset.equip.split(':'); profile.build.equips[pc] = eq; sfx.select(); }
  else return;
  // a preset matches if pts and passive equal
  for (const [k, p] of Object.entries(PRESETS)) if (p.passive === profile.build.passive && ['hp', 'atk', 'def', 'spd'].every((s) => p.pts[s] === profile.build.pts[s])) profile.build.preset = k;
  save(); renderLoadout();
}

// ---------- armory ----------
function renderArmory() {
  renderMarks();
  $('#skins').innerHTML = Object.entries(SKINS).map(([k, s]) => {
    const owned = profile.owned.includes(k), eq = profile.skin === k;
    const btn = eq ? `<button class="btn small" disabled>Equipped</button>` : owned ? `<button class="btn small" data-equip-skin="${k}">Equip</button>`
      : `<button class="btn small gold" data-buy="${k}" ${profile.marks < s.price ? 'disabled' : ''}>Unlock ${s.price}</button>`;
    return `<div class="skin ${eq ? 'equipped' : ''}"><div class="glow" style="background:${s.glow}"></div>
      <div class="row"><img src="${pieceIcon('knight', k, null, 48)}" alt=""><img class="mid" src="${pieceIcon('queen', k, null, 72)}" alt=""><img src="${pieceIcon('rook', k, null, 48)}" alt=""></div>
      <h4>${s.name}</h4>${btn}</div>`;
  }).join('');
}
function onArmoryClick(e) {
  const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.buy) {
    const k = b.dataset.buy, s = SKINS[k];
    if (profile.marks < s.price) { sfx.error(); return; }
    profile.marks -= s.price; profile.owned.push(k); profile.skin = k; save(); sfx.buy(); toast(`${s.name} unlocked`);
    renderArmory();
  } else if (b.dataset.equipSkin) { profile.skin = b.dataset.equipSkin; save(); sfx.select(); renderArmory(); }
}

function renderSoloMini() {
  const b = profile.build;
  $('#solo-loadout').innerHTML = `<img src="${pieceIcon('pawn', profile.skin, '#d6b05c', 64)}" alt=""><div class="lm-t"><b>${esc(profile.name)}</b><span>${b.preset ? PRESETS[b.preset].name : 'Custom'} build - ${PASSIVES[b.passive].name} - ${SKINS[profile.skin].name}</span></div>`;
}
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---------- bots ----------
function botPlayer(i, used) {
  const names = BOT_NAMES.filter((n) => !used.includes(n));
  const name = names[Math.floor(Math.random() * names.length)] || 'Bot' + i;
  const keys = Object.keys(PRESETS), p = PRESETS[keys[Math.floor(Math.random() * keys.length)]];
  const equips = {}; for (const pc of PIECE_ORDER) { const list = PIECES[pc].equips; equips[pc] = list[Math.floor(Math.random() * list.length)]; }
  const skins = Object.keys(SKINS);
  return { pid: 'bot' + i + Math.random().toString(36).slice(2, 6), name, isBot: true, skin: skins[Math.floor(Math.random() * skins.length)], build: { pts: { ...p.pts }, passive: p.passive, equips } };
}
const me = () => ({ pid: 'me', name: profile.name || 'Player', skin: profile.skin, build: { pts: { ...profile.build.pts }, passive: profile.build.passive, equips: { ...profile.build.equips } } });

// ---------- sessions ----------
let session = null; // { mode, host, send, myPid, server, client, conns, players, code }
function endSession() {
  if (!session) return;
  try { session.host && session.host.stop(); } catch {}
  try { session.server && session.server.close(); } catch {}
  try { session.client && session.client.close(); } catch {}
  session = null;
}

function startSolo() {
  endSession();
  const n = +$('#in-bots').value;
  const players = [me()];
  for (let i = 0; i < n; i++) players.push(botPlayer(i, players.map((p) => p.name)));
  session = { mode: 'solo', myPid: 'me' };
  session.host = new GameHost(players, (m) => game.onMsg(m));
  session.send = (a) => session.host.act('me', a);
  game.enter();
  session.host.start();
}

function lobbyHTML(players, host) {
  return players.map((p, i) => `<li style="--c:${['#ff4d6d', '#4dabff', '#ffd24d', '#5cff9d', '#c77dff', '#ff8f3d', '#3dfff0', '#ff6ad5'][i]}"><img src="${pieceIcon('pawn', p.skin, null, 34)}" alt=""><b>${esc(p.name)}</b><em>${p.pid === 'me' ? 'Host' : p.isBot ? 'Bot' : 'Player'}</em>${host && p.pid !== 'me' ? `<button data-kick="${p.pid}">Remove</button>` : ''}</li>`).join('');
}
function startHostLobby() {
  endSession();
  if (!window.Peer && !location.search.includes('net=local')) { $('#host-status').textContent = 'Online play could not load. Check your connection and reload.'; $('#host-status').classList.add('err'); return; }
  const code = makeCode();
  session = { mode: 'host', myPid: 'me', code, players: [me()], conns: new Map(), started: false };
  $('#host-code').textContent = code;
  $('#host-status').textContent = 'Opening room...'; $('#host-status').classList.remove('err');
  const renderLobby = () => {
    $('#host-lobby').innerHTML = lobbyHTML(session.players, true);
    $('#lobby-count').textContent = `${session.players.length}/${MAX_PLAYERS}`;
    $('#btn-start-host').disabled = session.players.length < 2;
    const pub = session.players.map(({ pid, name, skin, isBot }) => ({ pid, name, skin, isBot }));
    for (const c of session.conns.values()) c.send({ t: 'lobby', players: pub, code });
  };
  session.renderLobby = renderLobby;
  const sess = session;
  session.server = openServer(code, {
    onReady: () => { if (session !== sess) return; $('#host-status').textContent = 'Room open. Share the code with friends.'; },
    onError: (t) => {
      if (session !== sess) return;
      if (t === 'unavailable-id') { startHostLobby(); return; }
      if (t === 'network' || t === 'server-error' || t === 'socket-error' || t === 'socket-closed') { $('#host-status').textContent = 'Lost connection to the matchmaking server. Go back and try again.'; $('#host-status').classList.add('err'); }
    },
    onConn: (conn) => {
      conn.onData((m) => {
        if (!m || typeof m !== 'object') return;
        if (m.t === 'join') {
          if (sess.started || sess.players.length >= MAX_PLAYERS) { conn.send({ t: 'full' }); return; }
          const pid = 'c' + Math.random().toString(36).slice(2, 8);
          conn.pid = pid; sess.conns.set(pid, conn);
          const skin = SKINS[m.skin] ? m.skin : 'ivory';
          const b = m.build || {};
          const pts = sanitizePts(b.pts);
          const passive = PASSIVES[b.passive] ? b.passive : 'regen';
          const equips = {}; for (const pc of PIECE_ORDER) equips[pc] = PIECES[pc].equips.includes(b.equips && b.equips[pc]) ? b.equips[pc] : PIECES[pc].equips[0];
          sess.players.push({ pid, name: String(m.name || 'Player').slice(0, 14), skin, build: { pts, passive, equips } });
          conn.send({ t: 'welcome', pid });
          sfx.select(); renderLobby();
        } else if (m.t === 'act' && sess.host && conn.pid) sess.host.act(conn.pid, m.a);
      });
      conn.onClose(() => {
        if (!conn.pid) return;
        sess.conns.delete(conn.pid);
        if (!sess.started) { sess.players = sess.players.filter((p) => p.pid !== conn.pid); renderLobby(); }
        else if (sess.host) { sess.host.setBot(conn.pid); const u = sess.host.s.units.find((v) => v.pid === conn.pid); if (u) game.feed(`${u.name} disconnected - a bot takes over`); }
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
  sess.host = new GameHost(sess.players, (m) => {
    for (const c of sess.conns.values()) c.send(m);
    game.onMsg(m);
  });
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
    onOpen: () => { st.textContent = 'Connected. Joining lobby...'; sess.client.send({ t: 'join', name: profile.name, skin: profile.skin, build: profile.build }); },
    onData: (m) => {
      if (session !== sess) return;
      if (m.t === 'welcome') { sess.myPid = m.pid; st.textContent = 'In the lobby.'; sfx.select(); }
      else if (m.t === 'lobby') { $('#join-lobby-panel').classList.remove('hidden'); $('#join-lobby').innerHTML = lobbyHTML(m.players.map((p) => ({ ...p, pid: p.pid === sess.myPid ? 'you' : p.pid })), false).replace('<em>Player</em>', '<em>Player</em>'); }
      else if (m.t === 'full') { st.textContent = 'That match is full or already started.'; st.classList.add('err'); }
      else if (m.t === 'start') { sess.myPid = m.pid; game.enter(); }
      else if (m.t === 'state') game.onMsg(m);
    },
    onClose: () => {
      if (session !== sess) return;
      if (screen === 'game' && !game.s?.over) { toast('The host left the match'); game.showResults(true); }
      else if (screen === 'join') { st.textContent = 'Disconnected from host.'; st.classList.add('err'); }
    },
    onError: (t) => {
      if (session !== sess) return;
      st.textContent = t === 'peer-unavailable' ? 'No match found with that code.' : t === 'timeout' ? 'Could not reach that match. Check the code and try again.' : 'Connection error. Try again.';
      st.classList.add('err'); sfx.error();
    },
  });
  sess.send = (a) => sess.client.send({ t: 'act', a });
}

// ---------- game UI ----------
const game = {
  r: null, s: null, mode: 'move', preview: null, deadline: 0, lastTurnNo: -1, deadShown: false, resultsShown: false,
  init() {
    this.r = new Renderer($('#board'));
    let last = performance.now();
    const loop = (now) => {
      const dt = Math.min(0.05, (now - last) / 1000); last = now;
      if (screen === 'game') { this.r.frame(dt); this.tickTimer(); }
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
  },
  enter() {
    this.s = null; this.mode = 'move'; this.preview = null; this.lastTurnNo = -1; this.deadShown = false; this.resultsShown = false;
    this.r.disp.clear(); this.r.dying = []; this.r.parts = []; this.r.floats = []; this.r.zoomSet = false; this.r.follow = true; this.r.resize();
    $$('#s-game .modal').forEach((m) => m.classList.add('hidden'));
    $('#h-feed').innerHTML = '';
    go('game');
    requestAnimationFrame(() => this.fitPad());
  },
  fitPad() {
    const top = $('.hud-top').getBoundingClientRect().bottom;
    const bot = $('.hud-bottom').getBoundingClientRect();
    this.r.setPad(top + 4, Math.max(0, innerHeight - bot.top - 10));
  },
  get me() { return this.s && session ? this.s.units.find((u) => u.pid === session.myPid) : null; },
  myTurn() { const m = this.me; return !!(m && m.alive && this.s.active === m.id && !this.s.over); },
  onMsg(m) {
    if (m.t !== 'state' || !session) return;
    const first = !this.s;
    this.s = m.state;
    this.deadline = Date.now() + m.dl;
    const mine = this.me;
    this.r.myId = mine ? mine.id : null;
    this.r.setState(this.s, m.ev);
    if (!first) playEvents(m.ev, this.r.myId);
    this.handleEvents(m.ev, first);
    if (this.s.turnNo !== this.lastTurnNo) {
      this.lastTurnNo = this.s.turnNo; this.mode = 'move'; this.preview = null;
      const a = unitById(this.s, this.s.active);
      if (a && (this.myTurn() || (a.kind === 'player' && this.r.follow))) this.r.focus(a.x, a.y);
      if (first && mine) this.r.focus(mine.x, mine.y);
    }
    if (this.myTurn()) {
      const u = this.me;
      if (this.mode === 'move' && !canMove(this.s, u) && canAct(this.s, u)) this.mode = 'atk';
      if (this.mode !== 'move' && !canUse(this.s, u, this.mode)) this.mode = canMove(this.s, u) ? 'move' : 'atk';
      this.preview = null;
    }
    this.refresh();
    if (first) requestAnimationFrame(() => this.fitPad());
  },
  handleEvents(ev, first) {
    const s = this.s, myId = this.r.myId;
    if (first) { this.banner('Survive', 'Last piece standing wins', ''); return; }
    for (const e of ev) {
      if (e.e === 'turn' && e.id === myId) this.banner('Your Turn', '', '');
      if (e.e === 'storm') e.phase === 'crack' ? this.banner('The Storm Gathers', 'The outer ring collapses next round', 'red') : this.banner('Collapse', s.storm.ring >= STORM.maxRing ? 'Sudden death - everyone burns' : 'Stay inside the ring', 'red');
      if (e.e === 'crownSpawn') this.banner('The Crown', 'Has appeared at the centre', '');
      if (e.e === 'crowned') { const u = unitById(s, e.id); this.banner(u.id === myId ? 'You Are King' : 'A New King', u.id === myId ? 'Everyone is coming for you' : `${u.name} wears the Crown`, ''); }
      if (e.e === 'promote' && e.id === myId) this.banner(e.type === 'evolve' ? PIECES[e.piece].name : 'Honed', e.type === 'evolve' ? 'Evolution complete' : `${PIECES[e.piece].name} level ${e.hone}`, 'cyan');
      if (e.e === 'death') {
        const v = unitById(s, e.id); if (!v || v.kind !== 'player') continue;
        const k = e.by ? unitById(s, e.by) : null;
        this.feed(k && k.id !== v.id ? `<b style="color:${k.color}">${esc(k.name)}</b> took <b style="color:${v.color}">${esc(v.name)}</b>` : `<b style="color:${v.color}">${esc(v.name)}</b> fell to the storm`);
        if (e.id === myId && !s.over) setTimeout(() => this.showDead(), 1200);
      }
      if (e.e === 'over') setTimeout(() => this.showResults(), 1600);
    }
  },
  banner(main, sub, tone) {
    const b = $('#h-banner'); b.className = 'banner ' + (tone || '');
    b.querySelector('.b-main').textContent = main; b.querySelector('.b-sub').textContent = sub;
    void b.offsetWidth; b.classList.add('show');
  },
  feed(html) { const d = document.createElement('div'); d.innerHTML = html; $('#h-feed').prepend(d); setTimeout(() => d.remove(), 5200); while ($('#h-feed').children.length > 4) $('#h-feed').lastChild.remove(); },

  options() {
    const u = this.me; if (!u || !this.myTurn()) return [];
    if (this.mode === 'move' || this.mode === 'promote') return [];
    if (!canUse(this.s, u, this.mode)) return [];
    return abilityOptions(this.s, u, this.mode);
  },
  refresh() {
    const s = this.s; if (!s) return;
    const u = this.me;
    // overlay
    if (this.myTurn()) {
      if (this.mode === 'move') this.r.overlay = canMove(s, u) ? { moves: legalMoves(s, u) } : null;
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
    else {
      let next = STORM.firstCrack; while (next <= s.round) next += STORM.every;
      st.textContent = `Storm in ${next - s.round}`; st.classList.toggle('hot', next - s.round <= 1);
    }
    $('#h-alive').textContent = `${alivePlayers(s).length} left`;
    // order strip
    const order = predictOrder(s, 7);
    $('#h-order').innerHTML = order.map((id) => { const v = unitById(s, id); if (!v) return ''; return `<div class="o ${u && v.id === u.id ? 'me' : ''}" style="--c:${v.kind === 'player' ? v.color : '#555'}"><img src="${pieceIcon(v.piece, v.skin, null, 36)}" alt=""></div>`; }).join('');
    if (!u) return;
    // card
    const stt = stats(u);
    $('#h-portrait').src = pieceIcon(u.piece, u.skin, u.color, 56); $('#h-portrait').style.setProperty('--c', u.color);
    $('#h-name').textContent = u.name;
    const hone = u.hone[u.piece] || 0;
    $('#h-piece').textContent = (PIECES[u.piece] ? PIECES[u.piece].name : '') + (hone ? ' +' + hone : '');
    const r = Math.max(0, u.hp / stt.maxHp);
    const hp = $('#h-hp'); hp.style.width = r * 100 + '%'; hp.className = r > 0.5 ? '' : r > 0.25 ? 'mid' : 'low';
    $('#h-hptext').textContent = `${Math.max(0, u.hp)} / ${stt.maxHp}`;
    const defBuff = u.buffs.some((b) => b.k === 'def'), spdBuff = u.buffs.some((b) => b.k === 'spd' && b.v > 0);
    $('#h-stats').innerHTML = `<span>ATK <b>${stt.atk}</b></span><span class="${defBuff ? 'up' : ''}">DEF <b>${stt.def}${defBuff ? '+' : ''}</b></span><span class="${spdBuff ? 'up' : ''}">SPD <b>${Math.round(effSpd(u) * 10) / 10}</b></span><span>${PASSIVES[u.passive].name}</span>`;
    const popts = promoteOptions(u);
    const minCost = popts.length ? Math.min(...popts.map((p) => p.cost)) : 0;
    $('#h-shards').textContent = u.shards;
    $('#h-shardprog').style.width = (minCost ? Math.min(1, u.shards / minCost) * 100 : 100) + '%';
    const nextEvo = popts.find((p) => p.type === 'evolve');
    $('#h-next').textContent = u.piece === 'king' ? 'Crowned' : nextEvo ? `${popts.filter((p) => p.type === 'evolve').map((p) => PIECES[p.to].name).join(' / ')} ${nextEvo.cost}` : popts.length ? `Hone ${minCost}` : 'Max';
    // actions
    const my = this.myTurn();
    $('#h-actions').classList.toggle('wait', !my);
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
        used = !eqId && slot === 'eq' || (!canUse(s, u, slot) && u.cd[slot] === 0);
        b.classList.toggle('cooling', u.cd[slot] > 0);
        $('#cd-' + slot).textContent = u.cd[slot] > 0 ? u.cd[slot] : '';
        if (!used && u.cd[slot] === 0 && abilityOptions(s, u, slot).length === 0) used = true;
      } else if (slot === 'promote') { used = !popts.length; b.classList.toggle('ready', my && popts.some((p) => p.cost <= u.shards)); }
      b.classList.toggle('used', my && used);
      if (my && slot === this.mode && this.preview) b.classList.add('confirm');
    }
    // tip
    const a = unitById(s, s.active);
    let tip = '';
    if (!u.alive) tip = 'You are spectating.';
    else if (!my) tip = a ? (a.kind === 'hollow' ? 'A Hollow stirs...' : `<b>${esc(a.name)}</b> is taking their turn`) : '';
    else if (this.mode === 'move') tip = canMove(s, u) ? `<b>Move:</b> ${PIECES[u.piece].moveDesc} Tap a blue tile.` : canAct(s, u) ? 'Choose an action, or end your turn.' : '';
    else {
      const id = slotAbility(u, this.mode), ab = ABILITIES[id];
      tip = `<b>${ab.name}:</b> ${ab.desc}${honedTip(u, id)} ${this.preview ? '<b>Tap again to confirm.</b>' : 'Tap a target.'}`;
    }
    $('#h-tip').innerHTML = tip;
  },
  tickTimer() {
    const t = $('#h-timer'); if (!this.s || this.s.over) { t.style.transform = 'scaleX(0)'; return; }
    const a = unitById(this.s, this.s.active);
    const human = a && a.kind === 'player' && !a.bot;
    const left = Math.max(0, this.deadline - Date.now());
    t.style.transform = `scaleX(${human ? left / TURN_MS : 0})`;
    t.classList.toggle('low', left < 8000);
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
  exec(o) {
    sfx.tap();
    session.send({ type: 'ability', slot: this.mode, x: o.anchor.x, y: o.anchor.y });
    this.preview = null;
  },
  optAt(t) {
    const opts = this.options();
    let o = opts.find((q) => q.anchor.x === t.x && q.anchor.y === t.y);
    if (!o) { const c = opts.filter((q) => q.tiles.some((p) => p.x === t.x && p.y === t.y)); if (c.length === 1) o = c[0]; }
    return o;
  },
  onTap(t, mouse) {
    unlockAudio();
    if (!t || !this.s) return;
    if (this.myTurn()) {
      const u = this.me;
      if (this.mode === 'move') {
        if (canMove(this.s, u) && legalMoves(this.s, u).some((m) => m.x === t.x && m.y === t.y)) { session.send({ type: 'move', x: t.x, y: t.y }); return; }
      } else {
        const o = this.optAt(t);
        if (o) {
          if (mouse || this.preview === o) this.exec(o);
          else { this.preview = o; sfx.tap(); this.refresh(); }
          return;
        }
        if (this.preview) { this.preview = null; this.refresh(); return; }
      }
    }
    this.inspect(t);
  },
  onHover(t) {
    if (!this.myTurn() || this.mode === 'move' || !t) return;
    const o = this.optAt(t) || null;
    if (o !== this.preview) { this.preview = o; this.refresh(); }
  },
  inspect(t) {
    const v = this.s.units.find((q) => q.alive && q.x === t.x && q.y === t.y);
    const box = $('#h-inspect');
    clearTimeout(this.inspT);
    if (!v) { box.classList.add('hidden'); return; }
    const st = stats(v);
    const extra = v.kind === 'hollow' ? 'Guards a shard cache. Drops 2 shards.' : `${PASSIVES[v.passive].name} - ${v.shards} shard${v.shards === 1 ? '' : 's'} - ${v.kills} KO`;
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
      const P = PIECES[piece];
      const sig = ABILITIES[P.sig];
      const desc = o.type === 'evolve' ? `${P.moveDesc} Signature: ${sig.name}.` : `+15% stats. ${sig.honed && hone === 0 ? 'Signature upgrade: ' + sig.honed : 'Level ' + o.level + ' of 3.'}`;
      return `<button class="popt" data-to="${o.to}" ${u.shards < o.cost ? 'disabled' : ''}><img src="${pieceIcon(piece, u.skin, o.type === 'hone' ? '#7fe0ff' : null, 60)}" alt=""><div><b>${o.type === 'evolve' ? P.name : 'Hone ' + P.name}</b><span>${desc}</span></div><div class="cost"><span class="shard-ico"></span>${o.cost}</div></button>`;
    }).join('');
    $('#m-promote').classList.remove('hidden'); sfx.select();
  },
  showDead() {
    const u = this.me; if (!u || this.resultsShown) return;
    $('#dead-place').textContent = '#' + u.place;
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
    $('#r-title').textContent = win ? 'Checkmate' : aborted ? 'Match Ended' : 'Defeated';
    $('#r-place').textContent = `Placed ${place} of ${total}`;
    $('#r-stats').innerHTML = `<div><b>${u.kills}</b><span>Eliminations</span></div><div><b>${u.dmgDealt || 0}</b><span>Damage</span></div><div><b>${PIECES[u.piece].name}</b><span>Final piece</span></div>`;
    let earned = 0;
    const id = matchKey;
    if (!profile.played.includes(id)) {
      earned = 20 + u.kills * 15 + Math.max(0, total - place) * 8 + (win ? 60 : 0);
      profile.marks += earned; profile.games++; if (win) profile.wins++;
      profile.played = [...profile.played.slice(-30), id]; save();
    }
    $('#r-marks').innerHTML = earned ? `<i class="mark-ico"></i>+${earned} Marks` : '';
    const ranked = s.units.filter((v) => v.kind === 'player').sort((a, b) => (a.alive ? 0 : a.place) - (b.alive ? 0 : b.place));
    $('#r-board').innerHTML = ranked.map((v, i) => `<li class="${v.id === u.id ? 'me' : ''}" style="--c:${v.color}"><b>${v.alive ? 1 : v.place}</b><img src="${pieceIcon(v.piece, v.skin, null, 26)}" alt=""><span>${esc(v.name)}</span><em>${v.kills} KO</em></li>`).join('');
    $('#m-results').classList.remove('hidden');
    if (win) sfx.win();
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
      if (screen !== 'game') return;
      const map = { '1': 'move', '2': 'atk', '3': 'sig', '4': 'eq', p: 'promote', e: 'end', ' ': 'end' };
      if (e.key === 'Escape') { this.preview = null; this.mode = 'move'; this.refresh(); }
      else if (map[e.key.toLowerCase()]) { e.preventDefault(); this.onAction(map[e.key.toLowerCase()]); }
    });
  },
};
let matchKey = '';
function honedTip(u, id) { const ab = ABILITIES[id]; return ab.honed && (u.hone[u.piece] || 0) > 0 ? ` <b>Honed:</b> ${ab.honed}` : ''; }

// ---------- wiring ----------
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-go],[data-act]'); if (!b) return;
  unlockAudio();
  const act = b.dataset.act;
  if (act === 'leave-lobby') { endSession(); }
  if (b.dataset.go) { sfx.tap(); go(b.dataset.go); }
  switch (act) {
    case 'mute': setMuted(!isMuted()); document.body.classList.toggle('muted', isMuted()); if (!isMuted()) sfx.select(); break;
    case 'start-solo': matchKey = 'm' + Date.now(); sfx.select(); startSolo(); break;
    case 'copy-code': copy(session && session.code, 'Code copied'); break;
    case 'copy-link': copy(session && `${location.origin}${location.pathname}?join=${session.code}`, 'Invite link copied'); break;
    case 'add-bot': hostAddBot(); break;
    case 'fill-bots': while (session && session.players && session.players.length < MAX_PLAYERS) hostAddBot(); break;
    case 'start-host': matchKey = 'm' + Date.now(); sfx.select(); startHost(); break;
    case 'join': matchKey = 'm' + Date.now(); joinGame(); break;
    case 'zoom': if (game.r.cam.tz > game.r.fitZoom * 1.05) game.r.overview(); else game.r.closeup(); sfx.tap(); break;
    case 'menu': $('#m-menu').classList.remove('hidden'); sfx.tap(); break;
    case 'close-menu': $('#m-menu').classList.add('hidden'); break;
    case 'close-promote': $('#m-promote').classList.add('hidden'); break;
    case 'forfeit': $('#m-menu').classList.add('hidden'); if (game.s && !game.s.over && game.me && game.me.alive) game.showResults(true); else game.showResults(); break;
    case 'spectate': $('#m-dead').classList.add('hidden'); break;
    case 'results': game.showResults(); break;
    case 'to-title': endSession(); go('title'); break;
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
$('#in-bots').addEventListener('input', (e) => { $('#bot-n').textContent = e.target.value; });
$('#in-code').addEventListener('input', (e) => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); });
$('#in-code').addEventListener('keydown', (e) => { if (e.key === 'Enter') joinGame(); });

addEventListener('pagehide', () => endSession());
bgInit();
game.init();
renderMarks();
const q = new URLSearchParams(location.search);
if (q.get('join')) { go('join'); $('#in-code').value = q.get('join').toUpperCase().slice(0, 5); }
window.__cc = { game, profile, get session() { return session; }, startSolo };
void EVOLVE_COST; void CROWN_ROUND; void skinOf;
