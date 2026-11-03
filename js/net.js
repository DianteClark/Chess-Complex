// Networking: friend-code rooms over WebRTC (PeerJS), plus a same-browser transport for testing.
import { createMatch, applyAction, planBot, planHollow, unitById, introEvents } from './engine.js';
import { TURN_MS } from './data.js';
const TURN_GRACE = 2000; // the client shows each turn ~1-1.5 s after it starts (camera beats); don't charge that to the player

const PREFIX = 'chesscomplex-v1-';
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const makeCode = () => Array.from({ length: 5 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('');
const useLocal = () => new URLSearchParams(location.search).get('net') === 'local';

export const PEER_OPTS = {
  debug: 0,
  // STUN for direct connections, plus a public TURN relay as a fallback for strict networks.
  // For a commercial launch, replace the relay with your own (Cloudflare Calls or coturn); see docs/ROADMAP.md.
  config: { iceServers: [
    { urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:global.stun.twilio.com:3478' },
    { urls: ['turn:openrelay.metered.ca:80', 'turn:openrelay.metered.ca:443', 'turn:openrelay.metered.ca:443?transport=tcp'], username: 'openrelayproject', credential: 'openrelayproject' },
  ] },
};

// ---------- transports ----------
// 15.0 (N): every connection goes through link(): it splits big messages into chunks, sends heartbeats and drops a
// connection that has been silent too long. Root cause of the Siege wave 5 disconnects: PeerJS 1.5.4 JSON channels
// refuse any message of 16300 bytes or more ('message-too-big' error, the message is lost), a 4-player Siege state
// passes that around wave 5, and the host treated the error as a close. ?net=local enforces the same limit.
export const NET = { mtu: 16300, chunk: 5000, hb: 2000, dead: 12000, retry: 2000, retryFor: 45000, nochunk: false, stats: { maxMsg: 0, chunked: 0, tooBig: 0 }, log: [] };
const nlog = (s) => { NET.log.push(`${new Date().toISOString().slice(11, 23)} ${s}`); if (NET.log.length > 60) NET.log.shift(); };
const enc = typeof TextEncoder !== 'undefined' ? new TextEncoder() : null;
const bytes = (str) => (str.length * 3 < NET.mtu || !enc ? str.length : enc.encode(str).length);
let ckSeq = 0;
function link(rawSend, rawClose, h) {
  let rx = Date.now(), closed = false; const parts = new Map();
  const L = {
    send(o) {
      if (closed) return;
      const str = JSON.stringify(o), n = bytes(str);
      if (n > NET.stats.maxMsg) NET.stats.maxMsg = n;
      if (n < NET.mtu - 200 || NET.nochunk) { rawSend(o); return; }
      const k = ++ckSeq, total = Math.ceil(str.length / NET.chunk); NET.stats.chunked++;
      for (let i = 0; i < total; i++) rawSend({ t: 'ck', k, i, n: total, d: str.slice(i * NET.chunk, (i + 1) * NET.chunk) });
    },
    recv(m) {
      if (closed) return;
      rx = Date.now();
      if (!m || typeof m !== 'object') return;
      if (m.t === 'hb') return;
      if (m.t === 'ck') {
        if (typeof m.d !== 'string' || !(m.n > 0) || m.n > 400 || !(m.i >= 0 && m.i < m.n)) return;
        let p = parts.get(m.k); if (!p) { if (parts.size > 8) parts.clear(); p = { got: 0, d: [] }; parts.set(m.k, p); }
        if (p.d[m.i] == null) p.got++;
        p.d[m.i] = m.d;
        if (p.got === m.n) { parts.delete(m.k); let o; try { o = JSON.parse(p.d.join('')); } catch { return; } h.data(o); }
        return;
      }
      h.data(m);
    },
    // why: 'closed' (the other side or the network closed it), 'timeout' (silent too long), 'local' (we closed it).
    // quiet: tear down without telling the owner (the whole server or client is shutting down).
    end(why, quiet) { if (closed) return; closed = true; nlog(`link end ${why}${quiet ? ' (quiet)' : ''} silent ${Date.now() - rx} ms`); clearInterval(t); if (why !== 'closed') { try { rawClose(); } catch {} } if (!quiet) h.close(why); },
    get open() { return !closed; },
  };
  let tick = Date.now();
  const t = setInterval(() => {
    if (closed) return;
    // this device was asleep (backgrounded phone, throttled tab): its own timers ran late, so silence from the
    // other side means nothing yet; give the link a fresh window instead of dropping it on wake-up
    const now = Date.now(); if (now - tick > NET.hb * 3) rx = Math.max(rx, now - NET.hb); tick = now;
    if (now - rx > NET.dead) { L.end('timeout'); return; }
    try { rawSend({ t: 'hb' }); } catch {}
  }, NET.hb);
  return L;
}
function mkConn() {
  return { send(o) { this._L && this._L.send(o); }, close() { if (this._L) this._L.end('local'); }, _d: null, _c: null, onData(f) { this._d = f; }, onClose(f) { this._c = f; } };
}
const connLink = (conn, rawSend, rawClose, links) => {
  const L = link(rawSend, rawClose, { data: (d) => conn._d && conn._d(d), close: () => { links.delete(L); conn._c && conn._c(); } });
  links.add(L); conn._L = L; return L;
};

export function openServer(code, h) {
  if (useLocal()) return localServer(code, h);
  const peer = new window.Peer(PREFIX + code, PEER_OPTS); const links = new Set();
  peer.on('open', () => h.onReady());
  peer.on('connection', (c) => {
    const conn = mkConn();
    c.on('open', () => { connLink(conn, (o) => { if (c.open) c.send(o); }, () => c.close(), links); h.onConn(conn); });
    c.on('data', (d) => conn._L && conn._L.recv(d));
    c.on('close', () => conn._L && conn._L.end('closed'));
    // a conn error is not always fatal (message-too-big leaves the channel open): only a closed channel is a drop
    c.on('error', (e) => { if (e && e.type === 'message-too-big') NET.stats.tooBig++; if (!c.open && conn._L) conn._L.end('closed'); });
  });
  peer.on('error', (e) => h.onError(e.type || String(e)));
  peer.on('disconnected', () => { try { peer.reconnect(); } catch {} });
  return { close: () => { for (const L of [...links]) L.end('local', true); peer.destroy(); } };
}

// The client reconnects by itself: when its link drops without a goodbye it calls h.onDrop() and tries again every
// NET.retry ms for NET.retryFor ms; each success calls h.onOpen(again) (again = true after a drop) so the caller can
// send its join + token again. h.onClose() fires only when it gives up. close() is a deliberate leave: no retries.
export function openClient(code, h) {
  let L = null, peer = null, opened = false, gone = false, dropAt = 0, retryT = null, to = null, gen = 0;
  const fail = (g, why) => { // attempt g failed, or its live link dropped
    if (gone || g !== gen) return;
    gen++; clearTimeout(to); clearTimeout(retryT);
    if (L) { L.end('local', true); L = null; }
    try { peer && peer.destroy(); } catch {} peer = null;
    nlog(`client fail ${why} (attempt ${g})`);
    if (!opened) { gone = true; h.onError(why); return; }
    if (!dropAt) { dropAt = Date.now(); try { h.onDrop && h.onDrop(why); } catch (e) { console.error(e); } }
    if (Date.now() - dropAt > NET.retryFor) { gone = true; nlog('client gave up'); h.onClose(); return; }
    retryT = setTimeout(attempt, NET.retry);
  };
  const up = (g, raw, rawClose) => {
    if (gone || g !== gen) { try { rawClose(); } catch {} return; }
    clearTimeout(to);
    L = link(raw, rawClose, { data: (d) => { if (g === gen) h.onData(d); }, close: (why) => fail(g, why) });
    const again = opened; opened = true; dropAt = 0; nlog(`client open${again ? ' (reconnected)' : ''}`); h.onOpen(again);
  };
  const attempt = () => {
    if (gone) return;
    const g = ++gen;
    to = setTimeout(() => fail(g, 'timeout'), opened ? 8000 : 15000);
    if (useLocal()) {
      const lc = localClient(code, { open: (raw) => up(g, raw.send, raw.close), data: (d) => g === gen && L && L.recv(d), close: () => (L && g === gen ? L.end('closed') : fail(g, 'closed')), err: (e) => fail(g, e) });
      peer = { destroy: () => lc.close() };
      return;
    }
    const pr = peer = new window.Peer(PEER_OPTS);
    pr.on('open', () => {
      if (g !== gen) return;
      const c = pr.connect(PREFIX + code, { reliable: true, serialization: 'json' });
      c.on('open', () => up(g, (o) => { if (c.open) c.send(o); }, () => c.close()));
      c.on('data', (d) => { if (g === gen && L) L.recv(d); });
      c.on('close', () => { if (g === gen) (L ? L.end('closed') : fail(g, 'closed')); });
      c.on('error', () => { if (g === gen && !c.open) (L ? L.end('closed') : fail(g, 'closed')); });
    });
    // after the data channel is up, signalling-server errors don't matter (the channel is peer to peer)
    pr.on('error', (e) => { if (g === gen && !L) fail(g, e.type || String(e)); });
  };
  attempt();
  return {
    send: (o) => L && L.send(o),
    close: () => { gone = true; gen++; clearTimeout(retryT); clearTimeout(to); if (L) { L.end('local', true); L = null; } try { peer && peer.destroy(); } catch {} },
    get live() { return !!L; },
    get reconnecting() { return !!dropAt && !gone; },
  };
}

// Same-browser transport (BroadcastChannel) for tests. It enforces PeerJS's JSON size limit, and NET.drop() lets a
// test cut a page off without a goodbye, the way a phone losing signal or going to the background looks to the host.
const localLinks = new Set();
// NET.drop(ms): cut every link now, and keep this page offline for ms (new connection attempts get no answer)
let offlineUntil = 0;
NET.drop = (ms = 0) => { offlineUntil = Date.now() + ms; nlog(`drop (offline ${ms} ms)`); for (const x of [...localLinks]) x.cut(); };
function localTooBig(o) { const n = bytes(JSON.stringify(o)); if (n >= NET.mtu) { NET.stats.tooBig++; console.warn(`net: message of ${n} bytes is over the ${NET.mtu} byte channel limit (message-too-big)`); return true; } return false; }
function localServer(code, h) {
  const bc = new BroadcastChannel('cc-' + code); const conns = new Map(), links = new Set();
  let cut = false; const lk = { cut: () => { cut = true; } }; localLinks.add(lk);
  const post = (m) => { if (!cut) try { bc.postMessage(m); } catch {} };
  bc.onmessage = ({ data: m }) => {
    if (cut || m.to !== 'host') return;
    if (m.kind === 'hello') {
      const conn = mkConn(), id = m.from;
      // like PeerJS: a message over the limit never arrives
      connLink(conn, (o) => { if (!localTooBig(o)) post({ to: id, kind: 'data', data: o }); }, () => { post({ to: id, kind: 'bye' }); conns.delete(id); }, links);
      conns.set(id, conn); post({ to: id, kind: 'ok' }); h.onConn(conn);
    } else if (m.kind === 'data') { const c = conns.get(m.from); c && c._L.recv(m.data); }
    else if (m.kind === 'bye') { const c = conns.get(m.from); conns.delete(m.from); c && c._L.end('closed'); }
  };
  setTimeout(() => { if (!cut) h.onReady(); }, 50);
  return { close: () => { localLinks.delete(lk); for (const L of [...links]) L.end('local', true); post({ to: '*', kind: 'bye' }); try { bc.close(); } catch {} } };
}
function localClient(code, h) {
  const bc = new BroadcastChannel('cc-' + code); const me = Math.random().toString(36).slice(2);
  let ok = false, cut = false, done = false; const lk = { cut: () => { cut = true; } }; localLinks.add(lk);
  const post = (m) => { if (!cut && !done && Date.now() >= offlineUntil) try { bc.postMessage(m); } catch {} };
  const shut = () => { done = true; localLinks.delete(lk); try { bc.close(); } catch {} };
  const self = { close: () => { if (done) return; post({ to: 'host', from: me, kind: 'bye' }); shut(); } };
  bc.onmessage = ({ data: m }) => {
    if (cut || done || Date.now() < offlineUntil || (m.to !== me && m.to !== '*')) return;
    if (m.kind === 'ok') { ok = true; h.open({ send: (o) => { if (!localTooBig(o)) post({ to: 'host', from: me, kind: 'data', data: o }); }, close: () => self.close() }); }
    else if (m.kind === 'data') h.data(m.data);
    else if (m.kind === 'bye') { shut(); h.close(); }
  };
  post({ to: 'host', from: me, kind: 'hello' });
  setTimeout(() => { if (!ok && !done) { shut(); h.err('peer-unavailable'); } }, 3000);
  return self;
}

// ---------- authoritative match runner (used by solo and by online hosts) ----------
export class GameHost {
  // 15.0 (N): party options reach the engine: location (a LOCATIONS id; omitted = seeded pick) and custom rules
  constructor(players, emit, { seed, state, noTimer, mode, location, custom } = {}) {
    const o = { mode }; if (location) o.location = location; if (custom) o.custom = custom;
    this.s = state || createMatch(players, seed, o);
    this.noTimer = !!noTimer;
    this.emit = emit;
    this.lastTurn = -1; this.deadline = 0;
    this.aiT = null; this.timerT = null; this.fast = false;
  }
  // 15.0 (W): {e:'location', id} on the first state. 15.1 (D): introMs holds the first turn (bots and the turn clock)
  // back while every screen plays the match intro; go() starts it early (solo, when the player taps through).
  start(introMs = 0) {
    this.publish(this.s.v === 0 && !this.s.tutorial ? introEvents(this.s) : []);
    if (introMs > 0) { this.introUntil = Date.now() + introMs; this.introT = setTimeout(() => this.go(), introMs); } else this.schedule();
  }
  go() { if (!this.introUntil) return; clearTimeout(this.introT); this.introUntil = 0; this.schedule(); }
  publish(ev) { this.emit({ t: 'state', state: structuredClone(this.s), ev, dl: this.deadline ? Math.max(0, this.deadline - Date.now()) : -1 }); }
  act(pid, a) {
    if (this.s.over) return false;
    const r = applyAction(this.s, pid, a);
    if (r.ok) { this.publish(r.ev); this.schedule(); }
    return r.ok;
  }
  setBot(pid) { const u = this.s.units.find((v) => v.pid === pid); if (u) { u.bot = true; if (this.s.active === u.id) this.schedule(); } }
  schedule() {
    clearTimeout(this.aiT); clearTimeout(this.timerT);
    const s = this.s; if (s.over || this.introUntil) return; // 15.1 (D): go() schedules once the intro is over
    const u = unitById(s, s.active); if (!u) return;
    if (s.turnNo !== this.lastTurn) { this.lastTurn = s.turnNo; this.deadline = this.noTimer ? 0 : Date.now() + ((this.s.rules && this.s.rules.turnMs) || TURN_MS) + TURN_GRACE; if (!(u.kind === 'hollow' || u.bot)) this.publish([]); else this.deadline = 0; }
    if (u.kind === 'hollow' || u.bot) {
      const turn = s.turnNo;
      // R 15.1: bots never act faster than the host's screen can show turns at real speed: when its playback backlog
      // (NET.backlog(), ms, set by render.js) runs past ~0.9 s, the bot thinks that much longer (capped at 3 s)
      const lag = !this.fast && NET.backlog ? Math.min(3000, Math.max(0, NET.backlog() - 900)) : 0;
      this.aiT = setTimeout(() => this.runAI(u.id, turn), this.fast ? 0 : (u.kind === 'hollow' ? 260 : 520) + lag);
    } else {
      // 15.0 (N): a player who reconnects during their own turn (the bot had it, so no deadline) gets a fresh clock
      // instead of an instant timeout
      if (!this.noTimer && !this.deadline) { this.deadline = Date.now() + ((this.s.rules && this.s.rules.turnMs) || TURN_MS) + TURN_GRACE; this.publish([]); }
      if (!this.noTimer) this.timerT = setTimeout(() => { if (s.active === u.id) { this.publish([{ e: 'timeout', id: u.id }]); this.act(u.pid, { type: 'end' }); } }, Math.max(0, this.deadline - Date.now()));
      else this.deadline = 0;
    }
  }
  runAI(id, turn) {
    const s = this.s; if (s.over || s.active !== id || s.turnNo !== turn) return;
    const u = unitById(s, id);
    const plan = u.kind === 'hollow' ? planHollow(s, u) : planBot(s, u);
    const step = (i) => {
      if (s.over || s.active !== id || s.turnNo !== turn) return;
      if (i >= plan.length) { this.act(u.pid, { type: 'end' }); return; }
      const ok = applyAction(s, u.pid, plan[i]);
      if (ok.ok) this.publish(ok.ev);
      if (s.over || s.active !== id || s.turnNo !== turn) { this.schedule(); return; }
      this.aiT = setTimeout(() => step(i + 1), this.fast ? 0 : u.kind === 'hollow' ? 220 : 480);
    };
    step(0);
  }
  stop() { clearTimeout(this.aiT); clearTimeout(this.timerT); clearTimeout(this.introT); this.introUntil = 0; this.s.over = true; }
}
