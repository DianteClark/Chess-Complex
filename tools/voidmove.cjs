// G 10.2: a piece that starts its turn in the storm void can still move out (solo + ?net=local host/join). Needs servers on 8141.
// Usage: NODE_PATH=$(npm root -g) node tools/voidmove.cjs
const L = require('../tests/online/lib.js');
const { chromium, sleep } = L;
const SPOT = { x: 1, y: 8 };
// Arrange a real collapse next round: ring 2 cracked, walls around SPOT on rings 1-2, our piece on SPOT.
async function arrange(host, pid) {
  return host.evaluate(({ pid, SPOT }) => {
    const S = window.__cc.session, s = S.host.s, me = s.units.find((u) => u.pid === pid);
    const occ = s.units.find((u) => u.alive && u !== me && u.x === SPOT.x && u.y === SPOT.y); if (occ) { occ.x = 8; occ.y = 8; }
    for (const u of s.units) if (u.alive && u !== me && Math.max(Math.abs(u.x - SPOT.x), Math.abs(u.y - SPOT.y)) <= 3) { u.x = 10; u.y = 10 - u.id; }
    me.x = SPOT.x; me.y = SPOT.y; me.hp = Math.max(me.hp, 40);
    const walls = [[0, 7], [1, 7], [2, 7], [2, 8], [2, 9], [1, 9], [0, 9], [3, 8]];
    for (const [x, y] of walls) s.tiles[y * 16 + x] = { t: 'wall' };
    s.items = s.items.filter((i) => i.k === 'crown');
    s.storm.ring = 2; s.storm.crack = true; s.round = s.rules.first + s.rules.every; // the next round collapses ring 2
    S.host.publish([]);
    return { piece: me.piece, id: me.id };
  }, { pid, SPOT });
}
async function check(run, host, page, pid, label) {
  await page.waitForFunction(() => window.__cc.game.myTurn(), null, { timeout: 30000 });
  const a = await arrange(host, pid);
  await page.waitForFunction(({ SPOT }) => { const g = window.__cc.game; return g.me && g.me.x === SPOT.x && g.me.y === SPOT.y; }, { SPOT });
  const before = await page.evaluate(() => window.__cc.game.me.hp);
  const blocked = await page.evaluate(() => (window.__cc.game.r.overlay && window.__cc.game.r.overlay.moves || []).length);
  const tn = await page.evaluate(() => { window.__cc.session.send({ type: 'end' }); return window.__cc.game.s.turnNo; });
  await page.waitForFunction((tn) => window.__cc.game.s.turnNo > tn + 1 && window.__cc.game.myTurn(), tn, { timeout: 30000 });
  await sleep(1200);
  const st = await page.evaluate(() => {
    const g = window.__cc.game, s = g.s, u = g.me, R = g.r;
    R.focus(u.x, u.y);
    const mv = (R.overlay && R.overlay.moves) || [];
    const ring = (x, y) => Math.min(x, y, 15 - x, 15 - y);
    return { ring: s.storm.ring, pos: [u.x, u.y], hp: u.hp, wallsLeft: [[1, 7], [2, 8], [2, 7]].map(([x, y]) => s.tiles[y * 16 + x].t), moves: mv.map((m) => m.x + ',' + m.y), out: mv.filter((m) => ring(m.x, m.y) >= s.storm.ring).map((m) => [m.x, m.y]), mode: g.mode };
  });
  await sleep(800);
  if (!st.moves.length) console.log(label, 'debug', JSON.stringify(st), JSON.stringify(await page.evaluate(() => { const g = window.__cc.game; return { turn: g.s.turn, active: g.s.active, myId: g.me.id, ov: !!g.r.overlay }; })));
  const target = st.out[0] || (st.moves.includes('2,8') ? [2, 8] : st.moves[0].split(',').map(Number)); // (2,8) was a wall before the collapse
  await page.waitForFunction(() => { const c = window.__cc.game.r.cam; return Math.abs(c.x - c.tx) < 0.01 && Math.abs(c.y - c.ty) < 0.01 && Math.abs(c.z - c.tz) < 0.5 && Math.abs(c.vx) + Math.abs(c.vy) < 0.01; }, null, { timeout: 2500 }).catch(async () => console.log(label, "unsettled", JSON.stringify(await page.evaluate(() => window.__cc.game.r.cam))));
  const scr = await page.evaluate(([x, y]) => { const R = window.__cc.game.r; return { x: (x + 0.5 - R.cam.x) * R.z + (R.CX ?? R.W / 2), y: (y + 0.5 - R.cam.y) * R.z + R.CY, hit: R.tileAtScreen((x + 0.5 - R.cam.x) * R.z + (R.CX ?? R.W / 2), (y + 0.5 - R.cam.y) * R.z + R.CY) }; }, target);
  await page.screenshot({ path: `/tmp/${label}-void.png` });
  const box = await page.locator('#cv, canvas').first().boundingBox();
  const topEl = await page.evaluate(({ x, y }) => { const e = document.elementFromPoint(x, y); return e ? e.tagName + '#' + e.id + '.' + e.className : null; }, { x: box.x + scr.x, y: box.y + scr.y });
  const pre = await page.evaluate(() => ({ my: window.__cc.game.myTurn(), mode: window.__cc.game.mode, turn: window.__cc.game.s.turn }));
  await page.evaluate(() => { const S = window.__cc.session; if (!S._wrapped) { const o = S.send; S.send = (a) => { (window.__sent = window.__sent || []).push(a); return o(a); }; S._wrapped = 1; } window.__sent = []; });
  await page.touchscreen.tap(box.x + scr.x, box.y + scr.y);
  await sleep(1500);
  const sent = await page.evaluate(() => window.__sent); const mv = sent.find((a) => a.type === 'move'); const after = mv ? [mv.x, mv.y] : null;
  const left = await host.evaluate(({ id, SPOT }) => { const u = window.__cc.session.host.s.units.find((v) => v.id === id); return !(u.x === SPOT.x && u.y === SPOT.y); }, { id: a.id, SPOT });
  const ok = st.ring === 3 && st.hp < before && st.wallsLeft.every((t) => t === 'floor') && st.moves.length > 1 && after && left && st.moves.includes(after.join(','));
  console.log(label, ok ? 'PASS' : 'FAIL', JSON.stringify({ piece: a.piece, blockedBefore: blocked, before, ...st, target, tapHit: scr.hit, sent: after, left, topEl }));
  return ok;
}
(async () => {
  const browser = await chromium.launch(); let all = true;
  // solo (2 bots)
  { const run = new L.Run(browser, 'void-solo', 1); await run.open(); const p = await run.page('solo');
    await p.evaluate(() => { document.querySelectorAll('.modal').forEach((m) => m.classList.add('hidden')); window.__cc.startSolo(2, 'royale'); });
    await sleep(4500);
    all = (await check(run, p, p, 'me', 'solo')) && all;
    if (run.errors.length) { console.log('errors', run.errors); all = false; } await run.close(); }
  // ?net=local host + join: host and client each move out of the void
  { const run = new L.Run(browser, 'void-net', 1); await run.open();
    const { host, code } = await L.hostLobby(run); const c = await L.clientJoin(run, 'guest', code);
    await L.startMatch(run, host, { bots: 1, clients: [c] });
    await host.evaluate(() => { window.__cc.session.host.fast = false; });
    const cpid = await L.clientPid(c);
    const setBot = (pid, on) => host.evaluate(({ pid, on }) => { const H = window.__cc.session.host, u = H.s.units.find((v) => v.pid === pid); u.bot = on; H.schedule(); }, { pid, on });
    await setBot(cpid, true); all = (await check(run, host, host, 'me', 'host')) && all; await setBot(cpid, false);
    await setBot('me', true); all = (await check(run, host, c, cpid, 'join')) && all;
    if (run.errors.length) { console.log('errors', run.errors); all = false; } await run.close(); }
  await browser.close();
  console.log(all ? 'ALL PASS' : 'SOME FAILED'); process.exit(all ? 0 : 1);
})();
