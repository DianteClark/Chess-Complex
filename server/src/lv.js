// 18.0 (LV): live-spectate helpers + server upkeep. Owned by LV.
//  - TURN gate: GET /turn hands out Cloudflare TURN credentials only with a short-lived token the Room gives each seat
//    (welcome.turn and {t:'turn'} at every match start): `<exp36>.<code>.<pid>.<sig>`, sig = HMAC-SHA256 over the rest
//    (first 16 bytes, base64url). Without a valid token /turn answers the public STUN list (src 'public', err 'token'),
//    so old clients and phone-hosted (PeerJS) parties still get working voice, just no relay credentials.
//  - Daily upkeep (worker.js scheduled, the existing '5 0 * * *' cron, one pass a day, a few DO requests): moderation
//    verdict cache rows older than 30 days ('_mod' Room), the player-creation rate-limit rows (Player '_limits'),
//    the replay upload counters (Replay '_limits').
//  - ROOM_TEST-only route POST /lv/test {op: 'maint', now?} | {op: 'seedmod', n, ageDays} for the server tests.
export const TURN_TOK_TTL = 3600 * 1000; // 1 h; refreshed on every welcome and match start
const enc = new TextEncoder();
const b64u = (u8) => btoa(String.fromCharCode(...u8)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
let keyMemo = null; // {src, key}
async function gateKey(env) {
  // any configured secret works as key material (never sent anywhere); without one the endpoint only ever hands out the
  // public list, so a well-known dev key protects nothing that matters
  const src = String((env && (env.TURN_GATE_KEY || env.TURN_KEY_API_TOKEN || env.ADMIN_KEY)) || 'cc-dev-turn-gate');
  if (keyMemo && keyMemo.src === src) return keyMemo.key;
  const raw = await crypto.subtle.digest('SHA-256', enc.encode('cc-turn-gate:' + src));
  const key = await crypto.subtle.importKey('raw', raw, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  keyMemo = { src, key };
  return key;
}
async function sig(env, body) { return b64u(new Uint8Array(await crypto.subtle.sign('HMAC', await gateKey(env), enc.encode(body))).slice(0, 16)); }
export async function turnToken(env, code, pid, now = Date.now()) {
  if (!/^[A-Z0-9]{5}$/.test(String(code)) || !/^[a-z0-9]{4,16}$/.test(String(pid))) return null;
  const body = `${(now + TURN_TOK_TTL).toString(36)}.${code}.${pid}`;
  return body + '.' + (await sig(env, body));
}
// -> {code, pid} when the token is genuine and not expired, else null
export async function turnCheck(env, tok, now = Date.now()) {
  if (typeof tok !== 'string' || tok.length > 80) return null;
  const p = tok.split('.'); if (p.length !== 4) return null;
  const exp = parseInt(p[0], 36); if (!Number.isFinite(exp) || exp < now || exp > now + TURN_TOK_TTL + 60000) return null;
  const want = await sig(env, p.slice(0, 3).join('.'));
  if (want.length !== p[3].length) return null;
  let d = 0; for (let i = 0; i < want.length; i++) d |= want.charCodeAt(i) ^ p[3].charCodeAt(i);
  return d === 0 ? { code: p[1], pid: p[2] } : null;
}

// ---------------------------------------------------------------- daily upkeep
export const KEEP = { modDays: 30, modPages: 60, page: 1000 };
// '_mod' Room storage: verdicts are 'v:<hash>' -> {ok, at}. Called by room.js (/mod/prune) with that storage.
export async function pruneMod(storage, now = Date.now()) {
  const cut = now - KEEP.modDays * 864e5;
  let scanned = 0, deleted = 0, start;
  for (let i = 0; i < KEEP.modPages; i++) {
    const page = await storage.list({ prefix: 'v:', limit: KEEP.page, ...(start ? { startAfter: start } : {}) });
    if (!page.size) break;
    const old = [];
    for (const [k, v] of page) { scanned++; start = k; if (!v || !(v.at > cut)) old.push(k); }
    for (let j = 0; j < old.length; j += 128) deleted += await storage.delete(old.slice(j, j + 128));
    if (page.size < KEEP.page) break;
  }
  return { scanned, deleted };
}
// one pass, every part on its own (one failing never stops the others); returns counts for logs / tests
export async function maint(env, now = Date.now()) {
  const out = {};
  const step = async (k, fn) => { try { out[k] = await fn(); } catch (e) { out[k] = { err: String((e && e.message) || e).slice(0, 80) }; } };
  await step('mod', async () => {
    if (!env.ROOM) return null;
    const r = await env.ROOM.get(env.ROOM.idFromName('_mod')).fetch(new Request('https://room/mod/prune?now=' + now, { method: 'POST' }));
    return r.ok ? r.json() : { err: r.status };
  });
  await step('lim', async () => (env.PLAYER ? env.PLAYER.get(env.PLAYER.idFromName('_limits')).pruneLim(now) : null));
  await step('rp', async () => {
    if (!env.REPLAY) return null;
    const r = await env.REPLAY.get(env.REPLAY.idFromName('_limits')).fetch(new Request('https://replay/prune?now=' + now, { method: 'POST' }));
    return r.ok ? r.json() : { err: r.status };
  });
  try { console.log('[lv] upkeep ' + JSON.stringify(out).slice(0, 300)); } catch {}
  return out;
}

const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
const yes = (v) => !!v && v !== '0' && v !== 'false';
export async function routes(req, env, url) {
  if (url.pathname !== '/lv/test') return null;
  if (!yes(env.ROOM_TEST) || req.method !== 'POST') return json({ error: 'not found' }, 404);
  let b = {}; try { b = await req.json(); } catch {}
  if (b.op === 'maint') return json(await maint(env, Number.isFinite(+b.now) && +b.now > 0 ? +b.now : Date.now()));
  if (b.op === 'seedmod') { const r = await env.ROOM.get(env.ROOM.idFromName('_mod')).fetch(new Request('https://room/mod/seed', { method: 'POST', body: JSON.stringify(b) })); return json(await r.json()); }
  return json({ error: 'op' }, 400);
}
