// 17.0 (S1): room logic (lobby, party, match, bots, clocks, chat/voice relay). Plain JS: the Room DO (room.js) feeds
// it messages, closes and alarms through an io object; tests can drive it in Node with a fake io.
// Behaviour mirrors the phone host (js/net.js GameHost + main.js startHostLobby/startHost + js/party.js) unless noted.
import { createMatch, applyAction, planBot, planHollow, unitById, alivePlayers, nextTurn, stats } from '../../js/engine.js';
import { TURN_MS, MODES, SKINS, FINISHERS, TRAILS, PASSIVES, PIECES, PRESETS, STAT_POINTS } from '../../js/data.js';
import { LOCATIONS } from '../../js/locations.js';
import { hostCheck, BOT_LINES } from '../../js/chat.js';
import { modesIn, groupOf, cleanRules, defaultRules, RULES } from '../../js/party.js';
import { stateHash, protoVer } from '../../js/statehash.js';
import { nidOf, cleanNem, nemMap, cleanRk } from '../../js/rivals.js'; // 18.0 (NE)
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
  qpWait: 45000,        // 17.1 (MM): Quick Play lobby countdown once 2+ humans are in (empty seats -> bots)
  qpFull: 3000,         // 17.1 (MM): ... and when every seat is a human
  leadGrace: 8000,      // 17.1.1 (MM): a dropped leader keeps leading this long (brief app switch) before it passes on
  spamCap: 20, spamRate: 4, // 17.3 (QS): lobby-changing messages per seat: 20 burst, then 4/s
  specCap: 8, specPerIp: 3, // 18.0 (LV): read-only spectators per room (and per hashed IP)
  mmRefresh: 240000,    // 18.0 (LV): a listed room re-reports to the Matchmaker on its next activity once this old (MM ttl 10 min)
};
const SPEC_T = new Set(['a', 'h', 'snap', 'dl', 'seat', 'over', 'replay']); // 18.0 (LV): the lockstep stream spectators get
const SPAMMY = new Set(['ready', 'back', 'leave', 'part', 'lead', 'vc']); // 17.3 (QS): see RoomCore.spam
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
  async init(code, o) {
    const R = this.R;
    if (R && (R.players.length || this.io.sockets().length || this.now - R.created < this.T.reserve)) return false;
    this.R = {
      code, created: this.now, leader: null, players: [], gameMode: 'royale', maxP: MODES.royale.players[1],
      party: { group: 'competitive', loc: 'random', custom: null }, m: null, mid: null,
      t: { clean: this.now + this.T.reserve }, bl: {}, chatRL: {}, vc: {}, vcRL: {},
    };
    if (this.test) this.R.T = {};
    // 17.1 (MM): a Quick Play room (made by the Matchmaker): public, mode fixed, auto-start countdown, no leader options
    if (o && o.qp && modesIn('custom').includes(o.mode)) { this.setMode(o.mode, true); Object.assign(this.R, { qp: true, pub: true, loc: o.loc || null, pubIp: o.ip || null }); this.R.mmKey = 'placed'; }
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
  bcast(o, filter) { const s = JSON.stringify(o); for (const x of this.socks()) if (!filter || filter(x.pid)) this.io.send(x.ws, s); if (!filter && SPEC_T.has(o.t)) this.specCast(s); }
  // 18.0 (LV): spectators (read-only sockets without a seat)
  specs(all) { return this.io.specs ? this.io.specs(all) : []; }
  specCast(s) { for (const x of this.specs()) this.io.send(x.ws, s); }
  player(pid) { return this.R.players.find((p) => p.pid === pid) || null; }
  humans() { return this.R.players.filter((p) => !p.isBot); }
  live() { const m = this.R.m; return !!(m && !m.s.over); }
  unitOf(pid) { const m = this.R.m; return m ? m.s.units.find((u) => u.pid === pid && u.kind === 'player') || null : null; }
  dlLeft() { const m = this.R.m; return m && m.deadline ? Math.max(0, m.deadline - this.now) : -1; }
  paused() { return !this.humans().some((p) => this.online(p.pid)); }

  fixLeader() {
    const R = this.R, cur = this.player(R.leader);
    if (cur && !cur.isBot && (this.online(cur.pid) || !this.humans().some((p) => p.pid !== cur.pid && this.online(p.pid)))) return;
    // 17.1.1 (MM): a leader whose link just dropped (phone app switch, network blip) keeps leading for T.leadGrace; before,
    // leadership flipped at once and both phones' screens swapped (member pushed onto Host, leader onto Join): after a
    // Quick Play match that read as "Back to Party reset the game". Gone longer -> passes (R.t.lead alarm), as before.
    if (cur && !cur.isBot && cur.away && this.now < cur.away + this.T.leadGrace) { const at = cur.away + this.T.leadGrace; if (!R.t.lead || R.t.lead > at) R.t.lead = at; return; }
    const next = this.humans().find((p) => this.online(p.pid)) || this.humans()[0] || null;
    R.leader = next ? next.pid : null;
  }
  memberState(p) {
    const R = this.R;
    if (p.away) return 'away';
    if (p.pid === R.leader) return 'leader';
    if (p.isBot) return 'bot';
    if (R.qp && !this.live()) return 'ready'; // 17.1 (MM): Quick Play has no ready step
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
    const players = R.players.map((p) => { const o = { pid: p.pid, name: p.name, skin: p.skin, isBot: !!p.isBot, title: p.title || '', st: this.memberState(p) }; if (p.avatar) o.avatar = p.avatar; if (p.verified && p.tag) o.tag = p.tag; /* 18.0 (SO): public player tag (Recent Players, add friend) */ if (p.verified && p.nid) o.nid = p.nid; if (p.verified && p.rk) o.rk = p.rk; /* 18.0 (NE): Nemesis id + rank */ return o; });
    return { t: 'lobby', players, code: R.code, mode: R.gameMode, maxP: R.maxP, leader: R.leader, party: this.partyPub(), pub: !!R.pub, qp: !!R.qp, fromQp: !!R.fromQp && !R.qp, cd: R.t.qp && !this.live() ? Math.max(0, R.t.qp - this.now) : 0 }; // 17.1 (MM): pub/qp/cd (ms to the Quick Play start)
  }
  lobby() { this.qpCheck(); this.bcast(this.lobbyMsg()); this.dirty = true; this.lobbyChanged = true; this.mmSync(); this.soSync(); } // 18.0 (SO): + friends presence
  // 18.0 (SO): friends presence. Every verified human seat's Player DO hears which room it is in and whether its match is
  // live, only when that changed (R.so), riding the lobby() calls the room already makes (join, leave, kick, start, over,
  // away expiry). A seat that left the party is reported once as gone. Background only (io.social), never awaited.
  soSync() {
    const R = this.R; if (!R || !this.io.social) return;
    const so = R.so || (R.so = {}), live = this.live(), seen = {};
    for (const p of R.players) {
      if (p.isBot || !p.verified || !p.cid) continue;
      const st = live && R.m.seats.includes(p.pid) && !p.left ? 'match' : 'lobby', pub = !!R.pub && !live;
      const k = st + (pub ? '+' : '') + R.gameMode; seen[p.pid] = 1;
      const was = so[p.pid];
      if (was && was.cid === p.cid && was.k === k) continue;
      if (was && was.cid !== p.cid) this.io.social(was.cid, { room: R.code, st: '' });
      so[p.pid] = { cid: p.cid, k }; this.dirty = true;
      this.io.social(p.cid, { room: R.code, st, mode: R.gameMode, pub });
    }
    for (const pid of Object.keys(so)) if (!seen[pid]) { this.io.social(so[pid].cid, { room: R.code, st: '' }); delete so[pid]; this.dirty = true; }
  }

  // ---------- 17.1 (MM): public matchmaking ----------
  // Quick Play countdown: 2+ humans online -> qpWait (45 s), every seat a human -> qpFull (3 s); fewer than 2 cancels.
  qpCheck() {
    const R = this.R; if (!R) return;
    if (!R.qp || this.live()) { if (R.t.qp) R.t.qp = 0; return; }
    const hum = this.humans().filter((p) => this.online(p.pid)).length;
    if (hum >= 2 && hum >= R.maxP) { const at = this.now + this.T.qpFull; if (!R.t.qp || R.t.qp > at) R.t.qp = at; }
    else if (hum >= 2) { if (!R.t.qp) R.t.qp = this.now + this.T.qpWait; }
    else R.t.qp = 0;
  }
  // countdown over (or the lone leader's Start Now): fill the empty seats with bots and start
  qpGo(force) {
    const R = this.R; R.t.qp = 0;
    if (!R.qp || this.live()) return null;
    const hum = this.humans().filter((p) => this.online(p.pid)).length;
    if (hum < (force ? 1 : 2)) { this.lobby(); return 'Waiting for players'; }
    R.players = R.players.filter((p) => p.isBot || this.online(p.pid) || (p.away && p.awayUntil > this.now));
    while (R.players.length < R.maxP) this.addBot('normal');
    for (const p of R.players) if (!p.isBot) p.ready = true;
    const e = this.start();
    if (e) { R.players = R.players.filter((p) => !p.isBot); this.lobby(); }
    return e;
  }
  // Report the public listing to the Matchmaker when it changed (in the background: never waits on it). Private rooms
  // are never sent; a room going live, private or away is unlisted.
  mmSync() {
    const R = this.R; if (!R || !this.io.mm) return;
    // 18.0 (LV): a public room stays listed while its match is live (st 'live', w spectators of wcap) so Browse can
    // offer Watch; Quick Play never hands out a live room (mmcore pick). Before 18.0 a live room was unlisted.
    const listed = !!R.pub, live = this.live();
    const info = listed ? { code: R.code, mode: R.gameMode, n: R.players.length, h: this.humans().filter((p) => this.online(p.pid)).length, cap: R.maxP, st: live ? 'live' : R.t.qp ? 'starting' : 'lobby', qp: !!R.qp, loc: R.loc || null, created: R.created, ip: R.pubIp || null, ...(live ? { w: this.specs().length, wcap: this.T.specCap } : {}) } : null;
    const key = info ? JSON.stringify(info) : '';
    // 18.0 (LV): unchanged listings re-report once R.mmAt is older than T.mmRefresh (called on room activity, see
    // mmFresh), so a quiet lobby or a long match is not pruned by the Matchmaker's 10 min ttl while the Room thinks it is listed
    if (key === (R.mmKey || '') && !(key && this.now - (R.mmAt || 0) > this.T.mmRefresh)) return;
    const was = R.mmKey; R.mmKey = key; R.mmAt = this.now; this.dirty = true;
    if (!info) { if (was) this.io.mm({ op: 'unreg', code: R.code }); return; }
    const code = R.code;
    this.io.mm({ op: 'reg', ...info }).then((r) => {
      if (!r || r.ok !== false || r.why !== 'cap' || !this.R || this.R.code !== code || this.R.qp) return;
      this.R.pub = false; this.R.mmKey = '';
      this.sendTo(this.R.leader, { t: 'err', op: 'public', why: 'You already have open public matches. Close one to list this party.' });
      this.lobby(); return this.flush(true);
    });
  }

  // 18.0 (LV): piggyback refresh: every message / alarm the room handles anyway checks whether its listing is due a
  // re-report (cheap: one comparison; a report at most every T.mmRefresh). No alarm of its own.
  mmFresh() { const R = this.R; if (R && R.mmKey && this.now - (R.mmAt || 0) > this.T.mmRefresh) this.mmSync(); }

  // ---------- 18.0 (LV): spectators ----------
  // A spectator socket (room.js /ws/room/CODE?watch=1) has no seat: it never appears in socks(), so it never keeps a
  // room alive, unpauses a match, counts as online, reports a backlog (bots' pacing ignores it) or holds a party seat.
  // It gets the lockstep stream (start + snap, then a/h/dl/seat/over/replay) and public chat/emotes; it can send only
  // watch and sync. Any room whose code you know can be watched while its match is live (public rooms are listed in
  // Browse; friends pass the code through presence), capped at T.specCap per room and T.specPerIp per hashed IP.
  canWatch(ip) {
    if (!this.R) return 'noroom';
    if (!this.live()) return 'nolive';
    const all = this.specs(true);
    if (all.length >= this.T.specCap || (ip && all.filter((x) => x.ip === ip).length >= this.T.specPerIp)) return 'watchfull';
    return null;
  }
  async onSpec(ws, a, m) {
    if (!this.R) { this.sendWs(ws, { t: 'bye', why: 'closed', reason: 'closed' }); this.io.close(ws, 4004, 'closed'); return; }
    if (m.t === 'watch' && !a.ok) {
      const bye = (why, code, extra) => { this.sendWs(ws, { t: 'bye', why, reason: why, ...(extra || {}) }); this.io.close(ws, code, why); };
      if (m.ver !== VER) return bye('update', 4001, { ver: VER });
      if (!this.live()) return bye('nolive', 4007);
      if (this.specs().length >= this.T.specCap) return bye('watchfull', 4007);
      this.io.admit(ws);
      const mm = this.R.m, n = this.specs().length;
      this.sendWs(ws, { t: 'welcome', pid: null, spec: true, room: this.R.code, ver: VER, w: n });
      const st = this.startMsg(null, true); if (mm.s.v === 0) delete st.resume; // still in the intro: play it (remaining time)
      this.sendWs(ws, st);
      if (mm.s.v > 0) this.sendWs(ws, { t: 'snap', v: mm.s.v, mid: mm.mid, state: mm.s, dl: this.dlLeft() });
      this.specNote(); this.mmSync();
      await this.flush();
      return;
    }
    if (m.t === 'sync' && a.ok && this.R.m) {
      const sy = (this.specSync ||= new Map()), last = sy.get(a.spec) || 0; if (this.now - last < 1500) return;
      sy.set(a.spec, this.now); if (sy.size > 32) sy.delete(sy.keys().next().value);
      const mm = this.R.m; this.sendWs(ws, { t: 'snap', v: mm.s.v, mid: mm.mid, state: mm.s, dl: this.dlLeft() });
    }
    // everything else (act, chat, emote, vc, bl, lead, hello, test ...) is ignored: read-only
  }
  async specGone() { if (!this.R) return; this.specNote(); this.mmSync(); await this.flush(); }
  specNote() { this.specCast(JSON.stringify({ t: 'spec', n: this.specs().length })); }
  // fresh /turn tokens to every seated socket (background: HMAC is async)
  turnOut() {
    if (!this.io.turnTok) return;
    const job = Promise.all(this.humans().filter((p) => this.online(p.pid)).map(async (p) => { const tok = await this.io.turnTok(p.pid); if (tok && this.R) this.sendTo(p.pid, { t: 'turn', tok }); }));
    if (this.io.bg) this.io.bg(job);
  }

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
      else if (pid && this.player(pid)) { if (this.spam(ws, pid, m)) return; await this.handle(ws, pid, m); }
      else if (pid && m.t === 'sync') this.sync(ws, pid);
    } catch (e) { this.oops('msg ' + String(m.t).slice(0, 8), e); } // 17.3 (QS): a throw must not skip the flush below (lost writes / no alarm)
    finally { this.cpu.msg.push(performance.now() - t0); if (this.cpu.msg.length > 4000) this.cpu.msg.splice(0, 2000); }
    if (m.t === 'test' && this.test) await this.testOp(ws, m);
    this.mmFresh(); // 18.0 (LV)
    await this.flush();
  }
  // 17.3 (QS): per-seat flood guard for the messages that rewrite the lobby (each one = a broadcast to every socket, a
  // storage write of the whole room incl. the live match, and for public rooms a Matchmaker report). A token bucket
  // (T.spamCap burst, T.spamRate per second) in memory: an evicted room just starts every seat with a full bucket.
  // act / bl / sync / chat / emote / hb are not counted (cheap, or limited on their own).
  spam(ws, pid, m) {
    if (!SPAMMY.has(m.t) || (m.t === 'vc' && m.a === 'talk')) return false; // talk has its own limiter (and "stopped talking" must always pass)
    const now = this.now, b = (this.flood ||= new Map()).get(pid) || { n: this.T.spamCap, at: now };
    b.n = Math.min(this.T.spamCap, b.n + ((now - b.at) / 1000) * this.T.spamRate); b.at = now;
    if (b.n < 1) { this.flood.set(pid, b); if (m.t === 'lead' && !b.told) { b.told = 1; this.sendWs(ws, { t: 'err', op: m.op, why: 'Too fast. Try again in a moment.' }); } return true; }
    b.n -= 1; b.told = 0; this.flood.set(pid, b);
    if (this.flood.size > 64) this.flood.delete(this.flood.keys().next().value);
    return false;
  }
  // 17.3 (QS): log a caught throw (message only, never message bodies: they can hold chat text or cproof)
  oops(where, e) { this.errs = (this.errs || 0) + 1; try { console.log('[room] ' + where + ' failed: ' + String((e && e.message) || e).slice(0, 160)); } catch {} }
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
      if (!this.socks().length) { for (const x of this.specs(true)) { this.sendWs(x.ws, { t: 'bye', why: 'closed', reason: 'closed' }); this.io.close(x.ws, 4004, 'closed'); } /* 18.0 (LV) */ if (R.mmKey && this.io.mm) this.io.mm({ op: 'unreg', code: R.code }); this.R = null; await this.io.arm(0); await this.io.wipe(); return; } // 17.1 (MM): unlisted with it
    }
    // 17.3 (QS): each timer runs guarded. Before, one throw (engine, bot planner) escaped the alarm: the runtime retried
    // it with the timer already cleared, nothing re-armed, and the match froze for good. Now a failing bot step ends that
    // bot's turn instead, and the flush below always re-arms the room.
    const run = (k, fn) => { try { fn(); } catch (e) { this.oops('alarm ' + k, e); if (k === 'bot') this.botFail(); } };
    if (t.qp && t.qp <= now) run('qp', () => this.qpGo(false)); // 17.1 (MM): Quick Play countdown over
    if (t.intro && t.intro <= now) { t.intro = 0; run('intro', () => this.go()); }
    if (t.turn && t.turn <= now) { t.turn = 0; run('turn', () => this.timeout()); }
    if (t.bot && t.bot <= now) { t.bot = 0; run('bot', () => this.botStep()); }
    if (t.away && t.away <= now) { t.away = 0; run('away', () => this.awayExpire()); }
    if (t.lead && t.lead <= now) { t.lead = 0; run('lead', () => { const was = R.leader; this.fixLeader(); if (this.R && R.leader !== was) this.lobby(); }); } // 17.1.1 (MM): leader grace over
    if (t.say && t.say.length) { const due = t.say.filter((x) => x.at <= now); t.say = t.say.filter((x) => x.at > now); for (const x of due) run('say', () => this.chat(x.pid, { k: x.k })); }
    if (this.R) this.mmFresh(); // 18.0 (LV)
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
        if (R.players.filter((x) => !x.isBot).length === 1 && !R.mid && !R.qp) { const gm = pr.mode === 'daily' ? 'royale' : pr.mode; if (modesIn('custom').includes(gm)) this.setMode(gm, true); } // 17.1 (MM): !R.qp = a Quick Play room keeps its mode
      }
    }
    this.io.bind(ws, pid);
    R.t.clean = 0;
    { const pr = m.profile && typeof m.profile === 'object' ? m.profile : m; p.nem = cleanNem(pr.nem); } // 18.0 (NE): who this player calls their Nemesis
    this.identify(pid, m);
    const turn = this.io.turnTok ? await this.io.turnTok(pid) : null; // 18.0 (LV): short-lived /turn token for this seat
    if (!this.R) return;
    this.sendWs(ws, { t: 'welcome', pid, room: R.code, leader: R.leader, ver: VER, ...(turn ? { turn } : {}) });
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
      if (!cid) { p.cid = null; p.verified = false; p.nid = null; p.rk = null; } // 18.0 (NE): nid/rk
      return;
    }
    if (p.verified && p.cid === cid) return; // same seat, same id, already proven (reconnect)
    const seq = (p.vseq = (p.vseq || 0) + 1);
    const job = Promise.resolve().then(() => this.io.verify(cid, proof)).catch(() => null).then(async (r) => {
      const ok = !!(r && r.ok), nid = ok ? await nidOf(cid) : null, rk = ok ? await this.rankOf([cid]) : null; // 18.0 (NE): public Nemesis id + Crown Rating tier
      const q = this.R && this.player(pid); if (!q || q.vseq !== seq) return;
      q.verified = !!(r && r.ok); q.cid = q.verified ? cid : null;
      q.nid = nid; q.rk = (rk && rk[cid]) || null; // 18.0 (NE)
      if (q.verified) { q.pub = { name: r.name || null, title: r.title || null, avatar: r.avatar || null }; q.tag = typeof r.tag === 'string' ? r.tag : null; } // 18.0 (SO): tag
      const h = this.R.m && this.R.m.hum && this.R.m.hum[pid]; if (h && q.verified) { h.cid = cid; h.verified = true; }
      this.dirty = true; this.lobbyChanged = true;
      this.sendTo(pid, { t: 'ident', cid: q.cid, verified: q.verified });
      if (q.verified) this.lobby(); // 18.0 (SO): the seat's tag reaches every lobby + its presence is reported
      return this.flush();
    });
    if (this.io.bg) this.io.bg(job);
  }
  // 18.0 (NE) Ranks: Crown Rating of verified seats from the Board ({cid: {r, p?}}); io.rank is room.js's one Board RPC.
  // Asked once per verified join and once per match start (in the background; the lobby re-broadcasts when it changed).
  async rankOf(cids) {
    if (!this.io.rank || !cids.length) return null;
    try { const r = await this.io.rank(cids); const out = {}; for (const c of cids) { const k = r && cleanRk(r[c]); if (k) out[c] = k; } return out; } catch { return null; }
  }
  rankRefresh() {
    const ps = this.R.players.filter((p) => p.verified && p.cid); if (!ps.length || !this.io.rank) return;
    const job = this.rankOf(ps.map((p) => p.cid)).then((rk) => {
      if (!rk || !this.R) return; let ch = false;
      for (const p of this.R.players) if (p.verified && p.cid && rk[p.cid] && JSON.stringify(rk[p.cid]) !== JSON.stringify(p.rk)) { p.rk = rk[p.cid]; ch = true; }
      if (ch) { this.lobby(); return this.flush(); }
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
      case 'nem': p.nem = cleanNem(m.nem); this.dirty = true; return; // 18.0 (NE): the player's Nemesis changed at results (rematches in the same room use it)
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
    // 17.1 (MM): Quick Play lobbies have no leader options; a leader on their own may start now (bots fill the seats)
    if (R.qp) {
      if (m.op !== 'start') return err('Quick Play matches start by themselves');
      if (this.humans().filter((p) => this.online(p.pid)).length > 1) return err('Starting when the countdown ends');
      const e = this.qpGo(true); if (e) err(e); return;
    }
    switch (m.op) {
      case 'public': { // 17.1 (MM): list this party in Browse (the Matchmaker may refuse: per-IP cap -> back to Private + err)
        const on = !!m.on;
        if (on && !R.pub) { const me = this.io.meta ? this.io.meta(ws) : {}; R.pubIp = me.ip || null; R.loc = me.loc || R.loc || null; }
        R.pub = on; break;
      }
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
    { const nm = nemMap(R.players.map((p) => ({ pid: p.pid, isBot: !!p.isBot, name: p.name, nid: p.verified ? p.nid : null, nem: p.isBot ? null : p.nem }))); if (nm) opts.nemesis = nm; this.rankRefresh(); } // 18.0 (NE)
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
    for (const x of this.specs()) this.sendWs(x.ws, this.startMsg(null, false)); // 18.0 (LV): spectators who stayed on after the last match
    this.turnOut(); // 18.0 (LV): fresh /turn tokens for every seat (voice usually starts with the match)
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
  // 17.3 (QS): a bot step threw: end that bot's turn (an accepted, broadcast action like any timeout, so lockstep holds).
  // If even that throws, retry a few times, then leave the room to its clean-up timer (never an endless alarm loop).
  botFail() {
    try {
      const m = this.R && this.R.m; if (!m || m.s.over) return;
      const u = unitById(m.s, m.s.active); if (!u || !(u.kind === 'hollow' || u.bot)) { this.schedule(true); return; }
      if (this.act(u.pid, { type: 'end' }, true)) { m.botErr = 0; return; }
      throw new Error('end refused');
    } catch (e) {
      const m = this.R && this.R.m; if (!m) return;
      m.botErr = (m.botErr || 0) + 1;
      if (m.botErr <= 3) this.R.t.bot = this.now + 2000; else this.oops('bot gave up', e);
    }
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
    if (R.qp) { R.qp = false; R.pub = false; R.fromQp = true; } // 17.1.1: fromQp = lobby note "same players as your Quick Play match" // 17.1 (MM): after its match a Quick Play room is a normal private party of the same players (Back to Party works; the leader may list it again)
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
    if (team == null) this.specCast(JSON.stringify(out)); // 18.0 (LV): spectators read public chat + emotes (never team lines; they can't send)
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
      // 17.1 (A0, mirrors V2's voice.js fix): only "started talking" is rate limited; a "stopped talking" is always relayed
      // when the last relayed state for that pid was on, so nobody stays lit after a burst
      const now = this.now, st = R.vcRL[pid] || (R.vcRL[pid] = { n: 6, at: now, on: 0 }), on = m.on ? 1 : 0;
      if (on) { st.n = Math.min(6, st.n + (now - st.at) / 250); st.at = now; if (st.n < 1) return; st.n -= 1; }
      else if (!st.on) return;
      st.on = on;
      this.bcast({ t: 'vc', a: 'talk', pid, on });
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
