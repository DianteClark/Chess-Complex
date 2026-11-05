// Chess Complex 18.0 "Rivals" (SO): friends, public player tags, presence, party invites, blocks, Appear Offline.
// Everything lives in the Player Durable Object of each player (player.js; the methods below are mixed into its
// prototype, all prefixed `so` plus the WebSocket handlers), so there is no new class, binding or migration.
//
// Player tag: 8 Crockford base32 chars of SHA-256('cc-tag:' + cloud id), shown as XXXX-XXXX. Public; it reveals neither
// the secret nor the cloud id. A directory entry (the Player DO instance named '#' + tag) maps it back to the id.
//
// Client link (js/social.js): one WebSocket per phone, GET /social/ws/<id> -> the player's own DO (Hibernation API:
// an idle link costs no duration; {"t":"hb"} is answered by the runtime without waking the DO). First message
// {t:'auth', s:<secret>} (never in the URL). Then {t:'op', q, op, ...} -> {t:'r', q, ok, ...}. Pushes: {t:'inv'}
// (party invite), {t:'req'} (friend request), {t:'friend'} (request accepted), {t:'drop'} (removed), {t:'n'} (badge).
// The same ops also answer POST /social/<id> {op, ...} with Authorization: Bearer <secret> (tests, fallback).
//
// Presence is PUSHED on change (free plan: a list refresh must not cost a call per friend). A player's own presence =
// Room events (server/src/core.js soSync -> Player.soRoom on join / leave / match start / match end) + Appear Offline +
// "has a live friends link" (online / offline transitions). When it changes, the player's DO sends a small snapshot to
// each mutual friend's DO (soPres), at most one fan-out per 10 s per player (a later change inside the window goes out
// from a one-shot DO alarm at the end of it). The friend's DO stores it (so_pres) and pushes it to its open links; the
// reply carries the friend's own current snapshot back, so both sides heal. Friends silent for 14 days are skipped (they
// refresh everyone the moment they come back, through those replies). A list refresh reads only the player's OWN DO.
// Only mutual friends see presence; blocked players see nothing and cannot invite or request.
//
// Ops: me | list | add {tag} (request, or accept when they asked you) | accept {tag} | decline {tag} | remove {tag} |
//      block {tag, name?} | unblock {tag} | invite {tag, room, mode} | answer {tag, join} | hide {on}
// Limits: 200 friends (incl. sent requests), 100 incoming requests (oldest dropped), 300 blocks, 30 adds / hour,
// invites 15 / 10 min and 1 per friend per 15 s, 20 pending invites (one per sender, newest wins), invites expire after
// 10 min, 90 ops / min per player, 4 links per player.

export const TAG_LEN = 8;
const B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const TAG_RE = new RegExp(`^[${B32}]{${TAG_LEN}}$`), ID_RE = new RegExp(`^[${B32}]{10}$`), SECRET_RE = new RegExp(`^[${B32}]{16}$`);
const ROOM_RE = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{5}$/;
export const L = {
  friends: 200, incoming: 100, blocks: 300, addsPerHour: 30, invPer10: 15, invGap: 15000, invHeld: 20, invTtl: 600000,
  opsPerMin: 90, links: 4, fanGap: 10000, fanMs: 2500, dormant: 14 * 86400000, matchTtl: 3 * 3600000, lobbyTtl: 3600000,
};

async function sha256(s) {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));
  return [...d].map((x) => x.toString(16).padStart(2, '0')).join('');
}
// tag of a cloud id: 40 bits of SHA-256 in Crockford base32
export async function tagOf(id) {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode('cc-tag:' + String(id).toUpperCase())));
  let bits = 0, n = 0, out = '';
  for (let i = 0; out.length < TAG_LEN; ) { if (n < 5) { bits = (bits << 8) | d[i++]; n += 8; } n -= 5; out += B32[(bits >> n) & 31]; }
  return out;
}
// what a person typed -> tag (case, dash, spaces, Crockford look-alikes O->0, I/L->1)
export function cleanTag(t) {
  const s = String(t || '').toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
  return TAG_RE.test(s) ? s : null;
}
const nameOf = (v) => (typeof v === 'string' ? v.replace(/[<>&"]/g, '').trim().slice(0, 14) : '') || 'Player';
const MODES = /^[a-z]{3,12}$/;
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
const bearer = (req) => { const m = /^Bearer\s+([0-9A-Za-z]+)\s*$/.exec(req.headers.get('Authorization') || ''); return m ? m[1].toUpperCase() : null; };
const stubOf = (env, name) => env.PLAYER.get(env.PLAYER.idFromName(name));
const timed = (p, ms) => { let to; return Promise.race([p, new Promise((r) => { to = setTimeout(() => r(null), ms); })]).finally(() => clearTimeout(to)); };

// ---------------------------------------------------------------- Worker routes (worker.js)
//   GET  /social/ws/<id>   WebSocket upgrade -> the player's DO (returned as is: a 101 must not be re-wrapped for CORS)
//   POST /social/<id>      {op, ...} with Authorization: Bearer <secret>
//   GET  /social/tag/<id>  dev only (PLAYER_TEST): the tag of an id, for tests
export async function routes(req, env, url) {
  const p = url.pathname;
  if (!p.startsWith('/social/')) return null;
  if (!env.PLAYER) return json({ error: 'off' }, 503);
  let m = /^\/social\/ws\/([0-9A-Za-z]{10})$/.exec(p);
  if (m) {
    if (req.headers.get('Upgrade') !== 'websocket') return json({ error: 'expected websocket' }, 426);
    const id = m[1].toUpperCase(); if (!ID_RE.test(id)) return json({ error: 'unknown player' }, 404);
    const u = new URL(req.url); u.searchParams.set('id', id);
    return stubOf(env, id).fetch(new Request(u.toString(), req));
  }
  if ((m = /^\/social\/tag\/([0-9A-Za-z]{10})$/.exec(p)) && (env.PLAYER_TEST && env.PLAYER_TEST !== '0')) return json({ tag: await tagOf(m[1]) });
  m = /^\/social\/([0-9A-Za-z]{10})$/.exec(p);
  if (!m) return json({ error: 'not found' }, 404);
  if (req.method !== 'POST') return json({ error: 'method' }, 405);
  const id = m[1].toUpperCase(), secret = bearer(req);
  if (!ID_RE.test(id)) return json({ error: 'unknown player' }, 404);
  if (!secret || !SECRET_RE.test(secret)) return json({ error: 'bad secret' }, 401);
  let body = null; try { const t = await req.text(); if (t.length > 2000) return json({ error: 'too large' }, 413); body = JSON.parse(t); } catch {}
  if (!body || typeof body !== 'object' || typeof body.op !== 'string') return json({ error: 'need {op}' }, 400);
  const r = await stubOf(env, id).soOp(id, await sha256(secret), body);
  return json(r, r && r.status ? r.status : 200);
}

// ---------------------------------------------------------------- Player DO methods (mixed into Player.prototype)
export const methods = {
  // ---- storage (tables created on first social use; a probe of an unknown id stores nothing)
  soInit() {
    if (this._so) return;
    this.sql.exec('CREATE TABLE IF NOT EXISTS so_rel (tag TEXT PRIMARY KEY, id TEXT NOT NULL, st TEXT NOT NULL, name TEXT, at INTEGER NOT NULL)');
    this.sql.exec('CREATE TABLE IF NOT EXISTS so_inv (tag TEXT PRIMARY KEY, id TEXT NOT NULL, name TEXT, room TEXT NOT NULL, mode TEXT, at INTEGER NOT NULL)');
    this.sql.exec('CREATE TABLE IF NOT EXISTS so_kv (k TEXT PRIMARY KEY, v TEXT)');
    this.sql.exec('CREATE TABLE IF NOT EXISTS so_pres (tag TEXT PRIMARY KEY, v TEXT NOT NULL, at INTEGER NOT NULL)'); // friends\' last pushed snapshot; at = their last push (activity)
    this._so = true;
  },
  soGet(k) { this.soInit(); const r = this.sql.exec('SELECT v FROM so_kv WHERE k = ?', k).toArray()[0]; try { return r ? JSON.parse(r.v) : null; } catch { return null; } },
  soSet(k, v) { this.soInit(); if (v == null) this.sql.exec('DELETE FROM so_kv WHERE k = ?', k); else this.sql.exec('INSERT OR REPLACE INTO so_kv (k, v) VALUES (?, ?)', k, JSON.stringify(v)); },
  soMe() { return this.soGet('me') || {}; },
  soPutMe(patch) { const me = { ...this.soMe(), ...patch }; this.soSet('me', me); return me; },
  soRel(tag) { this.soInit(); return this.sql.exec('SELECT tag, id, st, name, at FROM so_rel WHERE tag = ?', tag).toArray()[0] || null; },
  soRels(st) { this.soInit(); return this.sql.exec('SELECT tag, id, st, name, at FROM so_rel WHERE st = ? ORDER BY at DESC', st).toArray(); },
  soCount(sts) { this.soInit(); return this.sql.exec(`SELECT COUNT(*) AS n FROM so_rel WHERE st IN (${sts.map(() => '?').join(',')})`, ...sts).one().n; },
  soPutRel(tag, id, st, name) { this.soInit(); this.sql.exec('INSERT OR REPLACE INTO so_rel (tag, id, st, name, at) VALUES (?, ?, ?, ?, ?)', tag, id, st, nameOf(name), Date.now()); },
  soDel(tag) { this.soInit(); this.sql.exec('DELETE FROM so_rel WHERE tag = ?', tag); this.sql.exec('DELETE FROM so_inv WHERE tag = ?', tag); this.sql.exec('DELETE FROM so_pres WHERE tag = ?', tag); },
  // every call to another Player DO goes through here (PLAYER_TEST answers count them: a list refresh must make none)
  soPeer(id) { this._rpc = (this._rpc || 0) + 1; return stubOf(this.env, id); },
  soTest() { return !!(this.env && this.env.PLAYER_TEST && this.env.PLAYER_TEST !== '0'); },
  soInvites() {
    this.soInit();
    this.sql.exec('DELETE FROM so_inv WHERE at < ?', Date.now() - L.invTtl);
    return this.sql.exec('SELECT tag, name, room, mode, at FROM so_inv ORDER BY at DESC').toArray().map((r) => ({ tag: r.tag, name: r.name, room: r.room, mode: r.mode, at: r.at, left: Math.max(0, r.at + L.invTtl - Date.now()) }));
  },
  soName() { try { const r = this.row(); const p = r && r.blob ? JSON.parse(r.blob).p : null; return nameOf(p && p.name); } catch { return 'Player'; } },
  // sliding-window limiter in so_kv: true when allowed (and counted)
  soRate(key, max, ms) {
    const now = Date.now(), list = (this.soGet('rl:' + key) || []).filter((t) => now - t < ms);
    if (list.length >= max) { this.soSet('rl:' + key, list); return false; }
    list.push(now); this.soSet('rl:' + key, list); return true;
  },
  soLinks() { return this.ctx.getWebSockets().filter((ws) => { const a = soAtt(ws); return a && a.ok && !a.gone; }); },
  soPush(o) { const me = this.soMe(); if (o.t !== 'n') o.n = this.soBadge(); const s = JSON.stringify(o); for (const ws of this.soLinks()) { try { ws.send(s); } catch {} } return me; },
  soBadge() { this.soInit(); return { inv: this.soInvites().length, req: this.soCount(['in']) }; },
  // ---- presence
  soPresence() {
    const me = this.soMe(), now = Date.now();
    if (me.hidden) return { st: 'offline' };
    const pr = me.pres;
    if (pr && pr.st && now - pr.at < (pr.st === 'match' ? L.matchTtl : L.lobbyTtl)) {
      const o = { st: pr.st, mode: pr.mode || null, t: pr.at };
      if (pr.st === 'match' || pr.pub) o.room = pr.room; // friends may Watch a match (LV) / see a public lobby; private lobby codes stay private
      return o;
    }
    // a link counts while its heartbeats are answered (25 s on the client): a phone that vanished without closing its
    // socket stops looking online after 90 s (the runtime keeps the time of the last auto-answered {"t":"hb"})
    if (this.soLinks().some((ws) => { let t = (soAtt(ws) || {}).at || 0; try { const d = this.ctx.getWebSocketAutoResponseTimestamp(ws); if (d) t = Math.max(t, +d); } catch {} return now - t < 90000; })) return { st: 'online' };
    return { st: 'offline', seen: me.seen || 0 };
  },
  soSnap() { return { name: this.soName(), ...this.soPresence() }; },
  soStorePres(tag, snap, active) {
    const v = cleanSnap(snap); if (!v) return null;
    const old = this.sql.exec('SELECT at FROM so_pres WHERE tag = ?', tag).toArray()[0];
    this.sql.exec('INSERT OR REPLACE INTO so_pres (tag, v, at) VALUES (?, ?, ?)', tag, JSON.stringify(v), active || !old ? Date.now() : old.at);
    if (v.name) this.sql.exec("UPDATE so_rel SET name = ? WHERE tag = ? AND st = 'friend'", v.name, tag);
    return v;
  },
  // my presence changed (maybe): tell every mutual friend, at most once per fanGap; a change inside the gap is sent by a
  // one-shot alarm at its end (the latest state then, not every step)
  async soAnnounce() {
    this.soInit();
    const me = this.soMe(); if (!me.tag || !me.id) return 0;
    const snap = this.soSnap(), k = JSON.stringify(snap), ann = this.soGet('ann') || { k: '', at: 0 }, now = Date.now();
    if (k === ann.k) return 0;
    const gap = this.soTest() && +this.env.SO_FAN_MS > 0 ? +this.env.SO_FAN_MS : L.fanGap;
    if (now - ann.at < gap) {
      const at = ann.at + gap, cur = await this.ctx.storage.getAlarm();
      if (!cur || cur > at) await this.ctx.storage.setAlarm(at);
      return 0;
    }
    this.soSet('ann', { k, at: now });
    const pres = {}; for (const r of this.sql.exec('SELECT tag, at FROM so_pres').toArray()) pres[r.tag] = r.at;
    const to = this.soRels('friend').filter((f) => !(f.tag in pres) || now - pres[f.tag] < L.dormant); // dormant friends refresh us when they return
    const from = { id: me.id, tag: me.tag };
    const back = await Promise.all(to.map((f) => timed(this.soPeer(f.id).soPres(from, snap).catch(() => null), L.fanMs)));
    back.forEach((r, i) => { if (r && r.friend && r.snap) this.soStorePres(to[i].tag, r.snap, false); });
    if (this.soTest()) this.soSet('fans', (this.soGet('fans') || 0) + 1);
    return to.length;
  },

  // ---- WebSocket link
  async soFetch(req) {
    const url = new URL(req.url);
    if (req.headers.get('Upgrade') !== 'websocket') return new Response('not found', { status: 404 });
    const id = (url.searchParams.get('id') || '').toUpperCase();
    if (!ID_RE.test(id) || !this.row()) return new Response('unknown player', { status: 404 });
    try { this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('{"t":"hb"}', '{"t":"hb"}')); } catch {}
    const old = this.ctx.getWebSockets();
    if (old.length >= L.links) { const o = old[0]; try { o.send('{"t":"bye","why":"replaced"}'); o.close(4003, 'replaced'); } catch {} }
    const pair = new WebSocketPair();
    this.ctx.acceptWebSocket(pair[1]);
    pair[1].serializeAttachment({ id, ok: false, at: Date.now() });
    return new Response(null, { status: 101, webSocket: pair[0] });
  },
  async webSocketMessage(ws, msg) {
    if (typeof msg !== 'string' || msg.length > 2000) return;
    let m; try { m = JSON.parse(msg); } catch { return; }
    if (!m || typeof m !== 'object') return;
    const a = soAtt(ws) || {};
    if (m.t === 'auth') {
      const s = String(m.s || '').toUpperCase();
      const r = SECRET_RE.test(s) && a.id ? this.auth(await sha256(s)) : { status: 401 };
      if (!r.r) { try { ws.send(JSON.stringify({ t: 'bye', why: 'auth' })); ws.close(4001, 'auth'); } catch {} return; }
      ws.serializeAttachment({ ...a, ok: true, at: Date.now() });
      const me = await this.soHello(a.id);
      try { ws.send(JSON.stringify({ t: 'me', ...me })); } catch {}
      await this.soAnnounce(); // offline -> online
      return;
    }
    if (!a.ok) return;
    if (m.t === 'op' && typeof m.op === 'string') {
      const r = await this.soDo(a.id, m);
      try { ws.send(JSON.stringify({ t: 'r', q: m.q, ...r })); } catch {}
    }
  },
  async webSocketClose(ws) { await this.soGone(ws); try { ws.close(1000, 'bye'); } catch {} },
  async webSocketError(ws) { await this.soGone(ws); },
  async soGone(ws) { const a = soAtt(ws) || {}; if (a.gone) return; try { ws.serializeAttachment({ ...a, gone: true }); } catch {} if (a.ok) { this.soInit(); this.soPutMe({ seen: Date.now() }); await this.soAnnounce(); } }, // online -> offline (when it was the last link)
  async alarm() { try { await this.soAnnounce(); } catch {} }, // the trailing fan-out of a debounced change
  // the secret was reset on another phone (transfer code): drop every live link
  soKick() { for (const ws of this.ctx.getWebSockets()) { try { ws.send('{"t":"bye","why":"auth"}'); ws.close(4001, 'auth'); } catch {} } },

  // ---- ops (HTTP: authenticated here; WebSocket: authenticated at 'auth')
  async soOp(id, hash, body) {
    const r = this.auth(hash); if (!r.r) return { ok: false, status: r.status, error: r.status === 401 ? 'bad secret' : 'unknown player' };
    if (body.op === 'me') return { ok: true, ...(await this.soHello(id)) };
    return this.soDo(id, body);
  },
  async soHello(id) {
    this.soInit();
    let me = this.soMe();
    if (!me.tag || me.id !== id) {
      const tag = await tagOf(id);
      const dir = await stubOf(this.env, '#' + tag).soDirSet(id).catch(() => false);
      me = this.soPutMe({ id, tag, dir: !!dir });
    }
    return { tag: me.tag, hidden: !!me.hidden, inv: this.soInvites(), n: this.soBadge(), friends: this.soCount(['friend']) };
  },
  async soDo(id, m) {
    try {
      if (!this.soRate('ops', L.opsPerMin, 60000)) return { ok: false, why: 'Too fast. Try again in a minute.' };
      const me = this.soMe(); if (!me.tag) await this.soHello(id);
      const tag = m.tag != null ? cleanTag(m.tag) : null;
      switch (m.op) {
        case 'me': return { ok: true, ...(await this.soHello(id)) };
        case 'list': { const r0 = this._rpc || 0, l = this.soList(); return { ok: true, ...l, ...(this.soTest() ? { rpc: (this._rpc || 0) - r0, fans: this.soGet('fans') || 0 } : {}) }; }
        case 'hide': { this.soPutMe({ hidden: !!m.on }); await this.soAnnounce(); return { ok: true, hidden: !!m.on }; }
        case 'add': case 'accept': return this.soAdd(id, tag);
        case 'decline': case 'remove': return this.soRemove(id, tag);
        case 'block': return this.soBlock(id, tag, m.name);
        case 'unblock': { if (!tag) return bad(); const r = this.soRel(tag); if (r && r.st === 'block') this.soDel(tag); return { ok: true, st: null }; }
        case 'invite': return this.soSendInvite(id, tag, m.room, m.mode);
        case 'answer': {
          if (!tag) return bad();
          const inv = this.soInvites().find((x) => x.tag === tag);
          this.sql.exec('DELETE FROM so_inv WHERE tag = ?', tag);
          this.soPush({ t: 'n' });
          if (!inv) return { ok: false, why: 'That invite has expired.' };
          return m.join ? { ok: true, room: inv.room, mode: inv.mode } : { ok: true };
        }
        default: return { ok: false, why: 'unknown op' };
      }
    } catch (e) { try { console.error('[social]', m && m.op, String(e && e.message || e).slice(0, 160)); } catch {} return { ok: false, why: 'Something went wrong. Try again.' }; }
  },
  async soLookup(tag) {
    if (!tag) return null;
    const id = await stubOf(this.env, '#' + tag).soDirGet().catch(() => null);
    return id && ID_RE.test(id) ? id : null;
  },
  async soAdd(id, tag) {
    if (!tag) return bad();
    const me = this.soMe(); if (tag === me.tag) return { ok: false, why: 'That is your own tag.' };
    const cur = this.soRel(tag);
    if (cur && cur.st === 'friend') return { ok: true, st: 'friend' };
    if (cur && cur.st === 'out') return { ok: true, st: 'out' };
    if (cur && cur.st === 'block') return { ok: false, why: 'You blocked this player. Unblock them first.' };
    if (!cur && this.soCount(['friend', 'out']) >= L.friends) return { ok: false, why: `Friend list full (${L.friends}).` };
    if (!cur && !this.soRate('add', L.addsPerHour, 3600000)) return { ok: false, why: 'Too many friend requests. Try again later.' };
    const fid = cur ? cur.id : await this.soLookup(tag);
    if (!fid) return { ok: false, why: 'No player with that tag.' };
    if (fid === id) return { ok: false, why: 'That is your own tag.' };
    const r = await this.soPeer(fid).soReq({ id, tag: me.tag, name: this.soName(), snap: this.soSnap() }).catch(() => null);
    if (!r) return { ok: false, why: 'Could not reach that player. Try again.' };
    const st = r.st === 'friend' ? 'friend' : 'out';
    this.soPutRel(tag, fid, st, r.name || (cur && cur.name));
    if (st === 'friend' && r.snap) this.soStorePres(tag, r.snap, true); // friends now: both sides start with each other's snapshot
    return { ok: true, st, name: r.name || null };
  },
  async soRemove(id, tag) {
    if (!tag) return bad();
    const cur = this.soRel(tag);
    if (!cur || cur.st === 'block') return { ok: true, st: cur ? cur.st : null };
    this.soDel(tag);
    await this.soPeer(cur.id).soDrop(this.soMe().tag).catch(() => {});
    return { ok: true, st: null };
  },
  async soBlock(id, tag, name) {
    if (!tag) return bad();
    const me = this.soMe(); if (tag === me.tag) return { ok: false, why: 'That is your own tag.' };
    const cur = this.soRel(tag);
    if (cur && cur.st === 'block') return { ok: true, st: 'block' };
    if (this.soCount(['block']) >= L.blocks) return { ok: false, why: `Block list full (${L.blocks}).` };
    const fid = cur ? cur.id : await this.soLookup(tag);
    if (!fid) return { ok: false, why: 'No player with that tag.' };
    this.soDel(tag);
    this.soPutRel(tag, fid, 'block', (cur && cur.name) || name);
    await this.soPeer(fid).soDrop(me.tag).catch(() => {}); // they lose the friendship / request / invite too
    return { ok: true, st: 'block' };
  },
  async soSendInvite(id, tag, room, mode) {
    if (!tag) return bad();
    room = String(room || '').toUpperCase(); if (!ROOM_RE.test(room)) return { ok: false, why: 'Open a party first.' };
    mode = MODES.test(String(mode || '')) ? String(mode) : null;
    const cur = this.soRel(tag);
    if (!cur || cur.st !== 'friend') return { ok: false, why: 'You can only invite friends.' };
    const last = this.soGet('ig:' + tag) || 0;
    if (Date.now() - last < L.invGap) return { ok: false, why: 'Invite already sent.' };
    if (!this.soRate('inv', L.invPer10, 600000)) return { ok: false, why: 'Too many invites. Try again in a few minutes.' };
    this.soSet('ig:' + tag, Date.now());
    const me = this.soMe();
    const r = await timed(this.soPeer(cur.id).soInvite({ id, tag: me.tag, name: this.soName() }, room, mode).catch(() => null), 4000);
    if (!r) return { ok: false, why: 'Could not reach that player. Try again.' };
    return r.ok ? { ok: true } : { ok: false, why: r.why || 'Invite not delivered.' };
  },
  // reads this DO only (snapshots pushed by friends): one request per refresh whatever the friend count
  soList() {
    const now = Date.now(), pres = {}, cut = (r) => ({ tag: r.tag, name: r.name, at: r.at });
    for (const r of this.sql.exec('SELECT tag, v FROM so_pres').toArray()) { try { pres[r.tag] = JSON.parse(r.v); } catch {} }
    const order = { match: 0, lobby: 1, online: 2, offline: 3 };
    const friends = this.soRels('friend').map((r) => {
      let p = pres[r.tag] || { st: 'offline' };
      if ((p.st === 'match' || p.st === 'lobby') && p.t && now - p.t > (p.st === 'match' ? L.matchTtl : L.lobbyTtl)) p = { st: 'offline' }; // no event for hours: don't trust it
      return { ...cut(r), st: p.st, mode: p.mode || null, room: p.room || null, seen: p.seen || 0 };
    }).sort((a, b) => (order[a.st] - order[b.st]) || a.name.localeCompare(b.name));
    const me = this.soMe();
    return { tag: me.tag, hidden: !!me.hidden, friends, req: this.soRels('in').map(cut), out: this.soRels('out').map(cut), blocked: this.soRels('block').map(cut), inv: this.soInvites(), n: this.soBadge(), at: now };
  },

  // ---- peer RPCs (Player DO -> Player DO; never reachable from outside)
  async soReq(from) {
    this.soInit();
    if (!from || !ID_RE.test(from.id) || !TAG_RE.test(from.tag)) return null;
    const cur = this.soRel(from.tag), mine = this.soName();
    if (cur && cur.st === 'block') return { st: 'out', name: null }; // looks sent; nothing is stored or shown
    if (cur && cur.st === 'friend') return { st: 'friend', name: mine, snap: this.soSnap() };
    if (cur && cur.st === 'out') { // both asked: friends now
      this.soPutRel(from.tag, from.id, 'friend', from.name);
      if (from.snap) this.soStorePres(from.tag, from.snap, true);
      this.soPush({ t: 'friend', tag: from.tag, name: nameOf(from.name) });
      return { st: 'friend', name: mine, snap: this.soSnap() };
    }
    if (!cur && this.soCount(['in']) >= L.incoming) this.sql.exec("DELETE FROM so_rel WHERE tag = (SELECT tag FROM so_rel WHERE st = 'in' ORDER BY at ASC LIMIT 1)");
    this.soPutRel(from.tag, from.id, 'in', from.name);
    this.soPush({ t: 'req', tag: from.tag, name: nameOf(from.name) });
    return { st: 'out', name: null };
  },
  async soDrop(fromTag) {
    this.soInit();
    if (!TAG_RE.test(String(fromTag || ''))) return false;
    const cur = this.soRel(fromTag);
    this.sql.exec('DELETE FROM so_inv WHERE tag = ?', fromTag);
    if (cur && cur.st !== 'block') { this.soDel(fromTag); this.soPush({ t: 'drop', tag: fromTag }); }
    return true;
  },
  async soInvite(from, room, mode) {
    this.soInit();
    if (!from || !TAG_RE.test(from.tag) || !ROOM_RE.test(room)) return { ok: false };
    const cur = this.soRel(from.tag);
    if (!cur || cur.st !== 'friend' || cur.id !== from.id) return { ok: false, why: 'You can only invite friends.' };
    this.sql.exec('INSERT OR REPLACE INTO so_inv (tag, id, name, room, mode, at) VALUES (?, ?, ?, ?, ?, ?)', from.tag, from.id, nameOf(from.name), room, mode || null, Date.now());
    const n = this.sql.exec('SELECT COUNT(*) AS n FROM so_inv').one().n;
    if (n > L.invHeld) this.sql.exec('DELETE FROM so_inv WHERE tag IN (SELECT tag FROM so_inv ORDER BY at ASC LIMIT ?)', n - L.invHeld);
    this.soPush({ t: 'inv', inv: { tag: from.tag, name: nameOf(from.name), room, mode: mode || null, at: Date.now(), left: L.invTtl } });
    return { ok: true };
  },
  // a friend's presence changed: keep the snapshot, show it on my open links, answer with mine (heals a stale side)
  async soPres(from, snap) {
    this.soInit();
    if (!from || !TAG_RE.test(String(from.tag || ''))) return null;
    const cur = this.soRel(from.tag);
    if (!cur || cur.st !== 'friend' || cur.id !== from.id) return { friend: false };
    const v = this.soStorePres(from.tag, snap, true);
    if (v && this.soLinks().length) this.soPush({ t: 'pres', tag: from.tag, ...v });
    return { friend: true, snap: this.soSnap() };
  },
  // from the Room (core.js soSync): st 'lobby' | 'match' | '' (left that room)
  async soRoom(room, st, mode, pub) {
    if (!ROOM_RE.test(String(room || ''))) return false;
    this.soInit();
    const me = this.soMe();
    if (!st) { if (me.pres && me.pres.room === room) { this.soPutMe({ pres: null, seen: Date.now() }); await this.soAnnounce(); } return true; }
    this.soPutMe({ pres: { st: st === 'match' ? 'match' : 'lobby', room, mode: MODES.test(String(mode || '')) ? mode : null, pub: !!pub, at: Date.now() } });
    await this.soAnnounce();
    return true;
  },
  // tag directory (the instance named '#' + tag)
  async soDirSet(id) {
    this.soInit();
    const cur = this.soGet('dir');
    if (cur && cur !== id) return false; // 40-bit collision: the first owner keeps the tag
    if (!cur) this.soSet('dir', id);
    return true;
  },
  async soDirGet() { this.soInit(); return this.soGet('dir'); },
};
const bad = () => ({ ok: false, why: 'Player tags look like ABCD-1234.' });
const STS = ['online', 'lobby', 'match', 'offline'];
function cleanSnap(p) {
  if (!p || typeof p !== 'object' || !STS.includes(p.st)) return null;
  const o = { st: p.st, name: nameOf(p.name) };
  if (p.mode && MODES.test(String(p.mode))) o.mode = String(p.mode);
  if (p.room && ROOM_RE.test(String(p.room))) o.room = String(p.room);
  if (Number.isFinite(+p.seen) && +p.seen > 0) o.seen = +p.seen;
  if (Number.isFinite(+p.t) && +p.t > 0) o.t = +p.t;
  return o;
}
function soAtt(ws) { try { return ws.deserializeAttachment(); } catch { return null; } }

// player.js calls this once after its class: mixes the methods in without touching anything it defines
export function install(Player) {
  for (const [k, f] of Object.entries(methods)) if (!(k in Player.prototype)) Player.prototype[k] = f;
  if (!('fetch' in Player.prototype)) Player.prototype.fetch = function (req) { return this.soFetch(req); };
}
