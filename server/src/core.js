// 17.0 (S1): room logic (lobby, party, match, bots, clocks, chat/voice relay). Plain JS: the Room DO (room.js) feeds
// it messages, closes and alarms through an io object; tests can drive it in Node with a fake io.
// Behaviour mirrors the phone host (js/net.js GameHost + main.js startHostLobby/startHost + js/party.js) unless noted.
import { createMatch, applyAction, planBot, planHollow, unitById, alivePlayers, nextTurn, stats } from '../../js/engine.js';
import { TURN_MS, MODES, SKINS, FINISHERS, TRAILS, PASSIVES, PIECES, PRESETS, STAT_POINTS } from '../../js/data.js';
import { LOCATIONS } from '../../js/locations.js';
import { hostCheck, BOT_LINES } from '../../js/chat.js';
import { modesIn, groupOf, cleanRules, defaultRules, RULES } from '../../js/party.js';
import { stateHash, protoVer } from '../../js/statehash.js';
import { introHold } from './intro.js';

export const T = {
  turnGrace: 2000,      // net.js TURN_GRACE
  think: 520, thinkHollow: 260, step: 480, stepHollow: 220, // net.js bot pacing
  lagFree: 900, lagCap: 3000, blStale: 2500,                // 15.1 backlog rule (slowest human)
  awayLobby: 20000,     // party.js AWAY_MS
  resume: 60000,        // dropped mid-match: 60 s to come back while a bot holds the seat
  clean: 600000,        // empty room: storage deleted after 10 min
  reserve: 600000,      // a code from POST /room nobody joined
  hashEvery: 8,
  planSplit: 6,         // ms: a bot plan slower than this defers its first step to the next alarm
  saveGap: 2000,        // persist when the next timer is further away than this (idle points)
};
const VER = protoVer();
const PIECE_ORDER = ['pawn', 'knight', 'bishop', 'rook', 'queen'];
const BOT_NAMES = ['Morphy', 'Tal', 'Capablanca', 'Lasker', 'Alekhine', 'Petrosian', 'Botvinnik', 'Steinitz', 'Anderssen', 'Philidor', 'Nimzo', 'Reti', 'Polgar', 'Rubinstein'];
const VID_RE = /^[A-Za-z0-9_-]{6,64}$/, TOK_RE = /^[A-Za-z0-9_-]{8,64}$/;
const own = (o, k) => typeof k === 'string' && k.length <= 40 && Object.prototype.hasOwnProperty.call(o, k);
const str = (v, n) => (typeof v === 'string' ? v : '').replace(/[<>]/g, '').slice(0, n);
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const LEVELS = ['easy', 'normal', 'hard'];

function sanitizePts(p) {
  const out = { hp: 0, atk: 0, def: 0, spd: 0 }; let left = STAT_POINTS;
  for (const k of Object.keys(out)) { const v = Math.max(0, Math.min(left, Math.floor(+((p || {})[k]) || 0))); out[k] = v; left -= v; }
  return out;
}
function cleanAvatar(a) {
  if (typeof a === 'string') return a.slice(0, 40);
  if (!a || typeof a !== 'object') return undefined;
  const o = {}; for (const k of Object.keys(a).slice(0, 4)) if (typeof a[k] === 'string' && k.length <= 12) o[k] = a[k].slice(0, 24);
  return o;
}
// main.js join handler: the same cleaning the host did
function cleanProfile(name, pr) {
  const b = (pr && pr.build) || {};
  const equips = {}; for (const pc of PIECE_ORDER) equips[pc] = PIECES[pc].equips.includes(b.equips && b.equips[pc]) ? b.equips[pc] : PIECES[pc].equips[0];
  const nm = typeof name === 'string' && name.trim() ? name : 'Player';
  return {
    name: str(nm, 14) || 'Player', title: str(pr && pr.title, 24),
    skin: own(SKINS, pr && pr.skin) ? pr.skin : 'ivory', finisher: own(FINISHERS, pr && pr.finisher) ? pr.finisher : 'shatter', trail: own(TRAILS, pr && pr.trail) ? pr.trail : 'none',
    avatar: cleanAvatar(pr && pr.avatar),
    build: { pts: sanitizePts(b.pts), passive: own(PASSIVES, b.passive) ? b.passive : 'regen', equips },
  };
}
// main.js botPlayer
function botPlayer(i, used, leaderSkin, level) {
  const names = BOT_NAMES.filter((n) => !used.includes(n));
  const name = names[Math.floor(Math.random() * names.length)] || 'Bot' + i;
  const keys = Object.keys(PRESETS), p = PRESETS[keys[Math.floor(Math.random() * keys.length)]];
  const equips = {}; for (const pc of PIECE_ORDER) { const list = PIECES[pc].equips; equips[pc] = list[Math.floor(Math.random() * list.length)]; }
  const pks = Object.keys(PASSIVES), passive = Math.random() < 0.3 ? pks[Math.floor(Math.random() * pks.length)] : p.passive;
  const skins = Object.keys(SKINS).filter((k) => k !== leaderSkin && SKINS[k].price != null), fins = Object.keys(FINISHERS).filter((k) => FINISHERS[k].price != null);
  const trails = Object.keys(TRAILS);
  return { pid: 'bot' + i + Math.random().toString(36).slice(2, 6), name, isBot: true, botLevel: LEVELS.includes(level) ? level : 'normal', title: '', skin: pick(skins), finisher: pick(fins), trail: pick(trails), build: { pts: { ...p.pts }, passive, equips } };
}
// public seat id from the client's secret token (others only ever see this)
async function pidOf(tok) {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode('cc-seat:' + tok)));
  const A = 'abcdefghijkmnpqrstuvwxyz23456789'; let s = 'p';
  for (let i = 0; i < 9; i++) s += A[d[i] & 31];
  return s;
}
// 17.0 (S2): replay id suggested to replay.save (rec.id); RP may keep it or answer its own
const ridOf = () => { const A = 'abcdefghjkmnpqrstuvwxyz23456789', b = crypto.getRandomValues(new Uint8Array(10)); let s = 'r'; for (let i = 0; i < 10; i++) s += A[b[i] % A.length]; return s; };
const cleanAct = (a) => {
  if (!a || typeof a !== 'object' || typeof a.type !== 'string' || a.type.length > 12) return null;
  const o = { type: a.type };
  if (Number.isInteger(a.x)) o.x = a.x; if (Number.isInteger(a.y)) o.y = a.y;
  if (typeof a.slot === 'string' && a.slot.length <= 12) o.slot = a.slot;
  if (typeof a.to === 'string' && a.to.length <= 16) o.to = a.to;
  return o;
};

export class RoomCore {
  constructor(R, io, o = {}) {
    this.R = R; this.io = io; this.test = !!o.test;
    this.T = { ...T };
    if (R && R.T) Object.assign(this.T, R.T); // test overrides survive hibernation
    this.cpu = { act: [], plan: [], msg: [], alarm: [] };
    this.lastSync = new Map();
  }
  exists() { return !!this.R; }
  get now() { return this.io.now(); }

  // ---------- lifecycle ----------
  async init(code) {
    const R = this.R;
    if (R && (R.players.length || this.io.sockets().length || this.now - R.created < this.T.reserve)) return false;
    this.R = {
      code, created: this.now, leader: null, players: [], gameMode: 'royale', maxP: MODES.royale.players[1],
      party: { group: 'competitive', loc: 'random', custom: null }, m: null, mid: null,
      t: { clean: this.now + this.T.reserve }, bl: {}, chatRL: {}, vc: {}, vcRL: {},
    };
    if (this.test) this.R.T = {};
    await this.flush(true);
    return true;
  }
  async onOpen() { if (this.R && this.R.t.clean) { /* a socket is connecting: hello will clear the clean timer */ } }

  // ---------- helpers ----------
  socks() { return this.io.sockets(); }
  conn(pid) { return this.socks().filter((x) => x.pid === pid); }
  online(pid) { return this.conn(pid).length > 0; }
  sendTo(pid, o) { const s = JSON.stringify(o); for (const x of this.conn(pid)) this.io.send(x.ws, s); }
  sendWs(ws, o) { this.io.send(ws, JSON.stringify(o)); }
  bcast(o, filter) { const s = JSON.stringify(o); for (const x of this.socks()) if (!filter || filter(x.pid)) this.io.send(x.ws, s); }
  player(pid) { return this.R.players.find((p) => p.pid === pid) || null; }
  humans() { return this.R.players.filter((p) => !p.isBot); }
  live() { const m = this.R.m; return !!(m && !m.s.over); }
  unitOf(pid) { const m = this.R.m; return m ? m.s.units.find((u) => u.pid === pid && u.kind === 'player') || null : null; }
  dlLeft() { const m = this.R.m; return m && m.deadline ? Math.max(0, m.deadline - this.now) : -1; }
  paused() { return !this.humans().some((p) => this.online(p.pid)); }

  fixLeader() {
    const R = this.R, cur = this.player(R.leader);
    if (cur && !cur.isBot && (this.online(cur.pid) || !this.humans().some((p) => p.pid !== cur.pid && this.online(p.pid)))) return;
    const next = this.humans().find((p) => this.online(p.pid)) || this.humans()[0] || null;
    R.leader = next ? next.pid : null;
  }
  memberState(p) {
    const R = this.R;
    if (p.away) return 'away';
    if (p.pid === R.leader) return 'leader';
    if (p.isBot) return 'bot';
    if (this.live() && R.m.seats.includes(p.pid) && !p.back) return 'play';
    if (p.ready) return 'ready';
    return R.mid && !p.back && R.m && R.m.seats.includes(p.pid) ? 'results' : 'wait';
  }
  partyPub() {
    const R = this.R, P = R.party, loc = P.group === 'custom' ? P.loc : 'random', L = loc && loc !== 'random' && LOCATIONS[loc]; // 17.0 (D2)
    const o = { group: P.group, mode: R.gameMode, loc, locName: L ? L.name : 'Random', custom: P.group === 'custom' ? cleanRules(P.custom) : null, live: this.live(), leader: (this.player(R.leader) || {}).name || 'Leader' };
    if (R.replay && R.replay.id) o.replay = { mid: R.replay.mid, id: R.replay.id }; // 17.0 (S2): last match's replay
    return o;
  }
  lobbyMsg() {
    const R = this.R;
    const players = R.players.map((p) => { const o = { pid: p.pid, name: p.name, skin: p.skin, isBot: !!p.isBot, title: p.title || '', st: this.memberState(p) }; if (p.avatar) o.avatar = p.avatar; return o; });
    return { t: 'lobby', players, code: R.code, mode: R.gameMode, maxP: R.maxP, leader: R.leader, party: this.partyPub() };
  }
  lobby() { this.bcast(this.lobbyMsg()); this.dirty = true; this.lobbyChanged = true; }

  // ---------- timers (one DO alarm = the earliest of these) ----------
  async arm() {
    const t = this.R ? this.R.t : {}; let at = 0;
    for (const k of Object.keys(t)) { const v = k === 'say' ? (t.say || []).reduce((a, x) => Math.min(a, x.at), Infinity) : t[k]; if (v && v !== Infinity && (!at || v < at)) at = v; }
    await this.io.arm(at);
    return at;
  }
  // persist at idle points (and always after lobby/party changes): bots chain alarms every ~0.5 s, so a match
  // writes storage about once per human turn, not once per action
  async flush(force) {
    const at = await this.arm();
    if (!this.R) return;
    if (force || this.lobbyChanged || (this.dirty && (!at || at - this.now > this.T.saveGap))) { await this.io.save(this.R); this.dirty = false; this.lobbyChanged = false; }
  }
  roomEmpty() { if (!this.socks().length) this.R.t.clean = this.now + this.T.clean; }

  // ---------- socket events ----------
  async onMessage(ws, pid, m) {
    if (!this.R) { this.sendWs(ws, { t: 'bye', why: 'closed', reason: 'closed' }); this.io.close(ws, 4004, 'closed'); return; }
    const t0 = performance.now();
    try {
      if (m.t === 'hello') { if (!pid) await this.hello(ws, m); }
      else if (pid && this.player(pid)) await this.handle(ws, pid, m);
      else if (pid && m.t === 'sync') this.sync(ws, pid);
    } finally { this.cpu.msg.push(performance.now() - t0); if (this.cpu.msg.length > 4000) this.cpu.msg.splice(0, 2000); }
    if (m.t === 'test' && this.test) await this.testOp(ws, m);
    await this.flush();
  }
  async onClose(pid) {
    if (!this.R) return;
    const R = this.R, p = pid && this.player(pid);
    if (p && !this.online(pid)) {
      delete R.bl[pid];
      if (R.vc[pid]) { delete R.vc[pid]; this.vcRoster(); }
      p.away = this.now; p.awayUntil = this.now + (this.live() && R.m.seats.includes(pid) ? this.T.resume : this.T.awayLobby);
      if (this.live()) { this.setBot(pid, true, 'drop'); const h = R.m.hum && R.m.hum[pid]; if (h) h.drops = (h.drops || 0) + 1; }
      this.fixLeader();
      this.lobby();
      this.awayTimer();
      if (this.live() && this.paused()) this.schedule();
    }
    this.roomEmpty();
    await this.flush(true);
  }
  async onAlarm() {
    if (!this.R) { await this.io.arm(0); return; }
    const t0 = performance.now();
    const R = this.R, t = R.t, now = this.now;
    if (t.clean && t.clean <= now) {
      t.clean = 0;
      if (!this.socks().length) { this.R = null; await this.io.arm(0); await this.io.wipe(); return; }
    }
    if (t.intro && t.intro <= now) { t.intro = 0; this.go(); }
    if (t.turn && t.turn <= now) { t.turn = 0; this.timeout(); }
    if (t.bot && t.bot <= now) { t.bot = 0; this.botStep(); }
    if (t.away && t.away <= now) { t.away = 0; this.awayExpire(); }
    if (t.say && t.say.length) { const due = t.say.filter((x) => x.at <= now); t.say = t.say.filter((x) => x.at > now); for (const x of due) this.chat(x.pid, { k: x.k }); }
    this.cpu.alarm.push(performance.now() - t0); if (this.cpu.alarm.length > 4000) this.cpu.alarm.splice(0, 2000);
    await this.flush();
  }

  // ---------- hello / seats ----------
  async hello(ws, m) {
    const R = this.R;
    if (m.ver !== VER) { this.sendWs(ws, { t: 'bye', why: 'update', reason: 'update', ver: VER }); this.io.close(ws, 4001, 'update'); return; }
    const tok = typeof m.pid === 'string' ? m.pid : typeof m.token === 'string' ? m.token : '';
    if (!TOK_RE.test(tok)) { this.sendWs(ws, { t: 'bye', why: 'bad', reason: 'bad' }); this.io.close(ws, 4002, 'bad'); return; }
    const pid = await pidOf(tok);
    let p = this.player(pid);
    if (p) {
      // same seat again (reconnect, reload, second tab): the newest socket wins
      for (const x of this.conn(pid)) if (x.ws !== ws) { this.sendWs(x.ws, { t: 'bye', why: 'replaced', reason: 'replaced' }); this.io.close(x.ws, 4003, 'replaced'); }
      p.away = 0; p.awayUntil = 0; this.awayTimer();
    } else {
      if (this.live()) { this.sendWs(ws, { t: 'bye', why: 'started', reason: 'started' }); this.io.close(ws, 4005, 'started'); return; }
      if (R.players.length >= R.maxP) { this.sendWs(ws, { t: 'bye', why: 'full', reason: 'full' }); this.io.close(ws, 4006, 'full'); return; }
      const pr = m.profile && typeof m.profile === 'object' ? m.profile : m;
      p = { pid, ...cleanProfile(m.name, pr), isBot: false, ready: false, back: false, away: 0, awayUntil: 0 };
      if (LEVELS.includes(pr.botLevel)) p.botLevel = pr.botLevel;
      R.players.push(p);
      if (!R.leader || !this.player(R.leader) || this.player(R.leader).isBot) {
        R.leader = pid;
        if (R.players.filter((x) => !x.isBot).length === 1 && !R.mid) { const gm = pr.mode === 'daily' ? 'royale' : pr.mode; if (modesIn('custom').includes(gm)) this.setMode(gm, true); }
      }
    }
    this.io.bind(ws, pid);
    R.t.clean = 0;
    this.identify(pid, m);
    this.sendWs(ws, { t: 'welcome', pid, room: R.code, leader: R.leader, ver: VER });
    this.fixLeader();
    this.lobby();
    if (R.vc && Object.keys(R.vc).length) this.sendWs(ws, this.rosterMsg());
    // back into a match: live, or over but not yet back in the party lobby (results)
    const mm = R.m, u = mm && this.unitOf(pid);
    if (u && !p.left && !p.back && mm.seats.includes(pid)) {
      this.sendWs(ws, this.startMsg(pid, true));
      this.sendWs(ws, { t: 'snap', v: mm.s.v, mid: mm.mid, state: mm.s, dl: this.dlLeft() });
      if (!mm.s.over) { this.setBot(pid, false, 'back'); this.schedule(true); }
    }
    this.dirty = true;
  }
  // 17.0 (S2) Identity: hello.cid + hello.cproof (the cloud save id + secret) checked once per connection against the
  // Player DO (io.verify = P's verifyPlayer). Runs in the background (welcome is not held up); cproof is never stored,
  // logged or echoed. Only verified seats carry a cid into the match record (ratings / boards count those only).
  identify(pid, m) {
    const p = this.player(pid); if (!p) return;
    const cid = typeof m.cid === 'string' ? m.cid.toUpperCase() : '', proof = typeof m.cproof === 'string' ? m.cproof : '';
    if (!cid || !proof || !/^[0-9A-Z]{10}$/.test(cid) || proof.length > 64 || !this.io.verify) {
      if (!cid) { p.cid = null; p.verified = false; }
      return;
    }
    if (p.verified && p.cid === cid) return; // same seat, same id, already proven (reconnect)
    const seq = (p.vseq = (p.vseq || 0) + 1);
    const job = Promise.resolve().then(() => this.io.verify(cid, proof)).catch(() => null).then((r) => {
      const q = this.R && this.player(pid); if (!q || q.vseq !== seq) return;
      q.verified = !!(r && r.ok); q.cid = q.verified ? cid : null;
      if (q.verified) { q.pub = { name: r.name || null, title: r.title || null, avatar: r.avatar || null }; }
      const h = this.R.m && this.R.m.hum && this.R.m.hum[pid]; if (h && q.verified) { h.cid = cid; h.verified = true; }
      this.dirty = true; this.lobbyChanged = true;
      this.sendTo(pid, { t: 'ident', cid: q.cid, verified: q.verified });
      return this.flush();
    });
    if (this.io.bg) this.io.bg(job);
  }
  setBot(pid, on, why) {
    const m = this.R.m; if (!m || m.s.over) return;
    const u = this.unitOf(pid); if (!u || u.bot === on) return;
    u.bot = on;
    this.bcast({ t: 'seat', pid, id: u.id, bot: on, why });
    if (m.s.active === u.id) this.schedule(true);
  }
  awayTimer() {
    const t = this.R.players.reduce((a, p) => (p.awayUntil && (!a || p.awayUntil < a) ? p.awayUntil : a), 0);
    this.R.t.away = t || 0;
  }
  awayExpire() {
    const R = this.R, now = this.now;
    const gone = R.players.filter((p) => p.away && p.awayUntil && p.awayUntil <= now && !this.online(p.pid));
    if (gone.length) { R.players = R.players.filter((p) => !gone.includes(p)); for (const p of gone) { delete R.bl[p.pid]; } this.fixLeader(); this.lobby(); }
    this.awayTimer();
  }
  removePlayer(pid, why) {
    const R = this.R;
    if (this.live() && R.m.seats.includes(pid)) { const p = this.player(pid); if (p) p.left = true; this.setBot(pid, true, 'leave'); }
    R.players = R.players.filter((p) => p.pid !== pid);
    delete R.bl[pid]; if (R.vc[pid]) { delete R.vc[pid]; this.vcRoster(); }
    for (const x of this.conn(pid)) { if (why) this.sendWs(x.ws, { t: 'bye', why, reason: why }); this.io.close(x.ws, 1000, why || 'part'); }
    this.fixLeader(); this.lobby();
    this.roomEmpty();
  }

  // ---------- messages from a seated client ----------
  handle(ws, pid, m) {
    const R = this.R, p = this.player(pid);
    switch (m.t) {
      case 'act': {
        const mm = R.m; if (!mm || mm.s.over || mm.introUntil) return;
        const a = cleanAct(m.a); if (!a) return;
        const u = unitById(mm.s, mm.s.active);
        if (!u || u.pid !== pid || u.bot) return; // a bot holds this seat (or not your turn)
        if (Number.isInteger(m.n) && m.n !== mm.s.v) { this.sendWs(ws, { t: 'nack', n: m.n, v: mm.s.v }); return; }
        if (!this.act(pid, a)) this.sendWs(ws, { t: 'nack', n: mm.s.v, v: mm.s.v });
        return;
      }
      case 'sync': this.sync(ws, pid); return;
      case 'chat': return this.chat(pid, m); // a Promise when a custom phrase is being moderated
      case 'emote': this.chat(pid, { k: m.k }); return;
      case 'vc': this.vcMsg(pid, m); return;
      case 'bl': { const ms = +m.ms; if (Number.isFinite(ms)) R.bl[pid] = { ms: Math.max(0, Math.min(10000, ms)), at: this.now }; return; }
      case 'ready': if (this.live()) return; p.ready = !!m.on; p.back = true; this.lobby(); return;
      case 'back': p.back = true; this.lobby(); return;
      case 'leave': { // forfeit: a bot takes the seat, the player stays in the party
        if (!this.live() || !R.m.seats.includes(pid) || p.left) return;
        p.left = true; this.setBot(pid, true, 'leave'); this.lobby(); return;
      }
      case 'part': this.removePlayer(pid, null); return;
      case 'lead': if (pid === R.leader) this.lead(ws, pid, m); else this.sendWs(ws, { t: 'err', why: 'Only the party leader can do that' }); return;
      default:
    }
  }
  sync(ws, pid) {
    const mm = this.R.m; if (!mm) return;
    const last = this.lastSync.get(pid) || 0; if (this.now - last < 1500) return; this.lastSync.set(pid, this.now);
    this.sendWs(ws, { t: 'snap', v: mm.s.v, mid: mm.mid, state: mm.s, dl: this.dlLeft() });
  }

  // ---------- leader commands (party.js mount click handler + main.js add/fill/kick/start) ----------
  setMode(id, quiet) {
    const R = this.R, M = MODES[id]; if (!M) return 'Unknown mode';
    const max = M.players[1], humans = this.humans().length;
    if (humans > max) return `${M.name} seats ${max}. Remove someone first.`;
    R.gameMode = id; R.maxP = max;
    while (R.players.length > max) { const i = R.players.map((p) => !!p.isBot).lastIndexOf(true); if (i < 0) break; R.players.splice(i, 1); }
    if (!quiet && R.party.group !== 'custom' && groupOf(id) !== R.party.group) R.party.group = groupOf(id);
    if (quiet) { const g = groupOf(id); R.party.group = g === 'challenge' ? 'competitive' : g; }
    return null;
  }
  lead(ws, pid, m) {
    const R = this.R, P = R.party, err = (why) => this.sendWs(ws, { t: 'err', op: m.op, why });
    if (this.live() && m.op !== 'kick') return err('Wait for the match to finish');
    switch (m.op) {
      case 'group': { const g = m.group ?? m.v; const list = modesIn(g); if (!list.length) return err('Unknown group'); P.group = g; if (g !== 'custom' && groupOf(R.gameMode) !== g) { const e = this.setMode(list[0]); if (e) return err(e); } else if (g === 'custom') P.custom ||= defaultRules(); break; }
      case 'mode': { const v = m.mode ?? m.v; if (!modesIn(P.group).includes(v)) return err('That mode is not in this group'); const e = this.setMode(v); if (e) return err(e); break; }
      case 'location': { const v = m.loc ?? m.location ?? m.v; P.loc = v === 'random' || own(LOCATIONS, v) ? v : 'random'; break; }
      case 'custom': {
        if (m.custom && typeof m.custom === 'object') P.custom = cleanRules(m.custom);
        else { const r = RULES.find((x) => x.k === m.k); if (!r) return err('Unknown rule'); const o = r.opts.find(([x]) => x === m.v || String(x) === String(m.v)); if (!o) return err('Unknown value'); (P.custom ||= defaultRules())[r.k] = o[0]; }
        break;
      }
      case 'add-bot': if (R.players.length >= R.maxP) return err('The party is full'); this.addBot(m.lv); break;
      case 'fill-bots': if (R.players.length >= R.maxP) return err('The party is full'); while (R.players.length < R.maxP) this.addBot(m.lv); break;
      case 'clear-bots': R.players = R.players.filter((p) => !p.isBot); break;
      case 'kick': {
        const t = this.player(m.pid); if (!t || t.pid === pid) return err('No such player');
        if (this.live()) return err('Wait for the match to finish');
        if (t.isBot) R.players = R.players.filter((p) => p !== t); else { this.removePlayer(t.pid, 'kicked'); return; }
        break;
      }
      case 'start': { const e = this.start(); if (e) return err(e); return; }
      default: return err('Unknown command');
    }
    this.lobby();
  }
  addBot(lv) {
    const R = this.R, L = this.player(R.leader) || {};
    R.players.push(botPlayer(R.players.length, R.players.map((p) => p.name), L.skin, LEVELS.includes(lv) ? lv : L.botLevel || 'normal'));
  }

  // ---------- match ----------
  matchOpts() {
    const R = this.R, P = R.party, o = { mode: R.gameMode };
    if (P.group === 'custom' && P.loc && P.loc !== 'random') o.location = P.loc; // 17.0 (D2): leader's location only in Custom; other matches roll one from the seed
    if (P.group === 'custom') o.custom = cleanRules(P.custom);
    return o;
  }
  start() {
    const R = this.R;
    // main.js startHost: members whose link is down are left out; then party.canStart
    // N2 17.0: a member whose link is down but still inside the lobby away window keeps the seat (a bot plays it until
    // their resume), like a mid-match drop; before, a phone that was reconnecting at Start lost the party ('started')
    R.players = R.players.filter((p) => p.isBot || this.online(p.pid) || (p.away && p.awayUntil > this.now));
    this.fixLeader();
    const M = MODES[R.gameMode], minP = Math.max(2, M.players[0]);
    if (R.players.length < minP) { this.lobby(); return `${M.name} needs at least ${minP} players. Add bots to fill.`; }
    const w = R.players.filter((p) => !p.isBot && p.pid !== R.leader && !p.ready && !(p.away && !this.online(p.pid))); // N2 17.0: like party.waiting(), a reconnecting member does not hold the party up
    if (w.length) { this.lobby(); return `Waiting for ${w.length === 1 ? w[0].name : w.length + ' players'} to ready up`; }
    const players = R.players.map((p) => { const o = { pid: p.pid, name: p.name, title: p.title || '', skin: p.skin, finisher: p.finisher, trail: p.trail, build: p.build }; if (p.isBot) { o.isBot = true; o.botLevel = p.botLevel || 'normal'; } return o; });
    const seed = (crypto.getRandomValues(new Uint32Array(1))[0] & 0x7fffffff) | 0;
    const opts = this.matchOpts();
    const t0 = performance.now();
    const s = createMatch(players, seed, opts);
    this.cpu.create = performance.now() - t0;
    const mid = 'm' + this.now.toString(36) + Math.random().toString(36).slice(2, 6);
    const introMs = this.T.introMs != null ? this.T.introMs : introHold(s);
    for (const p of R.players) { p.ready = false; p.back = false; p.left = false; }
    R.mid = mid; R.bl = {};
    R.m = { mid, seed, players, opts, introMs, s, seats: players.filter((p) => !p.isBot).map((p) => p.pid), introUntil: introMs > 0 ? this.now + introMs : 0, deadline: 0, lastTurn: -1, bot: null };
    // 17.0 (S2): match record (start args are the exact createMatch inputs; acts grows in act())
    R.m.t0 = this.now; R.m.acts = []; R.m.hum = {};
    for (const p of R.players) if (!p.isBot) R.m.hum[p.pid] = { name: p.name, cid: p.verified ? p.cid : null, verified: !!p.verified, title: p.title || '', avatar: p.avatar || null, drops: 0, left: false };
    R.replay = null;
    for (const x of this.socks()) this.sendWs(x.ws, this.startMsg(x.pid, false));
    for (const p of R.players) if (!p.isBot && !this.online(p.pid)) { p.awayUntil = this.now + this.T.resume; this.setBot(p.pid, true, 'drop'); } // N2 17.0: seat kept for a resume
    this.awayTimer();
    this.lobby();
    if (introMs > 0) R.t.intro = R.m.introUntil; else this.schedule(true);
    this.dirty = true; this.lobbyChanged = true;
    return null;
  }
  startMsg(pid, resume) {
    const m = this.R.m;
    const o = { t: 'start', mid: m.mid, seed: m.seed, players: m.players, opts: m.opts, introMs: resume ? Math.max(0, m.introUntil - this.now) : m.introMs, pid };
    if (resume) o.resume = true;
    return o;
  }
  go() { const m = this.R.m; if (!m || !m.introUntil) return; m.introUntil = 0; this.R.t.intro = 0; this.schedule(true); }
  // net.js GameHost.schedule. Returns nothing; tells clients about a clock that changed without an action when
  // announce is set (otherwise the caller's {t:'a'} carries dl).
  schedule(announce) {
    const R = this.R, m = R.m; R.t.bot = 0; R.t.turn = 0;
    if (!m || m.s.over || m.introUntil) return;
    if (this.paused()) return; // nobody connected: hold everything until someone is back
    const s = m.s, u = unitById(s, s.active); if (!u) return;
    const botU = u.kind === 'hollow' || u.bot, now = this.now;
    let changed = false;
    if (s.turnNo !== m.lastTurn) { m.lastTurn = s.turnNo; m.bot = null; m.deadline = botU ? 0 : now + (this.T.turnMs || (s.rules && s.rules.turnMs) || TURN_MS) + this.T.turnGrace; changed = !botU; }
    if (botU) {
      if (!m.bot || m.bot.id !== u.id || m.bot.turn !== s.turnNo) {
        m.bot = { id: u.id, turn: s.turnNo, plan: null, i: 0 };
        R.t.bot = now + this.thinkMs(u);
      } else R.t.bot = now + (m.bot.plan ? this.stepMs(u) : this.thinkMs(u));
    } else {
      m.bot = null;
      if (!m.deadline) { m.deadline = now + (this.T.turnMs || (s.rules && s.rules.turnMs) || TURN_MS) + this.T.turnGrace; changed = true; }
      R.t.turn = m.deadline;
    }
    if (announce && changed) this.bcast({ t: 'dl', v: s.v, dl: this.dlLeft() });
  }
  thinkMs(u) {
    if (this.T.fast) return 0;
    // 15.1: bots wait for the slowest human's playback (backlog reports, at most 3 s)
    let bl = 0; for (const [pid, b] of Object.entries(this.R.bl)) if (this.now - b.at < this.T.blStale && this.online(pid)) bl = Math.max(bl, b.ms);
    const lag = Math.min(this.T.lagCap, Math.max(0, bl - this.T.lagFree));
    return (u.kind === 'hollow' ? this.T.thinkHollow : this.T.think) + lag;
  }
  stepMs(u) { return this.T.fast ? 0 : u.kind === 'hollow' ? this.T.stepHollow : this.T.step; }
  botStep() {
    const m = this.R.m; if (!m) return;
    const s = m.s, b = m.bot;
    if (!b || s.over || s.active !== b.id || s.turnNo !== b.turn) { this.schedule(true); return; }
    const u = unitById(s, b.id);
    if (!u || !(u.kind === 'hollow' || u.bot)) { this.schedule(true); return; }
    if (!b.plan) {
      const t0 = performance.now();
      b.plan = u.kind === 'hollow' ? planHollow(s, u) : planBot(s, u);
      const dt = performance.now() - t0; this.cpu.plan.push(dt); if (this.cpu.plan.length > 4000) this.cpu.plan.splice(0, 2000);
      if (dt > this.T.planSplit) { this.R.t.bot = this.now; return; } // CPU split: first step in the next alarm
    }
    if (b.i >= b.plan.length) { this.act(u.pid, { type: 'end' }); return; }
    const a = b.plan[b.i++];
    if (!this.act(u.pid, a)) this.R.t.bot = this.now + this.stepMs(u);
  }
  timeout() {
    const m = this.R.m; if (!m || m.s.over || m.introUntil) return;
    const u = unitById(m.s, m.s.active);
    if (!u || u.kind === 'hollow' || u.bot) { this.schedule(true); return; }
    if (m.deadline && this.now >= m.deadline - 5) this.act(u.pid, { type: 'end' }, true); else this.schedule();
  }
  act(pid, a, to) {
    const R = this.R, m = R.m, s = m.s;
    const t0 = performance.now();
    const r = applyAction(s, pid, a);
    const dt = performance.now() - t0; this.cpu.act.push(dt); if (this.cpu.act.length > 4000) this.cpu.act.splice(0, 2000);
    if (!r.ok) return false;
    this.dirty = true;
    if (m.acts) m.acts.push(to ? [pid ?? null, { ...a }, 1] : [pid ?? null, { ...a }]); // null pid = a Hollow (replay with pid ?? undefined) // 17.0 (S2) record: every accepted action, in order
    this.schedule(false);
    const o = { t: 'a', v: s.v, pid, a, dl: this.dlLeft() }; if (to) o.to = 1;
    this.bcast(o);
    if (this.test && m.protect && this.protect(s)) this.bcast({ t: 'snap', v: s.v, mid: m.mid, state: s, dl: this.dlLeft() });
    if (s.v % this.T.hashEvery === 0) this.bcast({ t: 'h', v: s.v, x: stateHash(s) });
    this.botChatter(r.ev);
    if (s.over) this.over();
    return true;
  }
  over() {
    const R = this.R, m = R.m, s = m.s;
    R.t.bot = 0; R.t.turn = 0; m.deadline = 0;
    this.bcast({ t: 'h', v: s.v, x: stateHash(s) });
    this.bcast({ t: 'over', mid: m.mid, v: s.v, winner: s.winner });
    for (const p of R.players) if (p.left) { const h = m.hum && m.hum[p.pid]; if (h) h.left = true; p.left = false; }
    this.lobby();
    this.ended();
  }
  // 17.0 (S2): the match record, handed to hooks.js matchEnded (stats, boards, replays, analytics) by the Room
  record() {
    const R = this.R, m = R.m, s = m.s;
    const humans = {};
    for (const pid of m.seats) {
      const h = (m.hum && m.hum[pid]) || {}, p = this.player(pid);
      const verified = !!(h.verified || (p && p.verified && p.cid));
      const cid = verified ? h.cid || (p && p.cid) || null : null;
      humans[pid] = { name: h.name || (p && p.name) || 'Player', cid, verified: verified && !!cid, title: h.title || '', avatar: h.avatar || null, drops: h.drops || 0, left: !!h.left };
      if (p && p.pub && verified) humans[pid].pub = p.pub; // name/title/avatar from the saved cloud profile (P's verify)
    }
    const win = s.winner != null ? s.units.find((u) => u.id === s.winner) : null;
    const places = s.units.filter((u) => u.kind === 'player').map((u) => ({ pid: u.pid, id: u.id, name: u.name, place: u.place || 0, bot: !m.seats.includes(u.pid), team: u.team != null ? u.team : null }));
    return {
      v: 1, id: m.rid || null, mid: m.mid, room: R.code, ver: VER, mode: s.mode, location: s.location || null, t0: m.t0 || 0, t1: this.now,
      start: { players: m.players, seed: m.seed, opts: m.opts },
      actions: m.acts || [], humans, seats: humans, // seats = humans (A / RP read rec.seats)
      result: { winner: s.winner, winnerPid: win ? win.pid : null, team: win && win.team != null ? win.team : null, places, rounds: s.round, siegeWon: !!s.siegeWon, wave: s.siege ? s.siege.wave : null, v: s.v, hash: stateHash(s) },
      ...(m.tampered ? { tampered: true } : {}),
    };
  }
  ended() {
    const R = this.R, m = R.m; if (!m || m.ended) return;
    m.ended = true;
    let rec; try { m.rid = m.rid || ridOf(); rec = this.record(); } catch (e) { return; }
    // A's fast path: the final state rides along in memory only (non-enumerable: JSON / storage never carry it)
    try { Object.defineProperty(rec, 'state', { value: m.s, enumerable: false }); } catch {}
    if (this.test) this.lastRec = rec;
    if (!this.io.ended) return;
    const mid = m.mid;
    const job = Promise.resolve().then(() => this.io.ended(rec)).catch(() => null).then((id) => {
      if (!id || !this.R || !this.R.m || this.R.m.mid !== mid) return;
      this.R.m.replay = id; this.R.replay = { mid, id };
      this.bcast({ t: 'replay', mid, id, replay: id });
      this.lobby();
      return this.flush(true);
    });
    if (this.io.bg) this.io.bg(job);
  }

  // ---------- chat (main.js hostChat/botChatter, js/chat.js hostCheck) ----------
  chat(pid, raw) {
    const R = this.R, m = R.m; if (!m) return;
    const r = hostCheck(R.chatRL, pid, raw, m.s, this.now); if (!r) return;
    if (r.slow) { this.sendTo(pid, { t: 'chat', a: 'slow' }); return; }
    const out = r.out, team = out.team; delete out.team;
    if (out.x && this.io.moderate) return this.modChat(pid, out, team); // 17.0 (S2): custom text goes past the model first
    this.deliver(out, team);
  }
  deliver(out, team) {
    const teamOf = (p) => { const u = this.unitOf(p); return u ? u.team : undefined; };
    this.bcast(out, (p) => team == null || teamOf(p) === team);
  }
  // 17.0 (S2): custom phrases (already cleaned + word-filtered by chat.js) are checked by Workers AI (Llama Guard) via
  // io.moderate -> {ok, src}. Unsafe = shadowed (only the sender sees their line, so nobody learns to dodge the check).
  // Any failure (no AI locally, budget spent, timeout) delivers the word-filtered text: the filter is the fallback.
  async modChat(pid, out, team) {
    const st = this.modStats || (this.modStats = { n: 0, blocked: 0, src: {} });
    let v = null; try { v = await this.io.moderate(out.x); } catch {}
    st.n++; const src = (v && v.src) || 'error'; st.src[src] = (st.src[src] || 0) + 1; st.last = v ? { ok: v.ok, src, why: v.why } : null;
    if (!this.R || !this.R.m) return;
    if (v && v.ok === false) { st.blocked++; this.sendTo(pid, out); return; }
    this.deliver(out, team);
  }
  botChatter(ev) {
    const R = this.R, s = R.m.s;
    for (const e of ev || []) {
      if (e.e !== 'death') continue;
      const k = e.by != null && s.units.find((v) => v.id === e.by), d = s.units.find((v) => v.id === e.id);
      if (k && k.bot && Math.random() < 0.4) (R.t.say ||= []).push({ at: this.now + 900, pid: k.pid, k: pick(BOT_LINES.kill) });
      else if (d && d.bot && d.kind === 'player' && Math.random() < 0.3) (R.t.say ||= []).push({ at: this.now + 1300, pid: d.pid, k: pick(BOT_LINES.win) });
    }
    if (R.t.say && R.t.say.length > 12) R.t.say.splice(0, R.t.say.length - 12);
  }

  // ---------- voice signalling (voice.js hostMsg/hostDrop/hostSync) ----------
  rosterMsg() { return { t: 'vc', a: 'roster', list: Object.entries(this.R.vc).map(([pid, vid]) => ({ pid, vid })) }; }
  vcRoster() { this.bcast(this.rosterMsg()); this.dirty = true; }
  vcMsg(pid, m) {
    const R = this.R, p = this.player(pid);
    if (!m || typeof m.a !== 'string' || !p || p.isBot) return;
    if (m.a === 'join') {
      if (typeof m.vid !== 'string' || !VID_RE.test(m.vid)) return;
      if (Object.entries(R.vc).some(([q, v]) => v === m.vid && q !== pid)) return;
      if (!R.vc[pid] && Object.keys(R.vc).length >= 8) return;
      R.vc[pid] = m.vid; this.vcRoster();
    } else if (m.a === 'leave') { if (R.vc[pid]) { delete R.vc[pid]; this.vcRoster(); } }
    else if (m.a === 'talk') {
      if (!R.vc[pid]) return;
      const now = this.now, st = R.vcRL[pid] || (R.vcRL[pid] = { n: 6, at: now });
      st.n = Math.min(6, st.n + (now - st.at) / 250); st.at = now; if (st.n < 1) return; st.n -= 1;
      this.bcast({ t: 'vc', a: 'talk', pid, on: m.on ? 1 : 0 });
    }
  }

  // test only: online-suite helpers (tests/online/lib.js protectHumans / hostKill)
  protect(s) {
    let ch = false;
    for (const u of s.units) if (u.alive && u.kind === 'player' && this.R.m.protect.includes(u.pid)) { const mx = stats(u).maxHp; if (u.hp < mx * 0.6) { u.hp = mx; ch = true; } }
    if (ch) this.R.m.tampered = true;
    return ch;
  }
  kill(pid) {
    const m = this.R.m; if (!m || m.s.over) return;
    const s = m.s, v = s.units.find((u) => u.pid === pid && u.kind === 'player'); if (!v || !v.alive) return;
    if (m.protect) m.protect = m.protect.filter((x) => x !== pid);
    m.tampered = true; // the record can't replay past a hand edit
    v.alive = false; v.hp = 0; v.place = alivePlayers(s).length + 1;
    const ev = [{ e: 'death', id: v.id, by: null, x: v.x, y: v.y, cause: null }];
    const left = alivePlayers(s);
    if (left.length <= 1) { s.over = true; s.winner = left[0] ? left[0].id : null; if (left[0]) left[0].place = 1; ev.push({ e: 'over', winner: s.winner }); }
    if (!s.over && s.active === v.id) nextTurn(s, ev);
    s.v++; this.dirty = true;
    this.schedule(false);
    this.bcast({ t: 'snap', v: s.v, mid: m.mid, state: s, dl: this.dlLeft(), ev });
    if (s.over) this.over();
  }

  // ---------- test hooks (only with ROOM_TEST set, e.g. `wrangler dev --var ROOM_TEST:1`) ----------
  async testOp(ws, m) {
    const R = this.R;
    if (m.op === 'set' && m.T && typeof m.T === 'object') { for (const [k, v] of Object.entries(m.T)) if (k in T || k === 'fast' || k === 'introMs' || k === 'turnMs') this.T[k] = v; R.T = { ...(R.T || {}), ...m.T }; this.dirty = true; this.lobbyChanged = true; }
    if (m.op === 'cpu') this.sendWs(ws, { t: 'test', op: 'cpu', cpu: this.cpu, now: this.now });
    if (m.op === 'cpuReset') this.cpu = { act: [], plan: [], msg: [], alarm: [] };
    if (m.op === 'state') this.sendWs(ws, { t: 'test', op: 'state', R: { ...R, m: R.m ? { ...R.m, s: undefined, v: R.m.s.v, hash: stateHash(R.m.s), over: R.m.s.over } : null }, socks: this.socks().map((x) => x.pid) });
    if (m.op === 'go') this.go();
    if (m.op === 'kill') if (R.m) this.kill(m.pid);
    if (m.op === 'protect' && R.m && Array.isArray(m.pids)) { R.m.protect = m.pids.filter((x) => typeof x === 'string').slice(0, 8); if (this.protect(R.m.s)) this.bcast({ t: 'snap', v: R.m.s.v, mid: R.m.mid, state: R.m.s, dl: this.dlLeft() }); }
    if (m.op === 'bot' && typeof m.pid === 'string') this.setBot(m.pid, m.on !== false, 'test');
    // 17.0 (S2): the last match record, moderation counters, identity of every seat
    if (m.op === 'rec') this.sendWs(ws, { t: 'test', op: 'rec', rec: this.lastRec || null, replay: R.replay || null });
    if (m.op === 'mod') this.sendWs(ws, { t: 'test', op: 'mod', mod: this.modStats || null });
    if (m.op === 'ident') this.sendWs(ws, { t: 'test', op: 'ident', seats: R.players.filter((p) => !p.isBot).map((p) => ({ pid: p.pid, cid: p.cid || null, verified: !!p.verified, pub: p.pub || null })) });
    // N2 17.0: 'put' {state, ev} = the online suite's host levers that edit the match state by hand (teamKill, ...):
    // the edited state replaces the room's (actions the room applied meanwhile are dropped: tests only) and goes out as
    // a snap with ev; v moves past the room's so the lockstep stream carries on from it
    if (m.op === 'put' && R.m && !R.m.s.over && m.state && typeof m.state === 'object' && Array.isArray(m.state.units)) {
      m.state.v = Math.max(m.state.v | 0, R.m.s.v + 1); R.m.s = m.state; R.m.tampered = true; this.dirty = true; this.schedule(false);
      this.bcast({ t: 'snap', v: m.state.v, mid: R.m.mid, state: m.state, dl: this.dlLeft(), ev: Array.isArray(m.ev) ? m.ev : [] });
      if (m.state.over) this.over();
    }
  }
}
