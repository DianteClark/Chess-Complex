// NE 18.0: Nemesis engine rules (headless, constructed states + bot matches).
// node tests/q18/engine18.mjs [--verbose]
//   SET  opts.nemesis sanitising: unknown pids, self, allies and junk dropped; no map -> no s.nemesis
//   VEN  Vendetta: killing your Nemesis pays +1 shard + {e:'vendetta'} once; other kills pay nothing
//   AGN  your Nemesis eliminating you again -> {e:'nemesis', n: n+1}
//   THN  the target outliving its hunter -> {e:'thorn'} once
//   DET  determinism: same inputs -> same hash and event stream; replay through a JSON round trip; PROTO 3 + protoVer
//   BOT  a bot whose Nemesis is X targets X when two equal targets are in reach (bias), and full bot matches run clean
import * as E from '../../js/engine.js';
import { stateHash, PROTO, protoVer } from '../../js/statehash.js';
import { nemMap, cleanNem, nidOf, tierOf, rkPub, rewardFor } from '../../js/rivals.js';
import { roster, play } from '../../tools/run.mjs';
const VERB = process.argv.includes('--verbose');
let pass = 0, fail = 0;
const check = (g, name, ok, info = '') => { if (ok) pass++; else fail++; if (VERB || !ok) console.log(`${ok ? 'PASS' : 'FAIL'} ${g} ${name}${info !== '' ? ' :: ' + info : ''}`); };
const safe = async (g, name, fn) => { try { await fn(); } catch (e) { fail++; console.log(`FAIL ${g} ${name} (threw) :: ${e.message} @ ${(e.stack.split('\n')[1] || '').trim()}`); } };

function mk(n = 3, seed = 5, nemesis = null, mode = 'royale') {
  const opts = { mode, mutator: 'none' }; if (nemesis) opts.nemesis = nemesis;
  const s = E.createMatch(roster(n, 0), seed, opts);
  s.units = s.units.filter((u) => u.kind === 'player'); s.items = [];
  for (let i = 0; i < s.tiles.length; i++) s.tiles[i] = { t: 'floor' };
  s.storm = { ring: 0, crack: false }; s.rules = { ...s.rules, first: 99, crown: 99 }; s.round = 12; s.event = null;
  s.units.forEach((u, i) => { u.piece = 'pawn'; u.pts = { hp: 0, atk: 0, def: 0, spd: 0 }; u.buffs = []; u.status = []; u.gauge = 0; u.passive = 'none'; u.momentum = 0; u.attune = 0; u.shards = 0; u.x = 2 + i * 4; u.y = 2; u.hp = E.stats(u).maxHp; u.cd = { sig: 0, eq: 0 }; u.ult = 0; u.sw = true; });
  return s;
}
function forceTurn(s, u) { for (const w of s.units) if (w.alive) { w.gauge = 0; w.rt = s.round; } u.rt = null; s.roundTurns = 0; s.active = null; const ev = []; E.nextTurn(s, ev); return ev; }
// A attacks B (placed next to A) with B on 1 HP
function finish(s, A, B) {
  B.x = A.x + 1; B.y = A.y + 1; B.hp = 1; B.status = []; B.buffs = [];
  forceTurn(s, A);
  if (s.active !== A.id) throw new Error('turn did not go to A');
  const r = E.applyAction(s, A.pid, { type: 'ability', slot: 'atk', x: B.x, y: B.y });
  return r;
}
const evOf = (r) => (r && r.ev) || [];

await safe('SET', 'sanitising', () => {
  const s0 = mk(3, 5);
  check('SET', 'no map -> no s.nemesis', s0.nemesis === undefined);
  const s1 = mk(3, 5, { p0: { pid: 'p1', n: 2 }, p1: { pid: 'p1' }, p2: { pid: 'nobody' }, ghost: { pid: 'p0' }, p3: 7 });
  check('SET', 'only the valid hunter kept', JSON.stringify(s1.nemesis) === JSON.stringify({ p0: { pid: 'p1', n: 2 } }), JSON.stringify(s1.nemesis));
  const s2 = mk(3, 5, { p0: { pid: 'p1', n: 999 }, p2: { pid: 'p0', n: -4 } });
  check('SET', 'streak clamped 1..99', s2.nemesis.p0.n === 99 && s2.nemesis.p2.n === 1);
  const s3 = mk(4, 5, { p0: { pid: 'p1' }, p1: { pid: 'p2' } }, 'squads');
  const t = (pid) => s3.units.find((u) => u.pid === pid).team;
  check('SET', 'squads: allies dropped, enemies kept', (s3.nemesis || {}).p0 === undefined && t('p0') === t('p1') && !!(s3.nemesis || {}).p1 === (t('p1') !== t('p2')), JSON.stringify(s3.nemesis));
  const s4 = mk(3, 5, []);
  check('SET', 'array map ignored', s4.nemesis === undefined);
  const s5 = mk(3, 5, { p0: { pid: 'p1' } });
  check('SET', 'nemesisOf / huntersOf', E.nemesisOf(s5, s5.units[0]) === s5.units[1] && E.huntersOf(s5, s5.units[1]).length === 1 && E.nemesisOf(s5, s5.units[2]) === null);
});

await safe('VEN', 'vendetta', () => {
  const s = mk(3, 5, { p0: { pid: 'p1', n: 2 } }); const [A, B] = s.units;
  const r = finish(s, A, B), ev = evOf(r);
  const v = ev.find((q) => q.e === 'vendetta');
  check('VEN', 'kill landed', r.ok && !B.alive, JSON.stringify(r).slice(0, 200));
  check('VEN', '{e:vendetta} with ids and streak', v && v.id === A.id && v.of === B.id && v.n === 2, JSON.stringify(v));
  check('VEN', '+1 shard (victim loot drops on the board)', A.shards === 1, A.shards);
  check('VEN', 'paid flag set', s.nemesis.p0.paid === 1);
  const s2 = mk(3, 5, { p0: { pid: 'p1' } }); const [A2, , C2] = s2.units;
  const r2 = finish(s2, A2, C2);
  check('VEN', 'killing someone else pays nothing', !evOf(r2).some((q) => q.e === 'vendetta') && A2.shards === 0 && !s2.nemesis.p0.paid);
});

await safe('AGN', 'nemesis again', () => {
  const s = mk(3, 5, { p0: { pid: 'p1', n: 2 } }); const [A, B] = s.units;
  const ev = evOf(finish(s, B, A));
  const g = ev.find((q) => q.e === 'nemesis');
  check('AGN', '{e:nemesis} n+1', g && g.id === B.id && g.of === A.id && g.n === 3, JSON.stringify(g));
  check('AGN', 'no vendetta for the Nemesis', !ev.some((q) => q.e === 'vendetta') && B.shards === 0);
  check('AGN', 'thorn for the survivor too', ev.some((q) => q.e === 'thorn' && q.id === B.id && q.of === A.id));
});

await safe('THN', 'thorn', () => {
  const s = mk(3, 5, { p0: { pid: 'p1' } }); const [A, B, C] = s.units;
  const ev = evOf(finish(s, C, A));
  const t = ev.find((q) => q.e === 'thorn');
  check('THN', 'hunter falls to a third player -> thorn for its target', t && t.id === B.id && t.of === A.id, JSON.stringify(t));
  check('THN', 'no nemesis event (someone else got it)', !ev.some((q) => q.e === 'nemesis'));
  check('THN', 'flag once', s.nemesis.p0.thorn === 1);
  const s2 = mk(3, 5, { p0: { pid: 'p1' } }); const [A2, B2, C2] = s2.units;
  finish(s2, C2, B2);
  const ev2 = evOf(finish(s2, C2, A2));
  check('THN', 'no thorn when the target fell first', !ev2.some((q) => q.e === 'thorn'));
});

await safe('DET', 'determinism', () => {
  const nm = { p0: { pid: 'p3', n: 2 }, p3: { pid: 'p0' }, p5: { pid: 'p1', n: 4 } };
  const a = play(roster(6, 3), 777, { mode: 'royale', nemesis: nm }), b = play(roster(6, 3), 777, { mode: 'royale', nemesis: JSON.parse(JSON.stringify(nm)) });
  check('DET', 'same inputs -> same final hash', stateHash(a) === stateHash(b) && a.over, stateHash(a) + ' ' + stateHash(b));
  const c = play(roster(6, 3), 777, { mode: 'royale' });
  check('DET', 'nemesis map changes the hash', stateHash(c) !== stateHash(a));
  check('DET', 'PROTO 3', PROTO === 3 && /^p3-/.test(protoVer()), protoVer());
  // replay through a JSON round trip of the start args, applying the recorded actions
  const players = roster(6, 4), opts = { mode: 'royale', nemesis: { p1: { pid: 'p2' }, p2: { pid: 'p4' } } };
  const s = E.createMatch(JSON.parse(JSON.stringify(players)), 99, JSON.parse(JSON.stringify(opts)));
  const acts = [], evs = [];
  for (let k = 0; k < 6000 && !s.over; k++) {
    const u = E.unitById(s, s.active), turn = s.turnNo;
    const plan = u.kind === 'hollow' ? E.planHollow(s, u) : E.planBot(s, u);
    for (const x of plan) { const r = E.applyAction(s, u.pid, x); acts.push([u.pid, x]); if (r.ev) evs.push(...r.ev.filter((q) => /vendetta|nemesis|thorn/.test(q.e))); if (s.turnNo !== turn || s.over) break; }
    if (s.turnNo === turn && !s.over) { E.applyAction(s, u.pid, { type: 'end' }); acts.push([u.pid, { type: 'end' }]); }
  }
  const r2 = E.createMatch(JSON.parse(JSON.stringify(players)), 99, JSON.parse(JSON.stringify(opts))), evs2 = [];
  for (const [pid, x] of JSON.parse(JSON.stringify(acts))) { const r = E.applyAction(r2, pid ?? undefined, x); if (r.ev) evs2.push(...r.ev.filter((q) => /vendetta|nemesis|thorn/.test(q.e))); }
  check('DET', 'replay hash matches', stateHash(s) === stateHash(r2) && s.over, `${stateHash(s)} ${stateHash(r2)} over ${s.over}`);
  check('DET', 'replay nemesis events match', JSON.stringify(evs) === JSON.stringify(evs2), evs.length + ' vs ' + evs2.length);
});

await safe('BOT', 'bias + clean matches', () => {
  // bot A with two equal 1-HP pawns in reach: with B as its Nemesis it hits B, with C as its Nemesis it hits C
  const pickFor = (nem) => {
    const s = mk(3, 11, { p0: { pid: nem } }); const [A, B, C] = s.units;
    A.x = 7; A.y = 7; B.x = 8; B.y = 8; C.x = 6; C.y = 8; B.hp = C.hp = 1;
    forceTurn(s, A);
    const plan = E.planBot(s, A), at = plan.find((x) => x.type === 'ability');
    return at ? (at.x === B.x && at.y === B.y ? 'p1' : at.x === C.x && at.y === C.y ? 'p2' : '?') : 'none';
  };
  check('BOT', 'targets its Nemesis (B)', pickFor('p1') === 'p1', pickFor('p1'));
  check('BOT', 'targets its Nemesis (C)', pickFor('p2') === 'p2', pickFor('p2'));
  let vend = 0, again = 0, thorn = 0, bad = 0;
  for (let g = 0; g < 24; g++) {
    const n = 4 + (g % 5), mode = g % 4 === 3 ? 'squads' : 'royale';
    const ps = roster(mode === 'squads' ? 6 : n, g, { randomize: true });
    const nm = {}; ps.forEach((p, i) => { nm[p.pid] = { pid: ps[(i + 1 + (g % 3)) % ps.length].pid, n: 1 + (i % 3) }; });
    const s = E.createMatch(JSON.parse(JSON.stringify(ps)), 1000 + g, { mode, nemesis: nm });
    for (let k = 0; k < 40000 && !s.over; k++) {
      const u = E.unitById(s, s.active), turn = s.turnNo;
      const plan = u.kind === 'hollow' ? E.planHollow(s, u) : E.planBot(s, u);
      for (const x of plan) { const r = E.applyAction(s, u.pid, x); for (const q of r.ev || []) { if (q.e === 'vendetta') vend++; if (q.e === 'nemesis') again++; if (q.e === 'thorn') thorn++; } if (s.turnNo !== turn || s.over) break; }
      if (s.turnNo === turn && !s.over) E.applyAction(s, u.pid, { type: 'end' });
    }
    if (!s.over) bad++;
    for (const [h, e] of Object.entries(s.nemesis || {})) if ((e.paid && !s.units.some((u) => u.pid === h)) || e.n < 1) bad++;
  }
  check('BOT', '24 bot matches finish', bad === 0, bad);
  check('BOT', 'vendettas, repeats and thorns all happen', vend > 0 && again > 0 && thorn > 0, `vend ${vend} again ${again} thorn ${thorn}`);
});

await safe('RIV', 'rivals.js helpers', async () => {
  const seats = [{ pid: 'a', nid: 'AAAAAAAAAAAA', nem: { nid: 'BBBBBBBBBBBB', n: 2 } }, { pid: 'b', nid: 'BBBBBBBBBBBB' }, { pid: 'c', isBot: true, name: 'Vex', nem: null }, { pid: 'd', nid: 'CCCCCCCCCCCC', nem: { bot: 'Vex' } }, { pid: 'e', nem: { nid: 'ZZZZZZZZZZZZ' } }];
  check('RIV', 'nemMap resolves nid + bot name', JSON.stringify(nemMap(seats)) === JSON.stringify({ a: { pid: 'b', n: 2 }, d: { pid: 'c', n: 1 } }), JSON.stringify(nemMap(seats)));
  check('RIV', 'nemMap null when empty', nemMap([{ pid: 'x' }]) === null);
  check('RIV', 'cleanNem rejects junk', cleanNem({ nid: 'short' }) === null && cleanNem('x') === null && cleanNem({ bot: '<b>Vex</b>' }).bot === 'bVex/b');
  const n1 = await nidOf('ABCDEFGH12'), n2 = await nidOf('abcdefgh12');
  check('RIV', 'nidOf stable, case-insensitive, 12 chars', n1 && n1 === n2 && /^[0-9A-Z]{12}$/.test(n1) && (await nidOf('bad')) === null, n1);
  check('RIV', 'tiers', tierOf(1200, 12).id === 'knight' && tierOf(1000, 30).id === 'pawn' && tierOf(1760, 30).id === 'king' && tierOf(1500, 3).prov === true && tierOf(1500, 3).id === 'rook');
  check('RIV', 'rkPub', JSON.stringify(rkPub(1234.6, 4)) === '{"r":1235,"p":1}' && JSON.stringify(rkPub(1300, 10)) === '{"r":1300}');
  check('RIV', 'rewards', rewardFor(1).id === 'champion' && rewardFor(3).id === 'podium' && rewardFor(10).id === 'elite' && rewardFor(50).id === 'contender' && rewardFor(51) === null);
});

console.log(`engine18: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
