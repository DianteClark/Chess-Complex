// Shared helpers for the Chess Complex online lifecycle suite.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE = process.env.CC_URL || 'http://localhost:8141/';
const SHOTS = require('path').join(require('os').tmpdir(), 'cc-online-shots');
fs.mkdirSync(SHOTS, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class Run {
  constructor(browser, name, iter) { this.browser = browser; this.name = name; this.iter = iter; this.pages = {}; this.errors = []; this.notes = []; this.fails = []; this.shots = []; }
  async open() {
    this.ctx = await this.browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
    // PeerJS from unpkg is not needed for ?net=local; abort it so offline runs do not stall.
    await this.ctx.route(/unpkg\.com|fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  }
  async page(label) {
    const p = await this.ctx.newPage();
    p.on('pageerror', (e) => {
      const where = (e.stack || '').split('\n').slice(1, 4).map((l) => l.trim().replace(/https?:\/\/[^/]+\//, '')).join(' < ');
      if (/BroadcastChannel.*closed/.test(e.message)) this.notes.push(`KNOWN-E1 [${label}] postMessage on closed BroadcastChannel: ${where}`);
      else this.errors.push(`[${label}] pageerror: ${e.message} @ ${where}`);
    });
    p.on('console', (m) => { if (m.type() === 'error' && !/unpkg|peerjs|ERR_FAILED|Failed to load resource/i.test(m.text())) this.errors.push(`[${label}] console: ${m.text()}`); });
    // 17.0 (N2): CC_CLOUD=<url> (scenarios.js --cloud <url>) runs every page against a cloud Room (wrangler dev with
    // ROOM_TEST:1) instead of ?net=local. window.__ccHost() is the host lever for both: the PeerJS host's GameHost, or
    // in cloud runs a shim over the leader's lockstep state whose fast/go/kill/protect go to the Room's test ops.
    await p.addInitScript(() => {
      window.__ccHost = () => {
        const cc = window.__cc, s = cc && cc.session; if (!s) return undefined;
        if (s.host) return s.host;
        if (!s.cloud || !s.client) return undefined;
        const op = (m) => s.client.send({ t: 'test', ...m });
        const me = (pid) => (pid === 'me' ? s.myPid : pid);
        // s: a copy of the lockstep state in which the leader's own seat reads pid 'me', like the PeerJS host's; edit it
        // and call publish(ev) (the PeerJS lever pattern) to send it to the Room as test op 'put' (snap with ev)
        let last = null;
        return { cloud: true, get s() { const st = (s.client.match && s.client.match.s) || cc.game.s; if (!st) return st; const c = structuredClone(st); for (const u of c.units) if (u.pid === s.myPid) u.pid = 'me'; last = c; return c; }, publish(ev) { if (!last) return; const st = structuredClone(last); for (const u of st.units) if (u.pid === 'me') u.pid = s.myPid; op({ op: 'set', T: { fast: false } }); op({ op: 'put', state: st, ev: ev || [] }); }, /* real bot pace from here: a fast Room would play out a soul's 3 rounds before the Downed modal shows */ set fast(v) { op({ op: 'set', T: { fast: !!v } }); }, go() { op({ op: 'go' }); }, kill(pid) { op({ op: 'kill', pid: me(pid) }); }, protect(pids) { op({ op: 'protect', pids: pids.map(me) }); }, setBot(pid, on = true) { op({ op: 'bot', pid: pid === 'me' ? s.myPid : pid, on }); }, schedule() {} };
      };
    });
    // (&net=local too: voice keeps its offline loopback transport; hostLobby/clientJoin check the session really is cloud)
    await p.goto(BASE + (process.env.CC_CLOUD ? '?cloud=' + encodeURIComponent(process.env.CC_CLOUD) + '&net=local' : '?net=local'), { waitUntil: 'load' });
    await p.waitForFunction(() => window.__cc && window.__cc.game, null, { timeout: 15000 });
    // 17.0 (N2): a loaded test box can miss the 1.5 s health check and fall back to PeerJS (aborted here): allow 8 s
    if (process.env.CC_CLOUD) await p.evaluate(async () => { const C = await import('/js/cloud.js'); C.HEALTH.timeout = 8000; C.HEALTH.failFor = 0; return C.healthy(); });
    // 10.0: in a match toast() is routed to the Director hint lane (#gm-tip), so watch both
    await p.evaluate(() => { window.__toasts = []; for (const sel of ['#toast', '#gm-tip']) { const t = document.querySelector(sel); if (!t) continue; new MutationObserver(() => { const s = t.textContent.trim(); if (s && window.__toasts[window.__toasts.length - 1] !== s) window.__toasts.push(s); }).observe(t, { childList: true, characterData: true, subtree: true }); } });
    await sleep(900); // splash
    this.pages[label] = p;
    return p;
  }
  async close() { try { await this.ctx.close(); } catch {} }
  note(s) { this.notes.push(s); }
  check(cond, msg) { if (!cond) this.fails.push(msg); return cond; }
  async shot(label, tag) {
    const p = this.pages[label]; if (!p || p.isClosed()) return;
    const f = path.join(SHOTS, `${process.env.CC_TAG ? process.env.CC_TAG.replace("results-", "") + "-" : ""}${this.name}-${this.iter}-${label}-${tag}.png`);
    try { await p.screenshot({ path: f }); this.shots.push(f); } catch {}
  }
}

// Visible = in layout, not inside a hidden modal/screen.
async function visible(p, sel) {
  return p.evaluate((sel) => {
    const e = document.querySelector(sel); if (!e) return false;
    const sc = e.closest('.screen'); if (sc && !sc.classList.contains('active')) return false;
    const m = e.closest('.modal'); if (m && m.classList.contains('hidden')) return false;
    if (e.closest('.hidden')) return false;
    const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden';
  }, sel);
}
tap.blocked = [];
async function tap(p, sel, { force = false } = {}) {
  const ok = await visible(p, sel);
  if (!ok && !force) throw new Error(`not visible: ${sel}`);
  try { await p.click(sel, { timeout: 4000, force }); }
  catch (e) {
    const top = await p.evaluate((sel) => { const el = document.querySelector(sel); const r = el.getBoundingClientRect(); const t = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); const desc = (x) => x ? `${x.tagName.toLowerCase()}#${x.id}.${[...x.classList].join('.')}` : 'null'; return `top=${desc(t)} parent=${desc(t && t.parentElement)} anim=${el.getAnimations ? el.closest('.modal-box') && el.closest('.modal-box').getAnimations().length : '?'}`; }, sel).catch(() => '?');
    const m = /(<[^>]+> (from|intercepts)[^\n]*)/.exec(e.message);
    // fall back to a DOM click so the scenario can continue, but record the blocked tap
    await p.evaluate((sel) => document.querySelector(sel).click(), sel).catch(() => {});
    (p.__blocked = p.__blocked || []).push(`${sel}: ${m ? m[1] : 'timeout'} ${top}`);
    await sleep(300);
    return;
  }
  await sleep(/data-go|btn-host|to-title|rematch/.test(sel) ? 800 : 150); // screen transitions animate
}

// Snapshot of what a page is showing.
async function view(p) {
  if (!p || p.isClosed()) return { closed: true };
  return p.evaluate(() => {
    const cc = window.__cc, g = cc.game, s = cc.session;
    const open = [...document.querySelectorAll('.modal:not(.hidden)')].map((m) => m.id);
    const me = g.me;
    return {
      screen: (document.querySelector('.screen.active') || {}).id,
      modals: open,
      session: s ? s.mode : null,
      turnNo: g.s ? g.s.turnNo : null, over: g.s ? !!g.s.over : null,
      alive: me ? me.alive : null,
      resultsShown: g.resultsShown,
      rTitle: (document.querySelector('#r-title') || {}).textContent,
      rematchVisible: !document.querySelector('#btn-rematch').classList.contains('hidden'),
      marks: cc.profile.marks, games: cc.profile.stats ? cc.profile.stats.games : null, played: cc.profile.played.length,
      toasts: (window.__toasts || []).slice(),
      joinStatus: (document.querySelector('#join-status') || {}).textContent,
      hostTurn: s && s.host && s.host.s ? s.host.s.turnNo : null,
      hostStopped: s && s.host ? !!s.host.s.over : null,
      players: s && s.players ? s.players.length : null,
      joinLobby: [...document.querySelectorAll('#join-lobby li')].length,
    };
  });
}

// Simulated human: ends its turn quickly whenever it is its turn (unless paused).
async function autoplay(p, on = true, delay = 250) {
  await p.evaluate(([on, delay]) => {
    clearInterval(window.__ap);
    if (on) window.__ap = setInterval(() => { const g = window.__cc.game, s = window.__cc.session; try { if (s && s.send && g.myTurn()) s.send({ type: 'end' }); } catch {} }, delay);
  }, [on, delay]);
}

// Host-side lever: eliminate a unit by pid exactly the way engine.kill() does, then publish.
async function protectHumans(host) {
  await host.evaluate(async () => {
    { const h = window.__ccHost(); if (h && h.cloud) { window.__protect = new Set(h.s.units.filter((u) => u.kind === 'player' && !u.bot).map((u) => u.pid)); h.protect([...window.__protect]); return; } } // 17.0 (N2): the Room heals them
    const E = await import('/js/engine.js'); window.__protect = new Set(window.__cc.session.host.s.units.filter((u) => u.kind === 'player' && !u.bot).map((u) => u.pid));
    clearInterval(window.__pt); window.__pt = setInterval(() => { const h = window.__cc.session && window.__cc.session.host; if (!h) return; for (const u of h.s.units) if (u.alive && window.__protect.has(u.pid) && u.hp < E.stats(u).maxHp * 0.6) u.hp = E.stats(u).maxHp; }, 50);
  });
}
async function hostKill(host, pid) {
  return host.evaluate(async (pid) => {
    if (window.__protect) window.__protect.delete(pid);
    { const h = window.__ccHost(); if (h && h.cloud) { const v = h.s.units.find((u) => u.pid === pid && u.kind === 'player'); if (!v || !v.alive || h.s.over) return false; h.protect([...(window.__protect || [])]); h.kill(pid); await new Promise((r) => setTimeout(r, 150)); return true; } } // 17.0 (N2)
    const E = await import('/js/engine.js');
    const h = window.__cc.session.host; const s = h.s;
    const v = s.units.find((u) => u.pid === pid && u.kind === 'player'); if (!v || !v.alive || s.over) return false;
    v.alive = false; v.hp = 0; v.place = E.alivePlayers(s).length + 1;
    const ev = [{ e: 'death', id: v.id, by: null, x: v.x, y: v.y, cause: null }];
    const left = E.alivePlayers(s);
    if (left.length <= 1) { s.over = true; s.winner = left[0] ? left[0].id : null; if (left[0]) left[0].place = 1; ev.push({ e: 'over', winner: s.winner }); }
    if (!s.over && s.active === v.id) E.nextTurn(s, ev);
    s.v++; h.publish(ev); h.schedule();
    return true;
  }, pid);
}
async function pids(host) { return host.evaluate(() => window.__ccHost().s.units.filter((u) => u.kind === 'player').map((u) => ({ pid: u.pid === window.__cc.session.myPid ? 'me' : u.pid, alive: u.alive, bot: !!u.bot, name: u.name }))); } // cloud: the leader's own seat reads 'me' like the PeerJS host's
// Kill every bot except `keep` survivors (pids) to drive the match to its end.
async function killAllExcept(host, keep) {
  for (const u of await pids(host)) if (u.alive && !keep.includes(u.pid)) { await hostKill(host, u.pid); await sleep(60); }
}

// --- lobby setup ---
async function hostLobby(run, { mode = 'royale' } = {}) {
  const host = await run.page('host');
  await host.evaluate((m) => { window.__cc.profile.mode = m; window.__cc.profile.name = 'HostH'; }, mode);
  await tap(host, '#s-title [data-go="play"]').catch(async () => host.evaluate(() => document.querySelector('[data-go="play"]').click()));
  await tap(host, '#btn-host');
  await host.waitForFunction(() => /Room open/.test(document.querySelector('#host-status').textContent), null, { timeout: process.env.CC_CLOUD ? 12000 : 5000 });
  if (process.env.CC_CLOUD) run.check(await host.evaluate(() => !!(window.__cc.session && window.__cc.session.cloud)), 'host: not in a cloud room (fell back to the local/PeerJS host)');
  return { host, code: await host.textContent('#host-code') };
}
async function clientJoin(run, label, code, { expect = 'lobby' } = {}) {
  const c = run.pages[label] || await run.page(label);
  await c.evaluate((n) => { window.__cc.profile.name = n; }, label);
  if (!(await visible(c, '#in-code'))) await tap(c, '#s-title [data-go="join"]');
  await c.fill('#in-code', code);
  await tap(c, '#s-join [data-act="join"]');
  if (expect === 'lobby') await c.waitForFunction(() => /In the lobby/.test(document.querySelector('#join-status').textContent), null, { timeout: process.env.CC_CLOUD ? 10000 : 5000 });
  else await sleep(1200);
  if (process.env.CC_CLOUD && expect === 'lobby') run.check(await c.evaluate(() => !!(window.__cc.session && window.__cc.session.cloud)), `${label}: not in the cloud room (fell back to PeerJS/local)`);
  return c;
}
async function startMatch(run, host, { bots = 0, clients = [] } = {}) {
  for (let i = 0; i < bots; i++) await tap(host, '[data-act="add-bot"]');
  await readyAll(host, clients); // 15.0 (N): party members ready up before the leader can start
  await tap(host, '#btn-start-host');
  const all = [host, ...clients];
  for (const p of all) await p.waitForFunction(() => window.__cc.game.s && document.querySelector('.screen.active').id === 's-game', null, { timeout: process.env.CC_CLOUD ? 20000 : 8000 });
  await host.evaluate(() => { window.__ccHost().fast = true; });
  // 15.2: the intro now runs ~15 s; skip it on the host so the first turn starts right away
  await host.evaluate(() => { const h = window.__ccHost(); h && h.go && h.go(); });
  for (const p of all) await p.evaluate(() => { const i = window.__cc.intro; i && i.skipAll && i.skipAll(); }).catch(() => {});
  await sleep(1200);
}
async function clientPid(c) { return c.evaluate(() => window.__cc.session.myPid); }
// 15.0 (N): tap Ready Up on every member that is in the party lobby and not ready yet, then wait for the leader's Start.
async function readyAll(host, clients) {
  for (const c of clients) {
    if (c.isClosed()) continue;
    const st = await c.evaluate(() => { const b = document.querySelector('#btn-ready'); const s = window.__cc.session; return { btn: !!b && !b.classList.contains('hidden') && !b.disabled, ready: !!(s && s.amReady) }; });
    if (st.btn && !st.ready) await tap(c, '#btn-ready');
  }
  await waitFor(host, () => !document.querySelector('#btn-start-host').disabled, null, 5000);
}

// Is the match advancing on page p? Returns delta turnNo over ms.
async function advancing(p, ms = 4000) {
  const a = await view(p); await sleep(ms); const b = await view(p);
  return { from: a.turnNo, to: b.turnNo, moved: b.turnNo != null && a.turnNo != null && b.turnNo > a.turnNo };
}
async function waitFor(p, fn, arg, ms = 10000) {
  // Q 10.3: waitForFunction does not await a Promise returned by an async predicate (it is truthy at once), so poll those
  if (typeof fn === 'function' && fn.constructor && fn.constructor.name === 'AsyncFunction') { const t = Date.now(); while (Date.now() - t < ms) { try { if (await p.evaluate(fn, arg)) return true; } catch {} await sleep(150); } return false; }
  try { await p.waitForFunction(fn, arg, { timeout: ms }); return true; } catch { return false; } }
const waitResults = (p, ms = 12000) => waitFor(p, () => !document.querySelector('#m-results').classList.contains('hidden'), null, ms);
const waitDead = (p, ms = 12000) => waitFor(p, () => !document.querySelector('#m-dead').classList.contains('hidden'), null, ms);

module.exports = { protectHumans, chromium, Run, sleep, tap, visible, view, autoplay, hostKill, killAllExcept, pids, hostLobby, clientJoin, startMatch, clientPid, advancing, waitFor, waitResults, waitDead, readyAll };
