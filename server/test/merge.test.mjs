// 17.0 Cloud (P): js/cloudsave.js merge + transfer code rules, no server needed.  node server/test/merge.test.mjs
globalThis.localStorage ??= { _d: {}, getItem(k) { return this._d[k] ?? null; }, setItem(k, v) { this._d[k] = String(v); }, removeItem(k) { delete this._d[k]; } };
const noop = () => {}; globalThis.document ??= { addEventListener: noop, querySelector: () => null, visibilityState: 'visible', hidden: false }; globalThis.addEventListener ??= noop; globalThis.window ??= globalThis;
globalThis.location ??= { search: '', origin: 'http://x', pathname: '/' };
const CS = await import('../../js/cloudsave.js');
let pass = 0, fail = 0;
const ok = (c, n, x = '') => { if (c) pass++; else fail++; console.log(`${c ? 'PASS' : 'FAIL'} ${n}${x ? ' - ' + x : ''}`); };
const base = () => ({ name: 'P', marks: 1000, owned: ['ivory'], unlocked: [], level: 5, xp: 100, stats: { games: 10, wins: 2 }, mastery: { pawn: 1 }, season: { id: 4, xp: 700, tier: 1, pass: false, prem: -1 }, login: { streak: 2, best: 3 }, played: ['m1'], cs: { earn: 0, spend: 0, debt: 0, t: 1 } });
const clone = (o) => JSON.parse(JSON.stringify(o));

// 1. two phones spend the same 1000 Marks on different items -> both items, 0 Marks, 1000 debt (no free item)
{ const L = clone(base()), S = clone(base());
  L.marks = 0; L.owned.push('onyx'); L.cs.spend = 1000; L.cs.t = 5;
  S.marks = 0; S.owned.push('ember'); S.cs.spend = 1000; S.cs.t = 6;
  const m = CS.merge(L, S, 0);
  ok(m.owned.includes('onyx') && m.owned.includes('ember') && m.marks === 0 && m.cs.debt === 1000 && m.cs.spend === 2000, 'double spend: union items, Marks 0, the second purchase becomes debt', JSON.stringify({ marks: m.marks, cs: m.cs })); }
// 2. both earn -> max, never the sum
{ const L = clone(base()), S = clone(base());
  L.marks = 1300; L.cs.earn = 300; S.marks = 1100; S.cs.earn = 100;
  const m = CS.merge(L, S, 0);
  ok(m.marks === 1300, 'both earn: keep the higher wallet, never add', String(m.marks)); }
// 3. one earns offline, the other spends -> earning kept, spend charged
{ const L = clone(base()), S = clone(base());
  L.marks = 1500; L.cs.earn = 500; L.cs.t = 9;               // phone A played offline
  S.marks = 600; S.owned.push('onyx'); S.cs.spend = 400;    // phone B bought onyx for 400
  const m = CS.merge(L, S, 0);
  ok(m.marks === 1100 && m.owned.includes('onyx'), 'earn on one, spend on the other: 1000 + 500 - 400', String(m.marks)); }
// 4. repeated merges of the same pair do not grow Marks (idempotent-ish)
{ const L = clone(base()), S = clone(base());
  L.marks = 1200; L.cs.earn = 200; S.marks = 900; S.cs.spend = 100; S.owned.push('x');
  const m1 = CS.merge(L, S, 0), m2 = CS.merge(m1, S, m1.cs.spend), m3 = CS.merge(m2, m1, m2.cs.spend); // the base moves to the merged spend, as cloudsave does
  ok(m1.marks === 1100 && m2.marks === m1.marks && m3.marks === m1.marks, 'merging again never adds (or loses) Marks', [m1.marks, m2.marks, m3.marks].join(' ')); }
// 5. counters max, unions, pairs
{ const L = clone(base()), S = clone(base());
  L.level = 6; L.xp = 10; S.level = 5; S.xp = 900; L.stats.games = 12; S.stats.wins = 4; S.mastery.knight = 2; L.season.xp = 2100; S.season.pass = true; S.season.prem = 1; L.played.push('m2'); S.played.push('m3'); S.name = 'Newer'; S.cs.t = 99;
  const m = CS.merge(L, S, 0);
  ok(m.level === 6 && m.xp === 10, 'level/xp kept as a pair', `${m.level}/${m.xp}`);
  ok(m.stats.games === 12 && m.stats.wins === 4 && m.mastery.knight === 2 && m.mastery.pawn === 1, 'stats and mastery take the max');
  ok(m.season.xp === 2100 && m.season.pass === true && m.season.prem === 1, 'season xp max, Royal Pass kept');
  ok(['m1', 'm2', 'm3'].every((k) => m.played.includes(k)), 'played match keys unioned (rewards never paid twice)');
  ok(m.name === 'Newer', 'settings-like fields come from the copy changed last'); }
// 6. debt is paid from new Marks by track()
{ const p = { marks: 0, cs: { earn: 0, spend: 2000, debt: 300, t: 1 } };
  CS.track(p); p.marks += 200; CS.track(p);
  ok(p.marks === 0 && p.cs.debt === 100 && p.cs.earn === 200, 'debt is paid from new earnings', JSON.stringify(p));
  p.marks += 250; CS.track(p);
  ok(p.marks === 150 && p.cs.debt === 0, 'then Marks flow again', JSON.stringify(p)); }
// 7. transfer codes
{ const code = CS.encodeCode('ABCDEFGH12', 'JKMNPQRSTVWXYZ01');
  const d = CS.decodeCode(code);
  ok(/^[0-9A-Z]{4}(-[0-9A-Z]{1,4}){6}$/.test(code) && d && d.id === 'ABCDEFGH12' && d.secret === 'JKMNPQRSTVWXYZ01', 'code round trip', code);
  ok(!!CS.decodeCode(code.toLowerCase().replace(/-/g, ' ').replace(/0/g, 'o').replace(/1/g, 'l')), 'decode forgives case, spaces, O/0 and I/L/1');
  let caught = 0, tried = 0; const raw = code.replace(/-/g, ''); const A = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  for (let i = 0; i < raw.length; i++) for (const ch of A) { if (ch === raw[i]) continue; tried++; if (!CS.decodeCode(raw.slice(0, i) + ch + raw.slice(i + 1))) caught++; }
  ok(caught === tried, 'checksum catches single-character typos', `${caught}/${tried}`);
  let tc = 0, tt = 0; for (let i = 0; i < raw.length - 2; i++) { if (raw[i] === raw[i + 1]) continue; tt++; /* swaps inside the 26 code chars */ if (!CS.decodeCode(raw.slice(0, i) + raw[i + 1] + raw[i] + raw.slice(i + 2))) tc++; }
  ok(tc === tt, 'checksum catches adjacent swaps', `${tc}/${tt}`); }
console.log(`\n${pass} pass / ${fail} fail`);
process.exit(fail ? 1 : 0);
