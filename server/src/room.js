// 17.0 (S1): Room Durable Object. One per room code: lobby + party + match, with the authoritative engine.
// Lockstep: the server runs js/engine.js and broadcasts every accepted action ({t:'a'}); clients replay them with the
// same engine. Bots, the turn clock, the intro hold, resume windows and room cleanup run on DO alarms (never
// setTimeout), so a hibernated room still wakes. WebSocket Hibernation API: hb pings are answered by the runtime.
//
// The room logic lives in RoomCore (plain JS, no Cloudflare APIs) so it can also be timed and tested in Node;
// Room (the DO) is a thin shell that owns sockets, storage and the alarm.
import { DurableObject } from 'cloudflare:workers';
import { RoomCore } from './core.js';
// 17.0 (S2): identity, moderation and the match-end hook
import * as platform from './platform.js';
import * as hooks from './hooks.js';
import * as stats from './stats.js';
import * as board from './board.js';
import * as replay from './replay.js';
import { verifyPlayer } from './player.js';
hooks.use({ stats, board, replay, platform });
export const MOD_ROOM = '_mod'; // the one Room instance that holds the shared moderation cache + daily budget

export class Room extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.ctx = ctx; this.env = env;
    this.test = !!(env && env.ROOM_TEST && env.ROOM_TEST !== '0');
    try { ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('{"t":"hb"}', '{"t":"hb"}')); } catch {}
    this.core = null;
    this.bg = []; this.modMem = new Map(); // 17.0 (S2)
    ctx.blockConcurrencyWhile(async () => {
      const R = (await ctx.storage.get('R')) || null;
      this.armed = (await ctx.storage.getAlarm()) || 0;
      this.core = new RoomCore(R, this.io(), { test: this.test });
    });
  }
  // what RoomCore needs from the runtime
  io() {
    const self = this;
    return {
      now: () => Date.now(),
      sockets() { const out = []; for (const ws of self.ctx.getWebSockets()) { const a = att(ws); if (a && a.pid && !a.gone) out.push({ ws, pid: a.pid }); } return out; },
      send(ws, str) { try { ws.send(str); } catch {} },
      close(ws, code, why) { const a = att(ws) || {}; a.gone = true; try { ws.serializeAttachment(a); } catch {} try { ws.close(code, why); } catch {} },
      bind(ws, pid) { try { ws.serializeAttachment({ pid }); } catch {} },
      async save(R) { if (R) await self.ctx.storage.put('R', R); },
      async wipe() { await self.ctx.storage.deleteAll(); },
      async arm(at) {
        if (at === self.armed) return;
        self.armed = at;
        if (at) await self.ctx.storage.setAlarm(at); else await self.ctx.storage.deleteAlarm();
      },
      // 17.0 (S2)
      bg(p) { self.bg.push(Promise.resolve(p).catch(() => {})); },
      verify: (cid, proof) => verifyPlayer(self.env, cid, proof),
      moderate: (text) => self.moderate(text),
      ended: (rec) => hooks.matchEnded(self.env, { waitUntil: (p) => self.bg.push(Promise.resolve(p).catch(() => {})) }, rec),
    };
  }
  // 17.0 (S2): background work (identity checks, match-end fan-out) started inside an event is awaited before that
  // event's handler returns, so a hibernating room never drops it. Capped so a hung consumer can't pin the room.
  async drain() {
    for (let i = 0; i < 4 && this.bg.length; i++) {
      const list = this.bg.splice(0);
      let to; await Promise.race([Promise.allSettled(list), new Promise((r) => { to = setTimeout(r, 15000); })]); clearTimeout(to);
    }
  }
  // custom chat phrase -> {ok, src}. A small per-room memory cache, then the shared '_mod' instance (storage cache,
  // daily budget, Workers AI). Never throws; anything odd answers ok (chat.js's word filter already ran).
  async moderate(text) {
    try {
      const key = platform.modKey(text), hit = this.modMem.get(key);
      if (hit) return { ok: hit.ok, src: 'mem' };
      if (!this.env.ROOM) return { ok: true, src: 'filter', why: 'no-room' };
      const stub = this.env.ROOM.get(this.env.ROOM.idFromName(MOD_ROOM));
      const r = await stub.fetch(new Request('https://room/mod', { method: 'POST', body: JSON.stringify({ text }) }));
      const v = r.ok ? await r.json() : null;
      if (!v || typeof v.ok !== 'boolean') return { ok: true, src: 'filter', why: 'mod-room' };
      if (v.src === 'ai' || v.src === 'cache') { this.modMem.set(key, { ok: v.ok }); if (this.modMem.size > 200) this.modMem.delete(this.modMem.keys().next().value); }
      return v;
    } catch { return { ok: true, src: 'filter', why: 'error' }; }
  }
  async fetch(req) {
    const url = new URL(req.url);
    const code = url.searchParams.get('code') || '';
    if (url.pathname === '/mod' && req.method === 'POST') { // 17.0 (S2): only ever called on the '_mod' instance
      let text = ''; try { const b = await req.json(); text = typeof (b && b.text) === 'string' ? b.text.slice(0, 200) : ''; } catch {}
      const st = this.ctx.storage;
      const v = await platform.moderate(this.env, text, { get: (k) => st.get(k), put: (k, val) => st.put(k, val) });
      return new Response(JSON.stringify(v), { headers: { 'Content-Type': 'application/json' } });
    }
    if (url.pathname === '/mod/stats' && this.test) { const b = (await this.ctx.storage.get('budget')) || null; return new Response(JSON.stringify({ budget: b }), { headers: { 'Content-Type': 'application/json' } }); }
    if (url.pathname === '/init' && req.method === 'POST') {
      const ok = await this.core.init(code);
      return new Response(ok ? 'ok' : 'taken', { status: ok ? 200 : 409 });
    }
    if (req.headers.get('Upgrade') === 'websocket') {
      const pair = new WebSocketPair();
      if (!this.core.exists()) {
        // never created (or cleaned up): say so over the socket so the client can fall back to a phone-hosted party
        pair[1].accept(); try { pair[1].send(JSON.stringify({ t: 'bye', why: 'noroom', reason: 'noroom' })); pair[1].close(4004, 'noroom'); } catch {}
        return new Response(null, { status: 101, webSocket: pair[0] });
      }
      this.ctx.acceptWebSocket(pair[1]);
      pair[1].serializeAttachment({ pid: null });
      await this.core.onOpen();
      return new Response(null, { status: 101, webSocket: pair[0] });
    }
    return new Response('not found', { status: 404 });
  }
  async webSocketMessage(ws, msg) {
    if (typeof msg !== 'string' || msg.length > 20000) return;
    let m; try { m = JSON.parse(msg); } catch { return; }
    if (!m || typeof m !== 'object') return;
    const a = att(ws) || {};
    await this.core.onMessage(ws, a.pid || null, m);
    if (this.bg.length) await this.drain();
  }
  async webSocketClose(ws, code, reason) { await this.gone(ws); try { ws.close(1000, 'bye'); } catch {} }
  async webSocketError(ws) { await this.gone(ws); }
  async gone(ws) { const a = att(ws) || {}; if (a.gone) return; a.gone = true; try { ws.serializeAttachment(a); } catch {} await this.core.onClose(a.pid || null); if (this.bg.length) await this.drain(); }
  async alarm() { this.armed = 0; await this.core.onAlarm(); if (this.bg.length) await this.drain(); }
}
function att(ws) { try { return ws.deserializeAttachment(); } catch { return null; } }
