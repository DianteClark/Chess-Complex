// Chess Complex layout crawler (B1, 10.1). Visits every screen, tab, modal and match state, screenshots each and
// flags layout faults: clipped text, sibling overlap, children touching their box edge, off-centre content,
// touching buttons, tap targets < 40px, text < 11px, low contrast.
// Usage: NODE_PATH=$(npm root -g) node tests/layout/crawl.cjs [--vp phone,small,land,desk] [--out /tmp/cc-layout] [--only title,store,...]
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const A = process.argv.slice(2); const arg = (k, d) => { const i = A.indexOf('--' + k); return i >= 0 ? A[i + 1] : d; };
const BASE = process.env.CC_URL || 'http://localhost:8123/';
const OUT = arg('out', '/tmp/cc-layout'); fs.mkdirSync(OUT, { recursive: true });
const VPS = { phone: [390, 844, true], small: [360, 740, true], land: [844, 390, true], desk: [1280, 800, false] };
const vps = arg('vp', 'phone,small,land,desk').split(',');
const only = arg('only', '') ? arg('only').split(',') : null;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------- in-page audit ----------------
function pageAudit() {
  const vw = innerWidth, vh = innerHeight, F = { clip: [], overlap: [], edge: [], center: [], touch: [], small: [], tiny: [], contrast: [], offscreen: [] };
  const shown = (e) => {
    if (e.closest('.hidden')) return false; const sc = e.closest('.screen'); if (sc && !sc.classList.contains('active')) return false;
    const cs = getComputedStyle(e); if (cs.visibility === 'hidden' || cs.display === 'none') return false;
    for (let a = e; a && a !== document.body; a = a.parentElement) if (+getComputedStyle(a).opacity < 0.05) return false;
    const r = e.getBoundingClientRect(); return r.width > 0.5 && r.height > 0.5;
  };
  // is the element actually on screen (not covered by a modal above it)? sample its centre
  const onTop = (e) => { const r = e.getBoundingClientRect(); const x = Math.min(vw - 1, Math.max(0, r.left + r.width / 2)), y = Math.min(vh - 1, Math.max(0, r.top + r.height / 2)); const t = document.elementFromPoint(x, y); return !t || e.contains(t) || t.contains(e); };
  const inView = (r) => r.right > 0 && r.bottom > 0 && r.left < vw && r.top < vh;
  const desc = (e) => { const c = typeof e.className === 'string' && e.className.trim() ? '.' + e.className.trim().split(/\s+/).slice(0, 2).join('.') : ''; const par = e.parentElement; const pc = par && typeof par.className === 'string' && par.className.trim() ? par.className.trim().split(/\s+/)[0] : par ? par.tagName.toLowerCase() : ''; const anc = e.closest('[id]'); return `${anc && anc !== e ? '#' + anc.id + ' ' : ''}${pc ? pc + '>' : ''}${e.tagName.toLowerCase()}${e.id ? '#' + e.id : ''}${c}"${(e.textContent || e.getAttribute('aria-label') || '').trim().replace(/\s+/g, ' ').slice(0, 16)}"`; };
  const all = [...document.body.querySelectorAll('*')].filter((e) => !['SCRIPT', 'STYLE', 'svg', 'SVG', 'path', 'use', 'symbol', 'defs', 'g', 'BR', 'OPTION'].includes(e.tagName) && !(e instanceof SVGElement && e.tagName !== 'svg') && shown(e));
  const vis = all.filter((e) => inView(e.getBoundingClientRect()));
  const isFixedish = (cs) => cs.position === 'absolute' || cs.position === 'fixed';
  const hasText = (e) => [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
  const decorative = (e) => e.matches('canvas, img, i, .shard-ico, [aria-hidden=true]') || e.closest('#fx-layer, #confetti, #bg, .title-fx, #ui-wipe, #ui-flash, #splash');
  for (const e of vis) {
    if (decorative(e)) continue;
    const cs = getComputedStyle(e), r = e.getBoundingClientRect();
    const pad = { l: parseFloat(cs.paddingLeft), r: parseFloat(cs.paddingRight), t: parseFloat(cs.paddingTop), b: parseFloat(cs.paddingBottom) };
    // 1. clipped text
    if (hasText(e) || (e.children.length === 0 && e.textContent.trim())) {
      const hid = /hidden|clip/.test(cs.overflowX) || cs.textOverflow === 'ellipsis';
      const hidY = /hidden|clip/.test(cs.overflowY) || parseInt(cs.webkitLineClamp) > 0;
      if ((hid || hidY) && cs.display !== 'inline') {
        const rg = document.createRange(); rg.selectNodeContents(e); const tr = rg.getBoundingClientRect();
        const aw = e.clientWidth - pad.l - pad.r, ah = e.clientHeight - pad.t - pad.b;
        if (hid && tr.width > aw + 1.5 && e.scrollWidth > e.clientWidth) F.clip.push(`${desc(e)} w ${tr.width.toFixed(0)}>${aw.toFixed(0)}`);
        if (hidY && e.scrollHeight > e.clientHeight + 2 && tr.height > ah + 2) F.clip.push(`${desc(e)} h ${tr.height.toFixed(0)}>${ah.toFixed(0)}`);
      }
      // text that pokes out of a visually boxed ancestor with overflow hidden somewhere above
      const fs = parseFloat(cs.fontSize); if (fs < 11) F.tiny.push(`${desc(e)} ${fs}px`);
    }
    // 2. children touching / overflowing the padding edge of a visible box
    const boxed = (cs.backgroundColor !== 'rgba(0, 0, 0, 0)' && cs.backgroundColor !== 'transparent') || cs.backgroundImage !== 'none' || parseFloat(cs.borderTopWidth) > 0 || parseFloat(cs.borderLeftWidth) > 0;
    if (boxed && e.children.length && r.width > 60 && r.height > 30 && cs.overflow !== 'auto' && cs.overflowY !== 'auto' && cs.overflowY !== 'scroll' && !e.matches('.screen, body, #app, .modal')) {
      for (const c of e.children) {
        if (!shown(c) || decorative(c)) continue; const ccs = getComputedStyle(c); if (isFixedish(ccs)) continue;
        const cr = c.getBoundingClientRect(); if (cr.width < 2 || cr.height < 2) continue;
        const bl = parseFloat(cs.borderLeftWidth), br = parseFloat(cs.borderRightWidth), bt = parseFloat(cs.borderTopWidth), bb = parseFloat(cs.borderBottomWidth);
        const g = { l: cr.left - (r.left + bl), r: (r.right - br) - cr.right, t: cr.top - (r.top + bt), b: (r.bottom - bb) - cr.bottom };
        const bad = [];
        for (const s of ['l', 'r', 't', 'b']) if (pad[s] >= 4 && g[s] < Math.min(3, pad[s] * 0.5)) bad.push(`${s}${g[s].toFixed(0)}`);
        // child wider/taller than the box at all
        if (g.l < -1 || g.r < -1 || g.t < -1 || g.b < -1) { if (!bad.length) bad.push('out'); }
        if (bad.length) F.edge.push(`${desc(c)} in ${desc(e).slice(0, 50)} ${bad.join(',')}`);
      }
    }
    // 3. sibling overlap (in-flow children only) and touching buttons
    if (e.children.length > 1 && e.children.length < 60) {
      const kids = [...e.children].filter((c) => shown(c) && !decorative(c) && !isFixedish(getComputedStyle(c)) && getComputedStyle(c).display !== 'contents');
      const rs = kids.map((c) => c.getBoundingClientRect());
      for (let i = 0; i < kids.length; i++) for (let j = i + 1; j < kids.length; j++) {
        const a = rs[i], b = rs[j];
        const ox = Math.min(a.right, b.right) - Math.max(a.left, b.left), oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        if (ox > 2 && oy > 2 && getComputedStyle(kids[i]).display !== 'inline' && getComputedStyle(kids[j]).display !== 'inline') F.overlap.push(`${desc(kids[i])} x ${desc(kids[j])} ${ox.toFixed(0)}x${oy.toFixed(0)}`);
        const btn = (k) => k.matches('button, .btn, [role=button], a.btn');
        if (btn(kids[i]) && btn(kids[j])) {
          const gx = Math.max(a.left, b.left) - Math.min(a.right, b.right), gy = Math.max(a.top, b.top) - Math.min(a.bottom, b.bottom);
          // side by side (overlap vertically) with < 4px gap, or stacked (overlap horizontally) with < 4px gap
          const kcs = getComputedStyle(kids[i]); const seg = e.matches('.seg, .tabs, [role=tablist], .segmented') || parseFloat(kcs.borderRadius) === 0;
          if (!seg && ((oy > 4 && gx > -1 && gx < 4) || (ox > 4 && gy > -1 && gy < 4))) F.touch.push(`${desc(kids[i])} | ${desc(kids[j])} gap ${Math.max(gx, gy).toFixed(1)}`);
        }
      }
    }
    // 4. centring: flex/grid centre or text-align:center with a single text line
    if (cs.display.includes('flex') && cs.justifyContent === 'center' && cs.flexDirection.startsWith('row') && e.children.length && cs.flexWrap === 'nowrap') {
      const kids = [...e.children].filter((c) => shown(c) && !isFixedish(getComputedStyle(c)) && +getComputedStyle(c).opacity > 0.05).map((k) => k.getBoundingClientRect());
      for (const n of e.childNodes) if (n.nodeType === 3 && n.textContent.trim()) { const rg = document.createRange(); rg.selectNodeContents(n); kids.push(rg.getBoundingClientRect()); }
      if (kids.length) { const L = Math.min(...kids.map((k) => k.left)), R = Math.max(...kids.map((k) => k.right)); const gl = L - r.left - pad.l - parseFloat(cs.borderLeftWidth), gr = r.right - pad.r - parseFloat(cs.borderRightWidth) - R; if (Math.abs(gl - gr) > 4 && gl > -1 && gr > -1) F.center.push(`${desc(e)} L${gl.toFixed(0)} R${gr.toFixed(0)}`); }
    }
    if (cs.textAlign === 'center' && hasText(e) && e.children.length === 0 && cs.display !== 'inline' && r.width > 30) {
      const rg = document.createRange(); rg.selectNodeContents(e); const rects = [...rg.getClientRects()];
      if (rects.length === 1) { const t = rects[0]; const gl = t.left - r.left - pad.l - parseFloat(cs.borderLeftWidth), gr = r.right - pad.r - parseFloat(cs.borderRightWidth) - t.right; if (Math.abs(gl - gr) > 4 && gl > -1 && gr > -1) F.center.push(`${desc(e)} text L${gl.toFixed(0)} R${gr.toFixed(0)}`); }
    }
  }
  // 3b. absolutely positioned buttons/badges sitting on top of text in the same card
  for (const e of vis) {
    if (!e.matches('button, .badge, .chip, em, .tag') || !e.textContent.trim() || !isFixedish(getComputedStyle(e)) || decorative(e) || !onTop(e)) continue;
    const par = e.parentElement; if (!par) continue; const a = e.getBoundingClientRect();
    for (const t of par.querySelectorAll('*')) {
      if (t === e || e.contains(t) || t.contains(e) || !hasText(t) || !shown(t)) continue;
      const rg = document.createRange(); rg.selectNodeContents(t); const b = rg.getBoundingClientRect();
      const ox = Math.min(a.right, b.right) - Math.max(a.left, b.left), oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      if (ox > 3 && oy > 3) { F.overlap.push(`abs ${desc(e)} on ${desc(t)} ${ox.toFixed(0)}x${oy.toFixed(0)}`); break; }
    }
  }
  // 5. tap targets
  for (const e of document.querySelectorAll('button, a[href], [data-go], [data-act], input, select, .tab, [role=button], [data-open], [data-wish]')) {
    if (!shown(e) || e.type === 'range' || e.disabled) continue; const r = e.getBoundingClientRect(); if (!inView(r)) continue; if (!onTop(e)) continue;
    if (e.type === 'hidden') continue;
    const t = (e.type === 'checkbox' || e.type === 'radio') && e.closest('label') ? e.closest('label').getBoundingClientRect() : r;
    if (t.width < 40 - 0.5 || t.height < 40 - 0.5) F.small.push(`${desc(e)} ${Math.round(t.width)}x${Math.round(t.height)}`);
  }
  // 6. contrast on solid backgrounds
  const rgb = (s) => { const m = s.match(/rgba?\(([^)]+)\)/); if (!m) return null; const v = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return { r: v[0], g: v[1], b: v[2], a: v.length > 3 ? v[3] : 1 }; };
  const lum = (c) => { const f = (x) => { x /= 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };
  for (const e of vis) {
    if (!hasText(e)) continue; const cs = getComputedStyle(e); const fg = rgb(cs.color); if (!fg || fg.a < 0.99) continue;
    let bg = null, img = false; for (let a = e; a && a !== document.documentElement; a = a.parentElement) { const s = getComputedStyle(a); if (s.backgroundImage !== 'none') { img = true; break; } const c = rgb(s.backgroundColor); if (c && c.a >= 0.95) { bg = c; break; } }
    if (img || !bg) continue; const L1 = lum(fg), L2 = lum(bg), ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
    const fs = parseFloat(cs.fontSize), large = fs >= 18.66 || (fs >= 14 && +cs.fontWeight >= 700);
    if (ratio < (large ? 3 : 4.5)) F.contrast.push(`${desc(e)} ${ratio.toFixed(2)}:1`);
  }
  if (document.scrollingElement.scrollWidth > vw + 1) F.offscreen.push(`page h-overflow ${document.scrollingElement.scrollWidth - vw}px`);
  for (const k of Object.keys(F)) F[k] = [...new Set(F[k])];
  return F;
}

// ---------------- crawler ----------------
const report = {}; let errors = [];
async function newCtx(browser, vp, q = '') {
  const [w, h, m] = VPS[vp];
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, isMobile: m, hasTouch: m });
  await ctx.route(/unpkg\.com|fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  return ctx;
}
async function newPage(ctx, vp, q = '', seed = true) {
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(`[${vp}] pageerror: ${e.message}`));
  p.on('console', (m) => { if (m.type() === 'error' && !/unpkg|peerjs|ERR_FAILED|Failed to load resource|fonts\.g|AudioContext|vibrate/i.test(m.text())) errors.push(`[${vp}] console: ${m.text().slice(0, 200)}`); });
  await p.goto(BASE + q, { waitUntil: 'load' });
  await p.waitForFunction(() => window.__cc && window.__cc.game, null, { timeout: 30000 });
  await sleep(1500);
  return p;
}
const vis = (p, sel) => p.evaluate((sel) => { const e = document.querySelector(sel); if (!e || e.closest('.hidden')) return false; const sc = e.closest('.screen'); if (sc && !sc.classList.contains('active')) return false; const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; }, sel).catch(() => false);
const click = (p, sel) => p.evaluate((s) => { const e = document.querySelector(s); if (e) e.click(); return !!e; }, sel);
const go = async (p, name) => { await p.evaluate((n) => { const b = document.querySelector(`.screen.active [data-go="${n}"]`) || document.querySelector(`[data-go="${n}"]`); b && b.click(); }, name); await sleep(700); };
const closeReveals = async (p) => { for (let k = 0; k < 12 && (await vis(p, '#m-reveal')); k++) { await p.click('#m-reveal .modal-box', { timeout: 1500 }).catch(() => {}); await sleep(1100); if (await vis(p, '#rv-close')) await click(p, '#rv-close'), await sleep(400); } };
const waitFor = async (p, fn, ms) => { try { await p.waitForFunction(fn, null, { timeout: ms, polling: 250 }); return true; } catch { return false; } };
async function snap(p, vp, name) {
  if (only && !only.some((o) => name.startsWith(o))) return;
  await sleep(350);
  const f = path.join(OUT, `${vp}-${name}.png`); await p.screenshot({ path: f }).catch(() => {});
  const a = await p.evaluate(pageAudit).catch((e) => ({ err: [e.message] }));
  (report[vp] = report[vp] || {})[name] = a;
  const n = Object.entries(a).map(([k, v]) => v.length ? `${k}:${v.length}` : '').filter(Boolean).join(' ');
  console.log(`[${vp}] ${name} ${n}`);
}
async function solveLesson(p) {
  let last = '', stall = 0;
  for (let k = 0; k < 140; k++) {
    const st = await p.evaluate(() => ({ txt: (document.querySelector('#coach-text') || {}).textContent || '', next: !document.querySelector('#coach-next').classList.contains('hidden'), done: !document.querySelector('#m-lesson').classList.contains('hidden') }));
    if (st.done) return true; if (st.txt !== last) { last = st.txt; stall = 0; } else if (++stall > 40) return false;
    if (st.next) { await p.click('#coach-next').catch(() => {}); await sleep(250); continue; }
    await p.evaluate(async () => {
      const E = await import('/js/engine.js'); const cc = window.__cc, g = cc.game, s = cc.session; if (!s || !g.myTurn()) return;
      const S = s.host.s, u = S.units.find((x) => x.pid === 'me'); const marks = (g.r.marks || []).map((m) => m.x + ',' + m.y);
      const dummies = S.units.filter((x) => x.alive && x.dummy).map((d) => d.x + ',' + d.y); const cand = []; const obj = ((document.querySelector('#coach-obj') || {}).textContent || '').toLowerCase();
      for (const o of E.promoteOptions(u)) if (o.cost <= u.shards && o.to !== 'hone') cand.push([obj.includes(o.to) ? 60 : 30, { type: 'promote', to: o.to }]);
      for (const sl of ['ult', 'sig', 'eq', 'atk']) if (E.canUse(S, u, sl)) for (const o of E.abilityOptions(S, u, sl)) { const k = o.anchor.x + ',' + o.anchor.y; cand.push([(marks.includes(k) ? 40 : 0) + (o.hits || []).length * 15 + (o.tiles || []).filter((t) => dummies.includes(t.x + ',' + t.y)).length * 10 + Math.random() * 3, { type: 'ability', slot: sl, x: o.anchor.x, y: o.anchor.y }]); }
      if (E.canMove(S, u)) for (const m of E.legalMoves(S, u)) { const k = m.x + ',' + m.y; const it = S.items.some((i) => i.x === m.x && i.y === m.y); cand.push([(marks.includes(k) ? 45 : 0) + (it ? 30 : 0) + Math.random() * 5, { type: 'move', x: m.x, y: m.y }]); }
      cand.sort((a, b) => b[0] - a[0]); s.send(cand.length && cand[0][0] > 2 ? cand[0][1] : { type: 'end' });
    });
    await sleep(320);
  }
  return false;
}
async function crawl(browser, vp) {
  const ctx = await newCtx(browser, vp);
  // fresh profile with a game played so the daily login card + sequel reveal can show
  await ctx.addInitScript(() => { if (!localStorage.getItem('cc_layout_seeded')) { localStorage.setItem('cc_layout_seeded', '1'); } });
  let p = await newPage(ctx, vp);
  // boot interrupters
  if (await vis(p, '.sequel:not(.out)')) { await snap(p, vp, 'boot-sequel'); await p.evaluate(() => document.querySelector('.sequel').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))); await sleep(1500); }
  // daily reward card: force it if the app did not show one
  if (!(await vis(p, '#m-login'))) { await p.evaluate(() => { const pr = window.__cc.profile; pr.games = Math.max(pr.games || 0, 3); if (pr.login) { pr.login.last = ''; pr.login.day = ''; } }); await p.reload({ waitUntil: 'load' }); await p.waitForFunction(() => window.__cc && window.__cc.game); await sleep(2500); if (await vis(p, '.sequel:not(.out)')) { await p.evaluate(() => document.querySelector('.sequel').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))); await sleep(1500); } }
  if (await vis(p, '#m-login')) { await snap(p, vp, 'daily-reward'); await click(p, '#lg-claim'); await sleep(1200); }
  await closeReveals(p);
  await p.evaluate(() => { const pr = window.__cc.profile; pr.marks = 999999; pr.season.xp = 3000; });
  await sleep(800); await closeReveals(p);
  await snap(p, vp, 'title');
  await click(p, '[data-act="whatsnew"]'); await sleep(500); await snap(p, vp, 'whatsnew'); await click(p, '[data-act="close-info"]');
  await click(p, '[data-act="credits"]'); await sleep(400); await snap(p, vp, 'credits'); await click(p, '[data-act="close-info"]');
  await click(p, '#s-title [data-act="settings"]'); await sleep(500); await snap(p, vp, 'settings');
  await p.evaluate(() => { const b = document.querySelector('#m-settings .modal-box'); if (b) b.scrollTop = 1e5; }); await snap(p, vp, 'settings-bottom'); await click(p, '[data-act="close-settings"]'); await sleep(300);
  // play screen with each mode
  await go(p, 'play');
  const modes = await p.evaluate(() => [...document.querySelectorAll('#modes [data-mode]')].map((b) => b.dataset.mode));
  for (const m of modes) { await click(p, `#modes [data-mode="${m}"]`); await sleep(350); await snap(p, vp, `play-${m}`); }
  await click(p, '#modes [data-mode="royale"]');
  await p.evaluate(() => { const b = document.querySelector('#modes'); if (b) b.scrollIntoView(); document.querySelector('#s-play').scrollTop = 1e5; }); await snap(p, vp, 'play-bottom');
  // loadout, every piece
  await go(p, 'title'); await go(p, 'loadout');
  const pcs = await p.evaluate(() => [...new Set([...document.querySelectorAll('[data-lopiece]')].map((b) => b.dataset.lopiece))]);
  for (const pc of pcs) { await click(p, `[data-lopiece="${pc}"]`); await sleep(500); await snap(p, vp, `loadout-${pc}`); }
  await p.evaluate(() => { const s = document.querySelector('#s-loadout'); s.scrollTop = 1e5; const sc = s.querySelector('.scroll, .body'); if (sc) sc.scrollTop = 1e5; }); await snap(p, vp, 'loadout-bottom');
  // store
  await go(p, 'title'); await go(p, 'armory'); await sleep(500);
  await p.evaluate(() => { const pr = window.__cc.profile; pr.wishlist = pr.wishlist || []; });
  const tabs = await p.evaluate(() => [...document.querySelectorAll('#s-armory .tab[data-tab]')].map((b) => b.dataset.tab));
  let didItem = false, didReveal = false;
  for (const t of tabs) {
    await click(p, `#s-armory .tab[data-tab="${t}"]`); await sleep(600); await snap(p, vp, `store-${t}`);
    await p.evaluate(() => { const s = document.querySelector('#s-armory'); for (const e of [s, ...s.querySelectorAll('*')]) if (e.scrollHeight > e.clientHeight + 20 && /auto|scroll/.test(getComputedStyle(e).overflowY)) e.scrollTop = 1e5; }); await snap(p, vp, `store-${t}-bottom`);
    await p.evaluate(() => { const s = document.querySelector('#s-armory'); for (const e of [s, ...s.querySelectorAll('*')]) e.scrollTop = 0; });
    // wish a couple of items
    if (t !== 'wishlist' && t !== 'collections') await p.evaluate(() => { [...document.querySelectorAll('#s-armory [data-wish]:not(.on)')].slice(0, 2).forEach((w) => w.click()); });
    const c = await p.evaluate(() => { const b = [...document.querySelectorAll('#s-armory [data-open]')].find((x) => x.getBoundingClientRect().height > 0); if (b) { b.click(); return b.dataset.open; } return null; });
    if (c) { await sleep(700); if (await vis(p, '#m-item')) { await snap(p, vp, `item-${t}`);
      if (!didReveal && (await vis(p, '#m-item [data-mi="buy"]'))) { await click(p, '#m-item [data-mi="buy"]'); await sleep(300); if (await vis(p, '#m-item [data-mi="buy"]')) await click(p, '#m-item [data-mi="buy"]'); if (await waitFor(p, () => !document.querySelector('#m-reveal').classList.contains('hidden'), 4000)) { await sleep(500); await snap(p, vp, 'reveal-closed'); await p.click('#m-reveal .modal-box').catch(() => {}); await sleep(1800); await snap(p, vp, 'reveal-open'); didReveal = true; await closeReveals(p); } }
      if (await vis(p, '#m-item')) { await p.keyboard.press('Escape'); await sleep(300); if (await vis(p, '#m-item')) await p.evaluate(() => document.querySelector('#m-item').click()); await sleep(300); } } }
  }
  await click(p, '#s-armory .tab[data-tab="wishlist"]'); await sleep(500); await snap(p, vp, 'store-wishlist-filled');
  // Crown Path, trophies, profile, quests
  for (const s of ['path', 'trophies', 'profile', 'quests', 'howto', 'join']) { await go(p, 'title'); await go(p, s); await sleep(500); await closeReveals(p); await snap(p, vp, s); await p.evaluate(() => { const s = document.querySelector('.screen.active'); for (const e of [s, ...s.querySelectorAll('*')]) if (e.scrollHeight > e.clientHeight + 20 && /auto|scroll/.test(getComputedStyle(e).overflowY)) e.scrollTop = 1e5; }); await snap(p, vp, s + '-bottom'); }
  // codex
  await go(p, 'title'); await go(p, 'codex');
  const ct = await p.evaluate(() => [...document.querySelectorAll('#codex-tabs [data-ctab]')].map((b) => b.dataset.ctab));
  for (const t of ct) { await click(p, `#codex-tabs [data-ctab="${t}"]`); await sleep(400); await snap(p, vp, `codex-${t}`); }
  // tutorial list + one lesson HUD + lesson complete
  await go(p, 'title'); await go(p, 'tutorial'); await snap(p, vp, 'tutorial');
  if (!only || only.some((o) => o.startsWith('lesson'))) {
    const first = await p.evaluate(() => (document.querySelector('#lesson-list [data-lesson]') || {}).dataset.lesson);
    if (first) { await click(p, `#lesson-list [data-lesson="${first}"]`); await sleep(2500); await snap(p, vp, 'lesson-hud'); const ok = await solveLesson(p); if (ok) { await sleep(900); await snap(p, vp, 'lesson-complete'); } else console.log(`[${vp}] lesson not solved`); await click(p, '[data-act="to-tutorial"]'); await sleep(800); }
  }
  // match states
  if (!only || only.some((o) => o.startsWith('match'))) {
    await go(p, 'title'); await go(p, 'play'); await click(p, '#modes [data-mode="royale"]'); await click(p, '#btn-solo'); await sleep(900); await snap(p, vp, 'match-intro'); await sleep(2600);
    await waitFor(p, () => window.__cc.game.myTurn(), 20000); await sleep(600); await snap(p, vp, 'match-hud');
    await click(p, '#h-actions [data-slot="atk"]'); await sleep(400); await snap(p, vp, 'match-attack');
    await click(p, '#h-actions [data-slot="sig"]'); await sleep(400); await snap(p, vp, 'match-sig');
    await click(p, '#h-actions [data-slot="move"]');
    await click(p, '[data-act="emotes"]'); await sleep(400); await snap(p, vp, 'match-emotes'); await click(p, '[data-act="emotes"]');
    await p.evaluate(() => { const u = window.__cc.session.host.s.units.find((x) => x.pid === 'me'); u.shards = 9; window.__cc.session.host.s.v++; window.__cc.session.host.publish([]); }); await sleep(600);
    await snap(p, vp, 'match-shards');
    await p.evaluate(() => window.__cc.game.openPromote()); await sleep(500); await snap(p, vp, 'match-promote'); await click(p, '[data-act="close-promote"]');
    await click(p, '#s-game [data-act="menu"]'); await sleep(400); await snap(p, vp, 'match-menu'); await click(p, '[data-act="close-menu"]');
    // die -> eliminated -> spectate
    await p.evaluate(async () => { const E = await import('/js/engine.js'); const h = window.__cc.session.host, s = h.s; const v = s.units.find((u) => u.pid === 'me'); v.alive = false; v.hp = 0; v.place = E.alivePlayers(s).length + 1; const ev = [{ e: 'death', id: v.id, by: null, x: v.x, y: v.y, cause: null }]; if (s.active === v.id) E.nextTurn(s, ev); s.v++; h.publish(ev); h.schedule(); });
    if (await waitFor(p, () => !document.querySelector('#m-dead').classList.contains('hidden'), 12000)) { await sleep(800); await snap(p, vp, 'match-dead'); await click(p, '#m-dead [data-act="spectate"]'); await sleep(900); await snap(p, vp, 'match-spectate'); }
    await p.evaluate(async () => { const E = await import('/js/engine.js'); const h = window.__cc.session.host, s = h.s; const ev = []; const left = s.units.filter((u) => u.alive && u.kind === 'player'); for (const v of left.slice(1)) { v.alive = false; v.hp = 0; v.place = E.alivePlayers(s).length + 1; ev.push({ e: 'death', id: v.id, by: null, x: v.x, y: v.y, cause: null }); } s.over = true; s.winner = left[0] && left[0].id; left[0] && (left[0].place = 1); ev.push({ e: 'over', winner: s.winner }); s.v++; h.publish(ev); h.schedule(); });
    if (await waitFor(p, () => !document.querySelector('#m-results').classList.contains('hidden'), 20000)) { await sleep(2500); await snap(p, vp, 'results'); await p.evaluate(() => { const b = document.querySelector('#r-box'); if (b) b.scrollTop = 1e5; const m = document.querySelector('#m-results'); m.scrollTop = 1e5; }); await snap(p, vp, 'results-bottom');
      if (await vis(p, '#btn-potm')) { await click(p, '#btn-potm'); await sleep(1500); await snap(p, vp, 'potm'); await click(p, '[data-act="potm-close"]'); await sleep(300); } }
    await click(p, '#m-results [data-act="to-title"]'); await sleep(600); if (await vis(p, '#cf-yes')) { await snap(p, vp, 'confirm'); await click(p, '#cf-yes'); } await sleep(800); await closeReveals(p);
  }
  // lobbies
  if (!only || only.some((o) => o.startsWith('lobby'))) {
    const h = await newPage(ctx, vp, '?net=local'); await closeReveals(h); if (await vis(h, '#m-login')) await click(h, '#lg-claim'), await sleep(800);
    await go(h, 'play'); await click(h, '#btn-host'); await sleep(1500); await snap(h, vp, 'lobby-host');
    const code = await h.evaluate(() => document.querySelector('#host-code').textContent.trim());
    const j = await newPage(ctx, vp, '?net=local'); if (await vis(j, '#m-login')) await click(j, '#lg-claim'), await sleep(800);
    await go(j, 'join'); await j.fill('#in-code', code).catch(() => {}); await click(j, '#s-join [data-act="join"]'); await sleep(2500); await snap(j, vp, 'lobby-join'); await snap(h, vp, 'lobby-host-2');
    await click(h, '[data-act="add-bot"]'); await sleep(500); await snap(h, vp, 'lobby-host-bot');
    await j.close(); await h.close();
  }
  await ctx.close();
}
(async () => {
  const browser = await chromium.launch();
  for (const vp of vps) { try { await crawl(browser, vp); } catch (e) { console.log(`[${vp}] crawl threw: ${e.message.split('\n')[0]}`); errors.push(`[${vp}] threw ${e.message.split('\n')[0]}`); } }
  await browser.close();
  // roll-up
  const roll = {}; for (const [vp, st] of Object.entries(report)) for (const [s, a] of Object.entries(st)) for (const [k, v] of Object.entries(a)) for (const x of v) { const key = x.replace(/ [-\d.x>:LRwhtbl,R]+$/, '').replace(/ (w|h|gap|text|L-?\d+).*$/, ''); ((roll[k] = roll[k] || {})[key] = roll[k][key] || []).push(`${vp}/${s}`); }
  const sum = Object.fromEntries(Object.entries(roll).map(([k, v]) => [k, Object.keys(v).length]));
  console.log('\nDISTINCT:', JSON.stringify(sum)); console.log('ERRORS:', errors.length ? [...new Set(errors)].join('\n  ') : 'none');
  fs.writeFileSync(path.join(OUT, 'layout-report.json'), JSON.stringify({ sum, roll, report, errors: [...new Set(errors)] }, null, 1));
})();
