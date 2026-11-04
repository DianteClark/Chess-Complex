// 17.0 (L2): leaderboard logic with no Durable Object or Worker APIs, so Node tests can drive it directly.
//  - Crown Rating: multiplayer Elo from placements (pairwise), provisional for the first 10 games, K decays with games
//  - Season points + season ids (ISO weeks starting Monday 00:00 UTC)
//  - Daily verifier: a resumable stepper that re-simulates a submitted Daily run (createMatch + applyAction, bots
//    re-planned with planBot / planHollow) in small chunks, rejecting any action the server would not have produced.
import { createMatch, applyAction, planBot, planHollow, unitById } from '../../js/engine.js';
import { MODES } from '../../js/data.js';
import { dailySetup, dailyResult } from '../../js/daily.js';

// ---------- Crown Rating ----------
export const RATING = { start: 1200, provisional: 10, kProv: 48, kHigh: 32, kLow: 16, decayGames: 90, floor: 100 };
// K for a player who has played `games` rated games before this one: 48 while provisional, then 32 sliding to 16 by
// game 90 (so new players find their level fast and veterans move slowly).
export function kFactor(games) {
  if (games < RATING.provisional) return RATING.kProv;
  const t = Math.min(1, (games - RATING.provisional) / (RATING.decayGames - RATING.provisional));
  return Math.round(RATING.kHigh - (RATING.kHigh - RATING.kLow) * t);
}
export const expected = (ra, rb) => 1 / (1 + 10 ** ((rb - ra) / 400));
// entries: [{key, r, games, place}] (place 1 = best; equal places are a draw). Returns [{key, delta, r}].
// Each player plays a virtual game against every other rated player; the sum is scaled by K/(n-1) so a match's
// total swing does not grow with the lobby size. Zero-sum when everyone has the same K.
export function rateMatch(entries) {
  const n = entries.length;
  if (n < 2) return entries.map((e) => ({ key: e.key, delta: 0, r: e.r }));
  return entries.map((a) => {
    let sum = 0;
    for (const b of entries) {
      if (b === a) continue;
      const S = a.place < b.place ? 1 : a.place > b.place ? 0 : 0.5;
      sum += S - expected(a.r, b.r);
    }
    const delta = Math.round((kFactor(a.games) / (n - 1)) * sum * 10) / 10;
    return { key: a.key, delta, r: Math.max(RATING.floor, Math.round((a.r + delta) * 10) / 10) };
  });
}
export const ratedMode = (mode, custom) => !custom && !!MODES[mode] && MODES[mode].group === 'competitive';

// ---------- Seasons ----------
// Season id = the UTC date (YYYY-MM-DD) of the Monday the week starts on. The Monday cron (10 0 * * 1) rolls over.
export function seasonId(t = Date.now()) {
  const d = new Date(t); const dow = (d.getUTCDay() + 6) % 7; // 0 = Monday
  const m = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - dow));
  return m.toISOString().slice(0, 10);
}
export const seasonEnds = (sid) => Date.parse(sid + 'T00:00:00Z') + 7 * 864e5;
// Season points for one human: placement against everyone in the match (bots included), a win bonus, and a flat
// share for co-op. Needs at least 2 verified humans in the match (checked by the caller) so bot farming earns nothing.
export function seasonPoints(mode, place, total, win) {
  const g = MODES[mode] && MODES[mode].group;
  if (g === 'coop') return win ? 40 : 15;
  if (!(total > 1) || !(place >= 1)) return 10;
  return 10 + Math.round((40 * (total - Math.min(place, total))) / (total - 1)) + (place === 1 ? 20 : 0);
}

// ---------- match record -> rated humans ----------
// rec (S2): {mid, mode, opts:{custom?}, humans:{pid:{name, cid, verified, avatar?, title?}}, result:{places:{pid:place},
// winner, rounds}, start:{players, seed, opts}}. Returns the verified, de-duplicated humans with their places.
export function verifiedSeats(rec) {
  const out = [], seen = new Set();
  const humans = (rec && rec.humans) || {};
  const places = (rec && rec.result && rec.result.places) || {};
  for (const [pid, h] of Object.entries(humans)) {
    if (!h || !h.verified || typeof h.cid !== 'string' || !/^[0-9A-Z]{10}$/.test(h.cid) || seen.has(h.cid)) continue;
    const place = Math.floor(+places[pid]);
    if (!(place >= 1)) continue;
    seen.add(h.cid);
    out.push({ pid, cid: h.cid, place, name: cleanName(h.name), avatar: cleanTok(h.avatar), title: cleanTitle(h.title) });
  }
  return out;
}
export const cleanName = (v) => (typeof v === 'string' && v.trim() ? v.replace(/[<>&"'`\u0000-\u001f]/g, '').trim().slice(0, 14) : 'Player') || 'Player';
export const cleanTitle = (v) => (typeof v === 'string' ? v.replace(/[<>&"'`\u0000-\u001f]/g, '').slice(0, 24) : '');
export const cleanTok = (v) => (typeof v === 'string' && /^[a-z0-9_-]{1,24}$/i.test(v) ? v : '');

// ---------- Daily verification ----------
// Work budget per chunk. Wall time does not advance inside a production Worker invocation (timers are coarse), so the
// chunk is bounded by work units calibrated in Node + workerd (test/lb.test.mjs reports the measured CPU):
// one applyAction ~ 0.05-0.3 ms = 1 unit, one planBot ~ 0.3-4 ms = 12 units, planHollow = 3 units. A chunk stops at
// 12 units, so it holds at most one bot plan (or 12 actions). Where the clock advances (local dev, Node) it also stops
// at maxMs. The one thing a chunk cannot split is a single planBot call (a late-game Champion leap search can take
// 10-40 ms on its own, see S1's CPU note); everything else stays under ~5 ms.
export const VERIFY = { units: 12, plan: 12, hollow: 3, act: 1, maxMs: 4, maxActions: 6000 };
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
const sameAct = (x, y) => JSON.stringify(x) === JSON.stringify(y);

// job: {day, human, actions:[[pid, a], ...]} -> a verifier state (plain object; `s` is the live engine state)
export function verifyStart(job) {
  const { players, seed, opts } = dailySetup(job.day, job.human);
  const s = createMatch(players, seed, opts);
  return { s, i: 0, plan: null, steps: 0, plans: 0, done: false, ok: false, why: '' };
}
const fail = (V, why) => { V.done = true; V.ok = false; V.why = why; return V; };
function finish(V, acts) {
  if (V.i < acts.length) return fail(V, 'extra actions after the end');
  const r = dailyResult(V.s, 'me');
  if (!r || !r.final) return fail(V, 'run not finished');
  V.done = true; V.ok = true; V.result = r; return V;
}
// Advance up to one chunk. Returns V (V.done when finished; V.ok/V.why/V.result).
export function verifyStep(V, acts, budget = VERIFY) {
  if (V.done) return V;
  const t0 = now(); let units = 0;
  const s = V.s;
  while (units < budget.units && now() - t0 < budget.maxMs) {
    if (s.over) return finish(V, acts);
    const u = unitById(s, s.active);
    if (!u) return fail(V, 'no active unit');
    if (u.kind !== 'hollow' && !u.bot) {
      // the player's own turn: take the next submitted action, which must be theirs and legal
      if (V.i >= acts.length) return finish(V, acts);
      const [pid, a] = acts[V.i];
      if (pid !== u.pid) return fail(V, `action ${V.i}: expected ${u.pid}, got ${pid}`);
      const r = applyAction(s, pid, a); units += budget.act;
      if (!r.ok) return fail(V, `action ${V.i}: illegal`);
      V.i++; V.steps++; continue;
    }
    // a bot or Hollow: the server plans it, and every action it lands must match the submitted list
    if (!u.alive) return fail(V, 'dead unit active');
    if (V.plans > 8000) return fail(V, 'too long');
    const human = s.units.find((v) => v.pid === 'me' && v.kind === 'player');
    if (V.i >= acts.length) { if (human && !human.alive) return finish(V, acts); return fail(V, 'run ends on a bot turn'); }
    if (!V.plan || V.plan.id !== u.id || V.plan.turn !== s.turnNo) {
      const steps = u.kind === 'hollow' ? planHollow(s, u) : planBot(s, u);
      units += u.kind === 'hollow' ? budget.hollow : budget.plan; V.plans++;
      V.plan = { id: u.id, turn: s.turnNo, steps, k: 0 };
      continue; // re-check the budget before stepping
    }
    const P = V.plan;
    const a = P.k < P.steps.length ? P.steps[P.k] : { type: 'end' };
    const want = JSON.parse(JSON.stringify(a));
    const r = applyAction(s, u.pid, a); units += budget.act; P.k++;
    if (r.ok) {
      const got = acts[V.i];
      if (!got || (got[0] ?? null) !== (u.pid ?? null) || !sameAct(got[1], want)) return fail(V, `action ${V.i}: bot ${u.pid} mismatch`);
      V.i++; V.steps++;
    }
    if (P.k > P.steps.length || s.over || s.active !== u.id || s.turnNo !== P.turn) V.plan = null;
  }
  return V;
}
// Validate the shape of a submission before queueing it (cheap, no engine work).
export function checkActions(actions, max = VERIFY.maxActions) {
  if (!Array.isArray(actions) || !actions.length || actions.length > max) return false;
  for (const e of actions) {
    if (!Array.isArray(e) || e.length !== 2 || (e[0] !== null && (typeof e[0] !== 'string' || e[0].length > 24)) || !e[1] || typeof e[1] !== 'object' || Array.isArray(e[1]) || typeof e[1].type !== 'string') return false;
  }
  return true;
}
