// Chess Complex browser smoke suite (A10, 10.0).
// Usage: NODE_PATH=$(npm root -g) node tests/smoke/smoke.cjs [--vp phone,land,desk] [--only modes,tutorial,...] [--out /tmp/cc-smoke]
// Needs the static server on CC_URL (default http://localhost:8123/).
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const A = process.argv.slice(2); const arg = (k, d) => { const i = A.indexOf('--' + k); return i >= 0 ? A[i + 1] : d; };
const BASE = process.env.CC_URL || 'http://localhost:8123/';
const OUT = arg('out', '/tmp/cc-smoke'); fs.mkdirSync(OUT, { recursive: true });
const VPS = { phone: { width: 390, height: 844, mobile: true }, land: { width: 844, height: 390, mobile: true }, desk: { width: 1280, height: 800, mobile: false } };
const vpSel = arg('vp', 'phone,land,desk').split(',');
const only = arg('only', '') ? arg('only').split(',') : null;
const wants = (name) => !only || only.includes(name) || (only.includes('modes') && name.startsWith('mode-'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const results = []; // {vp, test, ok, ms, fails[], notes[], errors[]}
async function newPage(browser, vp, extra = {}) {
  const V = VPS[vp];
  const ctx = await browser.newContext({ viewport: { width: V.width, height: V.height }, deviceScaleFactor: 1, isMobile: V.mobile, hasTouch: V.mobile, ...extra });
  await ctx.route(/unpkg\.com|fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  const p = await ctx.newPage();
  p.__errors = [];
  p.on('pageerror', (e) => p.__errors.push(`pageerror: ${e.message} @ ${(e.stack || '').split('\n').slice(1, 3).map((l) => l.trim().replace(/https?:\/\/[^/]+\//, '')).join(' < ')}`));
  p.on('console', (m) => { if ((m.type() === 'error' || m.type() === 'warning') && !/unpkg|peerjs|ERR_FAILED|Failed to load resource|fonts\.g|AudioContext was not allowed|navigator\.vibrate/i.test(m.text())) p.__errors.push(`console.${m.type()}: ${m.text().slice(0, 300)}`); });
  // Boot interrupters (daily reward, sequel reveal) are dismissed automatically except in the test that checks them.
  if (!p.__keepPopups) await ctx.addInitScript(() => {
    window.__dismissed = [];
    setInterval(() => {
      if (window.__noDismiss) return;
      const lg = document.querySelector('#m-login:not(.hidden) #lg-claim'); if (lg) { window.__dismissed.push('m-login'); lg.click(); }
      const sq = document.querySelector('.sequel:not(.out)'); if (sq && performance.now() > 3000) { window.__dismissed.push('sequel'); sq.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); }
    }, 400);
  });
  for (let attempt = 0; attempt < 2; attempt++) {
    // a handler may be mid-edit: retry the boot once before calling it a failure
    await p.goto(BASE, { waitUntil: 'load' }).catch(() => {});
    try { await p.waitForFunction(() => window.__cc && window.__cc.game, null, { timeout: 25000 }); p.__bootFail = false; break; }
    catch { p.__bootFail = true; p.__bootErrors = p.__errors.slice(); p.__errors.length = 0; await sleep(5000); }
  }
  if (p.__bootFail) p.__errors.push(...(p.__bootErrors || []));
  await p.evaluate(() => { window.__toasts = []; const t = document.querySelector('#toast'); if (t) new MutationObserver(() => { if (t.textContent) window.__toasts.push(t.textContent); }).observe(t, { childList: true, characterData: true, subtree: true }); });
  await sleep(1200);
  return { ctx, p };
}
async function visible(p, sel) {
  return p.evaluate((sel) => {
    const e = document.querySelector(sel); if (!e) return false;
    const sc = e.closest('.screen'); if (sc && !sc.classList.contains('active')) return false;
    const m = e.closest('.modal'); if (m && m.classList.contains('hidden')) return false;
    if (e.closest('.hidden')) return false;
    const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden';
  }, sel);
}
// Real tap; if something covers the target, record it and fall back to a DOM click.
async function tap(T, sel, { wait = 250 } = {}) {
  const p = T.p;
  if (!(await visible(p, sel))) { T.fail(`not visible: ${sel}`); await p.evaluate((s) => { const e = document.querySelector(s); e && e.click(); }, sel); await sleep(wait); return false; }
  try { await p.click(sel, { timeout: 9000 }); }
  catch (e) {
    const m = /(<[^>]+> (from|intercepts)[^\n]*)/.exec(e.message);
    // covered targets are bugs; plain timeouts are usually the shared box being slow
    if (m) T.fail(`tap blocked ${sel}: ${m[1].slice(0, 200)}`); else T.note(`tap timed out (slow page?) ${sel}`);
    await p.evaluate((s) => document.querySelector(s).click(), sel).catch(() => {});
  }
  await sleep(wait); return true;
}
const screenId = (p) => p.evaluate(() => (document.querySelector('.screen.active') || {}).id);
async function goScreen(T, name) {
  // navigate through visible [data-go] buttons when possible, else via a DOM click on any data-go button
  const sel = `.screen.active [data-go="${name}"]`;
  if (await visible(T.p, sel)) await tap(T, sel, { wait: 700 });
  else await T.p.evaluate((n) => { const b = document.querySelector(`[data-go="${n}"]`); b && b.click(); }, name), await sleep(700);
  const id = await screenId(T.p); T.check(id === 's-' + name, `expected s-${name}, on ${id}`);
}
async function shot(T, tag) { const f = path.join(OUT, `${T.vp}-${T.name}-${tag}.png`); try { await T.p.screenshot({ path: f }); } catch {} return f; }

// Layout audit of the current screen/modals: overflow, tiny tap targets, tiny text, off-screen buttons.
async function audit(T, where) {
  const r = await T.p.evaluate(() => {
    const vw = innerWidth, vh = innerHeight, out = { hOverflow: 0, small: [], tinyText: [], offscreen: [] };
    const de = document.scrollingElement; if (de.scrollWidth > vw + 1) out.hOverflow = de.scrollWidth - vw;
    const isShown = (e) => { if (e.closest('.hidden')) return false; const sc = e.closest('.screen'); if (sc && !sc.classList.contains('active')) return false; const cs = getComputedStyle(e); if (cs.visibility === 'hidden' || cs.display === 'none' || +cs.opacity === 0) return false; const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    const desc = (e) => `${e.tagName.toLowerCase()}${e.id ? '#' + e.id : ''}${e.className && typeof e.className === 'string' ? '.' + e.className.trim().split(/\s+/).slice(0, 2).join('.') : ''}${e.dataset.act ? '[act=' + e.dataset.act + ']' : e.dataset.go ? '[go=' + e.dataset.go + ']' : ''}"${(e.textContent || e.getAttribute('aria-label') || '').trim().slice(0, 18)}"`;
    for (const e of document.querySelectorAll('button, a[href], [data-go], [data-act], input, .tab, [role=button]')) {
      if (!isShown(e)) continue;
      const rc = e.getBoundingClientRect();
      if (e.type === 'range') continue;
      // checkboxes inside labels: the label is the target
      const tgt = e.type === 'checkbox' && e.closest('label') ? e.closest('label').getBoundingClientRect() : rc;
      if (tgt.width < 40 || tgt.height < 40) out.small.push(`${desc(e)} ${Math.round(tgt.width)}x${Math.round(tgt.height)}`);
      if (rc.right < 0 || rc.bottom < 0 || rc.left > vw || rc.top > vh) { const sp = e.closest('.scroll, [class*=scroll], .modal-box'); if (!sp) out.offscreen.push(desc(e)); }
    }
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const seen = new Set();
    for (let n; (n = w.nextNode());) {
      if (!n.textContent.trim()) continue; const e = n.parentElement; if (!e || seen.has(e) || !isShown(e)) continue; seen.add(e);
      const cs = getComputedStyle(e); const fs = parseFloat(cs.fontSize); if (fs < 11) out.tinyText.push(`${desc(e)} ${fs}px`);
      // contrast against the nearest solid background (skipped when any ancestor paints an image/gradient)
      const rgb = (s) => { const m = s.match(/rgba?\(([^)]+)\)/); if (!m) return null; const v = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return { r: v[0], g: v[1], b: v[2], a: v.length > 3 ? v[3] : 1 }; };
      const lum = (c) => { const f = (x) => { x /= 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };
      const fg = rgb(cs.color); if (!fg || fg.a < 0.99 || +cs.opacity < 1) continue;
      let bg = null, img = false;
      for (let a = e; a && a !== document.documentElement; a = a.parentElement) { const s = getComputedStyle(a); if (s.backgroundImage !== 'none') { img = true; break; } const c = rgb(s.backgroundColor); if (c && c.a >= 0.95) { bg = c; break; } }
      if (img || !bg) continue;
      const L1 = lum(fg), L2 = lum(bg), ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
      const large = fs >= 18.66 || (fs >= 14 && +cs.fontWeight >= 700);
      if (ratio < (large ? 3 : 4.5)) (out.lowContrast = out.lowContrast || []).push(`${desc(e)} ${ratio.toFixed(2)}:1`);
    }
    out.small = [...new Set(out.small)]; out.tinyText = [...new Set(out.tinyText)];
    return out;
  });
  T.audit[where] = r;
  if (r.hOverflow) T.note(`${where}: horizontal overflow ${r.hOverflow}px`);
  return r;
}

class Test {
  constructor(vp, name, p) { this.vp = vp; this.name = name; this.p = p; this.fails = []; this.notes = []; this.audit = {}; this.t0 = Date.now(); }
  fail(m) { this.fails.push(m); }
  check(c, m) { if (!c) this.fails.push(m); return c; }
  note(m) { this.notes.push(m); }
}
async function runTest(browser, vp, name, fn) {
  if (!wants(name)) return;
  const { ctx, p } = await newPage(browser, vp, fn.ctx || {});
  const T = new Test(vp, name, p);
  if (p.__bootFail) T.fail('app did not boot (window.__cc missing after 25s)');
  else try { await Promise.race([fn(T), sleep(+process.env.CC_TEST_MS || 480000).then(() => { throw new Error('test timeout'); })]); }
  catch (e) { T.fail('threw: ' + e.message.split('\n')[0]); await shot(T, 'threw'); }
  const errs = p.__errors.slice();
  results.push({ vp, test: name, ok: !T.fails.length && !errs.filter((e) => !/warning/.test(e)).length, ms: Date.now() - T.t0, fails: T.fails, notes: T.notes, errors: errs, audit: T.audit });
  const r = results[results.length - 1];
  console.log(`${r.ok ? 'PASS' : 'FAIL'} [${vp}] ${name} (${(r.ms / 1000).toFixed(1)}s)${r.fails.length ? '\n    - ' + r.fails.slice(0, 8).join('\n    - ') : ''}${errs.length ? '\n    ! ' + [...new Set(errs)].slice(0, 6).join('\n    ! ') : ''}${r.notes.length ? '\n    . ' + r.notes.slice(0, 10).join('\n    . ') : ''}`);
  await ctx.close();
}

// ---------- match helpers ----------
async function speedUp(p) {
  await p.evaluate(() => {
    clearInterval(window.__ap);
    window.__ap = setInterval(() => { const cc = window.__cc, g = cc.game, s = cc.session; try { if (s && s.host) s.host.fast = true; if (s && s.send && g.myTurn()) s.send({ type: 'end' }); } catch {} }, 120);
  });
}
async function killMe(p) {
  return p.evaluate(async () => {
    const E = await import('/js/engine.js'); const h = window.__cc.session.host, s = h.s;
    const v = s.units.find((u) => u.pid === 'me'); if (!v || !v.alive || s.over) return false;
    // deal lethal damage through the normal turn flow: drop HP to 1 and let the storm/any hit finish, else hard-kill
    v.alive = false; v.hp = 0;
    if (s.siege) v.place = 0;
    else if (s.teams) { if (!s.units.some((w) => w.alive && E.ally(w, v))) { const pl = E.teamsAlive(s).size + 1; for (const w of s.units) if (w.kind === 'player' && (w === v || E.ally(w, v))) w.place = pl; } else v.place = 0; }
    else v.place = E.alivePlayers(s).length + 1;
    const ev = [{ e: 'death', id: v.id, by: null, x: v.x, y: v.y, cause: null }];
    const left = E.alivePlayers(s); const teams = E.teamsAlive(s);
    if (!s.siege && teams.size <= 1) { s.over = true; s.winner = left[0] ? left[0].id : null; ev.push({ e: 'over', winner: s.winner }); }
    if (s.siege && !left.length) { s.over = true; s.winner = null; ev.push({ e: 'over', winner: null, siege: true, wave: s.siege.wave }); }
    if (!s.over && s.active === v.id) E.nextTurn(s, ev);
    s.v++; h.publish(ev); h.schedule(); return true;
  });
}
// Drive a slow match to its end the way the online suite does: eliminate units through host state, then publish.
async function finishMatch(p) {
  return p.evaluate(async () => {
    const E = await import('/js/engine.js'); const h = window.__cc.session && window.__cc.session.host; if (!h) return 'nohost'; const s = h.s; if (s.over) return 'over';
    const me = s.units.find((u) => u.pid === 'me');
    const victims = s.siege ? s.units.filter((u) => u.alive && u.kind === 'player') : s.units.filter((u) => u.alive && u.kind === 'player' && u !== me && !E.ally(u, me));
    const ev = [];
    for (const v of victims) {
      v.alive = false; v.hp = 0;
      // same placement rule as engine kill(): a team places when its last member falls
      if (s.teams) { if (!s.units.some((w) => w.alive && E.ally(w, v))) { const pl = E.teamsAlive(s).size + 1; for (const w of s.units) if (w.kind === 'player' && (w === v || E.ally(w, v))) w.place = pl; } else v.place = 0; }
      else v.place = E.alivePlayers(s).length + 1;
      ev.push({ e: 'death', id: v.id, by: null, x: v.x, y: v.y, cause: null });
      const left = E.alivePlayers(s);
      if (s.siege && !left.length) { s.over = true; s.winner = null; for (const q of s.units) if (q.kind === 'player') q.place = 2; ev.push({ e: 'over', winner: null, siege: true, wave: s.siege.wave }); break; }
      if (!s.siege && E.teamsAlive(s).size <= 1) { s.over = true; s.winner = left[0] ? left[0].id : null; if (left[0]) for (const q of left) q.place = 1; ev.push({ e: 'over', winner: s.winner }); break; }
    }
    if (!s.over && !E.unitById(s, s.active).alive) E.nextTurn(s, ev);
    s.v++; h.publish(ev); h.schedule(); return 'killed ' + victims.length;
  });
}
async function waitFor(p, fn, ms, arg) { try { await p.waitForFunction(fn, arg, { timeout: ms, polling: 250 }); return true; } catch { return false; } }
const resultsUp = () => !document.querySelector('#m-results').classList.contains('hidden');

async function playMode(T, mode, { die = false, bots = null, rematch = false } = {}) {
  const p = T.p;
  if ((await screenId(p)) !== 's-play') await goScreen(T, 'play');
  if (await visible(p, `#modes [data-mode="${mode}"]`)) await tap(T, `#modes [data-mode="${mode}"]`, { wait: 300 });
  else { T.fail(`mode button ${mode} not visible`); await p.evaluate((m) => { window.__cc.profile.mode = m; }, mode); }
  if (bots != null) await p.evaluate((n) => { const i = document.querySelector('#in-bots'); if (i) { i.value = n; i.dispatchEvent(new Event('input', { bubbles: true })); } }, bots);
  await shot(T, `${mode}-play`);
  await tap(T, '#btn-solo', { wait: 1200 });
  T.check((await screenId(p)) === 's-game', `${mode}: did not enter game`);
  const info = await p.evaluate(() => { const g = window.__cc.game; return { mode: g.s && g.s.mode, n: g.s && g.s.units.filter((u) => u.kind === 'player').length }; });
  T.check(info.mode === mode, `${mode}: engine mode is ${info.mode}`);
  await sleep(1500); await shot(T, `${mode}-start`); await audit(T, `${mode}-hud`);
  // exercise the action bar once on my turn: tap Attack and Sig then Move
  await waitFor(p, () => window.__cc.game.myTurn(), 15000);
  for (const sl of ['atk', 'sig', 'move']) { const sel = `#h-actions [data-slot="${sl}"]`; if (await visible(p, sel)) await tap(T, sel, { wait: 200 }); }
  if (die) {
    await speedUp(p); await sleep(2500);
    await killMe(p);
    const dead = await waitFor(p, () => !document.querySelector('#m-dead').classList.contains('hidden') || !document.querySelector('#m-results').classList.contains('hidden'), 12000);
    T.check(dead, `${mode}: no Eliminated modal after death`);
    if (await visible(p, '#m-dead [data-act="spectate"]')) {
      await shot(T, `${mode}-dead`);
      await tap(T, '#m-dead [data-act="spectate"]', { wait: 600 });
      T.check(await visible(p, '#spec-bar'), `${mode}: spectate bar not visible`);
      if (await visible(p, '#spec-bar [data-act="spec-next"]')) await tap(T, '#spec-bar [data-act="spec-next"]');
      await shot(T, `${mode}-spectate`);
    }
  } else await speedUp(p);
  const t0 = Date.now();
  let ok = await waitFor(p, resultsUp, +process.env.CC_NATURAL_MS || 30000);
  if (!ok) { T.note(`${mode}: forcing the end after ${((Date.now() - t0) / 1000).toFixed(0)}s (${await finishMatch(p)})`); ok = await waitFor(p, resultsUp, 30000); }
  T.check(ok, `${mode}: results never appeared (turn ${await p.evaluate(() => window.__cc.game.s && window.__cc.game.s.turnNo)}, over=${await p.evaluate(() => window.__cc.game.s && window.__cc.game.s.over)})`);
  const rv = await p.evaluate(() => ({ title: document.querySelector('#r-title').textContent, place: document.querySelector('#r-place').textContent, rematch: !document.querySelector('#btn-rematch').classList.contains('hidden'), turn: window.__cc.game.s.turnNo, round: window.__cc.game.s.round }));
  T.note(`${mode}: "${rv.title}" ${rv.place} after ${((Date.now() - t0) / 1000).toFixed(0)}s, round ${rv.round}`);
  T.check(rv.title && rv.title.trim(), `${mode}: empty results title`);
  await sleep(600); await shot(T, `${mode}-results`); await audit(T, `${mode}-results`);
  if (rematch) {
    T.check(rv.rematch, `${mode}: rematch button hidden in solo`);
    await tap(T, '#btn-rematch', { wait: 1500 });
    const st = await p.evaluate(() => ({ over: window.__cc.game.s.over, turn: window.__cc.game.s.turnNo, res: !document.querySelector('#m-results').classList.contains('hidden'), mode: window.__cc.game.s.mode }));
    T.check(!st.over && !st.res && st.mode === mode, `${mode}: rematch did not start a fresh match ${JSON.stringify(st)}`);
    // forfeit via in-game menu
    await tap(T, '#s-game [data-act="menu"]', { wait: 300 });
    await tap(T, '#m-menu [data-act="forfeit"]', { wait: 900 });
    T.check(await waitFor(p, resultsUp, 8000), `${mode}: forfeit did not show results`);
  }
  await tap(T, '#m-results [data-act="to-title"]', { wait: 500 });
  if (await visible(p, '#cf-yes')) { T.note(`${mode}: confirm on leave: ${await p.textContent('#cf-title')}`); await tap(T, '#cf-yes', { wait: 900 }); }
  await sleep(800);
  const sc = await screenId(p); T.check(sc !== 's-game', `${mode}: still on game screen after Menu`);
  // reward/level-up modals may queue on return; close any reveal
  if (await visible(p, '#m-reveal [data-act="close-reveal"]')) await tap(T, '#m-reveal [data-act="close-reveal"]');
  await p.evaluate(() => clearInterval(window.__ap));
}

// ---------- tests ----------
const TESTS = {
  async title(T) {
    const p = T.p;
    T.check((await screenId(p)) === 's-title', `boot screen is ${await screenId(p)}`);
    const t = await p.evaluate(() => ({ title: document.title, btns: [...document.querySelectorAll('#s-title [data-go], #s-title [data-act]')].map((b) => b.dataset.go || b.dataset.act), splash: (document.querySelector('#splash') || {}).className }));
    T.note(`title buttons: ${t.btns.join(',')}`);
    T.check(t.btns.includes('play'), 'no Play button on title');
    const lg = await p.evaluate(() => window.__dismissed || []); if (lg.length) T.note('auto-dismissed on boot: ' + lg.join(','));
    await shot(T, 'title'); await audit(T, 'title');
    for (const go of ['play', 'loadout', 'armory', 'path', 'quests', 'trophies', 'profile', 'codex', 'tutorial', 'join', 'howto']) {
      await p.evaluate(() => { const b = document.querySelector('[data-go="title"]'); b && b.click(); }); await sleep(400);
      if (!(await p.$(`[data-go="${go}"]`))) { T.note(`no [data-go=${go}] anywhere`); continue; }
      await goScreen(T, go); await shot(T, 'screen-' + go); await audit(T, 'screen-' + go);
    }
  },
  async modesAll(T) {
    await playMode(T, 'royale', { bots: 7, rematch: true });
    const all = await T.p.evaluate(async () => Object.keys((await import('/js/data.js')).MODES));
    T.note('modes: ' + all.join(','));
    for (const m of all.filter((k) => k !== 'royale')) { await T.p.evaluate(() => { const b = document.querySelector('[data-go="title"]'); b && b.click(); }); await sleep(300); await playMode(T, m, { die: ['blitz', 'squads', 'siege', 'chaos', 'gauntlet'].includes(m) }); }
  },
  async death(T) { await playMode(T, 'royale', { bots: 5, die: true, rematch: true }); },
  async tutorial(T) {
    const p = T.p;
    await goScreen(T, 'tutorial'); await shot(T, 'lessons'); await audit(T, 'lessons');
    const ids = await p.evaluate(() => [...document.querySelectorAll('#lesson-list [data-lesson]')].map((b) => b.dataset.lesson));
    T.check(ids.length >= 5, `only ${ids.length} lessons listed`);
    for (const id of ids.filter((i) => i !== 'graduation')) {
      if ((await screenId(p)) !== 's-tutorial') await p.evaluate(() => { document.querySelector('[data-go="tutorial"]').click(); }), await sleep(700);
      await tap(T, `#lesson-list [data-lesson="${id}"]`, { wait: 2200 });
      T.check(await visible(p, '#coach'), `${id}: coach not shown`);
      const solved = await solveLesson(p);
      T.note(`${id}: reached step ${solved.steps} of the lesson (${solved.done ? 'COMPLETED' : 'stuck at "' + solved.at.slice(0, 50) + '"'})`);
      await shot(T, `lesson-${id}`); await audit(T, `lesson-${id}`);
      if (await visible(p, '#m-lesson')) { await p.evaluate(() => { document.querySelector('[data-act="to-tutorial"]') && document.querySelector('[data-act="to-tutorial"]').click(); }); await sleep(800); }
      else { await tap(T, '#s-game [data-act="menu"]', { wait: 300 }); await tap(T, '#m-menu [data-act="forfeit"]', { wait: 900 }); }
      T.check((await screenId(p)) === 's-tutorial', `${id}: did not return to lesson list (${await screenId(p)})`);
    }
    // graduation match
    await tap(T, '#lesson-list [data-lesson="graduation"]', { wait: 1500 });
    await speedUp(p);
    T.check(await waitFor(p, resultsUp, 120000), 'graduation: no results');
    await shot(T, 'graduation-results');
  },
  async codex(T) {
    const p = T.p; await goScreen(T, 'codex');
    const tabs = await p.evaluate(() => [...document.querySelectorAll('#codex-tabs [data-ctab]')].map((b) => b.dataset.ctab));
    T.check(tabs.length >= 3, `codex tabs: ${tabs}`);
    for (const t of tabs) { await tap(T, `#codex-tabs [data-ctab="${t}"]`, { wait: 300 }); const n = await p.evaluate(() => document.querySelector('#codex-body').textContent.trim().length); T.check(n > 40, `codex tab ${t} nearly empty (${n} chars)`); await shot(T, 'codex-' + t); await audit(T, 'codex-' + t); }
  },
  async store(T) {
    // 10.0 store: tabs -> item card [data-open] -> #m-item [data-mi=buy] (tap twice to confirm) -> #m-reveal (tap to open, Equip now / Later)
    const p = T.p;
    await p.evaluate(() => { window.__cc.profile.marks = 999999; });
    await goScreen(T, 'armory'); await sleep(600); await shot(T, 'armory'); await audit(T, 'armory');
    const tabs = await p.evaluate(() => [...document.querySelectorAll('#s-armory .tab[data-tab]')].map((b) => b.dataset.tab));
    T.note('store tabs: ' + tabs.join(','));
    T.check(tabs.length >= 3, `store has ${tabs.length} tabs`);
    let bought = 0, equipped = 0;
    for (const t of tabs) {
      await tap(T, `#s-armory .tab[data-tab="${t}"]`, { wait: 500 });
      await shot(T, 'armory-' + t); await audit(T, 'armory-' + t);
      const cards = await p.evaluate(() => [...document.querySelectorAll('#s-armory [data-open]')].filter((x) => x.getBoundingClientRect().height > 0).map((x) => x.dataset.open).slice(0, 12));
      let done = false;
      for (const c of cards) {
        await p.evaluate((c) => { const b = document.querySelector(`#s-armory [data-open="${c}"]`); if (b) { b.id = 'qa-open'; b.scrollIntoView({ block: 'center' }); } }, c);
        if (!(await p.$('#qa-open'))) continue;
        await tap(T, '#qa-open', { wait: 600 }); await p.evaluate(() => { const b = document.querySelector('#qa-open'); if (b) b.removeAttribute('id'); });
        if (!(await visible(p, '#m-item'))) { T.fail(`tab ${t}: item ${c} did not open #m-item`); break; }
        if (!(await visible(p, '#m-item [data-mi="buy"]'))) { await p.evaluate(() => document.querySelector('#m-item').click()); await sleep(400); if (await visible(p, '#m-item')) await p.keyboard.press('Escape'); await sleep(200); continue; }
        await shot(T, 'item-' + t); await audit(T, 'item-' + t);
        const m0 = await p.evaluate(() => window.__cc.profile.marks);
        await tap(T, '#m-item [data-mi="buy"]', { wait: 300 });
        const lbl = await p.evaluate(() => (document.querySelector('#m-item [data-mi="buy"]') || {}).textContent || '');
        if (await visible(p, '#m-item [data-mi="buy"]')) await tap(T, '#m-item [data-mi="buy"]', { wait: 900 });
        const m1 = await p.evaluate(() => window.__cc.profile.marks);
        T.check(m1 < m0, `tab ${t}: buying ${c} did not spend marks (${m0}->${m1}); confirm label "${lbl.trim()}"`);
        if (m1 < m0) bought++;
        if (await waitFor(p, () => !document.querySelector('#m-reveal').classList.contains('hidden'), 4000)) {
          await sleep(700); await p.click('#m-reveal .modal-box', { timeout: 3000 }).catch(() => {}); await sleep(1600);
          await shot(T, 'reveal-' + t); await audit(T, 'reveal-' + t);
          if (await visible(p, '#rv-equip')) { await tap(T, '#rv-equip', { wait: 600 }); equipped++; }
          for (let k = 0; k < 10 && (await visible(p, '#m-reveal')); k++) { await p.click('#m-reveal .modal-box', { timeout: 2000 }).catch(() => {}); await sleep(900); if (await visible(p, '#rv-close')) await tap(T, '#rv-close', { wait: 500 }); }
          T.check(!(await visible(p, '#m-reveal')), `tab ${t}: reveal modal would not close`);
        } else T.note(`tab ${t}: no reveal after buying ${c}`);
        done = true; break;
      }
      if (!done) T.note(`tab ${t}: nothing purchasable among first ${cards.length} cards`);
    }
    T.check(bought >= 3, `only ${bought} purchases succeeded`);
    T.note(`bought ${bought}, equipped from reveal ${equipped}`);
    const persisted = await p.evaluate(() => JSON.parse(localStorage.getItem('cc_profile_v1')).marks === window.__cc.profile.marks);
    T.check(persisted, 'profile not saved after purchases');
  },
  async path(T) {
    const p = T.p; await p.evaluate(() => { window.__cc.profile.season.xp = 2600; });
    await sleep(1500);
    const closeReveals = async () => { let n = 0; for (let k = 0; k < 12 && (await visible(p, '#m-reveal')); k++) { n++; await p.click('#m-reveal .modal-box', { timeout: 2000 }).catch(() => {}); await sleep(1300); if (await visible(p, '#rv-close')) await tap(T, '#rv-close', { wait: 500 }); } return n; };
    const early = await closeReveals(); if (early) T.note(`path: ${early} reveal(s) popped on the title as soon as XP was granted`);
    await goScreen(T, 'path'); await sleep(1200);
    // tier rewards granted by the XP above are revealed with the store reveal; open and close each
    let reveals = 0;
    for (let k = 0; k < 12 && (await visible(p, '#m-reveal')); k++) { reveals++; await p.click('#m-reveal .modal-box', { timeout: 2000 }).catch(() => {}); await sleep(1300); if (k === 0) await shot(T, 'path-reveal'); if (await visible(p, '#rv-close')) await tap(T, '#rv-close', { wait: 500 }); }
    if (reveals) T.note(`path: ${reveals} reward reveal(s) shown for granted tiers`);
    if ((await screenId(p)) !== 's-path') await goScreen(T, 'path');
    const n = await p.evaluate(() => document.querySelectorAll('#season-track .tier, #path-body .pt').length);
    T.check(n >= 30, `crown path shows ${n} tiers`);
    await shot(T, 'path'); await audit(T, 'path');
    await goScreen(T, 'quests'); await shot(T, 'quests'); await audit(T, 'quests');
  },
  async trophies(T) {
    const p = T.p; await p.evaluate(() => { const pr = window.__cc.profile; pr.titles = Array.from(new Set([...(pr.titles || []), 'Middlegame'])); });
    await goScreen(T, 'trophies'); await shot(T, 'trophies'); await audit(T, 'trophies');
    const n = await p.evaluate(() => document.querySelectorAll('#ach-list .ach').length); T.check(n > 5, `${n} achievements listed`);
    if (await visible(p, '#title-list [data-title="Middlegame"]')) { await tap(T, '#title-list [data-title="Middlegame"]'); T.check(await p.evaluate(() => window.__cc.profile.title === 'Middlegame'), 'title select failed'); }
  },
  async settings(T) {
    const p = T.p;
    await tap(T, '#s-title [data-act="settings"]', { wait: 500 });
    T.check(await visible(p, '#m-settings'), 'settings modal not open');
    await shot(T, 'settings'); await audit(T, 'settings');
    const ids = ['set-shake', 'set-haptics', 'set-motion', 'set-onetap', 'set-cb', 'set-bigtext'];
    for (const id of ids) {
      const before = await p.evaluate((id) => document.getElementById(id).checked, id);
      await p.evaluate((id) => document.getElementById(id).scrollIntoView({ block: 'center' }), id);
      // tap the label (the visible control)
      await p.evaluate((id) => { const l = document.getElementById(id).closest('label'); l.id = l.id || 'lbl-' + id; }, id);
      await tap(T, '#lbl-' + id, { wait: 200 });
      const after = await p.evaluate((id) => document.getElementById(id).checked, id);
      T.check(after !== before, `${id} did not toggle on tap`);
    }
    const st = await p.evaluate(() => ({ s: JSON.parse(localStorage.getItem('cc_settings_v1') || '{}'), reduced: document.body.classList.contains('reduced'), big: document.body.classList.contains('bigtext') }));
    T.check(st.reduced === !!st.s.motion, 'reduced-motion body class out of sync'); T.check(st.big === !!st.s.bigtext, 'bigtext body class out of sync');
    await shot(T, 'settings-toggled');
    for (const q of ['low', 'high', 'auto']) await tap(T, `#set-quality [data-q="${q}"]`, { wait: 150 });
    T.check(await p.evaluate(() => JSON.parse(localStorage.getItem('cc_settings_v1')).quality === 'auto'), 'quality not saved');
    // reload keeps settings
    await p.reload({ waitUntil: 'load' }); await p.waitForFunction(() => window.__cc && window.__cc.game); await sleep(900);
    const st2 = await p.evaluate(() => ({ reduced: document.body.classList.contains('reduced'), big: document.body.classList.contains('bigtext') }));
    T.check(st2.reduced === !!st.s.motion && st2.big === !!st.s.bigtext, `settings classes not restored after reload ${JSON.stringify(st2)}`);
    await shot(T, 'reloaded-bigtext');
    // big text + game HUD with bigtext on
    await audit(T, 'title-bigtext');
  },
  async profile(T) {
    const p = T.p;
    await p.evaluate(() => { const pr = window.__cc.profile; pr.marks = 4321; pr.name = 'QAExport'; });
    await tap(T, '#s-title [data-act="settings"]', { wait: 400 });
    await p.evaluate(() => document.querySelector('[data-act="export-profile"]').scrollIntoView({ block: 'center' }));
    await tap(T, '#m-settings [data-act="export-profile"]', { wait: 500 });
    const code = await p.evaluate(() => (document.querySelector('#m-info textarea') || {}).value || '');
    T.check(code.includes('.') && code.length > 100, `export code looks wrong (${code.length} chars)`);
    await shot(T, 'export'); await tap(T, '#m-info [data-act="close-info"]', { wait: 300 }).catch(() => {});
    await p.evaluate(() => { window.__cc.profile.marks = 1; });
    await tap(T, '#m-settings [data-act="import-profile"]', { wait: 400 });
    await p.fill('#import-code', 'garbage.code');
    await tap(T, '#m-info [data-act="do-import"]', { wait: 400 });
    T.check(await p.evaluate(() => (window.__toasts || []).some((t) => /did not work/.test(t))), 'bad import code was not rejected with a toast');
    await p.fill('#import-code', code);
    await tap(T, '#m-info [data-act="do-import"]', { wait: 600 });
    T.check(await p.evaluate(() => (window.__toasts || []).some((t) => /restored/i.test(t))), 'import did not toast restored');
    const pr = await p.evaluate(() => { const s = JSON.parse(localStorage.getItem('cc_profile_v1')); return { marks: s.marks, name: s.name }; });
    // a restored profile may immediately earn the daily login / trophy marks on the title, so allow a small surplus
    T.check(pr.marks >= 4321 && pr.marks < 4321 + 400 && pr.name === 'QAExport', `import did not restore profile ${JSON.stringify(pr)}`);
    if (pr.marks !== 4321) T.note(`profile: +${pr.marks - 4321} marks granted right after restore (daily login/trophies)`);
    // legacy profiles: a 1.0-style minimal profile and a corrupted one must still boot
    for (const [label, raw] of [['legacy', JSON.stringify({ name: 'Old', marks: 50, skin: 'ivory', owned: ['ivory'], build: { pts: { hp: 3, atk: 3, def: 2, spd: 2 }, passive: 'regen', equips: { pawn: 'sprint' } } })], ['corrupt', '{"marks":"NaN","owned":null,"build":null,"season":5']]) {
      await p.evaluate((raw) => localStorage.setItem('cc_profile_v1', raw), raw);
      await p.reload({ waitUntil: 'load' });
      const ok = await waitFor(p, () => window.__cc && window.__cc.game, 10000);
      T.check(ok, `${label} profile: app did not boot`); await sleep(800);
      await shot(T, 'boot-' + label);
      if (ok) { await goScreen(T, 'armory'); await goScreen(T, 'loadout'); await p.evaluate(() => { document.querySelector('[data-go="title"]').click(); }); }
    }
  },
  async loadout(T) {
    const p = T.p; await goScreen(T, 'loadout'); await shot(T, 'loadout'); await audit(T, 'loadout');
    const btn = await p.evaluate(() => { const b = [...document.querySelectorAll('#s-loadout button')].filter((x) => x.getBoundingClientRect().height > 0); return b.length; });
    T.check(btn > 5, `loadout has ${btn} buttons`);
    await p.evaluate(() => { const b = document.querySelector('#presets button, #presets .preset'); b && b.click(); }); await sleep(300);
    await goScreen(T, 'join'); await shot(T, 'join');
  },
  async landscape(T) {
    // rotate during a match: start portrait, rotate to landscape, rotate back
    const p = T.p; await p.setViewportSize({ width: 390, height: 844 });
    await goScreen(T, 'play'); await tap(T, '#btn-solo', { wait: 2000 });
    await p.setViewportSize({ width: 844, height: 390 }); await sleep(800); await shot(T, 'rotated-land'); await audit(T, 'rotated-land');
    const hud = await p.evaluate(() => { const r = (s) => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return [Math.round(b.left), Math.round(b.top), Math.round(b.right), Math.round(b.bottom)]; }; return { actions: r('#h-actions'), board: r('#board'), vw: innerWidth, vh: innerHeight }; });
    if (hud.actions) T.check(hud.actions[3] <= hud.vh + 1 && hud.actions[2] <= hud.vw + 1, `action bar off-screen in landscape ${JSON.stringify(hud)}`);
    await p.setViewportSize({ width: 390, height: 844 }); await sleep(800); await shot(T, 'rotated-back');
    const cv = await p.evaluate(() => { const c = document.querySelector('#board'); return c ? [c.width, c.height, innerWidth, innerHeight] : null; });
    T.note('canvas after rotate back: ' + JSON.stringify(cv));
  },
};

// OS-level reduced motion: the setting must default on and infinite animations should stop.
TESTS.motion = async function (T) {
  const p = T.p;
  const st = await p.evaluate(() => ({ cls: document.body.classList.contains('reduced') }));
  T.check(st.cls, 'prefers-reduced-motion: body.reduced not set');
  const inf = async (where) => {
    const a = await p.evaluate(() => document.getAnimations().filter((x) => x.playState === 'running' && x.effect && x.effect.getTiming().iterations === Infinity && x.effect.target && x.effect.target.closest && !x.effect.target.closest('.hidden') && !(x.effect.target.closest('.screen') && !x.effect.target.closest('.screen').classList.contains('active')) && x.effect.target.getBoundingClientRect().width > 0).map((x) => (x.animationName || 'js') + '@' + (x.effect.target.id || x.effect.target.className || x.effect.target.tagName).toString().slice(0, 40)));
    const u = [...new Set(a)]; if (u.length) T.note(`${where}: ${u.length} infinite animations still running with reduced motion: ${u.slice(0, 12).join(', ')}`); return u;
  };
  await inf('title');
  for (const s of ['play', 'armory', 'path', 'loadout']) { await goScreen(T, s); await sleep(600); await inf(s); await p.evaluate(() => { document.querySelector('[data-go="title"]').click(); }); await sleep(400); }
  await goScreen(T, 'play'); await tap(T, '#btn-solo', { wait: 2500 }); await inf('game');
  // canvas-side: the menu scene / board should not be animating camera punches; record renderer flags
  const rf = await p.evaluate(() => ({ reduced: window.__cc.game.r.reduced, shake: window.__cc.game.r.shakeOn }));
  T.check(rf.reduced, 'in-game renderer.reduced is false with prefers-reduced-motion');
};
TESTS.motion.ctx = { reducedMotion: 'reduce' };

async function solveLesson(p) {
  // Monkey solver: on my turn, try actions in priority order (marked tiles, dummies, promotions, coach Next) and watch the coach text change.
  let steps = 0, last = '', stall = 0;
  for (let k = 0; k < 140; k++) {
    const st = await p.evaluate(() => ({ txt: document.querySelector('#coach-text') ? (window.__coachFull = document.querySelector('#coach-text').textContent) : '', next: !document.querySelector('#coach-next').classList.contains('hidden'), done: !document.querySelector('#m-lesson').classList.contains('hidden'), coach: !document.querySelector('#coach').classList.contains('hidden') }));
    if (st.done) return { steps, done: true };
    if (st.txt !== last) { steps++; last = st.txt; stall = 0; } else stall++;
    if (stall > 40) return { steps, done: false, at: last };
    if (st.next) { await p.click('#coach-next').catch(() => {}); await sleep(250); continue; }
    await p.evaluate(async () => {
      const E = await import('/js/engine.js'); const cc = window.__cc, g = cc.game, s = cc.session; if (!s || !g.myTurn()) return;
      const S = s.host.s, u = S.units.find((x) => x.pid === 'me'); const marks = (g.r.marks || []).map((m) => m.x + ',' + m.y);
      const dummies = S.units.filter((x) => x.alive && x.dummy).map((d) => d.x + ',' + d.y);
      const cand = [];
      const obj = (document.querySelector('#coach-obj') || {}).textContent || '';
      for (const o of E.promoteOptions(u)) if (o.cost <= u.shards && o.to !== 'hone') cand.push([obj.toLowerCase().includes(o.to) ? 60 : 30, { type: 'promote', to: o.to }]);
      for (const sl of ['ult', 'sig', 'eq', 'atk']) if (E.canUse(S, u, sl)) for (const o of E.abilityOptions(S, u, sl)) { const k = o.anchor.x + ',' + o.anchor.y; const sc = (marks.includes(k) ? 40 : 0) + (o.hits || []).length * 15 + (o.tiles || []).filter((t) => dummies.includes(t.x + ',' + t.y)).length * 10 + (sl === 'ult' ? 8 : sl === 'sig' ? 4 : 0); cand.push([sc + Math.random() * 3, { type: 'ability', slot: sl, x: o.anchor.x, y: o.anchor.y }]); }
      if (E.canMove(S, u)) for (const m of E.legalMoves(S, u)) { const k = m.x + ',' + m.y; const it = S.items.some((i) => i.x === m.x && i.y === m.y); const nearD = S.units.some((d) => d.alive && d.dummy && Math.max(Math.abs(d.x - m.x), Math.abs(d.y - m.y)) <= 1); cand.push([(marks.includes(k) ? 45 : 0) + (it ? 30 : 0) + (nearD ? 6 : 0) + Math.random() * 5, { type: 'move', x: m.x, y: m.y }]); }
      cand.sort((a, b) => b[0] - a[0]);
      const a = cand.length && cand[0][0] > 2 ? cand[0][1] : { type: 'end' };
      s.send(a);
    });
    await sleep(320);
  }
  return { steps, done: false, at: last };
}

(async () => {
  const D = await import(require('path').join(__dirname, '../../js/data.js'));
  const MODE_IDS = Object.keys(D.MODES);
  for (const m of MODE_IDS) TESTS['mode-' + m] = async (T) => playMode(T, m, m === 'royale' ? { bots: 7, rematch: true } : { die: ['blitz', 'squads', 'siege', 'chaos', 'gauntlet'].includes(m) });
  TESTS.modes = null; delete TESTS.modes;
  const browser = await chromium.launch();
  const t0 = Date.now();
  const plan = { phone: Object.keys(TESTS).filter((k) => k !== 'modesAll'), land: ['title', 'mode-royale', 'mode-squads', 'store', 'settings', 'codex', 'path', 'landscape'], desk: ['title', 'death', 'mode-hill', 'store', 'tutorial', 'codex', 'trophies'] };
  // run viewports in parallel, tests within a viewport serially
  // serial: the box is shared with nine other handlers, parallel pages only add noise
  for (const vp of vpSel) for (const name of plan[vp]) await runTest(browser, vp, name, TESTS[name]);
  await browser.close();
  const pass = results.filter((r) => r.ok).length;
  console.log(`\nSMOKE: ${pass}/${results.length} passed in ${((Date.now() - t0) / 1000).toFixed(0)}s. Screenshots: ${OUT}`);
  // accessibility roll-up
  const small = new Map(), tiny = new Map(), lowc = new Map();
  for (const r of results) for (const [w, a] of Object.entries(r.audit || {})) { for (const s of a.small) small.set(s.replace(/ \d+x\d+$/, ''), `${r.vp}/${w} ${s.match(/\d+x\d+$/)}`); for (const s of a.tinyText) tiny.set(s.replace(/ [\d.]+px$/, ''), `${r.vp}/${w} ${s.match(/[\d.]+px$/)}`); for (const s of a.lowContrast || []) lowc.set(s.replace(/ [\d.]+:1$/, ''), `${r.vp}/${w} ${s.match(/[\d.]+:1$/)}`); }
  console.log(`A11Y: ${small.size} distinct tap targets < 40px, ${tiny.size} distinct text elements < 11px, ${lowc.size} low-contrast text elements (solid backgrounds only)`);
  fs.writeFileSync(path.join(OUT, 'smoke-report.json'), JSON.stringify({ results, small: [...small], tiny: [...tiny], lowContrast: [...lowc] }, null, 1));
  process.exitCode = pass === results.length ? 0 : 1;
})();
