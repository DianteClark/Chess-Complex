// 17.0 Cloud (P): POST /player/new with Turnstile turned on. Runs a fake siteverify on :8796 (this sandbox cannot reach
// Cloudflare) and expects wrangler dev to point at it:
//   cd server && npx wrangler dev --port 8797 --persist-to /tmp/cc-ts --var TURNSTILE_SECRET:test-secret \
//     --var TURNSTILE_VERIFY_URL:http://127.0.0.1:8796/siteverify
//   node test/player.turnstile.test.mjs [http://localhost:8797]
import http from 'node:http';
const BASE = (process.argv[2] || 'http://localhost:8797').replace(/\/$/, '');
let pass = 0, fail = 0, calls = [];
const ok = (c, n, x = '') => { if (c) pass++; else fail++; console.log(`${c ? 'PASS' : 'FAIL'} ${n}${x ? ' - ' + x : ''}`); };
const fake = http.createServer((req, res) => {
  let body = ''; req.on('data', (d) => (body += d)); req.on('end', () => {
    const secret = /name="secret"\r\n\r\n([^\r]*)/.exec(body)?.[1], token = /name="response"\r\n\r\n([^\r]*)/.exec(body)?.[1];
    calls.push({ secret, token });
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ success: secret === 'test-secret' && token === 'GOOD-TOKEN' }));
  });
}).listen(8796, '127.0.0.1');
const post = async (body) => { const r = await fetch(BASE + '/player/new', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }); return { s: r.status, j: await r.json().catch(() => null) }; };
let r = await post();
ok(r.s === 403, 'no token -> 403', String(r.s));
r = await post({ turnstile: 'BAD-TOKEN' });
ok(r.s === 403 && calls.length >= 1 && calls.at(-1).token === 'BAD-TOKEN' && calls.at(-1).secret === 'test-secret', 'bad token -> siteverify says no -> 403', JSON.stringify(calls.at(-1)));
r = await post({ turnstile: 'GOOD-TOKEN' });
ok(r.s === 201 && r.j && r.j.id && r.j.secret, 'good token -> 201 {id, secret}', JSON.stringify(r.j));
fake.close();
r = await post({ turnstile: 'GOOD-TOKEN' });
ok(r.s === 403, 'siteverify unreachable -> fail closed (403)', String(r.s));
console.log(`\n${pass} pass / ${fail} fail`);
process.exit(fail ? 1 : 0);
