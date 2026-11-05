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
import * as social from './social.js'; // 18.0 (SO)
import * as lv from './lv.js'; // 18.0 (LV): spectators, /turn tokens, upkeep
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
      sockets() { const out = []; for (const ws of self.ctx.getWebSockets()) { const a = att(ws); if (a && a.pid && !a.gone && !a.spec) out.push({ ws, pid: a.pid }); } return out; },
      // 18.0 (LV): spectator sockets (no seat; never in sockets(), so they count toward nothing). all = also the ones
      // that have not sent {t:'watch'} yet (the cap counts those too)
      specs(all) { const out = []; for (const ws of self.ctx.getWebSockets('spec')) { const a = att(ws); if (a && a.spec && !a.gone && (all || a.ok)) out.push({ ws, sid: a.spec, ip: a.ip || null }); } return out; },
      admit(ws) { try { const a = att(ws) || {}; ws.serializeAttachment({ ...a, ok: 1 }); } catch {} },
      turnTok: (pid) => lv.turnToken(self.env, self.core && self.core.R ? self.core.R.code : '', pid).catch(() => null), // 18.0 (LV): /turn gate
      send(ws, str) { try { ws.send(str); } catch {} },
      close(ws, code, why) { const a = att(ws) || {}; a.gone = true; try { ws.serializeAttachment(a); } catch {} try { ws.close(code, why); } catch {} },
      bind(ws, pid) { try { const a = att(ws) || {}; ws.serializeAttachment({ ...a, pid }); } catch {} }, // 17.1 (MM): keeps ip/loc
      meta(ws) { const a = att(ws) || {}; return { ip: a.ip || null, loc: a.loc || null }; }, // 17.1 (MM): hashed IP + region (worker headers)
      // 17.1 (MM): public listing report to the Matchmaker ({op:'reg', ...} | {op:'unreg', code}); background, 3 s cap,
      // never throws: a lobby or match never waits on it. Resolves to the Matchmaker's answer or null.
      mm(body) {
        if (!self.env || !self.env.MM) return Promise.resolve(null);
        const job = (async () => {
          const stub = self.env.MM.get(self.env.MM.idFromName('global'));
          const r = await stub.fetch(new Request('https://mm/' + (body.op === 'unreg' ? 'unreg' : 'reg'), { method: 'POST', body: JSON.stringify(body) }));
          return r.ok ? await r.json() : null;
        })().catch(() => null);
        let to; const p = Promise.race([job, new Promise((r) => { to = setTimeout(() => r(null), 3000); })]).finally(() => clearTimeout(to));
        self.bg.push(p);
        return p;
      },
      async save(R) { if (R) await self.ctx.storage.put('R', R); },
      async wipe() { await self.ctx.storage.deleteAll(); },
      async arm(at) {
        if (at === self.armed) return;
        self.armed = at;
        if (at) await self.ctx.storage.setAlarm(at); else await self.ctx.storage.deleteAlarm();
      },
      // 17.0 (S2)
      bg(p) { self.bg.push(Promise.resolve(p).catch(() => {})); },
      rank: (cids) => { if (!self.env || !self.env.BOARD) return Promise.resolve(null); let to; return Promise.race([self.env.BOARD.get(self.env.BOARD.idFromName('main')).ranks(cids), new Promise((r) => { to = setTimeout(() => r(null), 3000); })]).catch(() => null).finally(() => clearTimeout(to)); }, // 18.0 (NE): {cid: {r, p?}}, 3 s cap
      verify: async (cid, proof) => { const r = await verifyPlayer(self.env, cid, proof); if (r && r.ok) { try { r.tag = await social.tagOf(r.id); } catch {} } return r; }, // 18.0 (SO): + the public player tag
      // 18.0 (SO): friends presence -> the player's own Player DO (background, 3 s cap, never throws)
      social(cid, body) {
        if (!self.env || !self.env.PLAYER || !cid) return;
        const job = self.env.PLAYER.get(self.env.PLAYER.idFromName(cid)).soRoom(body.room, body.st, body.mode || null, !!body.pub).catch(() => null);
        let to; self.bg.push(Promise.race([job, new Promise((r) => { to = setTimeout(r, 3000); })]).finally(() => clearTimeout(to)));
      },
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
    if (url.pathname === '/mod/prune' && req.method === 'POST') { // 18.0 (LV): daily upkeep ('_mod' instance only): verdicts older than 30 days
      const now = +url.searchParams.get('now') || Date.now();
      return new Response(JSON.stringify(await lv.pruneMod(this.ctx.storage, this.test ? now : Date.now())), { headers: { 'Content-Type': 'application/json' } });
    }
    if (url.pathname === '/mod/seed' && req.method === 'POST' && this.test) { // 18.0 (LV) tests: n fake verdicts aged ageDays
      let b = {}; try { b = await req.json(); } catch {}
      const n = Math.max(0, Math.min(500, b.n | 0)), at = Date.now() - (+b.ageDays || 0) * 864e5, put = {};
      for (let i = 0; i < n; i++) put['v:seed' + (b.tag || '') + i] = { ok: true, at };
      for (let i = 0, ks = Object.keys(put); i < ks.length; i += 128) await this.ctx.storage.put(Object.fromEntries(ks.slice(i, i + 128).map((k) => [k, put[k]])));
      const all = await this.ctx.storage.list({ prefix: 'v:' });
      return new Response(JSON.stringify({ ok: true, total: all.size }), { headers: { 'Content-Type': 'application/json' } });
    }
    if (url.pathname === '/mod/stats' && this.test) { const b = (await this.ctx.storage.get('budget')) || null; return new Response(JSON.stringify({ budget: b }), { headers: { 'Content-Type': 'application/json' } }); }
    if (url.pathname === '/init' && req.method === 'POST') {
      const q = url.searchParams, o = q.get('qp') === '1' ? { qp: true, mode: q.get('mode') || 'royale', loc: q.get('loc') || null, ip: q.get('ip') || null } : null; // 17.1 (MM): a Quick Play room from the Matchmaker
      const ok = await this.core.init(code, o);
      if (this.bg.length) await this.drain();
      return new Response(ok ? 'ok' : 'taken', { status: ok ? 200 : 409 });
    }
    if (req.headers.get('Upgrade') === 'websocket') {
      const pair = new WebSocketPair();
      if (!this.core.exists()) {
        // never created (or cleaned up): say so over the socket so the client can fall back to a phone-hosted party
        pair[1].accept(); try { pair[1].send(JSON.stringify({ t: 'bye', why: 'noroom', reason: 'noroom' })); pair[1].close(4004, 'noroom'); } catch {}
        return new Response(null, { status: 101, webSocket: pair[0] });
      }
      if (url.searchParams.get('watch') === '1') { // 18.0 (LV): a read-only spectator (no seat); the core admits it on {t:'watch'}
        const ip = (req.headers.get('X-CC-IP') || '').slice(0, 32) || null, why = this.core.canWatch(ip);
        if (why) { pair[1].accept(); try { pair[1].send(JSON.stringify({ t: 'bye', why, reason: why })); pair[1].close(4007, why); } catch {} return new Response(null, { status: 101, webSocket: pair[0] }); }
        this.ctx.acceptWebSocket(pair[1], ['spec']);
        pair[1].serializeAttachment({ spec: 's' + crypto.randomUUID().slice(0, 8), ip });
        return new Response(null, { status: 101, webSocket: pair[0] });
      }
      this.ctx.acceptWebSocket(pair[1]);
      pair[1].serializeAttachment({ pid: null, ip: (req.headers.get('X-CC-IP') || '').slice(0, 32) || null, loc: (req.headers.get('X-CC-Loc') || '').slice(0, 8) || null }); // 17.1 (MM)
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
    if (a.spec) { await this.core.onSpec(ws, a, m); if (this.bg.length) await this.drain(); return; } // 18.0 (LV): spectators never reach the seat handlers
    await this.core.onMessage(ws, a.pid || null, m);
    if (this.bg.length) await this.drain();
  }
  async webSocketClose(ws, code, reason) { await this.gone(ws); try { ws.close(1000, 'bye'); } catch {} }
  async webSocketError(ws) { await this.gone(ws); }
  async gone(ws) { const a = att(ws) || {}; if (a.gone) return; a.gone = true; try { ws.serializeAttachment(a); } catch {} if (a.spec) { if (a.ok) await this.core.specGone(); if (this.bg.length) await this.drain(); return; } /* 18.0 (LV) */ await this.core.onClose(a.pid || null); if (this.bg.length) await this.drain(); }
  async alarm() { this.armed = 0; await this.core.onAlarm(); if (this.bg.length) await this.drain(); }
}
function att(ws) { try { return ws.deserializeAttachment(); } catch { return null; } }
