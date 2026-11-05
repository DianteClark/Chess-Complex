// NE 18.0 "Rivals": server tests against a running `wrangler dev` with the test hooks.
//   cd server && npx wrangler dev --local --port 8811 --ip 127.0.0.1 --var ROOM_TEST:1 --var LB_TEST:1 --var PLAYER_TEST:1 --var NEW_PER_HOUR:1000 --persist-to /tmp/ne
//   CLOUD=http://127.0.0.1:8811 node test/rivals18.test.mjs
// Covers: weekly Season rewards (Board rollover -> Player DO inbox -> GET/PUT answers -> ack), rank tiers on board rows,
// the Room's lobby rk + nid for verified seats, and opts.nemesis in the match start (hello nem + the 'nem' message).
import { Client, newRoom, check, assert, results, sleep, BASE } from './lib.mjs';
import { seasonId } from '../src/lbcore.js';
import { nidOf, tierOf } from '../../js/rivals.js';

const health = await fetch(BASE + '/health').then((r) => r.ok).catch(() => false);
if (!health) { console.log(`FAIL wrangler dev not reachable at ${BASE}`); process.exit(1); }
const req = async (method, path, { secret, body } = {}) => {
  const h = {}; if (secret) h.Authorization = 'Bearer ' + secret; if (body !== undefined) h['Content-Type'] = 'application/json';
  const r = await fetch(BASE + path, { method, headers: h, body: body !== undefined ? JSON.stringify(body) : undefined });
  let j = null; try { j = await r.json(); } catch {}
  return { s: r.status, j };
};
const mk = async () => { const r = await req('POST', '/player/new'); assert(r.s === 201, 'player/new ' + r.s); return r.j; };
const put = async (P, rev, extra = {}) => { await sleep(2100); return req('PUT', `/player/${P.id}`, { secret: P.secret, body: { rev, blob: { p: { name: 'P' + P.id.slice(0, 4) } }, ...extra } }); };

const A = await mk(), B = await mk(), C = await mk(), D = await mk();
const WEEK = 7 * 864e5, now = Date.now(), lastSid = seasonId(now - WEEK);
const fill = (i) => ('F' + String(i).padStart(9, '0')).replace(/[ILOU]/g, 'X');

await check('season rewards: rollover delivers title + banner to the top 50 (inbox on GET)', async () => {
  await req('POST', '/lb/test/reset');
  const rows = [{ cid: A.id, name: 'Alpha', v: 900 }, { cid: B.id, name: 'Bravo', v: 800 }];
  for (let i = 0; i < 8; i++) rows.push({ cid: fill(i), name: 'F' + i, v: 700 - i });
  rows.push({ cid: C.id, name: 'Charlie', v: 500 }); // rank 11 -> contender
  for (let i = 8; i < 60; i++) rows.push({ cid: fill(i), name: 'F' + i, v: 400 - i });
  rows.push({ cid: D.id, name: 'Delta', v: 1 }); // rank 63 -> nothing
  await req('POST', '/lb/test/rowset', { body: { board: 'season', sid: lastSid, rows } });
  const r = (await req('POST', '/lb/test/rollover', { body: { now, deliver: true } })).j;
  assert(r.rolled && r.archived && r.archived.sid === lastSid, 'rolled ' + JSON.stringify(r));
  const sent = (r.rewards ? r.rewards.sent : 0);
  const ga = (await req('GET', `/player/${A.id}`, { secret: A.secret })).j, gb = (await req('GET', `/player/${B.id}`, { secret: B.secret })).j;
  const gc = (await req('GET', `/player/${C.id}`, { secret: C.secret })).j, gd = (await req('GET', `/player/${D.id}`, { secret: D.secret })).j;
  const ia = ga.inbox && ga.inbox[0], ib = gb.inbox && gb.inbox[0], ic = gc.inbox && gc.inbox[0];
  assert(ia && ia.id === 'season:' + lastSid && ia.k === 'season' && ia.rank === 1 && ia.reward === 'champion' && ia.title === 'Season Champion' && ia.banner === 'season_champion', 'A ' + JSON.stringify(ga.inbox));
  assert(ib && ib.rank === 2 && ib.reward === 'podium', 'B ' + JSON.stringify(gb.inbox));
  assert(ic && ic.rank === 11 && ic.reward === 'contender', 'C ' + JSON.stringify(gc.inbox));
  assert(!gd.inbox, 'D (rank 63) gets nothing ' + JSON.stringify(gd.inbox));
  const q = (await req('POST', '/lb/test/rewards')).j;
  return `sent ${sent} (+${r.rewards ? r.rewards.dropped : '?'} fake cids dropped), queue left ${q ? q.list.length : 0}`;
});
await check('season rewards: idempotent (second rollover / deliver adds nothing, one item per season)', async () => {
  const r = (await req('POST', '/lb/test/rollover', { body: { now, deliver: true } })).j;
  assert(!r.rolled, 'not rolled again');
  const ga = (await req('GET', `/player/${A.id}`, { secret: A.secret })).j;
  assert(ga.inbox.length === 1, 'one item ' + ga.inbox.length);
});
await check('season rewards: PUT answers carry the inbox until a PUT acks it', async () => {
  const p1 = await put(A, 1);
  assert(p1.s === 200 && p1.j.inbox && p1.j.inbox.length === 1, 'PUT without ack keeps it ' + JSON.stringify(p1.j));
  const p2 = await put(A, 2, { ack: ['season:' + lastSid, 'junk', 42] });
  assert(p2.s === 200 && !p2.j.inbox, 'acked ' + JSON.stringify(p2.j));
  const g = (await req('GET', `/player/${A.id}`, { secret: A.secret })).j;
  assert(!g.inbox && g.rev === 2, 'gone on GET ' + JSON.stringify(g));
  const p409 = await req('PUT', `/player/${B.id}`, { secret: B.secret, body: { rev: 1, blob: { p: {} } } });
  const p409b = await put(B, 1);
  assert(p409b.s === 409 && p409b.j.inbox && p409b.j.inbox[0].rank === 2, '409 carries the inbox ' + p409b.s + ' ' + JSON.stringify(p409b.j && p409b.j.inbox));
  return `first PUT ${p409.s}`;
});
await check('ranks: board rows carry rk {r, p?} (rating, season, daily)', async () => {
  await req('POST', '/lb/test/rowset', { body: { board: 'rating', rows: [{ cid: A.id, name: 'Alpha', v: 1620, games: 30 }, { cid: B.id, name: 'Bravo', v: 1180, games: 12 }] } });
  await req('POST', '/lb/test/rowset', { body: { board: 'season', rows: [{ cid: A.id, name: 'Alpha', v: 50 }, { cid: C.id, name: 'Charlie', v: 40 }] } });
  const rt = (await req('GET', '/lb/top?board=rating')).j.top, se = (await req('GET', '/lb/top?board=season')).j.top;
  const ra = rt.find((x) => x.name === 'Alpha'), sa = se.find((x) => x.name === 'Alpha'), sc = se.find((x) => x.name === 'Charlie');
  assert(ra && ra.rk && ra.rk.r === 1620 && !ra.rk.p && tierOf(ra.rk.r, 30).id === 'queen', 'rating row ' + JSON.stringify(ra));
  assert(sa && sa.rk && sa.rk.r === 1620, 'season row joins the rating ' + JSON.stringify(sa));
  assert(sc && !sc.rk, 'no rating yet: no rk ' + JSON.stringify(sc));
  return `Alpha ${tierOf(ra.rk.r, 30).name}`;
});

const hello = (P) => ({ cid: P.id, cproof: P.secret });
await check('room: verified seats get nid + rk in the lobby; the start carries opts.nemesis', async () => {
  const code = await newRoom();
  const nb = await nidOf(B.id), nc = await nidOf(C.id);
  const a = new Client(code, { name: 'Alpha', profile: { title: 'T', skin: 'ivory', build: { pts: { hp: 3, atk: 3, def: 2, spd: 2 }, passive: 'regen', equips: {} }, nem: { nid: nb, n: 2 } } });
  const b = new Client(code, { name: 'Bravo' });
  await a.open(hello(A)); await a.waitMsg('welcome');
  await b.open(hello(B)); await b.waitMsg('welcome');
  await a.wait((c) => c.lobby && c.lobby.players.length === 2 && c.lobby.players.every((p) => p.nid && p.rk), 8000, 'lobby nid/rk');
  const L = a.lobby.players, pa = L.find((p) => p.pid === a.myPid), pb = L.find((p) => p.pid === b.myPid);
  assert(pb.nid === nb && pa.nid === (await nidOf(A.id)), 'nids');
  assert(pa.rk.r === 1620 && !pa.rk.p && pb.rk.r === 1180 && pb.rk.p === undefined, 'rk ' + JSON.stringify([pa.rk, pb.rk]));
  b.send({ t: 'ready', on: true }); await sleep(200);
  a.lead('start');
  const st = await a.waitMsg('start', 8000);
  assert(st.opts && st.opts.nemesis && st.opts.nemesis[a.myPid] && st.opts.nemesis[a.myPid].pid === b.myPid && st.opts.nemesis[a.myPid].n === 2, 'opts.nemesis ' + JSON.stringify(st.opts));
  assert(a.s && a.s.nemesis && a.s.nemesis[a.myPid].pid === b.myPid, 'engine state has it');
  // the 'nem' message replaces it for the next match (C is not here, so no entry)
  a.send({ t: 'nem', nem: { nid: nc } });
  b.send({ t: 'nem', nem: { nid: await nidOf(A.id), n: 1 } });
  a.close(); b.close();
  return `nemesis ${JSON.stringify(st.opts.nemesis)}`;
});
await check('room: an unverified seat never gets nid/rk and cannot be a Nemesis target', async () => {
  const code = await newRoom();
  const a = new Client(code, { name: 'Alpha', profile: { title: '', skin: 'ivory', build: { pts: { hp: 3, atk: 3, def: 2, spd: 2 }, passive: 'regen', equips: {} }, nem: { nid: 'ZZZZZZZZZZZZ' } } });
  const x = new Client(code, { name: 'Anon' });
  await a.open(hello(A)); await a.waitMsg('welcome');
  await x.open({ cid: D.id, cproof: 'WRONGSECRET00000' }); await x.waitMsg('welcome');
  await sleep(800);
  const px = a.lobby.players.find((p) => p.pid === x.myPid);
  assert(px && !px.nid && !px.rk, 'unverified ' + JSON.stringify(px));
  x.send({ t: 'ready', on: true }); await sleep(200);
  a.lead('start');
  const st = await a.waitMsg('start', 8000);
  assert(!st.opts.nemesis, 'no map ' + JSON.stringify(st.opts));
  a.close(); x.close();
});

const bad = results.filter((r) => !r.ok).length;
console.log(`rivals18: ${results.length - bad}/${results.length} passed`);
process.exit(bad ? 1 : 0);
