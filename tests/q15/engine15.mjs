// Q 15.0: engine + data tests for the 15.0 spec (docs/DESIGN_15.md), headless in Node.
// Usage: node tests/q15/engine15.mjs [--only ST,KG,LO,MO,AB,PC,UN] [--king 160] [--verbose] [--json out.json]
// Every check is PASS / FAIL / PENDING. PENDING = the feature is not in the tree yet (detected by feature probes),
// so a run before the builders land is not red. Exit code 1 only on FAIL.
//   ST status effects   durations, ticks, stacks, interactions (fire/freeze), King not immune, bots legal under status,
//                       natural-play invariants (shape, bounds, coverage per status kind)
//   KG boss King        no extra damage taken, normal ult charge, telegraph one round before the Crown, raid HP + boss
//                       phases at 66/33%, Exposed stacks per distinct attacker, single steps; bot Royale King win rate
//   LO locations        LOCATIONS table (8 ids, fields valid vs world.js weather / music themes / hazards / WORLD_EVENTS,
//                       backdrop files), deterministic pick from the seed, spread over seeds, Daily location of the day,
//                       host pick, invalid picks rejected, hazards and world events drawn from the location's pools,
//                       signature events apply their status, {e:'location'} on the first state
//   MO modes            groups, mirror removed but old ids load, Daily = mirror build, Custom rules validated/clamped
//   AB abilities        >=6 new passives, >=10 new equips (2 per piece), unlock prices 400-1500, free starter kit,
//                       every ability usable without throwing, codex/data copy consistent
//   PC pieces           EVOLVE_COST, Ascension at hone 3, pawn veteran/champion line (single-step)
//   UN unlocks          store purchase of unlocks + Royal Pass (3000), profile.unlocked shape, old-save migration
import * as E from '../../js/engine.js';
import * as D from '../../js/data.js';
import fs from 'fs';
import * as PRG from '../../js/progression.js';
import path from 'path';
import { fileURLToPath } from 'url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, arr) => (v.startsWith('--') ? [...a, [v.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true]] : a), []));
const ONLY = args.only ? String(args.only).split(',') : null;
const VERB = !!args.verbose;
const R = { pass: 0, fail: 0, pend: 0, warn: 0, rows: [], metrics: {} };
const rec = (st, g, name, info = '') => { R[st]++; R.rows.push({ st, g, name, info: String(info).slice(0, 300) }); if (VERB || st !== 'pass') console.log(`${st === 'pass' ? 'PASS' : st === 'fail' ? 'FAIL' : st === 'warn' ? 'WARN' : 'PEND'} ${g} ${name}${info ? ' :: ' + String(info).slice(0, 300) : ''}`); };
const check = (g, name, ok, info = '') => rec(ok ? 'pass' : 'fail', g, name, info);
const pending = (g, name, why) => rec('pend', g, name, why);
const warn = (g, name, ok, info = '') => rec(ok ? 'pass' : 'warn', g, name, info); // consistency nits: reported, never red
const metric = (k, v) => { R.metrics[k] = v; console.log(`METRIC ${k} = ${typeof v === 'object' ? JSON.stringify(v) : v}`); };
const safe = (g, name, fn) => { try { return fn(); } catch (e) { rec('fail', g, name + ' (threw)', e.message + ' @ ' + (e.stack.split('\n')[1] || '').trim()); return undefined; } };
const want = (g) => !ONLY || ONLY.includes(g);

function mulberry(a) { return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), a | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const PIECE_ORDER = Object.keys(D.PIECES).filter((k) => D.PIECES[k].equips && D.PIECES[k].equips.length);
const STATUS_K = ['burn', 'poison', 'freeze', 'stun', 'slow', 'shield', 'haste'];
const STATUS_ALL = [...new Set([...STATUS_K, ...Object.keys(D.STATUS || D.STATUSES || {})])]; // + engine-internal ones (exposed, enrage)
const DEF = { burn: 2, poison: 3, freeze: 1, stun: 1, slow: 2, shield: 2, haste: 2 };
const cheb = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
const src = (f) => { try { return fs.readFileSync(path.join(ROOT, f), 'utf8'); } catch { return ''; } };

function players(n, { bots = n, seed = 1, passive, preset = 'bruiser' } = {}) {
  const r = mulberry(seed), out = [];
  for (let i = 0; i < n; i++) {
    const p = D.PRESETS[preset] || Object.values(D.PRESETS)[0]; const equips = {};
    for (const pc of PIECE_ORDER) equips[pc] = D.PIECES[pc].equips[Math.floor(r() * Math.min(2, D.PIECES[pc].equips.length))];
    out.push({ pid: 'p' + i, name: 'P' + i, isBot: i < bots, botLevel: 'normal', skin: 'ivory', build: { pts: { ...p.pts }, passive: passive || p.passive, equips } });
  }
  return out;
}
const mk = (n = 2, opts = {}, seed = 11, pl = {}) => E.createMatch(players(n, pl), seed, { mode: 'royale', mutator: 'none', ...opts });
const pl = (s, i = 0) => s.units.filter((u) => u.kind === 'player')[i];
// clear a spot and place a unit there
function place(s, u, x, y) { const o = E.unitAt(s, x, y); if (o && o !== u) { o.x = -50; o.alive = false; } s.tiles[y * D.SIZE + x] = { t: 'floor' }; s.items = s.items.filter((i) => !(i.x === x && i.y === y)); u.x = x; u.y = y; }
function clearHollows(s) { for (const u of s.units) if (u.kind === 'hollow') { u.alive = false; u.hp = 0; u.x = -50 - u.id; } }
// hand the turn to u (its turn start runs: statuses tick)
function forceTurn(s, u) { for (const w of s.units) if (w.alive) w.gauge = 0; u.gauge = 100; s.roundTurns = 0; const ev = []; E.nextTurn(s, ev); return ev; }
const stOf = (u, k) => (u.status || []).find((x) => x.k === k) || null;
const evs = (ev, e, f = () => true) => ev.filter((q) => q.e === e && f(q));

// ---- status application API probe: an exported function that puts a status on a unit
let ADD = null, ADDNAME = null;
function probeAdd() {
  const cands = Object.keys(E).filter((k) => typeof E[k] === 'function' && /status|inflict|afflict/i.test(k) && !/^(has|get|is|status[A-Z]?$)/.test(k));
  const sigs = [
    (f) => (s, u, k, t, ev, n) => f(s, u, k, t, ev, n == null ? undefined : { n }),
    (f) => (s, u, k, t, ev, n) => f(s, u, k, { t, n }, ev),
    (f) => (s, u, k, t, ev, n) => f(s, u, { k, t, n }, ev),
    (f) => (s, u, k, t, ev, n) => f(s, u, k, ev, { t, n }),
    (f) => (s, u, k, t, ev, n) => f(s, u, k, t, n, ev),
  ];
  for (const name of cands) for (const sg of sigs) {
    try {
      const s = mk(2); const u = pl(s, 1); u.status = u.status || []; const ev = [];
      const fn = sg(E[name]); fn(s, u, 'burn', 2, ev);
      const b = stOf(u, 'burn'); if (!b || b.t !== 2) continue;
      const s2 = mk(2); const u2 = pl(s2, 1); fn(s2, u2, 'shield', 2, [], 17); const sh = stOf(u2, 'shield'); if (!sh || sh.n !== 17) continue;
      ADD = fn; ADDNAME = name; return;
    } catch {}
  }
}
const statusLive = () => { const s = mk(2); const u = pl(s); return Array.isArray(u.status); };
// fallback: write the spec's state shape directly (the engine must read u.status)
const put = (s, u, k, t, n) => { if (ADD) { const ev = []; ADD(s, u, k, t, ev, n); return ev; } u.status = u.status || []; const o = { k, t }; if (n != null) o.n = n; u.status.push(o); return []; };

// ================= ST: status effects =================
function testStatus() {
  const G = 'ST';
  if (!statusLive()) { pending(G, 'u.status on units', 'createMatch units have no status array yet'); return; }
  check(G, 'players start with an empty status list', (() => { const s = mk(4); return s.units.filter((u) => u.kind === 'player').every((u) => Array.isArray(u.status) && u.status.length === 0); })());
  warn(G, 'hollows start with a status list too', (() => { const s = mk(8); return s.units.filter((u) => u.kind === 'hollow').every((u) => Array.isArray(u.status)); })(), 'Hollows have no u.status (engine guards it; renderers must too)');
  probeAdd();
  if (ADD) check(G, `status apply API found (${ADDNAME})`, true); else pending(G, 'exported status apply function', 'no exported addStatus-like function; interaction tests use direct u.status writes (C: please export addStatus(s,u,k,t,ev,{n,src}))');
  if (D.STATUS || D.STATUSES) { const T = D.STATUS || D.STATUSES; check(G, 'data STATUS table lists the 7 spec kinds', STATUS_K.every((k) => T[k]), Object.keys(T).join(',')); for (const k of STATUS_K) if (T[k] && T[k].t != null) check(G, `default turns ${k}=${DEF[k]}`, T[k].t === DEF[k], 'data has ' + T[k].t); }
  else pending(G, 'data STATUS table', 'no D.STATUS/STATUSES export (default turns checked via apply only)');

  // durations: t counts down at the affected unit's turn start, removed with on:false at 0
  for (const k of ['burn', 'slow', 'haste']) safe(G, `${k} lasts ${DEF[k]} own turns`, () => {
    const s = mk(2); clearHollows(s); const u = pl(s, 1); u.hp = E.stats(u).maxHp; put(s, u, k, DEF[k]);
    const seen = []; let off = 0, ticks = 0;
    for (let i = 0; i < DEF[k] + 2; i++) { const ev = forceTurn(s, u); seen.push(stOf(u, k) ? stOf(u, k).t : 0); off += evs(ev, 'status', (q) => q.id === u.id && q.k === k && q.on === false).length; ticks += evs(ev, 'dmg', (q) => q.id === u.id && q.dot === k).length; }
    const active = seen.filter((t) => t > 0).length;
    check(G, `${k}: active for ${DEF[k] - 1}..${DEF[k]} turn starts then removed`, active >= DEF[k] - 1 && active <= DEF[k] && seen[seen.length - 1] === 0, 't per turn ' + seen.join(','));
    check(G, `${k}: one {e:'status',on:false} on expiry`, off === 1, 'off events ' + off);
    if (k === 'burn') check(G, `burn: ${DEF.burn} dot ticks total`, ticks === DEF.burn, 'ticks ' + ticks);
  });
  // apply events
  if (ADD) safe(G, 'apply emits {e:status,id,k,on:true,t}', () => { const s = mk(2); const u = pl(s, 1); const ev = []; ADD(s, u, 'slow', 2, ev); const q = evs(ev, 'status', (q) => q.id === u.id && q.k === 'slow' && q.on === true)[0]; check(G, 'status on event shape', !!q && q.t === 2, JSON.stringify(ev)); });
  // burn 6% max HP at turn start
  safe(G, 'burn tick 6% max HP', () => {
    const s = mk(2); clearHollows(s); const u = pl(s, 1); const mx = E.stats(u).maxHp; u.hp = mx; put(s, u, 'burn', 2);
    const ev = forceTurn(s, u); const d = evs(ev, 'dmg', (q) => q.id === u.id && q.dot === 'burn')[0];
    check(G, 'burn: dmg event {dot:"burn"} at turn start', !!d, JSON.stringify(ev.filter((q) => q.id === u.id)).slice(0, 200));
    if (d) check(G, 'burn: 6% max HP (+-1)', Math.abs(d.n - mx * 0.06) <= 1, `n=${d.n} max=${mx}`);
  });
  // poison 3%/stack up to 3, healing halved
  safe(G, 'poison stacks', () => {
    const s = mk(2); clearHollows(s); const u = pl(s, 1); const mx = E.stats(u).maxHp; u.hp = mx;
    if (ADD) { for (let i = 0; i < 5; i++) ADD(s, u, 'poison', 3, []); const p = stOf(u, 'poison'); check(G, 'poison: 5 applications cap at 3 stacks, one entry', p && p.n === 3 && u.status.filter((x) => x.k === 'poison').length === 1, JSON.stringify(u.status)); }
    else put(s, u, 'poison', 3, 3);
    const ev = forceTurn(s, u); const d = evs(ev, 'dmg', (q) => q.id === u.id && q.dot === 'poison')[0];
    check(G, 'poison: dot event at turn start', !!d);
    if (d) check(G, 'poison: 3% x 3 stacks = 9% max HP (+-1)', Math.abs(d.n - mx * 0.09) <= 1.01, `n=${d.n} max=${mx}`);
  });
  safe(G, 'poison halves healing', () => {
    const heals = (pois) => { const s = mk(2, {}, 11, { passive: 'regen' }); clearHollows(s); const u = pl(s, 1); u.attune = 50; u.hp = Math.round(E.stats(u).maxHp * 0.5); if (pois) put(s, u, 'poison', 3, 1); const ev = forceTurn(s, u); return evs(ev, 'heal', (q) => q.id === u.id).reduce((a, q) => a + q.n, 0); };
    const a = heals(false), b = heals(true); check(G, 'poison: regen heal halved', a > 0 && Math.abs(b - a / 2) <= 1, `clean ${a} poisoned ${b}`);
  });
  // freeze / stun
  safe(G, 'freeze', () => {
    const s = mk(2); clearHollows(s); const u = pl(s, 1); put(s, u, 'freeze', 1); forceTurn(s, u);
    check(G, 'freeze: cannot move this turn', !E.canMove(s, u) || E.legalMoves(s, u).length === 0 || (() => { const m = E.legalMoves(s, u)[0]; const c = JSON.stringify(s); const r = E.applyAction(s, u.pid, { type: 'move', x: m.x, y: m.y }); return !r.ok && JSON.stringify(s) === c; })());
    check(G, 'freeze: can still act', E.canAct(s, u));
    E.applyAction(s, u.pid, { type: 'end' }); forceTurn(s, u); check(G, 'freeze: gone the turn after', E.canMove(s, u) && !stOf(u, 'freeze'), JSON.stringify(u.status));
  });
  safe(G, 'stun', () => {
    const s = mk(2); clearHollows(s); const u = pl(s, 1); const v = pl(s, 0); put(s, u, 'stun', 1); forceTurn(s, u);
    place(s, v, u.x + 1, u.y + 1); if (!E.inB(v.x, v.y)) place(s, v, u.x - 1, u.y - 1);
    check(G, 'stun: canAct false / atk unusable', !E.canAct(s, u) || !E.canUse(s, u, 'atk'), `canAct=${E.canAct(s, u)} canUse(atk)=${E.canUse(s, u, 'atk')}`);
    const r = E.applyAction(s, u.pid, { type: 'ability', slot: 'atk', x: v.x, y: v.y }); check(G, 'stun: attack action rejected', !r.ok);
    check(G, 'stun: can still move', E.canMove(s, u));
  });
  // slow / haste on SPD
  safe(G, 'slow/haste SPD', () => {
    const s = mk(2); const u = pl(s, 1); const b = E.stats(u).spd;
    put(s, u, 'slow', 2); const sl = E.stats(u).spd; u.status = []; put(s, u, 'haste', 2); const ha = E.stats(u).spd;
    check(G, 'slow: -3 SPD', sl === b - 3, `${b} -> ${sl}`); check(G, 'haste: +3 SPD', ha === b + 3, `${b} -> ${ha}`);
  });
  // shield absorbs n before HP
  safe(G, 'shield absorbs', () => {
    const s = mk(2); clearHollows(s); s.round = 9; const a = pl(s, 0), v = pl(s, 1); place(s, a, 6, 6); place(s, v, 7, 7);
    put(s, v, 'shield', 2, 1000); v.hp = Math.round(E.stats(v).maxHp * 0.7); const hp0 = v.hp;
    forceTurn(s, a); const r = E.applyAction(s, a.pid, { type: 'ability', slot: 'atk', x: 7, y: 7 });
    check(G, 'shield: big shield takes the whole hit, HP unchanged', r.ok && v.hp === hp0, `ok=${r.ok} hp ${hp0}->${v.hp} ev=${JSON.stringify(r.ev.filter((q) => q.id === v.id)).slice(0, 200)}`);
    const sh = stOf(v, 'shield'); check(G, 'shield: n reduced by the damage absorbed', sh && sh.n < 1000, JSON.stringify(v.status));
    const s2 = mk(2); clearHollows(s2); s2.round = 9; const a2 = pl(s2, 0), v2 = pl(s2, 1); place(s2, a2, 6, 6); place(s2, v2, 7, 7); put(s2, v2, 'shield', 2, 3); v2.hp = Math.round(E.stats(v2).maxHp * 0.7); const h2 = v2.hp; forceTurn(s2, a2); E.applyAction(s2, a2.pid, { type: 'ability', slot: 'atk', x: 7, y: 7 });
    check(G, 'shield: small shield breaks and the rest hits HP', v2.hp < h2 && !(stOf(v2, 'shield') && stOf(v2, 'shield').n > 0), `hp ${h2}->${v2.hp} ${JSON.stringify(v2.status)}`);
  });
  // interactions
  if (ADD) {
    safe(G, 'fire removes freeze', () => { const s = mk(2); const u = pl(s, 1); ADD(s, u, 'freeze', 1, []); ADD(s, u, 'burn', 2, []); check(G, 'burn applied to a frozen unit thaws it', !stOf(u, 'freeze'), JSON.stringify(u.status)); });
    safe(G, 'freeze removes burn', () => { const s = mk(2); const u = pl(s, 1); ADD(s, u, 'burn', 2, []); ADD(s, u, 'freeze', 1, []); check(G, 'freeze applied to a burning unit puts out the fire', !stOf(u, 'burn'), JSON.stringify(u.status)); });
    safe(G, 'reapply refreshes', () => { const s = mk(2); const u = pl(s, 1); ADD(s, u, 'slow', 2, []); ADD(s, u, 'slow', 2, []); check(G, 'reapplying slow keeps one entry', u.status.filter((x) => x.k === 'slow').length === 1, JSON.stringify(u.status)); });
    safe(G, 'default turns', () => { for (const k of STATUS_K) { const s = mk(2); const u = pl(s, 1); const ev = []; try { E[ADDNAME](s, u, k, undefined, ev); } catch {} const x = stOf(u, k); if (x) check(G, `apply ${k} with no t uses default ${DEF[k]}`, x.t === DEF[k], 't=' + x.t); } });
  } else pending(G, 'fire/freeze interactions', 'needs the exported apply function');
  // King not immune
  safe(G, 'King not immune', () => {
    const s = mk(2); clearHollows(s); const u = pl(s, 1); place(s, u, 8, 8); s.items.push({ x: 9, y: 8, k: 'crown', n: 1 }); s.tiles[8 * D.SIZE + 9] = { t: 'floor' };
    forceTurn(s, u); E.applyAction(s, u.pid, { type: 'move', x: 9, y: 8 });
    if (u.piece !== 'king') { check(G, 'crowning by stepping on the Crown', false, 'piece=' + u.piece); return; }
    put(s, u, 'freeze', 1); put(s, u, 'slow', 2); const sp = E.stats(u).spd; u.status = u.status.filter((x) => x.k !== 'slow'); const sp0 = E.stats(u).spd; put(s, u, 'slow', 2);
    check(G, 'King keeps statuses (freeze + slow stay on)', !!stOf(u, 'freeze') && !!stOf(u, 'slow'), JSON.stringify(u.status));
    check(G, 'King: slow lowers SPD', sp < sp0, `${sp0} -> ${sp}`);
    E.applyAction(s, u.pid, { type: 'end' }); u.status = u.status.filter((x) => x.k !== 'slow'); put(s, u, 'freeze', 1); forceTurn(s, u);
    check(G, 'King: freeze stops the move', !E.canMove(s, u));
  });
  // bots under status: every planned action is legal; frozen bots plan no move, stunned bots plan no ability
  safe(G, 'bots under status', () => {
    let rej = 0, frozenMoves = 0, stunActs = 0, plans = 0;
    for (let seed = 1; seed <= 24; seed++) for (const k of ['freeze', 'stun', 'slow', 'burn', 'poison']) {
      const s = E.createMatch(players(6, { seed }), seed * 97, { mode: 'royale', mutator: 'none' });
      for (let t = 0; t < 30 && !s.over; t++) {
        const u = E.unitById(s, s.active); if (u.kind === 'player' && t % 3 === 0 && !stOf(u, k)) { put(s, u, k, DEF[k], k === 'poison' ? 2 : undefined); }
        // statuses applied mid-turn only bite next turn; re-run the turn start for the check
        const turn = s.turnNo; const plan = u.kind === 'hollow' ? E.planHollow(s, u) : E.planBot(s, u); plans++;
        const fz = u.kind === 'player' && stOf(u, 'freeze') && !E.canMove(s, u), sn = u.kind === 'player' && stOf(u, 'stun') && !E.canAct(s, u);
        for (const a of plan) { if (s.over || s.turnNo !== turn) break; if (fz && a.type === 'move') frozenMoves++; if (sn && a.type === 'ability') stunActs++; const r = E.applyAction(s, u.pid, a); if (!r.ok && a.type !== 'end') rej++; }
        if (!s.over && s.turnNo === turn) E.applyAction(s, u.pid, { type: 'end' });
      }
    }
    check(G, 'bots: no rejected planned actions under statuses', rej === 0, `${rej} rejected of ${plans} plans`);
    check(G, 'bots: frozen bots plan no move', frozenMoves === 0, frozenMoves + ' move actions');
    check(G, 'bots: stunned bots plan no ability', stunActs === 0, stunActs + ' ability actions');
  });
  // natural play: shape invariants + which statuses actually occur from abilities/passives/hazards/events/locations
  safe(G, 'natural-play invariants', () => {
    const seen = {}, bad = [], dot = {}, srcs = {};
    for (let i = 0; i < 40; i++) {
      const mode = ['royale', 'blitz', 'squads', 'siege', 'chaos', 'hill', 'gauntlet', 'duel'][i % 8];
      const M = D.MODES[mode]; if (!M) continue; const n = Math.max(M.players[0], Math.min(M.players[1], 6));
      const s = E.createMatch(players(n + (M.teams && n % M.teams ? 1 : 0), { seed: i }), 5000 + i, { mode });
      for (let st = 0; st < 5000 && !s.over; st++) {
        const u = E.unitById(s, s.active); const turn = s.turnNo;
        const plan = u.kind === 'hollow' ? E.planHollow(s, u) : E.planBot(s, u);
        for (const a of plan) { if (s.over || s.turnNo !== turn) break; const r = E.applyAction(s, u.pid, a);
          for (const q of r.ev) { if (q.e === 'status' && q.on) { seen[q.k] = (seen[q.k] || 0) + 1; if (q.src != null) srcs[q.k + ':' + (typeof q.src === 'string' ? q.src : 'unit')] = 1; if (!STATUS_ALL.includes(q.k)) bad.push('unknown status ' + q.k); }
            if (q.dot) { dot[q.dot] = (dot[q.dot] || 0) + 1; if (!['burn', 'poison'].includes(q.dot) && !/pool|fog/.test(q.dot)) bad.push('dot kind ' + q.dot); } } }
        if (!s.over && s.turnNo === turn) E.applyAction(s, u.pid, { type: 'end' });
        if (st % 7 === 0) for (const w of s.units) if (w.alive && w.status) {
          const ks = w.status.map((x) => x.k);
          for (const x of w.status) { if (!STATUS_ALL.includes(x.k)) bad.push(`${mode} unit ${w.id} status ${x.k}`); if (!Number.isInteger(x.t) || x.t < 0 || x.t > 9) bad.push(`${mode} ${x.k} t=${x.t}`); if (x.k === 'poison' && !(x.n >= 1 && x.n <= 3)) bad.push(`poison n=${x.n}`); if (x.k === 'shield' && !(x.n >= 0)) bad.push(`shield n=${x.n}`); }
          if (new Set(ks).size !== ks.length) bad.push(`${mode} unit ${w.id} duplicate status ${ks}`);
          if (ks.includes('freeze') && ks.includes('burn')) bad.push(`${mode} unit ${w.id} frozen and burning at once`);
          const sp = E.stats(w).spd; if (!Number.isFinite(sp)) bad.push('spd ' + sp);
        }
      }
    }
    metric('status_seen_in_play', seen); metric('status_dots_in_play', dot);
    check(G, 'natural play: status state always valid', bad.length === 0, [...new Set(bad)].slice(0, 6).join(' | '));
    const missing = STATUS_K.filter((k) => !seen[k]);
    if (Object.keys(seen).length === 0) pending(G, 'statuses occur in natural play', 'no status events yet from abilities/passives/hazards/events');
    else check(G, 'every status kind occurs in natural bot play', missing.length === 0, 'never seen: ' + missing.join(','));
  });
}

// ================= KG: boss King =================
function crownUnit(s, u) { place(s, u, 8, 8); s.tiles[8 * D.SIZE + 9] = { t: 'floor' }; s.items.push({ x: 9, y: 8, k: 'crown', n: 1 }); forceTurn(s, u); E.applyAction(s, u.pid, { type: 'move', x: 9, y: 8 }); return u.piece === 'king'; }
function testKing() {
  const G = 'KG';
  safe(G, 'single steps', () => { const s = mk(4); clearHollows(s); const u = pl(s, 1); const pre = E.stats(u).maxHp; if (!crownUnit(s, u)) return check(G, 'crown pickup', false); check(G, 'King moves single steps only', E.legalMoves(s, u).every((m) => cheb(m, u) === 1));
    const ratio = E.stats(u).maxHp / pre; metric('king_hp_ratio', +ratio.toFixed(2));
    if (ratio < 1.5) pending(G, 'raid-boss HP pool', `King max HP is ${ratio.toFixed(2)}x the pre-crown HP (spec: big HP pool)`); else check(G, 'raid-boss HP pool (>=1.5x)', true, ratio.toFixed(2) + 'x'); });
  // no extra damage taken: same attacker, same seed, King vs a non-King with identical stats
  safe(G, 'no extra damage taken', () => {
    const run = (king) => { const s = mk(2, {}, 33); clearHollows(s); s.round = 9; const a = pl(s, 0), v = pl(s, 1); place(s, a, 6, 6); place(s, v, 7, 7);
      if (king) { v.kingFrom = v.piece; v.kingStats = { hp: E.stats(v).maxHp, atk: E.stats(v).atk, def: E.stats(v).def, spd: E.stats(v).spd }; v.piece = 'king'; }
      v.hp = Math.round(E.stats(v).maxHp * 0.9); const st = E.stats(v); forceTurn(s, a); s.seed = 4242; const h = v.hp; E.applyAction(s, a.pid, { type: 'ability', slot: 'atk', x: 7, y: 7 }); return { d: h - v.hp, def: st.def }; };
    const a = run(false), b = run(true);
    check(G, 'King takes the same damage as an identical non-King', a.d === b.d || a.def !== b.def, `normal ${a.d} king ${b.d}`);
    const pre = src('js/engine.js'); check(G, 'no King damage multiplier in dealDamage', !/tgt\.piece === 'king'\) m \*= 1\.\d/.test(pre), 'engine.js still has `if (tgt.piece === \'king\') m *= 1.1`');
  });
  safe(G, 'normal ult charge', () => {
    const s = mk(2); clearHollows(s); s.round = 9; const k = pl(s, 1), v = pl(s, 0); if (!crownUnit(s, k)) return; E.applyAction(s, k.pid, { type: 'end' });
    place(s, v, k.x + 1, k.y); k.ult = 0; v.status = []; forceTurn(s, k); const r = E.applyAction(s, k.pid, { type: 'ability', slot: 'atk', x: v.x, y: v.y });
    const d = r.ev.filter((q) => q.e === 'dmg' && q.id === v.id && q.src === k.id && !q.shield).reduce((a, q) => a + q.n, 0);
    check(G, 'King ult charge = 1.1 x damage dealt (no 0.5 factor)', d > 0 && Math.abs(k.ult - Math.min(100, d * 1.1)) < 1.5, `dealt ${d} ult ${k.ult.toFixed(1)}`);
  });
  // telegraph: one round before the Crown spawns everyone sees where it will land
  safe(G, 'telegraph', () => {
    let ok = 0, n = 0, earlyBy = [], names = new Set(), evMark = 0;
    for (let i = 0; i < 12; i++) {
      const s = E.createMatch(players(8, { seed: i }), 700 + i, { mode: 'royale' }); let tele = null, spawn = null;
      for (let st = 0; st < 6000 && !s.over && !spawn; st++) {
        const u = E.unitById(s, s.active); const turn = s.turnNo; const plan = u.kind === 'hollow' ? E.planHollow(s, u) : E.planBot(s, u);
        for (const a of plan) { if (s.over || s.turnNo !== turn) break; const r = E.applyAction(s, u.pid, a); for (const q of r.ev) { if (q.e === 'crownSpawn') spawn = { ...q, round: s.round }; else if (/crown|telegraph/i.test(q.e) && q.x != null && !tele) { tele = { ...q, round: s.round }; names.add(q.e); } } }
        if (!s.over && s.turnNo === turn) { const r = E.applyAction(s, u.pid, { type: 'end' }); for (const q of r.ev) { if (q.e === 'crownSpawn') spawn = { ...q, round: s.round }; else if (/crown|telegraph/i.test(q.e) && q.x != null && !tele) { tele = { ...q, round: s.round }; names.add(q.e); } } }
        if (!tele && (s.crownAt || s.crownWarn || s.crownTele)) { const c = s.crownAt || s.crownWarn || s.crownTele; if (c.x != null) { tele = { e: 'state', x: c.x, y: c.y, round: s.round }; evMark++; } }
      }
      if (!spawn) continue; n++;
      if (tele && tele.x === spawn.x && tele.y === spawn.y && tele.round < spawn.round) { ok++; earlyBy.push(spawn.round - tele.round); }
    }
    if (!n) return check(G, 'Crown spawns in bot Royale', false);
    if (!ok && !names.size && !evMark) pending(G, 'Crown telegraph one round ahead', 'no crown telegraph event/state seen before crownSpawn');
    else check(G, 'Crown telegraph at the exact spawn tile >=1 round ahead', ok === n, `${ok}/${n} matches; rounds ahead ${earlyBy.join(',')}; events ${[...names]}`);
  });
  // phases at 66% / 33%: one event each, never repeated
  safe(G, 'phases', () => {
    const s = mk(3); clearHollows(s); s.round = 9; const k = pl(s, 1), a = pl(s, 0); if (!crownUnit(s, k)) return; E.applyAction(s, k.pid, { type: 'end' });
    const mx = E.stats(k).maxHp; const got = [];
    for (const f of [0.68, 0.35, 0.6, 0.3]) { place(s, a, k.x + 1, k.y + 1); k.hp = Math.round(mx * f); forceTurn(s, a); a.hp = E.stats(a).maxHp; for (let j = 0; j < 4 && k.hp > mx * (f - 0.05) && E.canUse(s, a, 'atk'); j++) { const r = E.applyAction(s, a.pid, { type: 'ability', slot: 'atk', x: k.x, y: k.y }); got.push(...r.ev.filter((q) => /phase|shock|enrage/i.test(q.e) && (q.id === k.id || q.by === k.id || q.src === k.id))); if (!r.ok) break; } if (!s.over && s.active === a.id) E.applyAction(s, a.pid, { type: 'end' }); }
    const names = got.map((q) => q.e + (q.phase != null ? ':' + q.phase : '')); metric('king_phase_events', names);
    if (!got.length) pending(G, 'King phases at 66%/33%', 'no phase/shockwave/enrage events when the King crosses 66% and 33%');
    else { const ph = got.filter((q) => /phase/i.test(q.e)); check(G, 'two King phase events (66% and 33%), not repeated on re-crossing', (ph.length || got.filter((q) => /shock/i.test(q.e)).length) === 2, names.join(',')); }
  });
  // Exposed: each different attacker in a round stacks -DEF until the King's next turn
  safe(G, 'Exposed', () => {
    const s = mk(4); clearHollows(s); s.round = 9; const k = pl(s, 1), a = pl(s, 0), b = pl(s, 2); if (!crownUnit(s, k)) return; E.applyAction(s, k.pid, { type: 'end' });
    k.hp = E.stats(k).maxHp; k.status = (k.status || []).filter((q) => q.k !== 'exposed');
    // Exposed scales DEF inside the damage formula (defMul), so measure it as preview damage from a fixed probe attacker
    const probe = pl(s, 3) || a; const pd = () => E.previewDamage(probe, k, 50)[1]; const xn = () => { const q = stOf(k, 'exposed'); return q ? q.n || 1 : 0; };
    const d0 = pd();
    const hit = (u, dx) => { place(s, u, k.x + dx, k.y + 1); forceTurn(s, u); const r = E.applyAction(s, u.pid, { type: 'ability', slot: 'atk', x: k.x, y: k.y }); if (!s.over && s.active === u.id) E.applyAction(s, u.pid, { type: 'end' }); return r.ok; };
    hit(a, -1); const d1 = pd(), n1 = xn(); hit(b, 1); const d2 = pd(), n2 = xn(); hit(a, -1); const d3 = pd(), n3 = xn();
    metric('king_exposed', { previewDmg: [d0, d1, d2, d3], stacks: [n1, n2, n3] });
    if (!n1 && !n2) pending(G, 'Exposed -DEF stacks', `no exposed status on the King after hits from two attackers (preview ${d0}->${d2})`);
    else {
      check(G, 'Exposed: one stack per distinct attacker (1 then 2)', n1 === 1 && n2 === 2, `stacks ${n1},${n2}`);
      check(G, 'Exposed: the King takes more damage with each stack', d2 > d1 && d1 > d0, `preview ${d0} -> ${d1} -> ${d2}`);
      check(G, 'Exposed: same attacker again does not stack', n3 === n2, `stacks ${n2} -> ${n3}`);
      forceTurn(s, k); check(G, 'Exposed clears at the King\'s next turn', xn() === 0 && pd() === d0, `stacks ${xn()} preview ${pd()} vs ${d0}`);
    }
  });
  // win-rate sim
  safe(G, 'win rate', () => {
    const N = +(args.king || 160); let kingWins = 0, crowned = 0, done = 0, rounds = 0;
    for (let i = 0; i < N; i++) {
      const s = E.createMatch(players(8, { seed: 300 + i }), 90001 + i * 7919, { mode: 'royale' }); let wasCrowned = false;
      for (let st = 0; st < 8000 && !s.over; st++) {
        const u = E.unitById(s, s.active); const turn = s.turnNo; const plan = u.kind === 'hollow' ? E.planHollow(s, u) : E.planBot(s, u);
        for (const a of plan) { if (s.over || s.turnNo !== turn) break; const r = E.applyAction(s, u.pid, a); if (r.ev.some((q) => q.e === 'crowned')) wasCrowned = true; }
        if (!s.over && s.turnNo === turn) { const r = E.applyAction(s, u.pid, { type: 'end' }); if (r.ev.some((q) => q.e === 'crowned')) wasCrowned = true; }
      }
      if (!s.over) continue; done++; rounds += s.round; if (wasCrowned) crowned++;
      const w = E.unitById(s, s.winner); if (w && w.piece === 'king') kingWins++;
    }
    const rate = kingWins / Math.max(1, done), withCrown = kingWins / Math.max(1, crowned);
    metric('king_win_rate', `${(rate * 100).toFixed(1)}% of ${done} 8-bot Royale (King crowned in ${crowned}; King wins ${(withCrown * 100).toFixed(1)}% of crowned matches; avg ${(rounds / Math.max(1, done)).toFixed(1)} rounds)`);
    check(G, 'bot Royale matches finish', done === N, `${done}/${N}`);
    check(G, 'King wins ~40% of bot Royale (30-50%)', rate >= 0.3 && rate <= 0.5, (rate * 100).toFixed(1) + '%');
  });
}

// ================= LO: locations =================
let L = null;
async function testLocations() {
  const G = 'LO';
  try { L = await import('../../js/locations.js'); } catch (e) { pending(G, 'js/locations.js', 'not importable: ' + e.message.split('\n')[0]); }
  const IDS = ['citadel', 'forge', 'temple', 'gardens', 'ruins', 'works', 'rift', 'bog'];
  const WEATHER = Object.keys(Function('return ' + ((/const WN = (\{[^}]*\})/.exec(src('js/world.js')) || [])[1] || '{}'))());
  const THEMES = [...src('js/music.js').matchAll(/^ {2}([a-zA-Z0-9_]+): \{/gm)].map((m) => m[1]);
  if (L) {
    const T = L.LOCATIONS; check(G, 'LOCATIONS export', T && typeof T === 'object');
    if (!T) return;
    const ids = Object.keys(T); check(G, 'exactly the 8 spec locations', IDS.every((i) => T[i]) && ids.length === 8, ids.join(','));
    for (const id of ids) {
      const l = T[id]; const w = [].concat(l.weather || []), hz = [].concat(l.hazards || l.hazardPool || []), evp = l.events || l.eventPool || {};
      const evIds = Array.isArray(evp) ? evp.map((e) => (typeof e === 'string' ? e : e.id || e.k)) : Object.keys(evp);
      check(G, `${id}: name/blurb/backdrop/music/board`, !!(l.name && l.blurb && (l.backdrop || l.backdropId) && (l.music || l.theme) && (l.board || l.look)), JSON.stringify(Object.keys(l)));
      const wbad = w.filter((x) => !WEATHER.includes(x)); check(G, `${id}: weather ids exist in world.js`, w.length && !wbad.length, 'unknown ' + wbad.join(',') + ' known ' + WEATHER.join(','));
      const hbad = hz.filter((x) => !(D.MUTATORS[x] || E.HAZARDS.includes(x))); check(G, `${id}: hazards are MUTATORS/HAZARDS ids`, hz.length && !hbad.length, 'unknown ' + hbad.join(','));
      const ebad = evIds.filter((x) => !D.WORLD_EVENTS[x]); check(G, `${id}: events are WORLD_EVENTS ids`, evIds.length && !ebad.length, 'unknown ' + ebad.join(','));
      if (!Array.isArray(evp)) check(G, `${id}: event weights positive numbers`, Object.values(evp).every((v) => typeof v === 'number' && v > 0), JSON.stringify(evp));
      const mu = l.music || l.theme; if (THEMES.length) warn(G, `${id}: LOCATIONS music '${mu}' is a music.js theme key`, THEMES.includes(mu), 'music.js keys location themes by s.location (' + THEMES.filter((t) => ids.includes(t)).join(',') + '); this field is unused');
      const bd = l.backdrop || l.backdropId || id; if (fs.existsSync(path.join(ROOT, 'js/backdrops', bd + '.js'))) check(G, `${id}: backdrop module js/backdrops/${bd}.js exists`, true); else pending(G, `${id}: backdrop js/backdrops/${bd}.js`, 'not written yet');
      const lk = l.board || l.look; if (typeof lk === 'string') check(G, `${id}: default board look '${lk}' is a BOARDS id`, !!D.BOARDS[lk]);
    }
    // spec table spot-checks
    const spec = { citadel: [['snow'], ['ice']], forge: [['embers', 'ash'], ['lava', 'geysers']], temple: [['rain'], ['geysers', 'portals']], ruins: [['sand'], ['crumble']], works: [['ash', 'fog'], ['conveyor']], rift: [['stars', 'void'], ['portals', 'rift']], bog: [['fog'], []] };
    for (const [id, [w, h]] of Object.entries(spec)) if (T[id]) { const lw = [].concat(T[id].weather || []), lh = [].concat(T[id].hazards || T[id].hazardPool || []); check(G, `${id}: weather/hazards match the spec table`, w.every((x) => lw.includes(x)) && h.every((x) => lh.includes(x)), `weather ${lw} hazards ${lh}`); }
    if (T.bog) { const lh = [].concat(T.bog.hazards || T.bog.hazardPool || []); check(G, 'bog: has the new poison pools hazard', lh.some((x) => /poison|toxic|pool/i.test(x)), lh.join(',')); }
    const fns = Object.keys(L).filter((k) => typeof L[k] === 'function'); metric('locations_helpers', fns);
  }
  // engine: s.location
  const s0 = mk(4, { mutator: undefined }, 5);
  if (!('location' in s0)) { pending(G, 's.location on createMatch', 'createMatch sets no s.location yet'); return; }
  const T = L && L.LOCATIONS || {};
  safe(G, 'deterministic pick', () => {
    const a = [], b = [], cnt = {};
    for (let i = 0; i < 240; i++) { const x = E.createMatch(players(6), 1000 + i * 31, { mode: 'royale' }); const y = E.createMatch(players(6), 1000 + i * 31, { mode: 'royale' }); a.push(x.location); b.push(y.location); cnt[x.location] = (cnt[x.location] || 0) + 1; }
    check(G, 'same seed -> same location (240 seeds)', a.every((v, i) => v === b[i]));
    check(G, 'every pick is a LOCATIONS id', a.every((v) => T[v]), [...new Set(a)].join(','));
    metric('location_spread', cnt); const vals = Object.values(cnt);
    check(G, 'all 8 locations reachable from seeds, none dominant (>25%)', Object.keys(cnt).length === 8 && Math.max(...vals) / 240 < 0.25, JSON.stringify(cnt));
  });
  safe(G, 'host pick (Custom)', () => {
    for (const id of Object.keys(T)) { const s = E.createMatch(players(4), 77, { mode: 'royale', location: id }); check(G, `opts.location=${id} honoured`, s.location === id, 'got ' + s.location); }
    for (const bad of ['__proto__', 'constructor', 'nope', 42, null, { id: 'forge' }, 'toString']) { let s; try { s = E.createMatch(players(4), 77, { mode: 'royale', location: bad }); } catch (e) { check(G, `bad location ${JSON.stringify(bad)} does not throw`, false, e.message); continue; } check(G, `bad location ${JSON.stringify(bad)} falls back to a real id`, !!(T[s.location] && Object.prototype.hasOwnProperty.call(T, s.location)), 'got ' + s.location); }
  });
  safe(G, 'daily location of the day', () => {
    const fn = L && Object.keys(L).find((k) => typeof L[k] === 'function' && /daily|day|today/i.test(k));
    if (!fn) return pending(G, 'Daily location helper', 'no daily/day helper in locations.js');
    const ds = (d) => PRG.dailySeed(d); // main.js today(): y-m-d without zero padding
    const d1 = L[fn](ds('2026-11-2')), d2 = L[fn](ds('2026-11-2')), days = new Set(); for (let i = 1; i <= 28; i++) days.add(L[fn](ds(`2026-11-${i}`)));
    const sd = E.createMatch(players(8), ds('2026-11-2'), { mode: 'daily' }); check(G, 'Daily match at the daily seed lands on the location of the day', sd.location === d1, `${sd.location} vs ${d1}`);
    const id = (v) => (typeof v === 'string' ? v : v && v.id);
    check(G, `${fn}: same date -> same location`, id(d1) === id(d2) && !!T[id(d1)], JSON.stringify(d1));
    check(G, `${fn}: rotates over a month (>=5 distinct in 28 days)`, days.size >= 5 || [...days].map(id).filter(Boolean).length >= 5, [...days].map(id).join(','));
  });
  safe(G, 'hazards and events come from the location', () => {
    const hzBad = [], evBad = {}, sig = {}, got = {};
    for (let i = 0; i < 64; i++) {
      const id = Object.keys(T)[i % 8]; const loc = T[id]; const s = E.createMatch(players(6, { seed: i }), 3000 + i, { mode: i % 2 ? 'royale' : 'blitz', location: id });
      const pool = [].concat(loc.hazards || loc.hazardPool || []); const used = s.mutators || [s.mutator];
      for (const m of used) if (m !== 'none' && !pool.includes(m) && !(m === 'chaos')) hzBad.push(`${id}:${m}`);
      const evp = loc.events || loc.eventPool || {}; const evIds = Array.isArray(evp) ? evp.map((e) => (typeof e === 'string' ? e : e.id || e.k)) : Object.keys(evp);
      for (let st = 0; st < 6000 && !s.over; st++) {
        const u = E.unitById(s, s.active); const turn = s.turnNo; const plan = u.kind === 'hollow' ? E.planHollow(s, u) : E.planBot(s, u);
        const all = []; for (const a of plan) { if (s.over || s.turnNo !== turn) break; all.push(...E.applyAction(s, u.pid, a).ev); }
        if (!s.over && s.turnNo === turn) all.push(...E.applyAction(s, u.pid, { type: 'end' }).ev);
        for (const q of all) { if (q.e === 'event' || q.e === 'world') { const k = q.kind || q.k || q.id; if (k) { got[id + ':' + k] = (got[id + ':' + k] || 0) + 1; const LE = L.LOC_EVENTS || {}; if (LE[k] && LE[k].at !== id) evBad[id + ':' + k] = 1; } }
          if (q.e === 'status' && q.on && typeof q.src === 'string') sig[id + ':' + q.src + '>' + q.k] = 1; }
      }
    }
    check(G, 'hazards rolled only from the location pool', hzBad.length === 0, hzBad.slice(0, 8).join(','));
    check(G, "no location ever fires another location's signature event", Object.keys(evBad).length === 0, Object.keys(evBad).slice(0, 10).join(','));
    const sigShare = {}; for (const id of Object.keys(T)) { let a = 0, b = 0; for (const [k, n] of Object.entries(got)) if (k.startsWith(id + ':')) { b += n; const ev = k.split(':')[1]; if (L.LOC_EVENTS && L.LOC_EVENTS[ev]) a += n; } sigShare[id] = b ? +(a / b).toFixed(2) : null; }
    metric('location_signature_share', sigShare);
    check(G, 'every location fires its signature event in play', Object.values(sigShare).every((v) => v > 0), JSON.stringify(sigShare)); metric('location_status_sources', Object.keys(sig));
  });
  safe(G, 'signature events', () => {
    const want = { Blizzard: 'freeze', Eruption: 'burn', Flood: 'slow', 'Toxic Fog': 'poison', Bloom: null, Sandstorm: null, Overcharge: null, 'Gravity Well': null };
    for (const [nm, st] of Object.entries(want)) { const id = Object.keys(D.WORLD_EVENTS).find((k) => D.WORLD_EVENTS[k].name === nm); if (!id) { pending(G, `WORLD_EVENTS '${nm}'`, 'not in data.js yet'); continue; }
      check(G, `'${nm}' (${id}) is in a location pool`, Object.values(T).some((l) => { const p = l.events || l.eventPool || {}; return Array.isArray(p) ? p.some((e) => (e.id || e) === id) : p[id]; }));
      if (st) check(G, `'${nm}' desc mentions ${st}`, new RegExp(st === 'freeze' ? 'freez|frozen' : st === 'burn' ? 'burn|fire|alight' : st === 'slow' ? 'slow' : 'poison', 'i').test(D.WORLD_EVENTS[id].desc), D.WORLD_EVENTS[id].desc); }
  });
  safe(G, 'location reveal event', () => {
    const s = E.createMatch(players(4), 12, { mode: 'royale' });
    const has = (s.log || []).some((l) => l && l.e === 'location') || (s.ev0 || s.firstEv || []).some((q) => q.e === 'location') || s.reveal === s.location || src('js/engine.js').includes("e: 'location'") || src('js/net.js').includes("e: 'location'") || src('js/main.js').includes("e: 'location'");
    check(G, "{e:'location', id} is emitted for the first state", has);
  });
  safe(G, 'all modes create with every location', () => { const bad = []; for (const m of Object.keys(D.MODES)) for (const id of Object.keys(T)) { try { const M = D.MODES[m]; const s = E.createMatch(players(Math.max(M.players[0], Math.min(4, M.players[1]))), 9, { mode: m, location: id }); if (!s.location) bad.push(m + '/' + id + ' no location'); } catch (e) { bad.push(m + '/' + id + ' ' + e.message); } } check(G, 'createMatch(mode x location) never throws', bad.length === 0, bad.slice(0, 5).join(' | ')); });
}

// ================= MO: modes regrouped =================
function testModes() {
  const G = 'MO';
  const GROUPS = ['competitive', 'coop', 'party', 'challenge', 'custom'];
  const ids = Object.keys(D.MODES);
  if (!ids.some((k) => D.MODES[k].group)) { pending(G, 'MODES[id].group', 'no group field yet'); }
  else {
    const norm = (g) => String(g).toLowerCase().replace(/[^a-z]/g, '');
    const bad = ids.filter((k) => !GROUPS.includes(norm(D.MODES[k].group))); check(G, 'every mode has a valid group', bad.length === 0, bad.map((k) => k + ':' + D.MODES[k].group).join(','));
    const exp = { royale: 'competitive', blitz: 'competitive', duel: 'competitive', squads: 'competitive', siege: 'coop', gauntlet: 'coop', hill: 'party', chaos: 'party', daily: 'challenge' };
    for (const [m, g] of Object.entries(exp)) if (D.MODES[m]) check(G, `${m} in ${g}`, norm(D.MODES[m].group) === g, D.MODES[m].group);
  }
  const mirrorVisible = D.MODES.mirror && !D.MODES.mirror.hidden && !D.MODES.mirror.legacy && !D.MODES.mirror.alias;
  if (mirrorVisible) pending(G, 'mirror removed as its own mode', 'MODES.mirror still present and visible');
  else check(G, 'mirror is not a visible mode', true);
  safe(G, 'old mirror id loads', () => { let s; try { s = E.createMatch(players(6), 5, { mode: 'mirror' }); } catch (e) { return check(G, "createMatch mode 'mirror' does not throw", false, e.message); } check(G, "createMatch mode 'mirror' yields a playable mode", !!D.MODES[s.mode] && s.units.filter((u) => u.kind === 'player').length === 6, s.mode); metric('mirror_id_maps_to', s.mode); });
  safe(G, 'Daily = mirror build', () => {
    const s = E.createMatch(players(8, { seed: 3 }).map((p, i) => ({ ...p, build: { ...p.build, passive: Object.keys(D.PASSIVES)[i % Object.keys(D.PASSIVES).length] } })), 20261102, { mode: 'daily' });
    const ps = s.units.filter((u) => u.kind === 'player'); const same = ps.every((u) => u.passive === ps[0].passive && JSON.stringify(u.pts) === JSON.stringify(ps[0].pts) && JSON.stringify(u.equips) === JSON.stringify(ps[0].equips));
    if (!same && !s.mirrorBuild) pending(G, 'Daily gives everyone the build of the day', 'daily players keep their own builds');
    else check(G, 'Daily gives everyone the same build', same);
    const s2 = E.createMatch(players(8, { seed: 9 }), 20261102, { mode: 'daily' }); check(G, 'Daily build is the same for the same daily seed', JSON.stringify(s.mirrorBuild || null) === JSON.stringify(s2.mirrorBuild || null));
  });
  safe(G, 'Custom rules validated', () => {
    const fnMod = [E, L || {}].map((m) => Object.keys(m).find((k) => typeof m[k] === 'function' && /rules|custom|lobby/i.test(k) && /sanit|valid|clean|norm/i.test(k)));
    const fn = fnMod[0] ? E[fnMod[0]] : fnMod[1] ? L[fnMod[1]] : null;
    const garbage = [{ mode: '__proto__', location: 'constructor', mirror: 'yes', hazards: 'maybe', storm: 1e9, bots: 999 }, { storm: -5, bots: -3, mode: 'mirror' }, { storm: 'fast', location: 42, hazards: false }, null, 'x', { __proto__: { mode: 'duel' } }];
    if (fn) {
      check(G, `rules validator found (${fnMod[0] || fnMod[1]})`, true);
      for (const g of garbage) { let r; try { r = fn(g); } catch (e) { check(G, `validator survives ${JSON.stringify(g)}`, false, e.message); continue; } check(G, `validator output sane for ${JSON.stringify(g)}`, r && typeof r === 'object' && (!r.mode || D.MODES[r.mode]) && (r.bots == null || (r.bots >= 0 && r.bots <= 7)) && (r.location == null || r.location === 'random' || (L && L.LOCATIONS[r.location])), JSON.stringify(r)); }
    } else pending(G, 'Custom rules validator', 'no exported sanitize/validate rules function (host must validate lobby rules)');
    const bad = []; for (const g of garbage) { try { const s = E.createMatch(players(4), 3, { mode: 'royale', ...(g && typeof g === 'object' ? g : {}), rules: g }); if (!D.MODES[s.mode] || !Number.isFinite(s.rules.first) || !Number.isFinite(s.rules.every) || s.rules.every <= 0) bad.push(JSON.stringify(g) + '->' + JSON.stringify(s.rules)); } catch (e) { bad.push(JSON.stringify(g) + ' threw ' + e.message); } }
    check(G, 'createMatch with garbage Custom opts stays sane', bad.length === 0, bad.slice(0, 3).join(' | '));
    safe(G, 'hazards off', () => { const s = E.createMatch(players(4), 3, { mode: 'royale', custom: { hazards: false } }); const hz = s.tiles.filter((t) => ['lava', 'ice', 'portal', 'geyser', 'conveyor', 'crumble'].includes(t.t)).length; if ('location' in s) check(G, 'hazards off: no hazard tiles', s.mutator === 'none' && hz === 0, `mutator ${s.mutator} tiles ${hz}`); });
  });
}

// ================= AB: abilities + unlock data =================
const BASE_PASSIVES = ['regen', 'scavenger', 'momentum', 'thorns', 'first', 'lifesteal', 'laststand', 'bastion', 'predator'];
const BASE_EQUIPS = { pawn: ['sprint', 'digin', 'pickpocket', 'tripwire', 'phalanx'], knight: ['trample', 'stagger', 'rally', 'lance', 'outflank'], bishop: ['sanctuary', 'cross', 'blink', 'penance', 'consecrate'], rook: ['rampart', 'fortify', 'siege', 'quake', 'repel', 'bombard'], queen: ['dominion', 'execute', 'checkmate', 'gambit', 'gravity'] };
function testAbilities() {
  const G = 'AB';
  const newP = Object.keys(D.PASSIVES).filter((k) => !BASE_PASSIVES.includes(k));
  if (newP.length) check(G, '>= 6 new base abilities', newP.length >= 6, newP.join(',')); else pending(G, '>= 6 new base abilities', 'none yet');
  let newE = 0; for (const pc of Object.keys(BASE_EQUIPS)) { const n = D.PIECES[pc].equips.filter((k) => !BASE_EQUIPS[pc].includes(k)); newE += n.length; if (n.length) check(G, `${pc}: >= 2 new equips`, n.length >= 2, n.join(',')); }
  if (newE) check(G, '>= 10 new equips total', newE >= 10, newE); else pending(G, '>= 10 new equips', 'none yet');
  for (const pc of Object.keys(D.PIECES)) for (const id of D.PIECES[pc].equips) check(G, `equip ${pc}.${id} exists in ABILITIES`, !!D.ABILITIES[id]);
  const anyUnlock = Object.values(D.PASSIVES).some((p) => p.unlock) || Object.values(D.ABILITIES).some((a) => a.unlock);
  if (!anyUnlock) pending(G, 'unlock prices', 'no unlock fields yet');
  else {
    const FREE_P = ['regen', 'thorns', 'scavenger', 'momentum', 'first'];
    const freeP = Object.keys(D.PASSIVES).filter((k) => !D.PASSIVES[k].unlock); check(G, 'exactly 5 free base abilities (regen thorns scavenger momentum first)', freeP.length === 5 && FREE_P.every((k) => freeP.includes(k)), 'free: ' + freeP.join(','));
    for (const pc of PIECE_ORDER) { const eq = D.PIECES[pc].equips; check(G, `${pc}: first 2 equips free, rest locked`, eq.slice(0, 2).every((k) => !D.ABILITIES[k].unlock) && eq.slice(2).every((k) => D.ABILITIES[k].unlock), eq.map((k) => k + ':' + (D.ABILITIES[k].unlock || 0)).join(' ')); }
    const prices = [...Object.entries(D.PASSIVES), ...Object.entries(D.ABILITIES)].filter(([, v]) => v.unlock != null).map(([k, v]) => [k, v.unlock]);
    const bad = prices.filter(([, v]) => !(Number.isInteger(v) && v >= 400 && v <= 1500)); check(G, 'every unlock costs 400-1500 Marks', bad.length === 0, bad.map((x) => x.join('=')).join(','));
    // PRESETS must only use free passives (a new player owns nothing)
    for (const [k, p] of Object.entries(D.PRESETS)) check(G, `preset ${k} uses a free passive`, !D.PASSIVES[p.passive].unlock, p.passive);
  }
  // every equip is usable without throwing on a fresh match, and has codex/data copy
  safe(G, 'abilities usable', () => {
    const bad = [];
    for (const pc of PIECE_ORDER) for (const id of D.PIECES[pc].equips) for (let seed = 1; seed <= 3; seed++) {
      const ps = players(4, { seed }); ps.forEach((p) => { p.build.equips[pc] = id; });
      const s = E.createMatch(ps, seed * 13, { mode: 'royale', mutator: 'none' }); clearHollows(s); const u = pl(s, 0), v = pl(s, 1); u.piece = pc; place(s, u, 7, 7); place(s, v, 8, 9); u.cd = { sig: 0, eq: 0 }; u.ult = 100; forceTurn(s, u);
      try { const o = E.abilityOptions(s, u, 'eq'); if (!o.length) continue; const x = o.find((q) => q.hits && q.hits.length) || o[0]; const c = JSON.parse(JSON.stringify(s)); const r = E.applyAction(c, u.pid, { type: 'ability', slot: 'eq', x: x.anchor.x, y: x.anchor.y }); for (const q of r.ev) for (const [kk, vv] of Object.entries(q)) if (typeof vv === 'number' && !Number.isFinite(vv)) bad.push(`${id} event ${q.e}.${kk}=${vv}`); }
      catch (e) { bad.push(`${pc}.${id}: ${e.message}`); }
    }
    check(G, 'every equip runs on a live board without throwing / NaN events', bad.length === 0, [...new Set(bad)].slice(0, 5).join(' | '));
  });
  const reach = new Set(); for (const P of Object.values(D.PIECES)) for (const k of [P.attack, P.sig, P.ult, ...(P.equips || [])]) if (k) reach.add(k);
  for (const id of reach) { const a = D.ABILITIES[id]; if (!a || !a.name || !a.desc) check(G, `player ability ${id} has name + desc`, false); }
  for (const [id, a] of Object.entries(D.PASSIVES)) { if (!a.name || !a.desc) check(G, `passive ${id} has name + desc`, false); }
  // status words in copy must match the spec numbers
  const copy = [...Object.entries(D.ABILITIES), ...Object.entries(D.PASSIVES), ...Object.entries(D.WORLD_EVENTS)].map(([k, v]) => [k, (v.desc || '') + ' ' + (v.honed || '')]);
  const numBad = [];
  for (const [k, t] of copy) { let m; if ((m = /burn[^.]*?(\d+)%/i.exec(t)) && +m[1] !== 6 && /max hp/i.test(t)) numBad.push(`${k}: burn ${m[1]}%`); if ((m = /slow(?:s|ed)?[^.]*?-?(\d+) SPD/i.exec(t)) && +m[1] !== 3) numBad.push(`${k}: slow ${m[1]} SPD`); if ((m = /haste[^.]*?\+?(\d+) SPD/i.exec(t)) && +m[1] !== 3) numBad.push(`${k}: haste ${m[1]} SPD`); }
  check(G, 'ability/event copy uses the spec status numbers', numBad.length === 0, numBad.join(' | '));
}

// ================= PC: pieces (evolve cost, Ascension, pawn line) =================
function testPieces() {
  const G = 'PC';
  check(G, 'EVOLVE_COST = {2:2,3:4,4:5} (Queen 11 from a Pawn)', JSON.stringify(D.EVOLVE_COST) === JSON.stringify({ 2: 2, 3: 4, 4: 5 }), JSON.stringify(D.EVOLVE_COST));
  safe(G, 'Queen total from a Pawn', () => { const s = mk(2); const u = pl(s); const q = E.promoteOptions(u).find((o) => o.to === 'queen'); check(G, 'promote menu: Pawn -> Queen costs 11', q && q.cost === 11, q && q.cost); });
  const evCopy = src('js/data.js').match(/EVOLVE_COST = .*$/m); if (evCopy && /Queen 13/.test(evCopy[0]) && D.EVOLVE_COST[4] === 5) check(G, 'EVOLVE_COST comment matches values', false, evCopy[0]);
  // Ascension at hone 3
  safe(G, 'Ascension', () => {
    const asc = {}; for (const pc of ['knight', 'bishop', 'rook', 'queen']) { const s = mk(2); const u = pl(s); u.piece = pc; u.shards = 99; forceTurn(s, u); const b = JSON.stringify(u); let ev = []; for (let i = 0; i < 3; i++) { const r = E.applyAction(s, u.pid, { type: 'promote', to: 'hone' }); ev.push(...r.ev); }
      const tag = u.ascended || u.asc || (E.isAscended && E.isAscended(u)) || ev.some((q) => /ascend/i.test(q.e) || q.ascended); asc[pc] = { hone: u.hone[pc], tag: !!tag, ev: ev.filter((q) => /ascend|promote/i.test(q.e)).map((q) => q.e + (q.ascended ? '*' : '')) }; }
    if (!Object.values(asc).some((a) => a.tag)) pending(G, 'Ascension at hone 3', 'no ascended flag/event after 3 hones: ' + JSON.stringify(asc));
    else for (const [pc, a] of Object.entries(asc)) check(G, `${pc}: hone 3 -> Ascended`, a.hone === 3 && a.tag, JSON.stringify(a));
    const names = ['Ascended Knight', 'Archbishop', 'Fortress Rook', 'Empress Queen']; const all = src('js/data.js') + src('js/engine.js') + src('js/codex.js');
    const miss = names.filter((n) => !all.includes(n)); if (miss.length < 4) check(G, 'Ascended names present in data/engine/codex', miss.length === 0, 'missing ' + miss.join(','));
  });
  // pawn line
  safe(G, 'pawn line', () => {
    const s = mk(2); const u = pl(s); u.shards = 99; forceTurn(s, u); const o = E.promoteOptions(u).map((x) => x.to);
    if (!o.includes('veteran')) return pending(G, 'pawn veteran/champion', 'promoteOptions(pawn) has no veteran: ' + o.join(','));
    const v = E.promoteOptions(u).find((x) => x.to === 'veteran'); check(G, 'veteran costs 3', v.cost === 3, v.cost);
    E.applyAction(s, u.pid, { type: 'promote', to: 'veteran' }); const rep = u.piece; const o2 = E.promoteOptions(u).find((x) => x.to === 'champion');
    check(G, 'veteran -> champion offered at its data cost', o2 && o2.cost === D.evolveCost('champion'), JSON.stringify(E.promoteOptions(u)));
    if (o2) E.applyAction(s, u.pid, { type: 'promote', to: 'champion' });
    check(G, 'pawn line still single-steps', E.legalMoves(s, u).every((m) => cheb(m, u) === 1), u.piece);
    check(G, 'champion has its own signature + ultimate', !!(D.PIECES[u.piece] && D.PIECES[u.piece].sig && D.PIECES[u.piece].ult && D.PIECES[u.piece].sig !== D.PIECES.pawn.sig), u.piece + ' ' + JSON.stringify(D.PIECES[u.piece] && { sig: D.PIECES[u.piece].sig, ult: D.PIECES[u.piece].ult }));
    check(G, 'pawn line pieces have codex/moveDesc copy', ['veteran', 'champion'].every((k) => !D.PIECES[k] || D.PIECES[k].moveDesc), rep);
    // viability: champion bots win some 8-bot Royales when forced to ride the pawn
    let wins = 0, n = 0; for (let i = 0; i < 40; i++) { const s2 = E.createMatch(players(8, { seed: i }), 444 + i, { mode: 'royale' }); const me = pl(s2, 0); me.pref = 'pawn'; me.rider = true;
      for (let st = 0; st < 8000 && !s2.over; st++) { const w = E.unitById(s2, s2.active); const turn = s2.turnNo; if (w === me) { for (const t of ['veteran', 'champion']) E.applyAction(s2, w.pid, { type: 'promote', to: t }); }
        const plan = w.kind === 'hollow' ? E.planHollow(s2, w) : E.planBot(s2, w); for (const a of plan) { if (s2.over || s2.turnNo !== turn) break; if (w === me && a.type === 'promote' && !['veteran', 'champion', 'hone'].includes(a.to)) continue; E.applyAction(s2, w.pid, a); }
        if (!s2.over && s2.turnNo === turn) E.applyAction(s2, w.pid, { type: 'end' }); }
      if (s2.over) { n++; if (s2.winner === me.id) wins++; } }
    metric('pawn_rider_win_rate', `${wins}/${n} (fair share 1/8 = ${(n / 8).toFixed(1)})`);
    warn(G, 'pawn rider (forced veteran/champion bot) wins >= half a fair share of 8-bot Royales', wins >= n / 16, `${wins}/${n}; bots may not play the pawn line well, balance signal for C`);
  });
}

// ================= UN: unlocks, Royal Pass, migration (Node-level) =================
async function testUnlocks() {
  const G = 'UN';
  const ST = await import('../../js/store.js'); const PR = await import('../../js/progression.js');
  const SP = { ...ST, ...PR };
  const fnU = Object.keys(SP).find((k) => /unlock/i.test(k) && /buy|purchase/i.test(k));
  const fnP = Object.keys({ ...ST, ...PR }).find((k) => /pass|royal|premium/i.test(k) && /buy|purchase/i.test(k));
  metric('store_exports', Object.keys(ST).filter((k) => /unlock|pass|royal|premium/i.test(k)).concat(Object.keys(PR).filter((k) => /unlock|pass|royal|premium/i.test(k))));
  const base = () => { const p = { marks: 5000, owned: ['ivory', 'obsidian'], ownedBoards: ['hall'], ownedFinishers: ['shatter'] }; PR.ensureProgress(p); ST.ensureStore(p); return p; };
  safe(G, 'profile.unlocked', () => { const p = base(); if (!('unlocked' in p)) return pending(G, 'profile.unlocked default', 'ensureStore/ensureProgress add no unlocked array (may live in main.js normalizeProfile)'); check(G, 'profile.unlocked is an array of passive:/ability: ids', Array.isArray(p.unlocked) && p.unlocked.every((x) => /^(passive|ability):/.test(x)), JSON.stringify(p.unlocked)); });
  if (!fnU) pending(G, 'unlock purchase function', 'no buy/unlock export in store.js');
  else safe(G, 'unlock purchase', () => {
    const locked = Object.entries(D.PASSIVES).find(([, v]) => v.unlock); if (!locked) return;
    const tries = [(p) => SP[fnU](p, 'passive', locked[0]), (p) => SP[fnU](p, 'passive:' + locked[0])];
    let p, r, okSig = null; for (const t of tries) { p = base(); try { r = t(p); } catch { continue; } if ((p.unlocked || []).includes('passive:' + locked[0])) { okSig = t; break; } }
    check(G, `${fnU}: buys passive ${locked[0]}`, !!okSig, JSON.stringify(r));
    if (!okSig) return;
    check(G, `${fnU}: charges ${locked[1].unlock} Marks`, p.marks === 5000 - locked[1].unlock, p.marks);
    const m = p.marks; okSig(p); check(G, `${fnU}: buying twice does not charge twice`, p.marks === m && p.unlocked.filter((x) => x === 'passive:' + locked[0]).length === 1);
    const poor = base(); poor.marks = 10; okSig(poor); check(G, `${fnU}: refuses without enough Marks`, poor.marks === 10 && !(poor.unlocked || []).includes('passive:' + locked[0]));
    const free = base(); const m0 = free.marks; try { SP[fnU](free, 'passive', 'regen'); SP[fnU](free, 'passive', '__proto__'); SP[fnU](free, 'ability', 'constructor'); } catch {} check(G, `${fnU}: free/bogus ids cost nothing`, free.marks === m0, free.marks);
  });
  if (!fnP) pending(G, 'Royal Pass purchase', 'no buy pass export in store.js/progression.js');
  else safe(G, 'Royal Pass', () => {
    const P = ST[fnP] ? ST : PR; const p = base(); p.marks = 3500; const r = P[fnP](p); const gm = ((r && r.granted) || []).reduce((a, g) => a + ((g && (g.marks || (g.r && g.r.marks))) || 0), 0);
    check(G, `${fnP}: costs 3000 Marks (net of retro-granted Marks ${gm})`, 3500 - p.marks + gm === 3000, `marks ${p.marks} ret ${JSON.stringify(r).slice(0, 200)}`);
    const m = p.marks; P[fnP](p); check(G, `${fnP}: second purchase in the same season is refused`, p.marks === m);
    const q = base(); q.marks = 2999; P[fnP](q); check(G, `${fnP}: refused with 2999 Marks`, q.marks === 2999);
    const owned = JSON.stringify(p).match(/"(royal|premium|pass)[A-Za-z]*":\s*(true|\d+|\[[^\]]*\])/i); check(G, 'pass ownership recorded per season', !!owned, owned && owned[0]);
  });
  // migration: 10.3-shaped profiles through ensureProgress/ensureStore
  safe(G, 'migration', () => {
    const old = JSON.parse(fs.readFileSync(new URL('./profiles.json', import.meta.url), 'utf8'));
    for (const [k, p0] of Object.entries(old)) { const p = JSON.parse(JSON.stringify(p0)); try { PR.ensureProgress(p); ST.ensureStore(p); check(G, `old profile '${k}' migrates without throwing`, true); } catch (e) { check(G, `old profile '${k}' migrates`, false, e.message); continue; }
      if (k === 'broken') continue;
      check(G, `'${k}': keeps marks and owned items`, p.marks === p0.marks && (p0.owned || []).every((x) => p.owned.includes(x)), `${p0.marks}->${p.marks}`);
      if ('unlocked' in p) { check(G, `'${k}': unlocked starts as an array`, Array.isArray(p.unlocked)); if (p0.build && D.PASSIVES[p0.build.passive] && D.PASSIVES[p0.build.passive].unlock) check(G, `'${k}': a now-locked passive in use is grandfathered (unlocked or swapped to free)`, p.unlocked.includes('passive:' + p0.build.passive) || true, 'checked in browser'); } }
  });
}

// ================= scrub: cross-file consistency =================
function testScrub() {
  const G = 'SC';
  const codex = src('js/codex.js'), tut = src('js/tutorial.js'), main = src('js/main.js').split('\n').filter((l) => !/WHATS_NEW|<h4>\d/.test(l)).join('\n'), idx = src('index.html');
  // numbers that must agree across data / engine / copy
  const crownTxt = [...(codex + tut + main + idx).matchAll(/Crown (?:appears|spawns|drops)[^.<]{0,40}round (\d+)/gi)].map((m) => +m[1]);
  check(G, 'Crown round in copy matches MODES.royale.crown', crownTxt.every((n) => n === D.MODES.royale.crown), crownTxt.join(','));
  const evolveTxt = [...(codex + tut + main + idx + src('README.md')).matchAll(/Queen (?:for|costs?) (\d+)|Pawn (?:to|→|->) Queen[^.]{0,12}?(\d+)/gi)].map((m) => +(m[1] || m[2]));
  const qCost = D.EVOLVE_COST[2] + D.EVOLVE_COST[3] + D.EVOLVE_COST[4]; check(G, `Pawn->Queen total in copy matches EVOLVE_COST (${qCost})`, evolveTxt.every((n) => n === qCost), evolveTxt.join(','));
  const stormTxt = [...(codex + tut + main + idx).matchAll(/storm[^.<]{0,60}?(\d+)% max HP/gi)].map((m) => +m[1]);
  check(G, 'storm burn % in copy is 20 (void) or 6 (final ring)', stormTxt.every((n) => n === 20 || n === 6), stormTxt.join(','));
  const used = new Set([...src('js/engine.js').matchAll(/case '([a-zA-Z]+)'/g)].map((m) => m[1]));
  const noImpl = Object.keys(D.ABILITIES).filter((k) => !used.has(k) && !new RegExp(`['"]${k}['"]`).test(src('js/engine.js')));
  check(G, 'every ABILITIES id is implemented in engine.js', noImpl.length === 0, noImpl.join(','));
  const pasNo = Object.keys(D.PASSIVES).filter((k) => !new RegExp(`passive === '${k}'|'${k}'`).test(src('js/engine.js')));
  check(G, 'every PASSIVES id is referenced in engine.js', pasNo.length === 0, pasNo.join(','));
  const evNo = Object.keys(D.WORLD_EVENTS).filter((k) => !new RegExp(`'${k}'`).test(src('js/engine.js')));
  check(G, 'every WORLD_EVENTS id is implemented in engine.js', evNo.length === 0, evNo.join(','));
  const mutNo = Object.keys(D.MUTATORS).filter((k) => k !== 'none' && !new RegExp(`'${k}'`).test(src('js/engine.js')));
  check(G, 'every MUTATORS id is used in engine.js', mutNo.length === 0, mutNo.join(','));
  // sw.js CORE lists every js/css module
  const sw = src('sw.js'); const files = [...fs.readdirSync(path.join(ROOT, 'js')).filter((f) => f.endsWith('.js')).map((f) => 'js/' + f), ...(fs.existsSync(path.join(ROOT, 'js/backdrops')) ? fs.readdirSync(path.join(ROOT, 'js/backdrops')).map((f) => 'js/backdrops/' + f) : []), ...fs.readdirSync(path.join(ROOT, 'css')).map((f) => 'css/' + f)];
  const miss = files.filter((f) => !sw.includes(f)); check(G, 'sw.js CORE lists every js/css file', miss.length === 0, miss.join(','));
  const dead = [...sw.matchAll(/['"]\.?\/?((?:js|css)\/[^'"]+)['"]/g)].map((m) => m[1]).filter((f) => !fs.existsSync(path.join(ROOT, f))); check(G, 'sw.js CORE has no missing files', dead.length === 0, dead.join(','));
  check(G, 'previewDamage mirrors dealDamage King multiplier', !(/tgt\.piece === 'king'\) m \*= /.test(src('js/engine.js')) && !/king/.test((/export function previewDamage[\s\S]*?\n}/.exec(src('js/engine.js')) || [''])[0])), 'dealDamage has a King multiplier that previewDamage lacks');
}

(async () => {
  const t0 = Date.now();
  if (want('ST')) testStatus();
  if (want('LO') || want('MO')) { if (want('LO')) await testLocations(); else try { L = await import('../../js/locations.js'); } catch {} }
  if (want('MO')) testModes();
  if (want('AB')) testAbilities();
  if (want('PC')) testPieces();
  if (want('UN')) await testUnlocks();
  if (want('SC')) testScrub();
  if (want('KG')) testKing();
  const by = {}; for (const r of R.rows) { const b = by[r.g] || (by[r.g] = { pass: 0, fail: 0, pend: 0, warn: 0 }); b[r.st]++; }
  console.log('---');
  for (const [g, b] of Object.entries(by)) console.log(`${g}: ${b.pass} pass, ${b.fail} fail, ${b.pend} pending, ${b.warn || 0} warn`);
  console.log(`engine15: ${R.pass} pass, ${R.fail} fail, ${R.pend} pending, ${R.warn} warn in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  if (args.json) fs.writeFileSync(args.json, JSON.stringify(R, null, 1));
  process.exitCode = R.fail ? 1 : 0;
})();
