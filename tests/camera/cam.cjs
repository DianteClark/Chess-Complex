// Q 10.3: camera director metrics. Plays all-bot matches (8 players, the player seat handed to the AI) with every
// player's ultimate forced to full each turn (back-to-back ultimates; --noult for natural play), records the camera
// and every player's drawn position each frame, and when each turn's scheduled beats actually fire (render.later()
// is wrapped, so this works whatever the sequencing), then reports:
//   speed     max / p95 screen pan speed (px/s, cam.x/cam.y * cam.z, punch excluded) and zoom rate (|dz/z| per s)
//   reversal  mid-flight reversals inside one turn's beat: > 150 px/s one way, then > 40 px/s the opposite way
//             within 0.12 s (a settle followed by the next beat is not counted)
//   retarget  camera target jumps > 1.5 tiles to a point > 2.5 tiles from the actor, during that actor's beat
//   framed    % of turns whose actor is inside the board viewport (12 px margin) for >= 90% of the frames while its
//             beats play (first fired beat .. last + 0.35 s); meanOn = mean on-screen share
//   lag       how far behind the live state beats start (p50 / max, s); myTurnLag = real seconds the board keeps
//             replaying other turns after my turn has started live
//   override  after a real touch-drag pan, how far the camera target moves in the next 4 s (tiles)
//   setting   Camera setting found (settings key matching /cam/ or a Settings label starting "Camera")
//
//   NODE_PATH=$(npm root -g) node tests/camera/cam.cjs [--url http://localhost:8123/] [--secs 75] [--matches 2]
//        [--land] [--noult] [--cam all|mine|free] [--tag after] [--json out.json] [--dump frames.json]
// Baseline: serve `git archive HEAD` from /tmp/qa-base on :8150 and pass --url http://localhost:8150/.
const { chromium } = require('playwright');
const fs = require('fs');
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const URL = arg('url', 'http://localhost:8123/');
const SECS = +arg('secs', 75), MATCHES = +arg('matches', 2), LAND = process.argv.includes('--land'), NOULT = process.argv.includes('--noult');
const TAG = arg('tag', 'run'), JSON_OUT = arg('json', null), CAM = arg('cam', null);

function hook(forceUlt) {
  const g = window.__cc.game, r = g.r;
  const R = window.__camRec = { frames: [], wins: [], ults: 0, setStates: 0, myId: null };
  let curWin = null, curMy = null; // the batch whose setState is running: later() calls made now belong to it
  const lt = r.later;
  r.later = function (t, fn) {
    const w = curWin;
    const my = curMy;
    let T = null;
    if ((w || my) && typeof fn === 'function') { const f0 = fn; fn = function () { if (w && !(T && T.cam)) w.fires.push(r.time); if (my) my.fires.push(r.real); return f0.apply(this, arguments); }; } // camera keyframes (camAt tags T.cam) are not part of the actor's beat
    T = lt.call(this, t, fn); return T;
  };
  const fr = r.frame;
  r.frame = function (dt) {
    const out = fr.apply(this, arguments);
    const c = this.cam, u = {};
    if (this.state) for (const v of this.state.units) if (v.kind === 'player' && v.alive) { const d = this.disp.get(v.id); if (d) u[v.id] = [+d.x.toFixed(2), +d.y.toFixed(2)]; }
    R.myId = this.myId;
    R.frames.push({ real: this.real, time: this.time, x: c.x, y: c.y, z: c.z, zz: this.z, tx: c.tx, ty: c.ty, tz: c.tz, cx: this.CX ?? this.W / 2, cy: this.CY, vw: this.VW || this.W, vh: this.VH, pt: this.pad ? this.pad.t : 0, u, intro: !!(this.intro && this.intro.fly && this.intro.t < 1.7) });
    if (R.frames.length > 40000) R.frames.shift();
    return out;
  };
  const ss = r.setState;
  r.setState = function (s, events = [], first = false) {
    const prev = this.state;
    let w = null;
    if (!first && prev && events && events.length) {
      const act = events.find((e) => (e.e === 'move' || e.e === 'ability') && e.id != null);
      const pa = prev.units.find((v) => v.id === prev.active && v.kind === 'player'); // the real actor (a move event may be a push victim)
      const un = act && (pa || s.units.find((v) => v.id === act.id));
      if (un && un.kind === 'player') { const ult = events.some((e) => e.e === 'ability' && e.slot === 'ult'); if (ult) R.ults++; w = { i: R.wins.length, actor: un.id, turnNo: prev.turnNo, ult, fires: [], at: this.time, kinds: [...new Set(events.map((e) => e.e))].join(',') }; R.wins.push(w); }
    }
    curWin = w;
    curMy = !first && events && events.some((e) => e.e === 'turn' && e.id === this.myId) ? { at: this.real, fires: [] } : null;
    if (curMy) (R.myTurns ||= []).push(curMy);
    try { return ss.apply(this, arguments); } finally {
      curWin = null; curMy = null; R.setStates++;
    }
  };
  if (forceUlt) window.__ultT = setInterval(() => { const h = window.__cc.session && window.__cc.session.host; if (!h || !h.s) return; for (const u of h.s.units) if (u.alive && u.kind === 'player') u.ult = 100; }, 40);
}

function analyse(R) {
  const F = R.frames.filter((f) => !f.intro);
  // a batch plays from its first fired beat to its last (+0.35 s tail for the last hit to land)
  const W = R.wins.filter((w) => w.fires.length).map((w) => ({ ...w, s: Math.min(...w.fires), e: Math.max(...w.fires) + 0.35 }));
  const onScreen = (f, id) => { const p = f.u[id]; if (!p) return null; const sx = (p[0] + 0.5 - f.x) * f.zz + f.cx, sy = (p[1] + 0.5 - f.y) * f.zz + f.cy, m = 12; return sx > m && sx < f.vw - m && sy > f.pt + m && sy < f.pt + f.vh - m; };
  const winAt = (t) => { let best = null; for (const w of W) if (t >= w.s && t <= w.e && (!best || w.s > best.s)) best = w; return best; };
  const sp = [], zr = []; let rev = 0, revUlt = 0; const revWins = new Set(); let travel = 0, travelOther = 0, pv = null;
  for (let i = 1; i < F.length; i++) {
    const a = F[i - 1], b = F[i], dt = b.real - a.real; if (dt <= 0.001 || dt > 0.2) { pv = null; continue; }
    const vx = (b.x - a.x) * b.z / dt, vy = (b.y - a.y) * b.z / dt, v = Math.hypot(vx, vy);
    sp.push(v); zr.push(Math.abs(Math.log(b.z / a.z)) / dt);
    const w = winAt(b.time), d = Math.hypot(b.x - a.x, b.y - a.y); travel += d; if (!w || w.actor !== R.myId) travelOther += d;
    // mid-flight reversal: moving > 150 px/s, then within 0.12 s moving > 40 px/s the opposite way, inside one beat (settle-then-retarget is not counted)
    if (v > 40) {
      if (pv && w && pv.w === w && pv.v > 150 && b.real - pv.t < 0.12) { const cos = (vx * pv.vx + vy * pv.vy) / (v * pv.v); if (cos < -0.5) { rev++; revWins.add(w.i); if (w.ult) revUlt++; } }
      pv = { vx, vy, v, w, t: b.real };
    }
  }
  const q = (arr, p) => { if (!arr.length) return 0; const s = [...arr].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
  // per turn (actor + turnNo): every frame inside any of its batches' play intervals
  const turns = new Map(); let retarget = 0;
  for (const w of W) {
    const fs = F.filter((f) => f.time >= w.s && f.time <= w.e);
    const k = w.turnNo + ':' + w.actor; const T = turns.get(k) || { n: 0, on: 0, ult: false }; turns.set(k, T); T.ult = T.ult || w.ult;
    let last = null;
    for (const f of fs) { const o = onScreen(f, w.actor); if (o === null) continue; T.n++; if (o) T.on++; if (last && Math.hypot(f.tx - last[0], f.ty - last[1]) > 1.5) { const p = f.u[w.actor]; if (!p || Math.hypot(f.tx - p[0] - 0.5, f.ty - p[1] - 0.5) > 2.5) retarget++; } last = [f.tx, f.ty]; }
  }
  const tl = [...turns.values()].filter((t) => t.n >= 3);
  const framed = tl.filter((t) => t.on / t.n >= 0.9).length, ultT = tl.filter((t) => t.ult), ultFramed = ultT.filter((t) => t.on / t.n >= 0.9).length;
  const meanOn = tl.length ? tl.reduce((a, t) => a + t.on / t.n, 0) / tl.length : 0;
  const mins = F.length ? (F[F.length - 1].real - F[0].real) / 60 : 0;
  const lag = W.map((w) => w.s - w.at).filter((x) => x >= 0); // how far behind the live state the beats play
  return {
    frames: F.length, fps: mins ? Math.round(F.length / (mins * 60)) : 0, mins: +mins.toFixed(2), turns: tl.length, ultTurns: ultT.length, ults: R.ults,
    maxPx: Math.round(Math.max(0, ...sp)), p95Px: Math.round(q(sp, 0.95)), p99Px: Math.round(q(sp, 0.99)), maxZoomRate: +Math.max(0, ...zr).toFixed(2),
    reversals: rev, reversalsPerMin: mins ? +(rev / mins).toFixed(1) : 0, reversalTurns: revWins.size, reversalsInUlt: revUlt, retargets: retarget,
    travelPerMin: mins ? +(travel / mins).toFixed(1) : 0, travelNotMinePerMin: mins ? +(travelOther / mins).toFixed(1) : 0,
    lagP50: +q(lag, 0.5).toFixed(2), lagMax: +Math.max(0, ...lag).toFixed(2), myTurnLag: (R.myTurns || []).map((m) => +(m.fires.length ? Math.max(...m.fires) - m.at : 0).toFixed(2)).slice(0, 12), myTurnLagMax: +Math.max(0, ...(R.myTurns || []).map((m) => (m.fires.length ? Math.max(...m.fires) - m.at : 0))).toFixed(2),
    framedPct: tl.length ? +(100 * framed / tl.length).toFixed(1) : 0, ultFramedPct: ultT.length ? +(100 * ultFramed / ultT.length).toFixed(1) : 0, meanOnPct: +(100 * meanOn).toFixed(1),
  };
}

(async () => {
  const browser = await chromium.launch();
  const vp = LAND ? { width: 844, height: 390 } : { width: 390, height: 844 };
  const results = [];
  for (let m = 0; m < MATCHES; m++) {
    const ctx = await browser.newContext({ viewport: vp, hasTouch: true, isMobile: true, deviceScaleFactor: 1 });
    const page = await ctx.newPage(); const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (x) => { if (x.type() === 'error' && !/net::|Failed to load resource/.test(x.text())) errors.push(x.text()); });
    await page.route('**/*', (r) => (/^https?:\/\/(localhost|127\.0\.0\.1)/.test(r.request().url()) ? r.continue() : r.abort()));
    await page.goto(URL, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__cc && window.__cc.game && window.__cc.game.r, null, { timeout: 20000 });
    await page.waitForTimeout(900);
    if (CAM) await page.evaluate(async (m) => { const A = await import('/js/audio.js'); A.settings.cam = m; if (window.__cc.game.r.setCamMode) window.__cc.game.r.setCamMode(m); }, CAM);
    await page.evaluate(() => { window.__cc.startSolo(7, 'royale'); window.__cc.session.host.setBot('me'); });
    await page.evaluate(hook, !NOULT);
    const t0 = Date.now(); let overridden = null;
    while (Date.now() - t0 < SECS * 1000) {
      await page.waitForTimeout(500);
      const over = await page.evaluate(() => !!(window.__cc.game.s && window.__cc.game.s.over));
      if (over) break;
      // manual override probe once, ~25 s in: a real touch drag on the board, then watch the camera target for 4 s
      if (!overridden && Date.now() - t0 > 25000) {
        const box = await page.evaluate(() => { const r = window.__cc.game.r, c = r.c.getBoundingClientRect(); return { x: c.left + (r.VW || r.W) / 2, y: c.top + r.pad.t + r.VH / 2 }; });
        const cdp = await ctx.newCDPSession(page);
        const pt = (x, y) => [{ x, y, radiusX: 4, radiusY: 4, id: 1 }];
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pt(box.x, box.y) });
        for (let k = 1; k <= 8; k++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pt(box.x - k * 12, box.y - k * 9) }); await page.waitForTimeout(16); }
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        await page.waitForTimeout(120);
        const a = await page.evaluate(() => { const r = window.__cc.game.r; return { tx: r.cam.tx, ty: r.cam.ty, x: r.cam.x, y: r.cam.y, follow: r.follow }; });
        let maxD = 0, moves = 0, last = a;
        for (let k = 0; k < 20; k++) { await page.waitForTimeout(200); const b = await page.evaluate(() => { const r = window.__cc.game.r; return { tx: r.cam.tx, ty: r.cam.ty, follow: r.follow }; }); const d = Math.hypot(b.tx - a.tx, b.ty - a.ty); maxD = Math.max(maxD, d); if (Math.hypot(b.tx - last.tx, b.ty - last.ty) > 0.5) moves++; last = b; }
        overridden = { followAfterPan: a.follow, maxTargetDrift: +maxD.toFixed(2), retargets4s: moves };
      }
    }
    const R = await page.evaluate(() => window.__camRec);
    const setting = await page.evaluate(async () => {
      const A = await import('/js/audio.js'); const keys = Object.keys(A.settings || {}).filter((k) => /cam/i.test(k));
      const ctl = [...document.querySelectorAll('#m-settings label, #m-settings .setting, [data-set*="cam" i]')].filter((e) => /^\s*camera/i.test(e.textContent)).map((e) => e.textContent.trim().replace(/\s+/g, ' ').slice(0, 80));
      return { keys: Object.fromEntries(keys.map((k) => [k, A.settings[k]])), controls: [...new Set(ctl)].slice(0, 4) };
    });
    if (arg('dump', null) && m === 0) fs.writeFileSync(arg('dump'), JSON.stringify(R));
    const res = { match: m + 1, ...analyse(R), override: overridden, setting, errors: errors.slice(0, 5) };
    results.push(res);
    console.log(JSON.stringify(res));
    await ctx.close();
  }
  await browser.close();
  const sum = (k) => results.reduce((a, r) => a + (r[k] || 0), 0), mx = (k) => Math.max(...results.map((r) => r[k] || 0));
  const agg = { tag: TAG, url: URL, land: LAND, cam: CAM, fps: Math.round(results.reduce((a, r) => a + r.fps, 0) / results.length), lagP50: +(results.reduce((a, r) => a + r.lagP50, 0) / results.length).toFixed(2), lagMax: Math.max(...results.map((r) => r.lagMax)), myTurnLagMax: Math.max(...results.map((r) => r.myTurnLagMax)), travelPerMin: +(results.reduce((a, r) => a + r.travelPerMin, 0) / results.length).toFixed(1), travelNotMinePerMin: +(results.reduce((a, r) => a + r.travelNotMinePerMin, 0) / results.length).toFixed(1), matches: results.length, turns: sum('turns'), ultTurns: sum('ultTurns'), maxPx: mx('maxPx'), p95Px: Math.round(sum('p95Px') / results.length), maxZoomRate: mx('maxZoomRate'),
    reversals: sum('reversals'), reversalsPerMin: +(sum('reversals') / Math.max(0.01, sum('mins'))).toFixed(1), reversalsInUlt: sum('reversalsInUlt'), retargets: sum('retargets'),
    framedPct: +(results.reduce((a, r) => a + r.framedPct * r.turns, 0) / Math.max(1, sum('turns'))).toFixed(1),
    ultFramedPct: +(results.reduce((a, r) => a + r.ultFramedPct * r.ultTurns, 0) / Math.max(1, sum('ultTurns'))).toFixed(1),
    meanOnPct: +(results.reduce((a, r) => a + r.meanOnPct * r.turns, 0) / Math.max(1, sum('turns'))).toFixed(1),
    override: results.map((r) => r.override), errors: results.flatMap((r) => r.errors).length };
  console.log('SUMMARY ' + JSON.stringify(agg));
  if (JSON_OUT) fs.writeFileSync(JSON_OUT, JSON.stringify({ agg, results }, null, 1));
})().catch((e) => { console.error(e); process.exit(1); });
