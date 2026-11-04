// 17.0 (S1): test client for the Room DO. Node 22 global WebSocket. Each client replays the server's actions through
// its own copy of js/engine.js (exactly what js/cloud.js does) and checks every {t:'h'} hash.
import * as E from '../../js/engine.js';
import { stateHash, protoVer } from '../../js/statehash.js';

export const BASE = (process.env.CLOUD || 'http://127.0.0.1:8787').replace(/\/$/, '');
export const WS = BASE.replace(/^http/, 'ws');
export const VER = protoVer();
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let tokN = 0;
export const newTok = () => 'tok' + Date.now().toString(36) + (tokN++) + Math.random().toString(36).slice(2, 10);

export async function newRoom() {
  const r = await fetch(BASE + '/room', { method: 'POST' });
  if (r.status !== 200) throw new Error('POST /room ' + r.status);
  return (await r.json()).code;
}

export class Client {
  constructor(code, o = {}) {
    this.code = code; this.tok = o.tok || newTok(); this.name = o.name || 'T' + Math.random().toString(36).slice(2, 6);
    this.ver = o.ver || VER; this.msgs = []; this.s = null; this.myPid = null; this.lobby = null; this.closed = false;
    this.hashOk = 0; this.hashBad = 0; this.applied = 0; this.gaps = 0; this.snaps = 0; this.autoPlay = !!o.autoPlay;
    this.waiters = []; this.profile = o.profile || { title: 'Tester', skin: 'ivory', build: { pts: { hp: 3, atk: 3, def: 2, spd: 2 }, passive: 'regen', equips: {} } };
    this.hbAnswered = 0; this.events = [];
  }
  open(extra = {}) {
    return new Promise((res, rej) => {
      const ws = this.ws = new WebSocket(`${WS}/ws/room/${this.code}`);
      this.closed = false;
      ws.onopen = () => { this.send({ t: 'hello', pid: this.tok, name: this.name, profile: this.profile, ver: this.ver, ...extra }); res(this); };
      ws.onerror = (e) => rej(new Error('ws error ' + (e && e.message || '')));
      ws.onclose = (e) => { this.closed = true; this.closeCode = e.code; this.kick(); };
      ws.onmessage = (e) => this.onMsg(e.data);
    });
  }
  send(o) { if (this.ws && this.ws.readyState === 1) this.ws.send(typeof o === 'string' ? o : JSON.stringify(o)); }
  close() { try { this.ws.close(); } catch {} }
  kick() { const w = this.waiters; this.waiters = []; for (const f of w) f(); }
  onMsg(data) {
    let m; try { m = JSON.parse(data); } catch { return; }
    if (m.t === 'hb') { this.hbAnswered++; return; }
    m._at = Date.now(); if (m.t === 'a' && this.s) m._turn = this.s.turnNo;
    this.msgs.push(m);
    if (m.t === 'welcome') this.myPid = m.pid;
    else if (m.t === 'lobby') this.lobby = m;
    else if (m.t === 'start') { this.start = m; if (!m.resume) { this.s = E.createMatch(m.players, m.seed, m.opts); this.applied = 0; } }
    else if (m.t === 'snap') { this.s = m.state; this.snaps++; }
    else if (m.t === 'a') {
      if (!this.s) return;
      if (this.s.v !== m.v - 1) { this.gaps++; if (this.s.v < m.v - 1) this.send({ t: 'sync' }); }
      else {
        const r = E.applyAction(this.s, m.pid, m.a);
        if (!r.ok) { this.gaps++; this.send({ t: 'sync' }); } else { this.applied++; this.events.push(...r.ev.map((x) => x.e)); if (this.events.length > 5000) this.events.splice(0, 2500); }
      }
    } else if (m.t === 'h') {
      if (this.s && this.s.v === m.v) { if (stateHash(this.s) === m.x) this.hashOk++; else { this.hashBad++; this.send({ t: 'sync' }); } }
    } else if (m.t === 'nack') { if (this.autoPlay && this.s) this.send({ t: 'act', a: { type: 'end' }, n: this.s.v }); return; }
    else if (m.t === 'seat') { const u = this.s && E.unitById(this.s, m.id); if (u) u.bot = m.bot; }
    if (this.autoPlay) this.play();
    this.kick();
  }
  // play my turn like a human would: plan locally (from MY replicated state) and send the actions one by one
  play() {
    const s = this.s; if (!s || s.over || !this.myPid) return;
    const u = E.unitById(s, s.active);
    if (!u || u.pid !== this.myPid || u.bot) return;
    if (this.pending === s.v) return;
    this.pending = s.v;
    const c = structuredClone(s), cu = E.unitById(c, c.active);
    const plan = E.planBot(c, cu);
    const a = plan.find((x) => E.applyAction(structuredClone(s), this.myPid, x).ok) || { type: 'end' };
    this.send({ t: 'act', a, n: s.v });
  }
  last(t) { for (let i = this.msgs.length - 1; i >= 0; i--) if (this.msgs[i].t === t) return this.msgs[i]; return null; }
  count(t) { return this.msgs.filter((m) => m.t === t).length; }
  async wait(pred, ms = 8000, what = 'condition') {
    const t0 = Date.now();
    while (!pred(this)) {
      if (Date.now() - t0 > ms) throw new Error(`${this.name}: timeout waiting for ${what}`);
      await new Promise((r) => { const to = setTimeout(r, Math.min(250, ms)); this.waiters.push(() => { clearTimeout(to); r(); }); });
    }
    return this;
  }
  waitMsg(t, ms, f = () => true) { const n0 = this.msgs.length; return this.wait(() => this.msgs.slice(n0).some((m) => m.t === t && f(m)), ms, 'msg ' + t).then(() => this.msgs.slice(n0).find((m) => m.t === t && f(m))); }
  lead(op, o = {}) { this.send({ t: 'lead', op, ...o }); }
  test(op, o = {}) { this.send({ t: 'test', op, ...o }); }
  async testGet(op) { const n0 = this.msgs.length; this.test(op); await this.wait(() => this.msgs.slice(n0).some((m) => m.t === 'test' && m.op === op), 5000, 'test ' + op); return this.msgs.slice(n0).find((m) => m.t === 'test' && m.op === op); }
}

// tiny test framework
export const results = [];
export async function check(name, fn) {
  const t0 = Date.now();
  try { const note = await fn(); results.push({ name, ok: true, ms: Date.now() - t0, note }); console.log(`PASS ${name}${note ? ' - ' + note : ''} (${Date.now() - t0} ms)`); }
  catch (e) { results.push({ name, ok: false, ms: Date.now() - t0, err: e.message }); console.log(`FAIL ${name}: ${e.message}`); }
}
export function assert(c, msg) { if (!c) throw new Error(msg); }
export const stats = (a) => { if (!a || !a.length) return 'n=0'; const b = a.slice().sort((x, y) => x - y); const q = (p) => b[Math.min(b.length - 1, Math.floor(b.length * p))]; return `n=${b.length} p50=${q(0.5).toFixed(2)} p95=${q(0.95).toFixed(2)} max=${b[b.length - 1].toFixed(2)} ms`; };
