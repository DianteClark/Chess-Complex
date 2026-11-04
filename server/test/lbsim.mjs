// 17.0 (L2): simulate an honest Daily run in Node the way the phone does (GameHost: bots planned with planBot, every
// accepted action logged as [pid, action]); the human is driven by planBot too (any legal play is a valid run).
import { createMatch, applyAction, planBot, planHollow, unitById } from '../../js/engine.js';
import { dailySetup, dailyResult } from '../../js/daily.js';
export function simDaily(day, human = { name: 'Tester', skin: 'ivory' }, { humanPlan } = {}) {
  const { players, seed, opts } = dailySetup(day, { pid: 'me', ...human });
  const s = createMatch(players, seed, opts);
  const log = [];
  const act = (pid, a) => { const r = applyAction(s, pid, a); if (r.ok) log.push([pid ?? null, JSON.parse(JSON.stringify(a))]); return r.ok; }; // cloned after applying, like GameHost.log (net.js)
  let guard = 0;
  while (!s.over && guard++ < 20000) {
    const u = unitById(s, s.active); const turn = s.turnNo;
    const isHuman = u.kind !== 'hollow' && !u.bot;
    const plan = isHuman ? (humanPlan ? humanPlan(s, u) : planBot(structuredClone(s), structuredClone(u))) : u.kind === 'hollow' ? planHollow(s, u) : planBot(s, u);
    let k = 0;
    for (; k < plan.length; k++) { act(u.pid, plan[k]); if (s.over || s.active !== u.id || s.turnNo !== turn) break; }
    if (k >= plan.length && !s.over && s.active === u.id && s.turnNo === turn) act(u.pid, { type: 'end' });
  }
  return { s, log, result: dailyResult(s, 'me'), players };
}
