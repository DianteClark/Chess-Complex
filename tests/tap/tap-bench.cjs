// Chess Complex tap-accuracy benchmark (QA, 10.2).
// Real touch emulation (CDP Input.dispatchTouchEvent -> touch + pointer events) on phone contexts
// (hasTouch, isMobile, DPR 2-3), fully zoomed out, in solo and in ?net=local online (the client taps).
//
// Usage: NODE_PATH=$(npm root -g) node tests/tap/tap-bench.cjs [--url http://localhost:8123/] [--trials 40]
//        [--vp 390x844@3,360x740@2,844x390@3] [--modes solo,online] [--phases clean,jitter,motion]
//        [--seed 7] [--tag now] [--save-baseline] [--compare tests/tap/baseline.json]
//
// Each trial: my turn, move mode, my piece is a Queen (many legal targets). The test picks a tile (70% a legal move,
// 30% a non-legal tile), aims at it on screen, and plays a touch: touchStart, a few touchMoves (finger roll), touchEnd.
// Ground truth is the tile under the finger AT TOUCH-DOWN, computed by the test from the draw transform (render.js
// frame(): translate(CX,CY) scale(cam.z*(1+punch)) translate(-cam.x,-cam.y)), i.e. what the player saw.
// The game's session.send is intercepted (actions recorded, not applied) so the board stays put.
//   correct     legal target -> move sent to that tile; non-legal target -> no move/ability sent
//   wrong       an action was sent for a tile other than the one under the finger at touch-down
//   none        legal target, nothing sent (tap swallowed: drag threshold, timing, ...)
// Phases: clean  = aim inside the central 50% of the tile, finger roll <= 4 px, 60-160 ms
//         jitter = aim anywhere inside the central 80%, finger roll 5-14 px (real thumbs), 60-300 ms
//         edge   = aim anywhere up to 3% from the tile border, finger roll 5-14 px
//         --onetap turns on the One-Tap setting (no confirm step)
//         motion = clean aim but the camera is springing (pan 1.5-3 tiles + zoom settling from 1.35x min) during the tap
// Tiles covered by HUD/DOM at the aim point are skipped (counted as `covered`).
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, arr) => (v.startsWith('--') ? [...a, [v.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true]] : a), []));
const BASE = args.url || 'http://localhost:8123/';
const TRIALS = +(args.trials || 40);
const VPS = String(args.vp || '390x844@3,360x740@2,844x390@3').split(',').map((s) => { const m = /(\d+)x(\d+)@?([\d.]*)/.exec(s); return { w: +m[1], h: +m[2], dpr: +(m[3] || 2), id: s }; });
const MODES = String(args.modes || 'solo,online').split(',');
const PHASES = String(args.phases || 'clean,jitter,motion').split(',');
const TAG = args.tag || new Date().toISOString().slice(11, 16).replace(':', '');
const OUT = path.join(require('os').tmpdir(), 'cc-tap'); fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function mulberry(a) { return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), a | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const rnd = mulberry(+(args.seed || 7));
const R = (a, b) => a + rnd() * (b - a);

async function newPage(browser, vp, errors, label) {
  const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, deviceScaleFactor: vp.dpr, isMobile: true, hasTouch: true });
  await ctx.route(/unpkg\.com|fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  const mk = async (lab) => {
    const p = await ctx.newPage();
    p.on('pageerror', (e) => { if (!/BroadcastChannel.*closed/.test(e.message)) errors.push(`[${lab}] ${e.message}`); });
    p.on('console', (m) => { if (m.type() === 'error' && !/unpkg|peerjs|ERR_FAILED|Failed to load resource/i.test(m.text())) errors.push(`[${lab}] console: ${m.text()}`); });
    await p.goto(BASE + '?net=local', { waitUntil: 'load' });
    await p.waitForFunction(() => window.__cc && window.__cc.game, null, { timeout: 15000 });
    await sleep(900);
    return p;
  };
  return { ctx, mk };
}

// In-page instrumentation: truth at pointerdown, sent actions.
async function instrument(p) {
  await p.evaluate(() => {
    const g = window.__cc.game, c = document.querySelector('#board');
    const truth = (cx, cy) => {
      const r = g.r, rect = c.getBoundingClientRect();
      const z = r.cam.z * (1 + (r.punch || 0)), sx = cx - rect.left, sy = cy - rect.top;
      const wx = (sx - (r.CX ?? r.W / 2)) / z + r.cam.x, wy = (sy - r.CY) / z + r.cam.y;
      return { x: Math.floor(wx), y: Math.floor(wy), fx: wx - Math.floor(wx), fy: wy - Math.floor(wy) };
    };
    window.__tb = { sent: [], down: null, truth, calls: [] };
    for (const k of ['onTap', 'tapAt']) if (typeof g[k] === 'function' && !g['__w' + k]) { const f = g[k].bind(g); g[k] = (...a) => { try { window.__tb.calls.push({ k, a: JSON.stringify(a[0]) + (k === 'tapAt' ? ',' + Math.round(a[1]) : ''), turn: g.myTurn(), mode: g.mode, ov: !!(g.r.overlay && g.r.overlay.moves) }); } catch {} return f(...a); }; g['__w' + k] = true; }
    if (!window.__tbHooked) {
      window.__tbHooked = true;
      c.addEventListener('pointerup', (e) => { if (!window.__tb.up) window.__tb.up = { t: performance.now() }; }, true);
      c.addEventListener('pointerdown', (e) => { if (!window.__tb.down) window.__tb.down = { ...truth(e.clientX, e.clientY), t: performance.now() }; }, true);
    }
  });
}
async function hijackSend(p) {
  await p.evaluate(() => { const s = window.__cc.session; if (!s.__realSend) s.__realSend = s.send; s.send = (a) => { window.__tb.sent.push(a); }; });
}

// Make me a Queen near the centre with an empty-ish neighbourhood, publish from the host page.
async function setupQueen(host, pid) {
  return host.evaluate(async (pid) => {
    const E = await import('/js/engine.js');
    const h = window.__cc.session.host, s = h.s; h.noTimer = true; h.deadline = 0; clearTimeout(h.timerT);
    const u = s.units.find((v) => v.pid === pid);
    u.piece = 'queen'; u.hp = E.stats(u).maxHp;
    let best = null;
    for (let y = 4; y < 12; y++) for (let x = 4; x < 12; x++) { if (!E.canStand(s, x, y) && !(u.x === x && u.y === y)) continue; const old = [u.x, u.y]; u.x = x; u.y = y; const n = E.legalMoves(s, u).length; u.x = old[0]; u.y = old[1]; if (!best || n > best.n) best = { x, y, n }; }
    if (best) { u.x = best.x; u.y = best.y; }
    s.v++; h.publish([]);
    return { n: E.legalMoves(s, u).length };
  }, pid);
}

async function zoomOut(p) {
  await p.evaluate(() => { const r = window.__cc.game.r; r.zoomBy(0.01); r.cam.z = r.cam.tz = r.minZ; r.cam.vx = r.cam.vy = r.cam.vz = 0; r.follow = false; });
  await sleep(500);
}

async function trial(p, cdp, phase) {
  // pick a target in page (positions at this instant)
  const setup = await p.evaluate(async ([phase, rr]) => {
    const E = await import('/js/engine.js');
    const g = window.__cc.game, r = g.r, c = document.querySelector('#board'), rect = c.getBoundingClientRect();
    if (!g.myTurn()) return { skip: 'not-my-turn' };
    g.mode = 'move'; g.preview = null; if (g.clearPending) g.clearPending(true); g.refresh && g.refresh();
    document.querySelector('#h-inspect') && document.querySelector('#h-inspect').classList.add('hidden');
    if (phase === 'motion') { // camera springing: offset target, zoom settling back to min
      r.cam.tz = r.minZ; r.cam.z = r.minZ * 1.35; r.cam.vz = 0;
      const a = rr[0] * Math.PI * 2, d = 1.5 + rr[1] * 1.5; r.cam.tx = r.cam.x; r.cam.ty = r.cam.y; r.cam.x += Math.cos(a) * d; r.cam.y += Math.sin(a) * d;
    }
    return { ok: true };
  }, [phase, [rnd(), rnd()]]);
  if (setup.skip) return { skip: setup.skip };
  if (phase === 'motion') await sleep(R(40, 160));
  const legalPick = rnd() < 0.7;
  const aim = phase === 'edge' ? 0.47 : phase === 'jitter' ? 0.4 : 0.25;
  const tgt = await p.evaluate(async ([legalPick, aim, r1, r2, r3]) => {
    const E = await import('/js/engine.js');
    const g = window.__cc.game, r = g.r, c = document.querySelector('#board'), rect = c.getBoundingClientRect();
    const u = g.me, s = g.s;
    const legal = E.legalMoves(s, u);
    const key = (t) => t.x + ',' + t.y;
    const L = new Set(legal.map(key));
    const z = r.cam.z * (1 + (r.punch || 0));
    const scr = (x, y) => [rect.left + (x - r.cam.x) * z + (r.CX ?? r.W / 2), rect.top + (y - r.cam.y) * z + r.CY];
    const okPt = (cx, cy) => { if (cx < 2 || cy < 2 || cx > innerWidth - 2 || cy > innerHeight - 2) return false; const el = document.elementFromPoint(cx, cy); return el === c; };
    let pool = [];
    if (legalPick) pool = legal.map((m) => ({ x: m.x, y: m.y, legal: true }));
    else for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) if (!L.has(x + ',' + y) && !(x === u.x && y === u.y)) pool.push({ x, y, legal: false });
    const t = pool[Math.floor(r1 * pool.length)];
    if (!t) return { skip: 'no-target' };
    const ox = (r2 - 0.5) * 2 * aim, oy = (r3 - 0.5) * 2 * aim;
    const [cx, cy] = scr(t.x + 0.5 + ox, t.y + 0.5 + oy);
    window.__tb.sent = []; window.__tb.down = null; window.__tb.up = null; window.__tb.calls = [];
    return { ...t, cx, cy, covered: !okPt(cx, cy), tilePx: z, legalN: legal.length };
  }, [legalPick, aim, rnd(), rnd(), rnd()]);
  if (tgt.skip) return { skip: tgt.skip };
  if (tgt.covered) return { covered: true, legal: tgt.legal };
  const roll = phase === 'jitter' || phase === 'edge' ? R(5, 14) : R(0, 4), ang = rnd() * Math.PI * 2;
  const dur = phase === 'jitter' || phase === 'edge' ? R(60, 300) : R(60, 160);
  const steps = 3;
  const pt = (k) => ({ x: tgt.cx + Math.cos(ang) * roll * k, y: tgt.cy + Math.sin(ang) * roll * k, radiusX: 6, radiusY: 6, force: 1, id: 1 });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [pt(0)] });
  for (let i = 1; i <= steps; i++) { await sleep(dur / (steps + 1)); await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [pt(i / steps)] }); }
  await sleep(dur / (steps + 1));
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await sleep(140);
  let res = await p.evaluate(() => ({ lat: window.__tb.down && window.__tb.up ? window.__tb.up.t - window.__tb.down.t : null, calls: window.__tb.calls.slice(), sent: window.__tb.sent.slice(), down: window.__tb.down, pend: window.__cc.game.tapPending || null }));
  // main-thread starvation (shared CI box): the page handled down->up far later than the finger did; not a fair trial
  const starved = res.lat != null && res.lat > dur + 300;
  let taps = 1, misprev = false;
  // 10.2 confirm step: small tiles preview first ("Tap again to move"). A player confirms only if the previewed tile is
  // the one they meant; a wrong preview is recoverable (no action), counted as misprev.
  if (!res.sent.length && res.pend && res.down) {
    if (res.pend.x === res.down.x && res.pend.y === res.down.y) {
      const p2 = await p.evaluate(([fx, fy, t]) => { const r = window.__cc.game.r, rect = document.querySelector('#board').getBoundingClientRect(); const z = r.cam.z * (1 + (r.punch || 0)); window.__tb.down2 = true; return [rect.left + (t.x + fx - r.cam.x) * z + (r.CX ?? r.W / 2), rect.top + (t.y + fy - r.cam.y) * z + r.CY]; }, [res.down.fx, res.down.fy, res.pend]);
      const q = { x: p2[0], y: p2[1], radiusX: 6, radiusY: 6, force: 1, id: 2 };
      await sleep(R(120, 260));
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [q] }); await sleep(R(50, 110));
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await sleep(140);
      taps = 2;
      const r2 = await p.evaluate(() => ({ sent: window.__tb.sent.slice() })); res = { ...res, sent: r2.sent };
    } else misprev = true;
  }
  const truthTile = res.down ? { x: res.down.x, y: res.down.y } : { x: tgt.x, y: tgt.y };
  const truthLegal = res.down ? await p.evaluate(async (t) => { const E = await import('/js/engine.js'); const g = window.__cc.game; return E.legalMoves(g.s, g.me).some((m) => m.x === t.x && m.y === t.y); }, truthTile) : tgt.legal;
  const acts = res.sent.filter((a) => a && (a.type === 'move' || a.type === 'ability'));
  let out;
  if (truthLegal) {
    if (!acts.length) out = misprev ? 'misprev' : 'none';
    else if (acts.length === 1 && acts[0].type === 'move' && acts[0].x === truthTile.x && acts[0].y === truthTile.y) out = 'correct';
    else out = 'wrong';
  } else out = acts.length ? 'wrong' : 'correct';
  // a starved trial that produced nothing says nothing about the code (the tap window may have expired in the queue)
  if (starved && !acts.length && !(res.pend)) return { starved: true, lat: res.lat };
  return { calls: res.calls, out, taps, legal: truthLegal, aimedLegal: tgt.legal, drift: !!res.down && (res.down.x !== tgt.x || res.down.y !== tgt.y), tilePx: tgt.tilePx, acts, truth: truthTile, aimed: { x: tgt.x, y: tgt.y }, noDown: !res.down };
}

async function runConfig(browser, vp, mode) {
  const errors = [];
  const { ctx, mk } = await newPage(browser, vp, errors);
  let p, host;
  try {
    if (mode === 'solo') {
      p = host = await mk('solo');
      await p.evaluate(() => { window.__cc.startSolo(3, 'royale'); });
      await p.waitForFunction(() => window.__cc.game.s && window.__cc.game.myTurn && window.__cc.game.myTurn(), null, { timeout: 30000 }).catch(() => {});
      await p.evaluate(() => { window.__cc.session.host.fast = true; });
      await p.waitForFunction(() => window.__cc.game.myTurn(), null, { timeout: 30000 });
      await sleep(3500); // intro fly-over and drop
      await p.waitForFunction(() => window.__cc.game.myTurn(), null, { timeout: 30000 });
      await instrument(p); await hijackSend(p);
      await setupQueen(host, 'me');
    } else {
      host = await mk('host');
      await host.evaluate(() => { window.__cc.profile.mode = 'royale'; window.__cc.profile.name = 'HostH'; });
      await host.evaluate(() => document.querySelector('#s-title [data-go="play"]').click()); await sleep(800);
      await host.evaluate(() => document.querySelector('#btn-host').click());
      await host.waitForFunction(() => /Room open/.test(document.querySelector('#host-status').textContent), null, { timeout: 6000 });
      const code = await host.textContent('#host-code');
      p = await mk('client');
      await p.evaluate(() => { window.__cc.profile.name = 'Tapper'; document.querySelector('#s-title [data-go="join"]').click(); }); await sleep(800);
      await p.fill('#in-code', code);
      await p.evaluate(() => document.querySelector('#s-join [data-act="join"]').click());
      await p.waitForFunction(() => /In the lobby/.test(document.querySelector('#join-status').textContent), null, { timeout: 6000 });
      await host.evaluate(() => document.querySelector('[data-act="add-bot"]').click()); await sleep(150);
      await host.evaluate(() => document.querySelector('#btn-start-host').click());
      for (const q of [host, p]) await q.waitForFunction(() => window.__cc.game.s && document.querySelector('.screen.active').id === 's-game', null, { timeout: 10000 });
      await host.evaluate(() => { try { window.__cc.game.r.setQuality('low'); } catch {} const h = window.__cc.session.host; h.fast = true; h.noTimer = true; clearInterval(window.__ap); window.__ap = setInterval(() => { const g = window.__cc.game, s = window.__cc.session; try { if (s && s.send && g.myTurn()) s.send({ type: 'end' }); } catch {} }, 200); });
      await sleep(3500);
      await p.waitForFunction(() => window.__cc.game.myTurn(), null, { timeout: 30000 });
      await instrument(p); await hijackSend(p);
      const pid = await p.evaluate(() => window.__cc.session.myPid);
      await setupQueen(host, pid);
    }
    // shared box: keep frames cheap so input is not starved (hit-testing is in CSS px; viewport DPR is unchanged)
    if (args.onetap) await p.evaluate(() => { const cb = document.querySelector('#set-onetap'); cb.checked = true; cb.dispatchEvent(new Event('change', { bubbles: true })); });
    if (!args['full-quality']) await p.evaluate(() => { try { window.__cc.game.r.setQuality('low'); } catch {} });
    await sleep(600);
    await p.waitForFunction(() => window.__cc.game.me && window.__cc.game.me.piece === 'queen', null, { timeout: 5000 });
    const cdp = await ctx.newCDPSession(p);
    const res = {};
    for (const ph of PHASES) {
      await zoomOut(p);
      const r = { n: 0, correct: 0, wrong: 0, none: 0, misprev: 0, taps: 0, covered: 0, legalN: 0, legalCorrect: 0, drift: 0, noDown: 0, skips: 0, samples: [] };
      for (let i = 0; i < TRIALS * 6 && r.n < TRIALS; i++) {
        if (ph !== 'motion') { await p.evaluate(() => { const r = window.__cc.game.r; r.cam.z = r.cam.tz = r.minZ; r.cam.vz = 0; }); }
        const t = await trial(p, cdp, ph);
        if (t.skip) { r.skips++; if (r.skips > 20) break; await sleep(200); continue; }
        if (t.covered) { r.covered++; continue; }
        if (t.starved) { r.starved = (r.starved || 0) + 1; if (r.starved > TRIALS * 2) break; await sleep(300); continue; }
        r.n++; r[t.out]++; if (t.out === 'correct' && t.legal) r.taps += t.taps; if (t.legal) { r.legalN++; if (t.out === 'correct') r.legalCorrect++; }
        if (t.drift) r.drift++; if (t.noDown) r.noDown++;
        if (t.out !== 'correct' && r.samples.length < 6) r.samples.push({ calls: t.calls, out: t.out, truth: t.truth, aimed: t.aimed, acts: t.acts, tilePx: +t.tilePx.toFixed(1) });
        r.tilePx = +t.tilePx.toFixed(1);
        if (ph === 'motion') await sleep(450);
      }
      res[ph] = r;
    }
    return { vp: vp.id, mode, res, errors };
  } finally { await ctx.close().catch(() => {}); }
}

(async () => {
  const browser = await chromium.launch();
  const all = [];
  for (const vp of VPS) for (const mode of MODES) {
    try { const r = await runConfig(browser, vp, mode); all.push(r); }
    catch (e) { all.push({ vp: vp.id, mode, error: String(e.message || e).split('\n')[0] }); }
    const r = all[all.length - 1];
    if (r.error) console.log(`${vp.id.padEnd(12)} ${mode.padEnd(7)} ERROR ${r.error}`);
    else for (const [ph, x] of Object.entries(r.res)) console.log(`${vp.id.padEnd(12)} ${mode.padEnd(7)} ${ph.padEnd(7)} n=${String(x.n).padStart(3)} correct ${pct(x.correct, x.n)} wrong ${pct(x.wrong, x.n)} none ${pct(x.none, x.n)} misprev ${pct(x.misprev, x.n)} legalHit ${pct(x.legalCorrect, x.legalN)} taps/move ${x.legalCorrect ? (x.taps / x.legalCorrect).toFixed(2) : '-'} tile=${x.tilePx}px covered=${x.covered} starved=${x.starved || 0}${r.errors.length ? ' ERR=' + r.errors.length : ''}`);
  }
  await browser.close();
  const sum = {}; for (const r of all) if (r.res) for (const [ph, x] of Object.entries(r.res)) { const s = sum[ph] || (sum[ph] = { n: 0, correct: 0, wrong: 0, none: 0, misprev: 0, legalN: 0, legalCorrect: 0, taps: 0 }); s.legalN += x.legalN; s.legalCorrect += x.legalCorrect; s.taps += x.taps || 0; s.n += x.n; s.correct += x.correct; s.wrong += x.wrong; s.none += x.none; s.misprev += x.misprev; }
  console.log('TOTAL'); for (const [ph, s] of Object.entries(sum)) console.log(`  ${ph.padEnd(7)} n=${s.n} correct ${pct(s.correct, s.n)} wrong-action ${pct(s.wrong, s.n)} no-response ${pct(s.none, s.n)} wrong-preview ${pct(s.misprev, s.n)} | move taps that moved right ${pct(s.legalCorrect, s.legalN)} (taps/move ${s.legalCorrect ? (s.taps / s.legalCorrect).toFixed(2) : '-'})`);
  const out = { tag: TAG, at: new Date().toISOString(), trials: TRIALS, sum, runs: all };
  fs.writeFileSync(path.join(OUT, `tap-${TAG}.json`), JSON.stringify(out, null, 1));
  if (args['save-baseline']) fs.writeFileSync(path.join(__dirname, 'baseline.json'), JSON.stringify(out, null, 1));
  if (args.compare && fs.existsSync(args.compare)) {
    const b = JSON.parse(fs.readFileSync(args.compare, 'utf8'));
    console.log(`VS BASELINE ${b.tag}`); for (const [ph, s] of Object.entries(sum)) { const o = b.sum[ph]; if (o) console.log(`  ${ph.padEnd(7)} moveHit ${o.legalN != null ? pct(o.legalCorrect, o.legalN) : '-'} -> ${pct(s.legalCorrect, s.legalN)}   correct ${pct(o.correct, o.n)} -> ${pct(s.correct, s.n)}   wrong ${pct(o.wrong, o.n)} -> ${pct(s.wrong, s.n)}   none ${pct(o.none, o.n)} -> ${pct(s.none, s.n)}`); }
  }
  const errs = all.flatMap((r) => r.errors || []); if (errs.length) { console.log('PAGE ERRORS'); [...new Set(errs)].slice(0, 10).forEach((e) => console.log('  ' + e)); }
  console.log(`json: ${path.join(OUT, `tap-${TAG}.json`)}`);
})();
function pct(a, n) { return n ? (100 * a / n).toFixed(1).padStart(5) + '%' : '   - '; }
