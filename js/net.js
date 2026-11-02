// Networking: friend-code rooms over WebRTC (PeerJS), plus a same-browser transport for testing.
import { createMatch, applyAction, planBot, planHollow, unitById } from './engine.js';
import { TURN_MS } from './data.js';

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
export function openServer(code, h) {
  if (useLocal()) return localServer(code, h);
  const peer = new window.Peer(PREFIX + code, PEER_OPTS);
  peer.on('open', () => h.onReady());
  peer.on('connection', (c) => {
    const conn = { send: (o) => { if (c.open) c.send(o); }, close: () => c.close(), _d: null, _c: null, onData(f) { this._d = f; }, onClose(f) { this._c = f; } };
    c.on('open', () => h.onConn(conn));
    c.on('data', (d) => conn._d && conn._d(d));
    c.on('close', () => conn._c && conn._c());
    c.on('error', () => conn._c && conn._c());
  });
  peer.on('error', (e) => h.onError(e.type || String(e)));
  peer.on('disconnected', () => { try { peer.reconnect(); } catch {} });
  return { close: () => peer.destroy() };
}
export function openClient(code, h) {
  if (useLocal()) return localClient(code, h);
  const peer = new window.Peer(PEER_OPTS);
  let c = null; let opened = false;
  const to = setTimeout(() => { if (!opened) h.onError('timeout'); }, 15000);
  peer.on('open', () => {
    c = peer.connect(PREFIX + code, { reliable: true, serialization: 'json' });
    c.on('open', () => { opened = true; clearTimeout(to); h.onOpen(); });
    c.on('data', (d) => h.onData(d));
    c.on('close', () => h.onClose());
    c.on('error', () => h.onClose());
  });
  peer.on('error', (e) => { clearTimeout(to); h.onError(e.type || String(e)); });
  return { send: (o) => c && c.open && c.send(o), close: () => peer.destroy() };
}

function localServer(code, h) {
  const bc = new BroadcastChannel('cc-' + code); const conns = new Map();
  bc.onmessage = ({ data: m }) => {
    if (m.to !== 'host') return;
    if (m.kind === 'hello') {
      const conn = { id: m.from, send: (o) => bc.postMessage({ to: m.from, kind: 'data', data: o }), close: () => bc.postMessage({ to: m.from, kind: 'bye' }), _d: null, _c: null, onData(f) { this._d = f; }, onClose(f) { this._c = f; } };
      conns.set(m.from, conn); bc.postMessage({ to: m.from, kind: 'ok' }); h.onConn(conn);
    } else if (m.kind === 'data') { const c = conns.get(m.from); c && c._d && c._d(m.data); }
    else if (m.kind === 'bye') { const c = conns.get(m.from); c && c._c && c._c(); conns.delete(m.from); }
  };
  setTimeout(() => h.onReady(), 50);
  return { close: () => { bc.postMessage({ to: '*', kind: 'bye' }); bc.close(); } };
}
function localClient(code, h) {
  const bc = new BroadcastChannel('cc-' + code); const me = Math.random().toString(36).slice(2);
  let ok = false;
  bc.onmessage = ({ data: m }) => {
    if (m.to !== me && m.to !== '*') return;
    if (m.kind === 'ok') { ok = true; h.onOpen(); } else if (m.kind === 'data') h.onData(m.data); else if (m.kind === 'bye') h.onClose();
  };
  bc.postMessage({ to: 'host', from: me, kind: 'hello' });
  setTimeout(() => { if (!ok) h.onError('peer-unavailable'); }, 3000);
  return { send: (o) => bc.postMessage({ to: 'host', from: me, kind: 'data', data: o }), close: () => { bc.postMessage({ to: 'host', from: me, kind: 'bye' }); bc.close(); } };
}

// ---------- authoritative match runner (used by solo and by online hosts) ----------
export class GameHost {
  constructor(players, emit, { seed, state, noTimer, mode } = {}) {
    this.s = state || createMatch(players, seed, { mode });
    this.noTimer = !!noTimer;
    this.emit = emit;
    this.lastTurn = -1; this.deadline = 0;
    this.aiT = null; this.timerT = null; this.fast = false;
  }
  start() { this.publish([]); this.schedule(); }
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
    const s = this.s; if (s.over) return;
    const u = unitById(s, s.active); if (!u) return;
    if (s.turnNo !== this.lastTurn) { this.lastTurn = s.turnNo; this.deadline = this.noTimer ? 0 : Date.now() + ((this.s.rules && this.s.rules.turnMs) || TURN_MS); if (!(u.kind === 'hollow' || u.bot)) this.publish([]); else this.deadline = 0; }
    if (u.kind === 'hollow' || u.bot) {
      const turn = s.turnNo;
      this.aiT = setTimeout(() => this.runAI(u.id, turn), this.fast ? 0 : u.kind === 'hollow' ? 260 : 520);
    } else {
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
  stop() { clearTimeout(this.aiT); clearTimeout(this.timerT); this.s.over = true; }
}
