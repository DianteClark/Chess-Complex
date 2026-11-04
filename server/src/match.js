// 17.1 (MM): public matchmaking (Quick Play + Browse open matches). Owned by MM.
//   POST /mm/quick  {mode, exclude?}  -> {code, created}      join the best open public lobby for that mode (nearest
//                                                              region, fullest first) or a new Quick Play room
//   GET  /mm/list?mode=<id>            -> {rooms:[{code, mode, n, h, cap, st, qp, loc, age, near}]}
//   POST /mm/test {op}                 ROOM_TEST only: reset | set {L} | dump
// One global Matchmaker DO (idFromName('global')) holds the public room list (logic in mmcore.js). Rooms report
// themselves (core.js mmSync -> room.js io.mm -> /reg | /unreg) in the background: a slow or failing Matchmaker never
// holds up a lobby or a match. No WebSockets here, so the object sleeps between requests; a 60 s alarm prunes stale
// rooms only while some are listed. Abuse limits: RL_API (worker) + per-IP Quick Play / create / listed-room caps
// (IPs are hashed in the Worker; the Matchmaker never sees one).
import { DurableObject } from 'cloudflare:workers';
import { MatchCore } from './mmcore.js';
import { MODES } from '../../js/data.js';
import { modesIn } from '../../js/party.js';
import { locationHint } from './platform.js';

export const QP_MODES = modesIn('custom'); // every party-playable mode (Royale, Blitz, Duel, Squads, Siege, Gauntlet, Hill, Chaos)
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const makeCode = () => { const b = crypto.getRandomValues(new Uint8Array(5)); return Array.from(b, (x) => CODE_CHARS[x % CODE_CHARS.length]).join(''); };
const json = (o, status = 200, extra) => new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...(extra || {}) } });
const yes = (v) => !!v && v !== '0' && v !== 'false';

// hashed client IP: rate limits and the listed-room cap key on this, never on the address itself
export async function ipHash(req) {
  const ip = req.headers.get('CF-Connecting-IP') || 'local';
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode('cc-ip:' + ip)));
  return Array.from(d.slice(0, 8), (x) => x.toString(16).padStart(2, '0')).join('');
}
const mmStub = (env) => env.MM.get(env.MM.idFromName('global'));

export async function routes(req, env, url) {
  const p = url.pathname;
  if (!p.startsWith('/mm/')) return null;
  if (!env.MM) return json({ error: 'off' }, 503);
  if (p === '/mm/quick') {
    if (req.method !== 'POST') return json({ error: 'method' }, 405);
    let b = {}; try { b = await req.json(); } catch {}
    const mode = b && typeof b.mode === 'string' ? b.mode : '';
    if (!QP_MODES.includes(mode)) return json({ error: 'mode' }, 400);
    const exclude = Array.isArray(b.exclude) ? b.exclude.filter((x) => typeof x === 'string' && /^[A-Z0-9]{5}$/.test(x)).slice(0, 8) : [];
    const body = { mode, exclude, ip: await ipHash(req), loc: locationHint(req.cf) };
    const r = await mmStub(env).fetch(new Request('https://mm/quick', { method: 'POST', body: JSON.stringify(body) }));
    const j = await r.json().catch(() => ({ error: 'server' }));
    if (j.error === 'slow') return json(j, 429, { 'Retry-After': String(j.retry || 60) });
    if (j.error === 'cap') return json({ ...j, why: 'You already have open public matches. Finish or leave one first.' }, 409);
    if (j.error) return json(j, 503);
    return json({ code: j.code, created: !!j.created, mode });
  }
  if (p === '/mm/list') {
    if (req.method !== 'GET') return json({ error: 'method' }, 405);
    const mode = url.searchParams.get('mode') || '';
    if (mode && !QP_MODES.includes(mode)) return json({ error: 'mode' }, 400);
    const q = new URLSearchParams({ mode, loc: locationHint(req.cf) || '' });
    const r = await mmStub(env).fetch(new Request('https://mm/list?' + q));
    return json(await r.json().catch(() => ({ rooms: [] })));
  }
  if (p === '/mm/test' && yes(env.ROOM_TEST) && req.method === 'POST') {
    const r = await mmStub(env).fetch(new Request('https://mm/test', { method: 'POST', body: await req.text() }));
    return json(await r.json().catch(() => ({})));
  }
  return json({ error: 'not found' }, 404);
}

export class Matchmaker extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.ctx = ctx; this.env = env; this.creating = new Map();
    ctx.blockConcurrencyWhile(async () => { this.core = new MatchCore((await ctx.storage.get('S')) || null, { L: (await ctx.storage.get('L')) || undefined }); });
  }
  async save() {
    const now = Date.now();
    if (this.core.dirty) { this.core.dirty = false; await this.ctx.storage.put('S', this.core.dump()); }
    const want = this.core.nextAlarm(now), cur = await this.ctx.storage.getAlarm();
    if (want && !cur) await this.ctx.storage.setAlarm(want); else if (!want && cur) await this.ctx.storage.deleteAlarm();
  }
  async alarm() { this.core.prune(Date.now()); await this.save(); }
  async fetch(req) {
    const url = new URL(req.url), p = url.pathname, now = Date.now();
    let b = {}; if (req.method === 'POST') { try { b = await req.json(); } catch {} }
    let out;
    if (p === '/reg') out = this.core.reg(b, now);
    else if (p === '/unreg') out = this.core.unreg(String(b.code || ''));
    else if (p === '/list') { this.core.prune(now); out = { rooms: this.core.list(url.searchParams.get('mode') || '', url.searchParams.get('loc') || null, now) }; }
    else if (p === '/quick') out = await this.quick(b, now);
    else if (p === '/test') out = await this.test(b);
    else return json({ error: 'not found' }, 404);
    await this.save();
    return json(out);
  }
  async quick(b, now) {
    this.core.prune(now);
    const r = this.core.quick(b, now);
    if (r.code) { const c = this.creating.get(r.code); if (c) await c; return r; } // that room is still being made: answer once it exists
    if (!r.create) return r;
    const cap = (MODES[b.mode] || MODES.royale).players[1];
    for (let i = 0; i < 6; i++) {
      const code = makeCode();
      if (this.core.rooms.has(code)) continue;
      this.core.placed(b, code, cap, now); // listed before the Room exists: a second Quick Play now waits for this one
      let done; const p = new Promise((res) => { done = res; }); this.creating.set(code, p);
      let ok = false;
      try {
        let stub; try { stub = b.loc ? this.env.ROOM.get(this.env.ROOM.idFromName(code), { locationHint: b.loc }) : null; } catch {}
        stub ||= this.env.ROOM.get(this.env.ROOM.idFromName(code));
        const q = new URLSearchParams({ code, qp: '1', mode: b.mode, loc: b.loc || '', ip: b.ip || '' });
        const res = await stub.fetch(new Request('https://room/init?' + q, { method: 'POST' }));
        ok = res.status === 200;
      } catch {}
      this.creating.delete(code); done();
      if (ok) return { code, created: true };
      this.core.unreg(code);
    }
    return { error: 'busy' };
  }
  async test(b) {
    if (!yes(this.env.ROOM_TEST)) return { error: 'off' };
    if (b.op === 'reset') { this.core = new MatchCore(null); await this.ctx.storage.delete('L'); this.core.dirty = true; return { ok: true }; }
    if (b.op === 'set' && b.L && typeof b.L === 'object') { Object.assign(this.core.L, b.L); await this.ctx.storage.put('L', b.L); return { ok: true, L: this.core.L }; }
    if (b.op === 'dump') return { ...this.core.dump(), L: this.core.L };
    return { error: 'op' };
  }
}
