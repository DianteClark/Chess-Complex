// Q 15.0: menu slowdown / leak probe (owner's bug: "the menus get slow after leaving some modes").
// Usage: NODE_PATH=$(npm root -g) node tests/q15/leak.cjs [--urls http://localhost:8125/,http://localhost:8123/]
//        [--cycles 8] [--modes royale,siege,hill,chaos,gauntlet,daily,squads,duel,blitz] [--play 7] [--json out.json]
// Per URL, one page: boot -> title sample; then N cycles of
//   start a solo match in the next mode (fast host, my turns auto-ended) -> play --play seconds -> leave mid-match
//   (Menu > Forfeit > results > Title; alternate cycles leave from the results of a finished-for-me match)
//   -> visit every menu screen and click through its tabs/segments -> back to title -> sample.
// A sample on the idle title: frame time (rAF, 3 s), CPU task seconds per second (CDP, robust on a loaded box), JS heap
// after 2 GCs, DOM nodes, JS listeners (CDP + add/remove counter), live intervals, pending timeouts, pending rAF
// callbacks, canvases, AudioNodes created per second, and a 3 s CPU profile of what runs on the title (anything from
// the match renderer = a leaked loop).
// Verdict per URL (cycle 2..N slope and cycle-1 reference, so first-use caches and music start do not count): heap < 1.5 MB/cycle, nodes < 150/cycle,
// listeners < 4/cycle, intervals and rAF pending back to boot level, title CPU/s within 1.35x of boot (+0.03),
// no match-only code (render/world/fx/hazards10/backdrop/camdir/wheel) in the idle title profile above 3%.
const { chromium } = require('playwright');
const fs = require('fs');
const A = process.argv.slice(2); const arg = (k, d) => { const i = A.indexOf('--' + k); return i >= 0 ? A[i + 1] : d; };
const URLS = arg('urls', 'http://localhost:8125/,http://localhost:8123/').split(',');
const CYCLES = +arg('cycles', 8), PLAY = +arg('play', 7);
const MODES = arg('modes', 'royale,siege,hill,chaos,gauntlet,daily,squads,duel,blitz').split(',');
const SCREENS = ['play', 'loadout', 'armory', 'path', 'trophies', 'profile', 'quests', 'codex', 'tutorial', 'howto'];
const MATCH_CODE = /(^|\/)(render|world|fx|hazards10|camdir|wheel|backdrop[^/]*|backdrops\/[a-z0-9]+|announcer)\.js$/;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const INIT = () => {
  const raf = window.requestAnimationFrame.bind(window); let pending = 0;
  window.requestAnimationFrame = (cb) => { pending++; return raf((t) => { pending--; cb(t); }); };
  window.__rafPending = () => pending;
  const L = (window.__listeners = { add: 0, remove: 0, byType: {} });
  const key = (t, ty) => (t === window ? 'window' : t === document ? 'document' : t.nodeName || (t.constructor && t.constructor.name) || '?') + ':' + ty;
  const add = EventTarget.prototype.addEventListener, rem = EventTarget.prototype.removeEventListener;
  EventTarget.prototype.addEventListener = function (t, f, o) { L.add++; const k = key(this, t); L.byType[k] = (L.byType[k] || 0) + 1; return add.call(this, t, f, o); };
  EventTarget.prototype.removeEventListener = function (t, f, o) { L.remove++; const k = key(this, t); L.byType[k] = (L.byType[k] || 0) - 1; return rem.call(this, t, f, o); };
  const si = window.setInterval, ci = window.clearInterval, st = window.setTimeout, ct = window.clearTimeout;
  const IV = (window.__intervals = new Map()), TO = (window.__timeouts = new Set());
  window.setInterval = function (f, ms, ...a) { const id = si.call(window, f, ms, ...a); IV.set(id, (new Error().stack || '').split('\n')[2] || ''); return id; };
  window.clearInterval = function (id) { IV.delete(id); return ci.call(window, id); };
  window.setTimeout = function (f, ms, ...a) { let id; const g = typeof f === 'function' ? function () { TO.delete(id); return f.apply(this, arguments); } : f; id = st.call(window, g, ms, ...a); TO.add(id); return id; };
  window.clearTimeout = function (id) { TO.delete(id); return ct.call(window, id); };
  // count audio nodes created (a leaked music/sfx loop keeps creating them on the title)
  window.__anodes = 0;
  try { const AC = window.AudioContext || window.webkitAudioContext; if (AC) for (const m of ['createOscillator', 'createGain', 'createBufferSource', 'createBiquadFilter', 'createStereoPanner', 'createDelay', 'createConvolver']) { const o = AC.prototype[m]; if (o) AC.prototype[m] = function () { window.__anodes++; return o.apply(this, arguments); }; } } catch {}
  // keep the daily login / sequel reveal / what's new out of the way
  window.__dismiss = si.call(window, () => {
    const lg = document.querySelector('#m-login:not(.hidden) #lg-claim'); if (lg) lg.click();
    const sq = document.querySelector('.sequel:not(.out)'); if (sq && performance.now() > 3000) sq.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    for (const b of document.querySelectorAll('#m-new:not(.hidden) [data-act="close-new"], #m-new:not(.hidden) .btn, #m-reveal:not(.hidden) [data-act="close-reveal"]')) b.click();
  }, 500);
};

async function open(browser, url) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await ctx.route(/unpkg\.com|fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  await ctx.addInitScript(INIT);
  const p = await ctx.newPage(); p.__errors = [];
  p.on('pageerror', (e) => p.__errors.push(e.message.split('\n')[0]));
  await p.goto(url, { waitUntil: 'load' });
  await p.waitForFunction(() => window.__cc && window.__cc.game, null, { timeout: 120000 });
  await sleep(4000);
  const cdp = await ctx.newCDPSession(p);
  await cdp.send('Performance.enable');
  return { ctx, p, cdp };
}
const metrics = async (cdp) => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]));

async function sample(p, cdp, label) {
  await p.evaluate(() => { for (const m of document.querySelectorAll('.modal:not(.hidden)')) if (!['m-login'].includes(m.id)) m.classList.add('hidden'); });
  await sleep(1500);
  const m0 = await metrics(cdp); const a0 = await p.evaluate(() => window.__anodes);
  const fr = await p.evaluate(() => new Promise((r) => { const ts = []; const t0 = performance.now(); const f = (t) => { ts.push(t); if (t - t0 < 3000) requestAnimationFrame(f); else r(ts); }; requestAnimationFrame(f); }));
  const m1 = await metrics(cdp); const a1 = await p.evaluate(() => window.__anodes);
  const d = fr.slice(1).map((x, i) => x - fr[i]).sort((a, b) => a - b); const wall = (m1.Timestamp - m0.Timestamp) || 3;
  // what runs on the idle title
  await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 1000 }); await cdp.send('Profiler.start');
  await sleep(3000);
  const { profile } = await cdp.send('Profiler.stop');
  const byId = new Map(profile.nodes.map((n) => [n.id, n])); const self = new Map(); let tot = 0, busy = 0;
  profile.samples.forEach((id, i) => { const f = byId.get(id).callFrame; const dt = profile.timeDeltas[i] || 0; tot += dt; if (/^\((idle|program|garbage collector)\)$/.test(f.functionName)) return; busy += dt; const file = f.url.replace(/^https?:\/\/[^/]+\//, ''); const k = `${f.functionName || '(anon)'} ${file}:${f.lineNumber + 1}`; self.set(k, (self.get(k) || 0) + dt); });
  const hot = [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => [k, +(100 * v / tot).toFixed(1)]);
  const matchCode = [...self.entries()].filter(([k]) => MATCH_CODE.test(k.split(' ')[1].replace(/:\d+$/, ''))).reduce((a, [, v]) => a + v, 0);
  await cdp.send('HeapProfiler.collectGarbage'); await sleep(300); await cdp.send('HeapProfiler.collectGarbage');
  const dc = await cdp.send('Memory.getDOMCounters'); const m2 = await metrics(cdp);
  const pg = await p.evaluate(() => ({ screen: (document.querySelector('.screen.active') || {}).id, listeners: window.__listeners.add - window.__listeners.remove, byType: { ...window.__listeners.byType }, intervals: window.__intervals.size, ivSites: [...window.__intervals.values()].map((s) => s.trim().replace(/^at /, '').replace(/https?:\/\/[^/]+\//, '').slice(0, 90)), timeouts: window.__timeouts.size, raf: window.__rafPending(), canvases: document.querySelectorAll('canvas').length, game: !!(window.__cc.game && window.__cc.game.s && !window.__cc.game.s.over), session: !!window.__cc.session }));
  return {
    label, screen: pg.screen, fps: +(d.length / 3).toFixed(1), frameAvg: +(d.reduce((a, b) => a + b, 0) / Math.max(1, d.length)).toFixed(1), frameP95: +(d[Math.floor(d.length * 0.95)] || 0).toFixed(1),
    cpu: +((m1.TaskDuration - m0.TaskDuration) / wall).toFixed(3), script: +((m1.ScriptDuration - m0.ScriptDuration) / wall).toFixed(3), busyPct: +(100 * busy / Math.max(1, tot)).toFixed(1), matchCodePct: +(100 * matchCode / Math.max(1, tot)).toFixed(1),
    heapMB: +(m2.JSHeapUsedSize / 1048576).toFixed(2), nodes: dc.nodes, jsListeners: dc.jsEventListeners, docs: dc.documents, listeners: pg.listeners, intervals: pg.intervals, timeouts: pg.timeouts, raf: pg.raf, canvases: pg.canvases,
    audioNodesPerSec: +((a1 - a0) / 3).toFixed(1), liveGame: pg.game, session: pg.session, hot, _byType: pg.byType, _iv: pg.ivSites,
  };
}

async function playAndLeave(p, mode, i) {
  await p.evaluate(([mode]) => {
    const cc = window.__cc; cc.profile.botLevel = 'normal'; cc.profile.mode = mode;
    const siege = ['siege', 'gauntlet'].includes(mode); cc.startSolo(siege ? 3 : mode === 'duel' ? 1 : 7, mode);
    clearInterval(window.__ap);
    window.__ap = setInterval(() => { const g = cc.game, s = cc.session; if (!s || !s.host) return; s.host.fast = true; try { if (g.myTurn()) s.send({ type: 'end' }); } catch {} }, 250);
  }, [mode]);
  await sleep(PLAY * 1000);
  // leave: menu > forfeit > results > title (the owner's path: quitting a mode mid-match)
  await p.evaluate(() => { clearInterval(window.__ap); const m = document.querySelector('#s-game [data-act="menu"]'); m && m.click(); });
  await sleep(400);
  await p.evaluate(() => { const f = document.querySelector('#m-menu [data-act="forfeit"]'); f && f.click(); });
  await p.waitForFunction(() => { const r = document.querySelector('#m-results'); return r && !r.classList.contains('hidden'); }, null, { timeout: 12000, polling: 300 }).catch(() => {});
  await sleep(i % 2 ? 2500 : 600); // odd cycles linger on the results (Play of the Match, podium)
  await p.evaluate(() => { const b = document.querySelector('#m-results [data-act="to-title"]') || document.querySelector('#m-results [data-act="back-party"]'); b && b.click(); });
  await sleep(900);
  await p.evaluate(() => { const y = document.querySelector('#cf-yes'); if (y && !y.closest('.hidden')) y.click(); });
  await sleep(800);
  const st = await p.evaluate(() => (document.querySelector('.screen.active') || {}).id);
  if (st !== 's-title') await p.evaluate(() => { const b = document.querySelector('.screen.active .back'); b && b.click(); });
  await sleep(600);
}
async function visitMenus(p) {
  for (const name of SCREENS) {
    const ok = await p.evaluate((name) => { const b = document.querySelector(`#s-title [data-go="${name}"]`); if (!b) return false; b.click(); return true; }, name);
    if (!ok) continue;
    await sleep(700);
    // click through tabs / segments on that screen (store tabs, codex tabs, loadout pieces, path pages)
    await p.evaluate(async () => {
      const sc = document.querySelector('.screen.active'); if (!sc) return;
      const tabs = [...sc.querySelectorAll('.tab, .tabs button, .seg button, [data-tab], [data-piece]')].filter((b) => b.offsetParent).slice(0, 10);
      for (const t of tabs) { t.click(); await new Promise((r) => setTimeout(r, 160)); }
    });
    await sleep(400);
    await p.evaluate(() => { for (const m of document.querySelectorAll('.modal:not(.hidden)')) m.classList.add('hidden'); const b = document.querySelector('.screen.active .back'); b && b.click(); });
    await sleep(500);
  }
  // settings modal open/close
  await p.evaluate(() => { const s = document.querySelector('#s-title [data-act="settings"], #s-title .settings-btn, [data-act="settings"]'); s && s.click(); });
  await sleep(500);
  await p.evaluate(() => { for (const m of document.querySelectorAll('.modal:not(.hidden)')) m.classList.add('hidden'); });
}

const slope = (rows, k) => { const xs = rows.slice(1); if (xs.length < 2) return 0; const n = xs.length; const mx = (n - 1) / 2; const my = xs.reduce((a, r) => a + r[k], 0) / n; let num = 0, den = 0; xs.forEach((r, i) => { num += (i - mx) * (r[k] - my); den += (i - mx) ** 2; }); return den ? num / den : 0; };
function verdict(rows) {
  // reference = after cycle 1 (boot is before the first gesture: no music, no caches); boot is reported only
  const boot = rows[1], c = rows.slice(1), last = rows[rows.length - 1];
  const out = [];
  const chk = (name, ok, info) => out.push({ name, ok, info });
  chk('heap slope < 1.5 MB/cycle', slope(c, 'heapMB') < 1.5, slope(c, 'heapMB').toFixed(2) + ' MB/cycle');
  chk('DOM nodes slope < 150/cycle', slope(c, 'nodes') < 150, slope(c, 'nodes').toFixed(0) + '/cycle');
  chk('listeners slope < 4/cycle', slope(c, 'listeners') < 4 && slope(c, 'jsListeners') < 4, `counter ${slope(c, 'listeners').toFixed(1)} cdp ${slope(c, 'jsListeners').toFixed(1)}/cycle`);
  chk('intervals back to cycle-1 level', last.intervals <= boot.intervals, `${boot.intervals} -> ${last.intervals} ${last._iv.slice(boot.intervals).join(' ; ')}`);
  chk('pending rAF back to cycle-1 level', last.raf <= boot.raf + 1, `${boot.raf} -> ${last.raf}`);
  chk('title CPU/s within 1.35x of cycle 1', last.cpu <= boot.cpu * 1.35 + 0.03, `${boot.cpu} -> ${last.cpu}`);
  chk('no match-only code on the idle title', Math.max(...c.map((r) => r.matchCodePct)) < 3, 'max ' + Math.max(...c.map((r) => r.matchCodePct)) + '% ' + (c.find((r) => r.matchCodePct >= 3) || { hot: [] }).hot.slice(0, 3).map((h) => h.join(' ')).join(' | '));
  chk('no live session after leaving', c.every((r) => !r.session), c.filter((r) => r.session).map((r) => r.label).join(','));
  chk('audio nodes on idle title not growing', last.audioNodesPerSec <= boot.audioNodesPerSec * 1.5 + 5, `${boot.audioNodesPerSec} -> ${last.audioNodesPerSec}/s`);
  return out;
}

(async () => {
  const browser = await chromium.launch();
  const report = { when: new Date().toISOString(), load: require('os').loadavg(), urls: {} };
  let fails = 0;
  for (const url of URLS) {
    const rows = []; let errs = [];
    try {
      const { ctx, p, cdp } = await open(browser, url);
      rows.push(await sample(p, cdp, 'boot'));
      for (let i = 1; i <= CYCLES; i++) { const mode = MODES[(i - 1) % MODES.length]; await playAndLeave(p, mode, i); await visitMenus(p); rows.push(await sample(p, cdp, `c${i}:${mode}`)); console.log(`${url} ${JSON.stringify((({ hot, _byType, _iv, ...r }) => r)(rows[rows.length - 1]))}`); }
      errs = p.__errors.slice(0, 8); await ctx.close();
    } catch (e) { errs.push('harness: ' + e.message.split('\n')[0]); }
    const v = rows.length > 2 ? verdict(rows) : [{ name: 'ran', ok: false, info: 'too few samples' }];
    const a = rows[1], b = rows[rows.length - 1]; const grow = {}; if (a && b) for (const k of Object.keys(b._byType)) { const dl = (b._byType[k] || 0) - (a._byType[k] || 0); if (dl > 0) grow[k] = dl; }
    report.urls[url] = { rows: rows.map(({ _byType, _iv, ...r }) => r), verdict: v, listenerGrowth: grow, errors: errs };
    console.log(`\nLEAK ${url}`);
    console.log('  label            screen     fps  frame  cpu/s  busy% match%  heapMB  nodes  jsL  lst  iv  to  raf  cnv  aud/s');
    for (const r of rows) console.log(`  ${r.label.padEnd(16)} ${String(r.screen).padEnd(9)} ${String(r.fps).padStart(5)} ${String(r.frameAvg).padStart(6)} ${String(r.cpu).padStart(6)} ${String(r.busyPct).padStart(5)} ${String(r.matchCodePct).padStart(6)} ${String(r.heapMB).padStart(7)} ${String(r.nodes).padStart(6)} ${String(r.jsListeners).padStart(4)} ${String(r.listeners).padStart(4)} ${String(r.intervals).padStart(3)} ${String(r.timeouts).padStart(3)} ${String(r.raf).padStart(4)} ${String(r.canvases).padStart(4)} ${String(r.audioNodesPerSec).padStart(6)}`);
    console.log('  hot on title at the end: ' + (b ? b.hot.map((h) => h[1] + '% ' + h[0]).join(' | ') : '-'));
    console.log('  listener growth c1 -> end: ' + JSON.stringify(grow));
    for (const c of v) { console.log(`  ${c.ok ? 'PASS' : 'FAIL'} ${c.name} :: ${c.info}`); if (!c.ok && url === URLS[URLS.length - 1]) fails++; }
    if (errs.length) console.log('  page errors: ' + [...new Set(errs)].join(' | '));
  }
  await browser.close();
  const out = arg('json', '/tmp/q15/leak.json'); try { fs.mkdirSync(require('path').dirname(out), { recursive: true }); fs.writeFileSync(out, JSON.stringify(report, null, 1)); } catch {}
  console.log(`leak: ${fails ? fails + ' FAIL on ' + URLS[URLS.length - 1] : 'all checks pass on ' + URLS[URLS.length - 1]} (verdict counts the last URL; earlier URLs are the baseline)`);
  process.exitCode = fails ? 1 : 0;
})();
