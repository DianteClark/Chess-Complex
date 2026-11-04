// 17.0 Cloud (P): Player DO tests against a running `wrangler dev`.
//   cd server && npx wrangler dev --port 8797 --persist-to /tmp/cc-player-test --var NEW_PER_HOUR:8 --var PLAYER_TEST:1
//   node test/player.test.mjs [http://localhost:8787]
// Use a fresh --persist-to dir and NEW_PER_HOUR:8: this file creates 7 players and then expects the 9th create from the
// same IP to be refused (the limiter is per IP and per hour, so a second run on the same state needs a new dir).
import { gzipSync } from 'node:zlib';
import { randomBytes } from 'node:crypto';

const BASE = (process.argv[2] || process.env.CLOUD || 'http://localhost:8787').replace(/\/$/, '');
const PER_HOUR = +(process.env.NEW_PER_HOUR || 8);
let pass = 0, failN = 0;
const ok = (c, name, extra = '') => { if (c) pass++; else failN++; console.log(`${c ? 'PASS' : 'FAIL'} ${name}${extra ? ' - ' + extra : ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let made = 0;
async function req(method, path, { secret, body, raw, headers } = {}) {
  const h = { ...(headers || {}) };
  if (secret) h.Authorization = 'Bearer ' + secret;
  let b; if (raw) b = raw; else if (body !== undefined) { b = JSON.stringify(body); h['Content-Type'] = 'application/json'; }
  const r = await fetch(BASE + path, { method, headers: h, body: b });
  let j = null; try { j = await r.json(); } catch {}
  return { s: r.status, j };
}
const newPlayer = async () => { made++; return req('POST', '/player/new'); };
const B32 = /^[0-9A-HJKMNP-TV-Z]+$/;

const health = await fetch(BASE + '/health').then((r) => r.ok).catch(() => false);
if (!health) { console.log(`FAIL wrangler dev not reachable at ${BASE}`); process.exit(1); }

// new
const a = await newPlayer();
ok(a.s === 201 && a.j && a.j.id.length === 10 && a.j.secret.length === 16 && B32.test(a.j.id) && B32.test(a.j.secret), 'new: 201, id 10 + secret 16 Crockford base32', JSON.stringify(a.j));
const { id, secret } = a.j;
const b = await newPlayer();
ok(b.s === 201 && b.j.id !== id && b.j.secret !== secret, 'new: second player gets a different id and secret');

// get (empty)
let g = await req('GET', `/player/${id}`, { secret });
ok(g.s === 200 && g.j.rev === 0 && g.j.blob === null, 'get: fresh player has rev 0 and no blob', JSON.stringify(g.j));
g = await req('GET', `/player/${id.toLowerCase()}`, { secret: secret.toLowerCase() });
ok(g.s === 200, 'get: id and secret are case-insensitive');

// auth failures
ok((await req('GET', `/player/${id}`)).s === 401, 'auth: no secret -> 401');
ok((await req('GET', `/player/${id}`, { secret: b.j.secret })).s === 401, "auth: another player's secret -> 401");
ok((await req('PUT', `/player/${id}`, { secret: b.j.secret, body: { rev: 1, blob: { marks: 999999 } } })).s === 401, "auth: PUT with another player's secret -> 401");
ok((await req('GET', `/player/ZZZZZZZZZZ`, { secret })).s === 404, 'auth: unknown id -> 404');
ok((await req('GET', `/player/bad!`, { secret })).s === 404, 'auth: malformed id -> 404');

// put + get
const prof = { name: 'Tester', marks: 1234, owned: ['ivory', 'onyx'] };
let p = await req('PUT', `/player/${id}`, { secret, body: { rev: 1, blob: prof } });
ok(p.s === 200 && p.j.rev === 1 && p.j.updatedAt > 0, 'put: rev 1 accepted', JSON.stringify(p.j));
g = await req('GET', `/player/${id}`, { secret });
ok(g.s === 200 && g.j.rev === 1 && g.j.blob && g.j.blob.marks === 1234 && g.j.blob.owned.length === 2, 'get: returns the saved blob and rev');

// per-id PUT limit (1 per 2 s)
p = await req('PUT', `/player/${id}`, { secret, body: { rev: 2, blob: { ...prof, marks: 1 } } });
ok(p.s === 429 && p.j.retry >= 1, 'rate: second PUT within 2 s -> 429 with retry', JSON.stringify(p.j));
await sleep(2100);

// rev conflict
p = await req('PUT', `/player/${id}`, { secret, body: { rev: 1, blob: { ...prof, marks: 5 } } });
ok(p.s === 409 && p.j.rev === 1 && p.j.blob.marks === 1234, 'conflict: stale rev -> 409 with the server copy', JSON.stringify(p.j).slice(0, 120));
g = await req('GET', `/player/${id}`, { secret });
ok(g.j.blob.marks === 1234, 'conflict: stale PUT did not overwrite');

// gzip
const gz = gzipSync(Buffer.from(JSON.stringify({ rev: 2, blob: { ...prof, marks: 2000, pad: 'x'.repeat(30000) } })));
p = await req('PUT', `/player/${id}`, { secret, raw: gz, headers: { 'Content-Type': 'application/json', 'Content-Encoding': 'gzip' } });
ok(p.s === 200 && p.j.rev === 2, 'gzip: compressed PUT accepted', `${gz.length} B on the wire`);
g = await req('GET', `/player/${id}`, { secret });
ok(g.j.rev === 2 && g.j.blob.marks === 2000 && g.j.blob.pad.length === 30000, 'gzip: stored inflated');
await sleep(2100);

// size cap
const big = randomBytes(40000).toString('base64'); // ~53 KB of incompressible text, 70 KB+ JSON
p = await req('PUT', `/player/${id}`, { secret, body: { rev: 3, blob: { big: big + big.slice(0, 20000) } } });
ok(p.s === 413, 'size: > 64 KB body -> 413', String(p.s));
const bomb = gzipSync(Buffer.from(JSON.stringify({ rev: 3, blob: { z: '0'.repeat(2_000_000) } })));
p = await req('PUT', `/player/${id}`, { secret, raw: bomb, headers: { 'Content-Encoding': 'gzip' } });
ok(p.s === 413, 'size: gzip that inflates past 512 KB -> 413', `${bomb.length} B on the wire, status ${p.s}`);
p = await req('PUT', `/player/${id}`, { secret, raw: 'not json{' });
ok(p.s === 400, 'bad body -> 400');
p = await req('PUT', `/player/${id}`, { secret, body: { rev: 3 } });
ok(p.s === 400, 'PUT without blob -> 400');
g = await req('GET', `/player/${id}`, { secret });
ok(g.j.rev === 2, 'size: rejected PUTs left rev 2');

// rotate
const r = await req('POST', `/player/${id}/rotate`, { secret });
ok(r.s === 200 && r.j.secret && r.j.secret.length === 16 && r.j.secret !== secret, 'rotate: new 16-char secret');
ok((await req('GET', `/player/${id}`, { secret })).s === 401, 'rotate: old secret -> 401');
g = await req('GET', `/player/${id}`, { secret: r.j.secret });
ok(g.s === 200 && g.j.rev === 2 && g.j.blob.marks === 2000, 'rotate: new secret reads the same data');
ok((await req('POST', `/player/${id}/rotate`, { secret: r.j.secret })).s === 429, 'rotate: second rotate within 10 s -> 429');
ok((await req('POST', `/player/${id}/rotate`, { secret })).s === 401, 'rotate: old secret cannot rotate');

// identity: verifyPlayer (internal RPC for the Room; reached here through the dev-only /player/_verify route)
if ((await req('POST', '/player/_verify', { body: {} })).s === 404) console.log('SKIP verify (start wrangler dev with --var PLAYER_TEST:1)');
else {
  let v = await req('POST', '/player/_verify', { body: { id, secret: r.j.secret } });
  ok(v.j && v.j.ok === true && v.j.id === id && v.j.name === null, 'verify: current secret ok (no profile blob with a name yet -> name null)', JSON.stringify(v.j));
  v = await req('POST', '/player/_verify', { body: { id: id.toLowerCase(), secret } });
  ok(v.j && v.j.ok === false && v.j.why === 'bad', 'verify: rotated-away secret refused', JSON.stringify(v.j));
  v = await req('POST', '/player/_verify', { body: { id: 'ZZZZZZZZZZ', secret } });
  ok(v.j && v.j.ok === false && v.j.why === 'unknown', 'verify: unknown id', JSON.stringify(v.j));
  v = await req('POST', '/player/_verify', { body: { id: 'x', secret: 'y' } });
  ok(v.j && v.j.ok === false && v.j.why === 'shape', 'verify: malformed input', JSON.stringify(v.j));
  await sleep(2100);
  await req('PUT', `/player/${b.j.id}`, { secret: b.j.secret, body: { rev: 1, blob: { v: 1, p: { name: 'Verified<b>Name', title: 'Endgamer', avatar: { piece: 'rook', skin: 'onyx' }, marks: 5 } } } });
  v = await req('POST', '/player/_verify', { body: { id: b.j.id, secret: b.j.secret } });
  ok(v.j && v.j.ok && v.j.name === 'VerifiedbName' && v.j.title === 'Endgamer' && v.j.avatar.piece === 'rook' && !('marks' in v.j), 'verify: returns public name/title/avatar only, cleaned', JSON.stringify(v.j));
}

// per-IP limit on /player/new
let last = null;
while (made < PER_HOUR) last = await newPlayer();
ok(last && last.s === 201, `rate: creates up to ${PER_HOUR}/h allowed`);
const over = await newPlayer();
ok(over.s === 429 && over.j.retry > 0, `rate: create ${PER_HOUR + 1} in the hour -> 429`, JSON.stringify(over.j));

console.log(`\n${pass} pass / ${failN} fail`);
process.exit(failN ? 1 : 0);
