// 18.0 (SO): friends / tags / presence / invites / blocks against a local Worker.
//   cd server && npx wrangler dev --local --port 8812 --ip 127.0.0.1 --var ROOM_TEST:1 --var PLAYER_TEST:1 --var NEW_PER_HOUR:1000 --var SO_FAN_MS:1500 --persist-to /tmp/so
//   (SO_FAN_MS: the per-player fan-out gap, 10 s in production, shortened for tests; PLAYER_TEST only)
//   CLOUD=http://127.0.0.1:8812 node test/social.test.mjs
import { BASE, WS, Client, newRoom, check, assert, results, sleep } from './lib.mjs';

const j = (r) => r.json().catch(() => ({}));
async function newPlayer(name) {
  let r; for (let i = 0; i < 40; i++) { r = await fetch(BASE + '/player/new', { method: 'POST' }); if (r.status !== 429) break; await sleep(3000); } // RL_NEW: 20 per minute per IP
  assert(r.status === 201, 'new ' + r.status);
  const p = await r.json(); p.name = name;
  const put = await fetch(BASE + '/player/' + p.id, { method: 'PUT', headers: { Authorization: 'Bearer ' + p.secret, 'Content-Type': 'application/json' }, body: JSON.stringify({ rev: 1, blob: { v: 1, p: { name } } }) });
  assert(put.status === 200, 'put ' + put.status);
  return p;
}
const op = (p, o, secret) => fetch(BASE + '/social/' + p.id, { method: 'POST', headers: { Authorization: 'Bearer ' + (secret || p.secret), 'Content-Type': 'application/json' }, body: JSON.stringify(o) }).then(async (r) => ({ status: r.status, ...(await j(r)) }));
const friendOf = async (p, tag) => (await op(p, { op: 'list' })).friends.find((f) => f.tag === tag) || null;
// presence is pushed (debounced 1.5 s here): poll the friend's own list until it shows the state
async function seen(p, tag, pred, ms = 6000) { const t0 = Date.now(); let f; for (;;) { f = await friendOf(p, tag); if (f && pred(f)) return f; if (Date.now() - t0 > ms) return f; await sleep(150); } }
// the friends link (what js/social.js keeps open)
function link(p) {
  return new Promise((res, rej) => {
    const ws = new WebSocket(`${WS}/social/ws/${p.id}`), L = { ws, msgs: [], closed: 0, code: 0 };
    ws.onopen = () => ws.send(JSON.stringify({ t: 'auth', s: p.secret }));
    ws.onmessage = (e) => { const m = JSON.parse(e.data); L.msgs.push(m); if (m.t === 'me') res(L); };
    ws.onclose = (e) => { L.closed = 1; L.code = e.code; res(L); };
    ws.onerror = () => rej(new Error('ws error'));
    L.wait = async (t, ms = 5000) => { const t0 = Date.now(); for (;;) { const m = L.msgs.find((x) => x.t === t && !x._seen); if (m) { m._seen = 1; return m; } if (Date.now() - t0 > ms) throw new Error('no ' + t + ' push'); await sleep(50); } };
    L.op = (o) => new Promise((r) => { const q = Math.random().toString(36).slice(2); ws.send(JSON.stringify({ t: 'op', q, ...o })); const t0 = Date.now(); const iv = setInterval(() => { const m = L.msgs.find((x) => x.t === 'r' && x.q === q); if (m || Date.now() - t0 > 5000) { clearInterval(iv); r(m || { ok: false, why: 'timeout' }); } }, 30); });
  });
}

const A = await newPlayer('Avery'), B = await newPlayer('Blake'), C = await newPlayer('Casey'), D = await newPlayer('Drew');
let LA, LB;

await check('tags: 8 chars, stable, public (no id / secret inside), dev route agrees', async () => {
  const a = await op(A, { op: 'me' }), a2 = await op(A, { op: 'me' });
  assert(a.ok && /^[0-9A-HJKMNP-TV-Z]{8}$/.test(a.tag), 'tag shape ' + JSON.stringify(a));
  assert(a.tag === a2.tag, 'stable');
  assert(!A.id.includes(a.tag.slice(0, 5)) && !A.secret.includes(a.tag.slice(0, 5)), 'tag is not a slice of id/secret');
  const t = await j(await fetch(BASE + '/social/tag/' + A.id)); assert(t.tag === a.tag, 'tagOf matches');
  for (const p of [B, C, D]) p.tag = (await op(p, { op: 'me' })).tag;
  A.tag = a.tag;
  return A.tag + ' ' + B.tag;
});
await check('auth: bad secret 401, bad body 400, unknown id 404, link with wrong secret closed', async () => {
  assert((await op(A, { op: 'me' }, 'ZZZZZZZZZZZZZZZZ')).status === 401, '401');
  const r = await fetch(BASE + '/social/' + A.id, { method: 'POST', headers: { Authorization: 'Bearer ' + A.secret }, body: 'nope' }); assert(r.status === 400, '400 ' + r.status);
  assert((await op({ id: '0000000000', secret: A.secret }, { op: 'me' })).status === 404, '404');
  const L = await link({ id: A.id, secret: 'ZZZZZZZZZZZZZZZZ' }); await sleep(300); assert(L.closed && L.code === 4001, 'closed ' + L.code);
});
await check('add by tag (typed with dash, lower case) -> request pushed to their open link', async () => {
  LA = await link(A); LB = await link(B);
  assert(LB.msgs[0].t === 'me' && LB.msgs[0].tag === B.tag, 'me on link');
  const typed = (B.tag.slice(0, 4) + '-' + B.tag.slice(4)).toLowerCase();
  const r = await op(A, { op: 'add', tag: typed }); assert(r.ok && r.st === 'out', JSON.stringify(r));
  const push = await LB.wait('req'); assert(push.tag === A.tag && push.name === 'Avery' && push.n.req === 1, JSON.stringify(push));
  const l = await op(B, { op: 'list' }); assert(l.req.length === 1 && l.req[0].tag === A.tag, 'B sees the request');
  const la = await op(A, { op: 'list' }); assert(la.out.length === 1 && la.out[0].tag === B.tag && !la.friends.length, 'A sees it as sent');
});
await check('accept -> mutual friends, pushed to the asker; own tag / junk refused', async () => {
  const r = await LB.op({ op: 'accept', tag: A.tag }); assert(r.ok && r.st === 'friend', JSON.stringify(r));
  const push = await LA.wait('friend'); assert(push.tag === B.tag && push.name === 'Blake', JSON.stringify(push));
  assert((await op(A, { op: 'add', tag: A.tag })).ok === false, 'own tag');
  assert((await op(A, { op: 'add', tag: 'hello' })).ok === false, 'junk');
  assert((await op(A, { op: 'add', tag: 'ZZZZZZZZ' })).why === 'No player with that tag.', 'unknown tag');
});
await check('presence: online with an open link, offline (with last seen) after it closes', async () => {
  let f = await seen(A, B.tag, (x) => x.st === 'online'); assert(f && f.st === 'online' && f.name === 'Blake', 'online ' + JSON.stringify(f));
  LB.ws.close();
  f = await seen(A, B.tag, (x) => x.st === 'offline'); assert(f.st === 'offline' && f.seen > 0, 'offline ' + JSON.stringify(f));
  LB = await link(B);
  f = await seen(A, B.tag, (x) => x.st === 'online'); assert(f.st === 'online', 'back online');
  const push = await LA.wait('pres', 4000); assert(push.tag === B.tag && ['online', 'offline'].includes(push.st), 'pushed to the open link ' + JSON.stringify(push));
});
let room, cb;
await check('room events: lobby (tag on the lobby seat, private code hidden) -> match (room for Watch) -> lobby -> gone', async () => {
  room = await newRoom();
  cb = await new Client(room, { name: 'Blake' }).open({ cid: B.id, cproof: B.secret });
  await cb.wait((c) => c.lobby && c.lobby.players.some((p) => p.tag), 6000, 'tag in lobby');
  const seat = cb.lobby.players.find((p) => p.name === 'Blake'); assert(seat.tag === B.tag, 'lobby tag ' + JSON.stringify(seat));
  assert(!JSON.stringify(cb.lobby).includes(B.id), 'cloud id never in the lobby');
  let f = await seen(A, B.tag, (x) => x.st === 'lobby'); assert(f.st === 'lobby' && f.mode === 'royale' && !f.room, 'lobby ' + JSON.stringify(f));
  cb.test('set', { T: { fast: true, introMs: 0 } }); cb.lead('add-bot'); await sleep(200); cb.lead('start');
  await cb.waitMsg('start', 6000);
  f = await seen(A, B.tag, (x) => x.st === 'match'); assert(f.st === 'match' && f.room === room, 'match ' + JSON.stringify(f));
  for (const p of cb.s.units.filter((u) => u.kind === 'player' && u.pid !== cb.myPid)) cb.test('kill', { pid: p.pid });
  await cb.waitMsg('over', 8000);
  f = await seen(A, B.tag, (x) => x.st === 'lobby'); assert(f.st === 'lobby', 'lobby after match ' + JSON.stringify(f));
  cb.send({ t: 'part' });
  f = await seen(A, B.tag, (x) => x.st === 'online'); assert(f.st === 'online', 'left the room -> online ' + JSON.stringify(f));
});
await check('Appear Offline hides presence; off again restores it', async () => {
  assert((await LB.op({ op: 'hide', on: true })).hidden === true, 'hide');
  let f = await seen(A, B.tag, (x) => x.st === 'offline'); assert(f.st === 'offline' && !f.seen, 'hidden ' + JSON.stringify(f));
  assert((await op(B, { op: 'list' })).hidden === true, 'own list says hidden');
  await LB.op({ op: 'hide', on: false });
  f = await seen(A, B.tag, (x) => x.st === 'online'); assert(f.st === 'online', 'visible ' + JSON.stringify(f));
});
await check('invite: pushed with room + mode, accept returns the room, one per friend per 15 s, friends only', async () => {
  const code = await newRoom();
  const r = await LA.op({ op: 'invite', tag: B.tag, room: code, mode: 'duel' }); assert(r.ok, JSON.stringify(r));
  const push = await LB.wait('inv'); assert(push.inv.tag === A.tag && push.inv.room === code && push.inv.mode === 'duel' && push.inv.name === 'Avery' && push.n.inv === 1, JSON.stringify(push));
  assert((await LA.op({ op: 'invite', tag: B.tag, room: code })).ok === false, 'second invite within 15 s refused');
  assert((await op(A, { op: 'invite', tag: C.tag, room: code })).why === 'You can only invite friends.', 'non-friend refused');
  assert((await op(A, { op: 'invite', tag: B.tag, room: 'nope' })).ok === false, 'bad room refused');
  const me = await op(B, { op: 'me' }); assert(me.inv.length === 1 && me.inv[0].left > 590000, 'pending, 10 min');
  const ans = await LB.op({ op: 'answer', tag: A.tag, join: true }); assert(ans.ok && ans.room === code, JSON.stringify(ans));
  assert((await op(B, { op: 'me' })).inv.length === 0, 'cleared');
  assert((await LB.op({ op: 'answer', tag: A.tag, join: true })).ok === false, 'answering twice says expired');
  // the accepted invite really joins that room's lobby
  const c2 = await new Client(code, { name: 'Blake' }).open({ cid: B.id, cproof: B.secret }); await c2.waitMsg('lobby'); c2.close();
});
await check('both ask each other -> friends at once; remove drops it on both sides (pushed)', async () => {
  assert((await op(C, { op: 'add', tag: D.tag })).st === 'out', 'C asks');
  assert((await op(D, { op: 'add', tag: C.tag })).st === 'friend', 'D asks back = friends');
  assert((await friendOf(C, D.tag)) && (await friendOf(D, C.tag)), 'mutual');
  assert((await op(D, { op: 'remove', tag: C.tag })).ok, 'remove');
  await sleep(200);
  assert(!(await friendOf(C, D.tag)) && !(await friendOf(D, C.tag)), 'gone on both sides');
  assert((await op(C, { op: 'add', tag: D.tag })).st === 'out' && (await op(D, { op: 'decline', tag: C.tag })).ok, 'decline');
  assert((await op(C, { op: 'list' })).out.length === 0, 'declined request leaves the sender list');
});
await check('block: ends the friendship, hides presence, blocks requests + invites silently; unblock', async () => {
  const r = await LB.op({ op: 'block', tag: A.tag }); assert(r.ok && r.st === 'block', JSON.stringify(r));
  await LA.wait('drop');
  assert(!(await friendOf(A, B.tag)), 'A lost B');
  const lb = await op(B, { op: 'list' }); assert(lb.blocked.length === 1 && lb.blocked[0].tag === A.tag && lb.blocked[0].name === 'Avery', 'B blocked list');
  const again = await op(A, { op: 'add', tag: B.tag }); assert(again.ok && again.st === 'out', 'looks sent ' + JSON.stringify(again));
  assert((await op(B, { op: 'list' })).req.length === 0, 'B never sees it');
  assert((await op(A, { op: 'invite', tag: B.tag, room: room })).ok === false, 'no invite');
  assert((await op(B, { op: 'add', tag: A.tag })).ok === false, 'B must unblock before adding');
  // blocking someone who is not a friend (a Recent Player) works by tag too
  assert((await op(C, { op: 'block', tag: A.tag, name: 'Avery' })).st === 'block', 'block a stranger');
  assert((await op(B, { op: 'unblock', tag: A.tag })).ok && (await op(B, { op: 'list' })).blocked.length === 0, 'unblock');
  assert((await op(A, { op: 'remove', tag: B.tag })).ok, 'A clears the stale request');
});
await check('free plan: a list refresh is ONE request (own DO, 0 calls to friends) with 25 friends; presence still arrives by push', async () => {
  const H = await newPlayer('Hub'); H.tag = (await op(H, { op: 'me' })).tag;
  const fr = []; for (let i = 0; i < 25; i++) fr.push(await newPlayer('Pal' + i));
  for (const f of fr) assert((await op(f, { op: 'add', tag: H.tag })).st === 'out', 'request');
  for (const f of fr) { f.tag = (await op(f, { op: 'me' })).tag; assert((await op(H, { op: 'accept', tag: f.tag })).st === 'friend', 'accept'); }
  const l = await op(H, { op: 'list' });
  assert(l.friends.length === 25 && l.rpc === 0, `25 friends, ${l.rpc} peer calls during the refresh`);
  const lh = await link(H);
  const LP = await link(fr[7]); // Pal7 comes online: Pal7's DO pushes to Hub's DO, Hub's link hears it
  const push = await lh.wait('pres', 5000); assert(push.tag === fr[7].tag && push.st === 'online', JSON.stringify(push));
  const l2 = await op(H, { op: 'list' });
  assert(l2.rpc === 0 && l2.friends[0].tag === fr[7].tag && l2.friends[0].st === 'online', 'still 0 calls, Pal7 online first ' + JSON.stringify(l2.friends[0]));
  lh.ws.close(); LP.ws.close();
  return `list ok, ${l2.friends.filter((x) => x.st === 'online').length} online`;
});
await check('debounce: four changes inside the gap = one fan-out now + one trailing (alarm) with the latest state', async () => {
  const P = await newPlayer('Pia'), Q = await newPlayer('Quin');
  Q.tag = (await op(Q, { op: 'me' })).tag; P.tag = (await op(P, { op: 'me' })).tag;
  await op(P, { op: 'add', tag: Q.tag }); await op(Q, { op: 'accept', tag: P.tag });
  const LP = await link(P); // online (fans once)
  await sleep(1700);
  const f0 = (await op(P, { op: 'list' })).fans;
  await op(P, { op: 'hide', on: true }); await op(P, { op: 'hide', on: false }); await op(P, { op: 'hide', on: true }); await op(P, { op: 'hide', on: false });
  const f1 = (await op(P, { op: 'list' })).fans; assert(f1 === f0 + 1, `4 toggles: one immediate fan-out (${f0} -> ${f1})`);
  assert((await friendOf(Q, P.tag)).st === 'offline', 'Quin got the first change (hidden)');
  await sleep(2200);
  const f2 = (await op(P, { op: 'list' })).fans; assert(f2 === f1 + 1, `then one trailing fan-out (${f1} -> ${f2})`);
  const q = await friendOf(Q, P.tag); assert(q.st === 'online', 'the trailing one carried the latest state (visible) ' + JSON.stringify(q));
  LP.ws.close();
});
await check('limits: 30 friend requests per hour', async () => {
  let refused = null;
  for (let i = 0; i < 31; i++) { const r = await op(D, { op: 'add', tag: 'ZZZZZZ' + '0123456789ABCDEFGHJKMNPQRSTVWXYZ'[i] + '0' }); if (!r.ok && /Too many/.test(r.why || '')) { refused = i; break; } }
  assert(refused === 30, 'refused at ' + refused);
});
await check('a reset transfer code closes the old secret\'s friends link', async () => {
  const r = await fetch(BASE + '/player/' + A.id + '/rotate', { method: 'POST', headers: { Authorization: 'Bearer ' + A.secret } });
  assert(r.status === 200, 'rotate ' + r.status); await sleep(400);
  assert(LA.closed && LA.code === 4001, 'closed ' + LA.code);
  A.secret = (await r.json()).secret;
  assert((await op(A, { op: 'me' })).tag === A.tag, 'same tag with the new secret');
});
try { LB.ws.close(); cb.close(); } catch {}
const bad = results.filter((r) => !r.ok);
console.log(`\n${results.length - bad.length}/${results.length} passed`);
process.exit(bad.length ? 1 : 0);
