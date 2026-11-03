// Chess Complex 10.0 - the Director.
// One owner for every pixel of screen real estate that talks to the player. Messages never stack:
// each lives in a fixed lane, the hero lane plays one moment at a time from a priority queue,
// similar messages merge, stale low-priority ones are dropped, and the canvas (ultimate cine,
// floating combat text) asks the Director where it may draw.
//
// Lanes (top to bottom, computed from the live HUD so they fit 390px portrait, landscape and desktop):
//   top    - turn handoff pill / event chip (one at a time; the chip yields while the pill shows)
//   feed   - kill feed, max 3 single-line rows, repeated lines coalesce into a x2 badge
//   hero   - callouts, banners, discoveries, the canvas ultimate cine (exclusive, queued)
//   status - lethal warning, between the emote and ultimate buttons
//   hint   - coach tips and toasts, above the buttons (one at a time)

const now = () => performance.now();
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// hero timing per tier (ms on screen, not counting the gap). 15.0: tier 4 = Regicide only; 'loc' = location intro.
const LIFE = { 1: 1650, 2: 1900, 3: 2350, 4: 3100, disc: 2600, loc: 3000 };
const GAP = 200;              // minimum spacing between two hero moments
const MERGE_MS = 2600;        // same group (same killer) within this window merges into one callout
const FEED_MAX = 3, FEED_LIFE = 5200, FEED_MERGE = 4500;

export class Director {
  constructor() {
    this.q = []; this.cur = null; this.lastEnd = 0; this.holdUntil = 0; this.seq = 0;
    this.feedRows = []; this.hintQ = []; this.hintCur = null; this.turnUntil = 0; this.pendFeed = []; this.pendTurn = null;
    this.occ = []; this.occAt = 0; this.layoutAt = 0; this.box = null; this.mounted = false;
    this.L = { top: 100, feed: 132, hero: 230, heroH: 104, hint: 280, side: 0, W: 390, H: 844 };
    this.stats = { shown: 0, merged: 0, dropped: 0, preempted: 0 };
  }

  // ---------------------------------------------------------------- setup
  mount(root, opts = {}) {
    if (this.mounted) return;
    this.root = root; this.opts = opts; this.mounted = true;
    const mk = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return root.appendChild(t.content.firstChild); };
    this.heroEl = mk(`<div class="dh" id="dir-hero" aria-live="polite"><div class="dh-plate"><i class="dh-sweep"></i></div><div class="dh-ring"></div><div class="dh-shards" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i></div><div class="dh-in" data-msg="hero"><div class="dh-kick"></div><div class="dh-title"></div><div class="dh-sub"></div><div class="dh-tags"></div></div></div>`);
    this.turnEl = mk(`<div class="dt" id="dir-turn" data-msg="turn"><b></b><span></span></div>`);
    // 15.0: boss bar (the King, or a Siege boss), visible to everyone; it sits under the top HUD and pushes the lanes down
    this.bossEl = mk(`<div class="dboss hidden" id="dir-boss" data-msg="boss" role="status" aria-live="off"><div class="db-top"><i class="db-crown"></i><b class="db-name"></b><span class="db-tag"></span><span class="db-st"></span><span class="db-hp"></span></div><div class="db-bar"><i class="db-ghost"></i><i class="db-fill"></i><i class="db-flash"></i><s class="db-m1"></s><s class="db-m2"></s></div></div>`);
    this.feedEl = root.querySelector('#h-feed');
    this.hintEl = root.querySelector('#gm-tip');
    this.chipEl = root.querySelector('#event-chip');
    this.lethalEl = root.querySelector('#lethal');
    if (this.hintEl) { this.hintEl.dataset.msg = 'hint'; this.hintEl.classList.add('hidden'); this.hintEl.addEventListener('click', () => this.dismissHint()); }
    addEventListener('resize', () => { this.layoutAt = 0; });
  }
  reduced() { return !!(this.opts && this.opts.reduced && this.opts.reduced()); }
  // 10.2 (N): a module that owns its own small DOM lane (chat log) registers it so canvas floats avoid it
  claim(el) { if (el && !(this.claims ||= []).includes(el)) { this.claims.push(el); this.occAt = 0; } }
  sound(n, lvl) { try { this.opts.sound && this.opts.sound(n, lvl); } catch {} }

  reset() {
    this.q = []; this.cur = null; this.lastEnd = 0; this.holdUntil = 0; this.turnUntil = 0; this.hintHold = 0;
    for (const r of this.feedRows) r.el.remove();
    this.feedRows = []; this.hintQ = []; this.hintCur = null; this.occ = []; this.pendFeed = []; this.pendTurn = null;
    if (!this.mounted) return;
    this.heroEl.className = 'dh'; this.turnEl.className = 'dt';
    if (this.hintEl) this.hintEl.classList.add('hidden');
    this.root.classList.remove('dir-turn');
    this.boss(null); this.bossKey = null;
    this.layoutAt = 0;
  }
  // Pause every lane except status (contender intro, modals).
  hold(ms) { this.holdUntil = Math.max(this.holdUntil, now() + ms); this.root && this.root.classList.add('dir-hold'); }
  release() { this.holdUntil = 0; this.root && this.root.classList.remove('dir-hold'); }
  // 15.1: tips/toasts only (the hero lane keeps playing), e.g. while "Round 1" and the camera drop-in play
  holdHints(ms) { this.hintHold = Math.max(this.hintHold || 0, now() + ms); }
  held() {
    if (now() < this.holdUntil) return true;
    if (this.root && this.root.classList.contains('dir-hold')) this.root.classList.remove('dir-hold');
    return !!(this.root && this.root.querySelector('.modal:not(.hidden)'));
  }

  // ---------------------------------------------------------------- layout
  layout() {
    if (!this.mounted) return;
    const R = this.root, $ = (s) => R.querySelector(s);
    const rect = (el) => (el && !el.classList.contains('hidden') && el.offsetParent !== null ? el.getBoundingClientRect() : null);
    const W = innerWidth, H = innerHeight;
    const hb = $('.hud-bottom') && $('.hud-bottom').getBoundingClientRect();
    const side = hb && hb.top < H * 0.5 && hb.left > W * 0.3 ? Math.round(W - hb.left) : 0; // landscape: HUD is a right-hand column
    let top = 0;
    for (const el of [$('.hud-top'), rect($('#coach')) ? $('#coach') : null]) if (el) top = Math.max(top, el.getBoundingClientRect().bottom);
    // 15.0: floating HUD buttons (e.g. a zoom toggle) mark themselves data-dir-avoid; upper-third ones push the lanes down
    const avoid = [...R.querySelectorAll('[data-dir-avoid]')].map(rect).filter((r) => r && r.height > 4);
    for (const r of avoid) if (r.top < H * 0.34 && r.left < W - (hb && hb.top < H * 0.5 && hb.left > W * 0.3 ? W - hb.left : 0)) top = Math.max(top, r.bottom);
    // 15.0: the boss bar takes the first slot under the top HUD
    this.bossTop = Math.round(top + 4);
    R.style.setProperty('--lane-boss', this.bossTop + 'px');
    if (this.bossOn) top = this.bossTop + (this.bossEl.offsetHeight || 34);
    const big = document.body.classList.contains('bigtext') ? 1.12 : 1;
    const short = H < 520;
    const laneTop = Math.round(top + 6);
    const feedTop = laneTop + (short ? 30 : 34);
    this.feedMax = short ? 2 : FEED_MAX;
    const rowH = Math.round((short ? 22 : 24) * big), feedH = this.feedMax * rowH + (this.feedMax - 1) * 4;
    const heroTop = feedTop + feedH + (short ? 6 : 12);
    // bottom: lowest obstacle among buttons and the status slot
    let floor = side ? H : hb ? hb.top : H;
    for (const el of [$('#ult-btn'), $('.emote-wrap'), this.lethalEl, ...R.querySelectorAll('[data-dir-avoid]')]) { const r = rect(el); if (r && r.height > 4 && r.top > H * 0.4) floor = Math.min(floor, r.top); }
    const hint = Math.round(H - floor + 8);
    // reserve room for a two-line hint above the buttons so hero and hint never meet
    const hintRoom = Math.round((short ? 62 : 72) * big);
    const heroH = Math.max(60, Math.min(short ? 90 : 120, (H - hint - hintRoom - 6) - heroTop));
    this.L = { top: laneTop, feed: feedTop, rowH, hero: heroTop, heroH, hint, side, W, H };
    const st = R.style;
    st.setProperty('--lane-top', laneTop + 'px'); st.setProperty('--lane-feed', feedTop + 'px'); st.setProperty('--lane-row', rowH + 'px');
    st.setProperty('--lane-hero', heroTop + 'px'); st.setProperty('--lane-hero-h', heroH + 'px');
    st.setProperty('--lane-hint', hint + 'px'); st.setProperty('--lane-side', side + 'px');
  }
  // Rect the canvas cine / banners must use (CSS px).
  heroRect() { const L = this.L; return { x: 0, y: L.hero, w: L.W - L.side, h: L.heroH, cx: (L.W - L.side) / 2 }; }
  cineActive() { return !!(this.cur && this.cur.kind === 'cine' && (now() < this.cur.end || (this.opts.cineLive && this.opts.cineLive()))); }

  // ---------------------------------------------------------------- per-frame pump
  tick() {
    if (!this.mounted) return;
    const t = now();
    if (t - this.layoutAt > 250) { this.layoutAt = t; this.layout(); }
    const held = this.held();
    // DOM changes only happen here, before the canvas frame, so canvas text always knows the current occupancy
    if (this.pendTurn) { const p = this.pendTurn; this.pendTurn = null; this.showTurn(p); }
    if (this.pendFeed.length && !held) { const list = this.pendFeed; this.pendFeed = []; for (const [h, k] of list) this.addFeed(h, k); }
    // hero lane
    if (this.cur && this.cur.kind === 'cine' && this.opts.cineLive && this.opts.cineLive()) this.cur.end = Math.max(this.cur.end, t + 60);
    if (this.cur && t >= this.cur.end) this.endHero();
    this.q = this.q.filter((m) => { const ok = t - m.at <= m.ttl; if (!ok) this.stats.dropped++; return ok; });
    if (!this.cur && !held && this.q.length && t - this.lastEnd >= GAP) { if (this.hintCur && this.hitsHero(this.hintEl)) this.endHint(); this.showHero(this.q.shift()); }
    // top lane: the chip yields to the turn pill through a class on #s-game (the HUD refresh owns the chip's own classes)
    if (this.turnUntil && t >= this.turnUntil) { this.turnUntil = 0; this.turnEl.classList.remove('show'); this.root.classList.remove('dir-turn'); }
    // feed
    for (const r of this.feedRows) if (t >= r.until && !r.out) { r.out = true; r.el.classList.add('out'); setTimeout(() => r.el.remove(), 260); }
    this.feedRows = this.feedRows.filter((r) => !r.out);
    // hint
    if (this.hintCur && t >= this.hintCur.until) this.endHint();
    this.hintQ = this.hintQ.filter((h) => t - h.at <= h.ttl);
    if (!this.hintCur && !held && this.hintQ.length && t >= (this.hintRetry || 0) && t >= (this.hintHold || 0)) { const h = this.hintQ.shift(); this.showHint(h); if (this.cur && this.hitsHero(this.hintEl)) { this.endHint(); this.hintQ.unshift(h); this.hintRetry = t + 300; } }
  }
  // Screen rects currently owned by DOM messages (recomputed lazily; canvas floats must not draw under them).
  occupied() {
    const t = now();
    if (this.occDirty || t - this.occAt > 40) {
      this.occAt = t; this.occDirty = false; const o = [];
      // CSS exit animations can lag behind wall time on a busy phone, so trust what is actually painted
      const shown = (el) => el && !el.classList.contains('hidden') && +getComputedStyle(el).opacity > 0.04 && getComputedStyle(el).visibility !== 'hidden';
      const push = (el) => { if (!shown(el)) return; const r = el.getBoundingClientRect(); if (r.width > 2 && r.height > 2) o.push({ x: r.left - 4, y: r.top - 4, w: r.width + 8, h: r.height + 8 }); };
      if ((this.cur && this.cur.kind !== 'cine') || shown(this.heroEl)) { const r = this.heroRect(); o.push({ x: r.x, y: r.y - 14, w: r.w, h: r.h + 28 }); }
      if (this.cineActive()) { const r = this.heroRect(); o.push({ x: 0, y: r.y - 28, w: this.L.W, h: r.h + 56 }); }
      if (this.root.querySelector('#contenders:not(.hidden)')) o.push({ x: 0, y: 0, w: this.L.W, h: this.L.H });
      if (this.turnUntil || shown(this.turnEl)) { const el = this.turnEl; let x = el.offsetLeft, y = el.offsetTop; for (let p = el.offsetParent; p && p !== document.body; p = p.offsetParent) { x += p.offsetLeft; y += p.offsetTop; } o.push({ x: x - 4, y: y - 4, w: el.offsetWidth + 8, h: el.offsetHeight + 8 }); }
      push(this.chipEl);
      for (const d of this.feedEl ? this.feedEl.children : []) push(d); // includes rows still fading out
      if (this.hintCur && !this.hintEl.classList.contains('hidden')) { const r = this.hintEl.getBoundingClientRect(); o.push({ x: r.left - 6, y: r.top - 14, w: r.width + 12, h: r.height + 28 }); } // fading in counts as shown
      push(this.lethalEl);
      if (this.bossOn) push(this.bossEl);
      for (const el of this.claims || []) push(el); // 10.2 (N): other HUD lanes, e.g. the chat log, registered with claim()
      this.occ = o;
    }
    return this.occ;
  }

  // ---------------------------------------------------------------- hero lane
  // m: { text, sub, kicker, color, tier 1|2|3|'disc', prio, key, group, sting, level, ttl, tone, tags }
  say(m) {
    if (!this.mounted || !m || !m.text) return;
    const t = now();
    m = { tier: 1, prio: 40, ttl: 2600, tags: [], ...m, at: t, id: ++this.seq };
    m.tags = [...(m.tags || [])];
    // same key: never twice in a row
    if (m.key) {
      if (this.cur && this.cur.key === m.key && t - this.cur.start < 4000) { this.stats.merged++; if (m.prio > this.cur.prio) this.upgrade(this.cur, m); return; }
      const qi = this.q.findIndex((x) => x.key === m.key);
      if (qi >= 0) { this.stats.merged++; const old = this.q[qi]; if (m.prio >= old.prio) this.q[qi] = { ...m, at: old.at }; return; }
    }
    // same group (same killer, close in time): one callout carries all the tags
    if (m.group) {
      const same = (x) => x && x.group === m.group && t - x.at < MERGE_MS;
      if (this.cur && this.cur.kind !== 'cine' && same(this.cur)) { this.stats.merged++; this.upgrade(this.cur, m); return; }
      const qi = this.q.findIndex(same);
      if (qi >= 0) { this.stats.merged++; this.q[qi] = this.merge(this.q[qi], m); this.sortQ(); return; }
    }
    // a much more important moment cuts a minor one short
    if (this.cur && this.cur.kind !== 'cine' && m.prio >= this.cur.prio + 30 && t - this.cur.start > 350) { this.stats.preempted++; this.cur.end = Math.min(this.cur.end, t + 120); }
    this.q.push(m); this.sortQ();
    while (this.q.length > 4) { this.q.pop(); this.stats.dropped++; }
  }
  sortQ() { this.q.sort((a, b) => b.prio - a.prio || a.at - b.at); }
  merge(a, b) {
    const [hi, lo] = b.prio > a.prio ? [b, a] : [a, b];
    const tags = [...new Set([...hi.tags, ...lo.tags, lo.text].filter((x) => x && x !== hi.text))].slice(0, 3);
    return { ...hi, at: Math.min(a.at, b.at), tags, tier: Math.max(+a.tier || 1, +b.tier || 1) };
  }
  upgrade(cur, m) {
    const merged = this.merge(cur, m);
    Object.assign(cur, merged, { start: cur.start, end: Math.max(cur.end, now() + 900) });
    this.render(cur, true);
    if (m.prio >= cur.prio) this.sound(m.sting ? 'announce:' + m.sting : 'stinger', m.level || 2);
  }
  showHero(m) {
    const t = now();
    m.start = t; m.end = t + (m.life || LIFE[m.tier] || LIFE[1]);
    this.cur = m; this.stats.shown++; this.occAt = 0;
    this.render(m, false);
    if (m.sting) this.sound('announce:' + m.sting, m.level); else if (m.level) this.sound('stinger', m.level);
    if (m.haptic && this.opts.haptic) this.opts.haptic(m.haptic);
  }
  render(m, bump) {
    const el = this.heroEl, q = (s) => el.querySelector(s);
    q('.dh-kick').textContent = m.kicker || '';
    q('.dh-title').innerHTML = `<span data-t="${esc(m.text)}">${esc(m.text)}</span>`;
    q('.dh-sub').innerHTML = m.subHtml || esc(m.sub || '');
    q('.dh-tags').innerHTML = (m.tags || []).map((x) => `<em>${esc(x)}</em>`).join('');
    el.style.setProperty('--ac', m.color || '#ffd24d');
    // fit the title to the lane: tier sets the ceiling, width and lane height set the floor
    const L = this.L, avail = Math.max(200, L.W - L.side - 32), base = { 1: 36, 2: 44, 3: 56, 4: 66, disc: 34, loc: 40 }[m.tier] || 36;
    const px = Math.max(18, Math.min(base * (L.W >= 760 && !L.side ? 1.25 : 1), avail / (String(m.text).length * (m.tier === 'loc' ? 0.86 : 0.74) + 0.6), L.heroH * (m.tags && m.tags.length ? 0.38 : m.tier === 4 ? 0.52 : 0.46)));
    el.style.setProperty('--tpx', px.toFixed(1) + 'px');
    el.style.setProperty('--life', ((m.end - m.start) / 1000).toFixed(2) + 's');
    const tier = m.tier === 'disc' || m.tier === 'loc' ? m.tier : 't' + (m.tier || 1);
    const cls = `dh show ${tier}${m.tone ? ' tone-' + m.tone : ''}${m.kicker ? ' has-kick' : ''}${(m.tags || []).length ? ' has-tags' : ''}${this.reduced() ? ' calm' : ''}`;
    if (bump) { el.className = cls; el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump'); return; }
    el.className = 'dh'; void el.offsetWidth; el.className = cls;
  }
  endHero(fast) {
    if (!this.cur) return;
    const wasCine = this.cur.kind === 'cine';
    this.cur = null; this.lastEnd = now(); this.occAt = 0;
    if (!wasCine) { this.heroEl.classList.remove('show', 'bump'); this.heroEl.classList.add(fast ? 'cut' : 'out'); }
  }
  // The canvas ultimate cine takes the hero lane immediately (hard cut of any DOM callout).
  cine(lifeS) {
    if (!this.mounted) return this.heroRect();
    const t = now();
    if (this.cur && this.cur.kind !== 'cine') { this.stats.preempted++; const back = this.cur; this.endHero(true); if (t - back.start < 700) { back.at = t; this.q.unshift(back); } }
    if (this.heroEl.classList.contains('out')) { this.heroEl.classList.remove('out'); this.heroEl.classList.add('cut'); }
    this.cur = { kind: 'cine', prio: 100, start: t, end: t + lifeS * 1000 + 60, at: t };
    this.occAt = 0;
    return this.heroRect();
  }

  // Called by the renderer every frame the cine is drawn: canvas time can run slower than wall time
  // (frame-capped dt on slow phones), so the cine keeps the lane for as long as it is actually on screen.
  holdCine() {
    const t = now();
    if (this.cur && this.cur.kind === 'cine') { if (this.cur.end < t + 90) this.cur.end = t + 90; return; }
    this.cine(0.09);
  }

  // ---------------------------------------------------------------- top lane: turn handoff
  turn(text, sub = '', color = '#ffd24d') { if (this.mounted) this.pendTurn = { text, sub, color }; }
  showTurn({ text, sub, color }) {
    const el = this.turnEl;
    el.querySelector('b').textContent = text; el.querySelector('span').textContent = sub;
    el.style.setProperty('--ac', color);
    el.className = 'dt'; void el.offsetWidth; el.className = 'dt show' + (this.reduced() ? ' calm' : '');
    this.root.classList.add('dir-turn');
    this.turnUntil = now() + 1500; this.occAt = 0;
  }

  // ---------------------------------------------------------------- feed lane
  feed(html, key) { if (this.mounted && this.feedEl) this.pendFeed.push([html, key]); }
  addFeed(html, key) {
    const t = now(); key = key || html;
    const hit = this.feedRows.find((r) => r.key === key && t - r.at < FEED_MERGE);
    if (hit) {
      hit.n++; hit.until = t + FEED_LIFE; hit.at = t;
      let b = hit.el.querySelector('.fx-n'); if (!b) { b = document.createElement('i'); b.className = 'fx-n'; hit.el.appendChild(b); }
      b.textContent = 'x' + hit.n; hit.el.classList.remove('pulse'); void hit.el.offsetWidth; hit.el.classList.add('pulse');
      this.stats.merged++; return;
    }
    const d = document.createElement('div'); d.innerHTML = html; d.dataset.msg = 'feed';
    this.feedEl.prepend(d);
    this.feedRows.unshift({ el: d, key, at: t, until: t + FEED_LIFE, n: 1 });
    while (this.feedRows.length > (this.feedMax || FEED_MAX)) { const r = this.feedRows.pop(); r.el.remove(); }
    this.occAt = 0;
  }

  // ---------------------------------------------------------------- hint lane: tips and toasts
  // kind 'toast' (short, preempts tips) or 'tip' (long, tap to dismiss, onShow fires only when actually displayed)
  hint(html, o = {}) {
    if (!this.mounted || !this.hintEl) return;
    const t = now(), kind = o.kind || 'tip';
    const h = { html, kind, id: o.id, onShow: o.onShow, at: t, ttl: o.ttl ?? (kind === 'toast' ? 2500 : 9000), life: o.life ?? (kind === 'toast' ? 2300 : 6500), icon: o.icon };
    if (h.id && (this.hintQ.some((x) => x.id === h.id) || (this.hintCur && this.hintCur.id === h.id))) return;
    if (kind === 'toast') {
      if (this.hintCur && this.hintCur.html === html) { this.hintCur.until = t + h.life; return; }
      if (this.hintCur && this.hintCur.kind === 'tip') this.endHint();
      this.hintQ.unshift(h);
    } else this.hintQ.push(h);
  }
  // short screens: a tall hint could reach the hero lane; they then take turns instead of stacking
  hitsHero(el) { if (!el || el.classList.contains('hidden')) return false; const r = el.getBoundingClientRect(), H = this.heroRect(); return r.top < H.y + H.h + 4 && r.bottom > H.y - 4 && r.left < H.w; }
  showHint(h) {
    const el = this.hintEl; this.hintCur = { ...h, until: now() + h.life };
    const img = el.querySelector('img');
    if (img) { if (h.icon) img.src = h.icon; img.style.display = h.kind === 'toast' || !h.icon ? 'none' : ''; }
    el.querySelector('p').innerHTML = h.html;
    el.classList.toggle('toast', h.kind === 'toast');
    el.classList.remove('hidden', 'out'); el.style.animation = 'none'; void el.offsetWidth; el.style.animation = '';
    if (h.onShow && !(this.cur && this.hitsHero(el))) { try { h.onShow(); } catch {} h.onShow = null; }
    this.occAt = 0;
  }
  endHint() { this.hintCur = null; if (this.hintEl) this.hintEl.classList.add('hidden'); }
  dismissHint() { if (this.hintCur) this.hintCur.until = 0; this.endHint(); }
  clearHints() { this.hintQ = []; this.endHint(); }

  // ---------------------------------------------------------------- 15.0 boss bar
  // b: null (hide) or { key, name, color, hp, max, kind:'king'|'boss', me, exposed, enrage, statusHtml, phases:[.66,.33] }
  // returns true when the bar appeared or disappeared (the caller re-fits the camera padding)
  boss(b) {
    if (!this.mounted) return false;
    const el = this.bossEl, was = !!this.bossOn;
    if (!b) { if (was) { this.bossOn = false; el.classList.add('hidden'); el.classList.remove('in'); this.layoutAt = 0; this.occAt = 0; } return was; }
    const q = (s) => el.querySelector(s);
    const r = Math.max(0, Math.min(1, b.hp / Math.max(1, b.max)));
    if (this.bossKey !== b.key) {
      this.bossKey = b.key; this.bossR = r; this.bossPh = b.phase ?? (r <= 0.33 ? 2 : r <= 0.66 ? 1 : 0);
      q('.db-name').textContent = b.name; q('.db-tag').textContent = b.me ? 'You are the King' : b.kind === 'king' ? 'The King' : 'Boss';
      el.style.setProperty('--bc', b.color || '#ffd24d');
      q('.db-ghost').style.transition = 'none'; q('.db-ghost').style.width = r * 100 + '%'; void el.offsetWidth; q('.db-ghost').style.transition = '';
      el.classList.remove('hidden', 'in'); void el.offsetWidth; if (!this.reduced()) el.classList.add('in');
    }
    el.classList.toggle('king', b.kind === 'king'); el.classList.toggle('me', !!b.me);
    const [m1, m2] = b.phases || [0.66, 0.33];
    q('.db-m1').style.left = m1 * 100 + '%'; q('.db-m2').style.left = m2 * 100 + '%';
    q('.db-m1').classList.toggle('past', r <= m1); q('.db-m2').classList.toggle('past', r <= m2);
    q('.db-fill').style.width = r * 100 + '%'; q('.db-ghost').style.width = r * 100 + '%';
    q('.db-hp').textContent = `${Math.max(0, Math.round(b.hp))} / ${Math.round(b.max)}`;
    const tags = [];
    if (b.exposed > 0) tags.push(`<em class="db-exp">Exposed x${b.exposed}</em>`);
    if (b.enrage) tags.push(`<em class="db-rage">Enraged${b.enrage > 1 && b.enrage < 9 ? ' ' + b.enrage : ''}</em>`);
    const st = tags.join('') + (b.statusHtml || '');
    if (q('.db-st').innerHTML !== st) q('.db-st').innerHTML = st;
    el.classList.toggle('rage', !!b.enrage); el.classList.toggle('low', r <= m2);
    if (r < this.bossR - 0.001) { el.classList.remove('hit'); void el.offsetWidth; if (!this.reduced()) el.classList.add('hit'); }
    this.bossR = r;
    if (!was) { this.bossOn = true; this.layoutAt = 0; this.occAt = 0; this.layout(); }
    return !was;
  }
}

// ---------------------------------------------------------------- 15.0 HUD vocabulary (status effects, locations, places)
const SV = (d) => `<svg viewBox="0 0 16 16" aria-hidden="true">${d}</svg>`;
// one glyph per status: stroke icons read at 14-18 px; colour carries the family, the glyph carries the meaning
export const STATUS = {
  burn:    { name: 'Burn',    c: '#ff8a3d', what: 'Loses 6% max HP at the start of each turn. Freeze puts it out.', icon: SV('<path d="M8 1.5c.5 2.6 3.8 4 3.8 7.6A3.8 3.8 0 0 1 4.2 9.1c0-1.6.8-2.6 1.6-3.4.1 1.3.7 2 1.4 2.3C6.8 5.6 7.4 3.4 8 1.5z"/>') },
  poison:  { name: 'Poison',  c: '#8ee05a', what: 'Loses 3% max HP per stack each turn (up to 3 stacks). Healing is halved.', icon: SV('<path d="M8 1.8C6 5 4 7.3 4 9.9a4 4 0 0 0 8 0C12 7.3 10 5 8 1.8z"/><path d="M6.4 10.4l3.2-1.6"/>') },
  freeze:  { name: 'Freeze',  c: '#7fe0ff', what: 'Cannot move this turn. You can still act. Fire thaws it.', icon: SV('<path d="M8 1.5v13M2.4 4.8l11.2 6.4M2.4 11.2l11.2-6.4M6.3 2.6L8 4.2l1.7-1.6M6.3 13.4L8 11.8l1.7 1.6"/>') },
  stun:    { name: 'Stun', c: '#ffe066', what: 'Cannot act this turn. You can still move.', icon: SV('<path d="M8 1.8l1.6 3.6 3.9.4-2.9 2.6.8 3.8L8 10.3l-3.4 1.9.8-3.8-2.9-2.6 3.9-.4z"/>') },
  slow:    { name: 'Slow',  c: '#b4a4ff', what: '-3 SPD: you act later in the turn order.', icon: SV('<path d="M3.5 4.5L8 9l4.5-4.5M3.5 8.5L8 13l4.5-4.5"/>') },
  shield:  { name: 'Shield',  c: '#9df3ff', what: 'Absorbs damage before HP.', icon: SV('<path d="M8 1.6l5 2v4.2c0 3.2-2.2 5.5-5 6.6-2.8-1.1-5-3.4-5-6.6V3.6z"/>') },
  haste:   { name: 'Haste',   c: '#6dffa8', what: '+3 SPD: you act sooner in the turn order.', icon: SV('<path d="M3.5 11.5L8 7l4.5 4.5M3.5 7.5L8 3l4.5 4.5"/>') },
  exposed: { name: 'Exposed', c: '#ff6b7a', what: '-15% DEF for each different attacker this round (up to 4), until the King moves again. Gang up.', icon: SV('<path d="M8 1.6l5 2v4.2c0 3.2-2.2 5.5-5 6.6-2.8-1.1-5-3.4-5-6.6V3.6z"/><path d="M8.6 3.4L7 7.2l2.2 1.4-1.6 4"/>') },
  enrage:  { name: 'Enrage', c: '#ff4d5e', what: '+25% ATK for a short time after a phase shockwave.', icon: SV('<path d="M3 3.5l3 3.2M13 3.5l-3 3.2M4 10.5c1.2-1.4 2.5-2 4-2s2.8.6 4 2M5.5 13h5"/>') },
};
const ST_ORDER = ['freeze', 'stun', 'burn', 'poison', 'slow', 'exposed', 'enrage', 'shield', 'haste'];
// u.status entries [{k,t,n}] (spec 15.0) plus older/alternate fields, merged into one list
export function statusList(u) {
  if (!u) return [];
  const out = new Map();
  for (const x of Array.isArray(u.status) ? u.status : []) if (x && STATUS[x.k] && (x.t == null || x.t > 0)) { const o = out.get(x.k); out.set(x.k, o ? { ...o, t: Math.max(o.t || 0, x.t || 0), n: (o.n || 1) + (x.n || 1) } : { k: x.k, t: x.t, n: x.n }); }
  if (u.exposed > 0 && !out.has('exposed')) out.set('exposed', { k: 'exposed', n: u.exposed });
  if (u.enraged > 0 && !out.has('enrage')) out.set('enrage', { k: 'enrage', t: u.enraged });
  return [...out.values()].sort((a, b) => ST_ORDER.indexOf(a.k) - ST_ORDER.indexOf(b.k));
}
export const hasStatus = (u, k) => statusList(u).some((x) => x.k === k);
// chips: icon + turns left (bottom-right) + stacks (top-right) for poison/exposed, or the shield's absorb value
export function statusChips(u, o = {}) {
  const list = statusList(u).filter((x) => !(o.skip || []).includes(x.k)).slice(0, o.max || 6);
  // one badge per chip: stacks for poison / Exposed, otherwise turns left (a shield shows its absorb value only in the name view)
  return list.map((x) => {
    const S = STATUS[x.k], stacks = x.k === 'poison' || x.k === 'exposed';
    const t = x.t > 0 && x.t < 10 ? x.t : '', badge = stacks ? (x.n > 1 ? 'x' + x.n : t) : t;
    const tip = `${S.name}${stacks && x.n > 1 ? ' x' + x.n : ''}${t ? ` - ${t} turn${t > 1 ? 's' : ''}` : ''}`;
    if (o.names) return `<span class="stc st-${x.k}" style="--sc:${S.c}" title="${tip}">${S.icon}<b>${S.name}${stacks && x.n > 1 ? ' x' + x.n : x.k === 'shield' && x.n > 0 ? ' ' + x.n : ''}</b>${t ? `<i>${t}t</i>` : ''}</span>`;
    return `<span class="stc st-${x.k}${stacks && x.n > 1 ? ' stk' : ''}" style="--sc:${S.c}" title="${tip}">${S.icon}${badge !== '' ? `<i>${badge}</i>` : ''}</span>`;
  }).join('');
}
// glossary lines for every status an ability or passive mentions (ability info box)
export function statusGlossary(...texts) {
  const t = texts.filter(Boolean).join(' ').toLowerCase();
  const hit = Object.keys(STATUS).filter((k) => new RegExp(`\\b${k === 'freeze' ? 'free[zs]|frozen' : k === 'stun' ? 'stun' : k === 'slow' ? 'slow' : k === 'enrage' ? 'enrage' : k}`).test(t));
  return hit.length ? `<div class="ab-st">${hit.map((k) => `<span style="--sc:${STATUS[k].c}"><span class="stc st-${k}">${STATUS[k].icon}</span><b>${STATUS[k].name}</b> ${STATUS[k].what}</span>`).join('')}</div>` : '';
}
// what a fresh freeze / stun means for the player's next turn (callout copy)
export const STATUS_CALL = {
  freeze: { text: 'Frozen', sub: 'Next turn you cannot move. You can still attack.', color: '#7fe0ff' },
  stun: { text: 'Stunned', sub: 'Next turn you cannot act. You can still move.', color: '#ffe066' },
  burn: { text: 'Burning', sub: '6% max HP each turn. Freeze puts it out.', color: '#ff8a3d' },
  poison: { text: 'Poisoned', sub: 'Damage each turn and healing halved.', color: '#8ee05a' },
};

// World Tour: names and one-liners; js/locations.js (W) wins when it is loaded
const LOC_FALLBACK = {
  citadel: { name: 'Frost Citadel', blurb: 'Ice floors slide you further. Blizzards freeze pieces where they stand.', c: '#9fe6ff' },
  forge:   { name: 'Volcanic Forge', blurb: 'Lava and geysers. Eruptions set the board on fire.', c: '#ff8a3d' },
  temple:  { name: 'Sunken Temple', blurb: 'Geysers and portals. Floods slow everyone down.', c: '#5fd8c8' },
  gardens: { name: 'Royal Gardens', blurb: 'Brambles bite. Bloom heals, and a bounty finds the leader.', c: '#9ee07a' },
  ruins:   { name: 'Desert Ruins', blurb: 'The floor crumbles. Sandstorms hide distant pieces.', c: '#f0c46c' },
  works:   { name: 'Iron Works', blurb: 'Conveyors drag you along. War Drums speed the fight up.', c: '#d0a070' },
  rift:    { name: 'Astral Rift', blurb: 'Portals and rifts warp the board. Mana surges charge ultimates.', c: '#b98cff' },
  bog:     { name: 'Witchwood Bog', blurb: 'Poison pools and toxic fog. The dead do not rest here.', c: '#a6d46a' },
};
let LOCS = null, locLoad = null;
// loaded on the first match that has a location (no request at all before W's module exists in a match)
export function loadLocations() { return locLoad || (locLoad = import('./locations.js').then((m) => { LOCS = m.LOCATIONS || m.default || null; }).catch(() => {})); }
export function locationInfo(id) {
  if (!id) return null;
  loadLocations();
  const L = (LOCS && LOCS[id]) || {}, F = LOC_FALLBACK[id] || {};
  const name = L.name || F.name; if (!name) return null;
  // the wheel already shows W's flavour blurb; the intro card says what to expect in play (W's line only for new places)
  return { id, name, blurb: L.expect || F.blurb || L.blurb || L.desc || '', c: (L.mood && L.mood.accent) || L.color || F.c || '#ffd24d' };
}
// "north-east" etc. relative to the playable board (arena or the full board)
export function compass(s, x, y, size = 16) {
  const A = (s && s.arena) || { x0: 0, y0: 0, x1: size - 1, y1: size - 1 };
  const fx = (x - A.x0) / Math.max(1, A.x1 - A.x0), fy = (y - A.y0) / Math.max(1, A.y1 - A.y0);
  const ns = fy < 0.36 ? 'north' : fy > 0.64 ? 'south' : '', ew = fx < 0.36 ? 'west' : fx > 0.64 ? 'east' : '';
  return ns || ew ? `the ${ns}${ns && ew ? '-' : ''}${ew}` : 'the centre';
}
// Ascended names (spec 15.0)
export const ASCENDED = { knight: 'Ascended Knight', bishop: 'Archbishop', rook: 'Fortress Rook', queen: 'Empress Queen' };

export const director = new Director();

// ---------------------------------------------------------------- 15.1 match intro (D)
// One calm sequence instead of overlapping pop-ups: contenders -> location wheel (spin, land, hold) -> one location
// briefing card (name, one line, hazard, signature event) -> the caller plays "Round 1" + the camera drop-in.
// Wall-clock timers only (setTimeout / performance.now): the renderer's timeline pace (camdir speed-up) never touches
// intro text. A tap advances ONE step (a spinning wheel lands first); "Skip intro" (returning players) ends it all.
// Every lane of the Director is held for the whole intro, so tips, toasts, feed and callouts wait for it.
export const INTRO = { ct: 2500, spin: 3100, hold: 2500, brief: 3200, perRow: 500, gap: 300, fly: 1950, net: 600, minTap: 350 };
export const briefMs = (b) => (b ? INTRO.brief + INTRO.perRow * Math.max(0, ((b.rows || []).length) - 1) : 0);
// Deterministic from the state (host and clients agree): how long until the first turn may start.
export function introMs({ contenders = true, wheel = false, brief = null } = {}) {
  let t = 0;
  if (contenders) t += INTRO.ct + INTRO.gap;
  if (wheel) t += INTRO.spin + INTRO.hold + INTRO.gap;
  if (brief) t += briefMs(brief) + INTRO.gap;
  return t ? t + INTRO.fly : 0;
}
export function briefHTML(b) {
  const rows = (b.rows || []).map((r) => `<div class="ib-row${r.cls ? ' ' + r.cls : ''}"><em>${esc(r.k)}</em><b>${esc(r.name)}</b>${r.desc ? `<span>${esc(r.desc)}</span>` : ''}</div>`).join('');
  return `<div class="ib-card" data-msg="intro"><div class="ib-kick">${esc(b.kicker || '')}</div><div class="ib-name">${esc(b.title)}</div>${b.line ? `<p class="ib-line">${esc(b.line)}</p>` : ''}${rows ? `<div class="ib-rows">${rows}</div>` : ''}</div>`;
}
export class Intro {
  constructor(dir) { this.dir = dir; this.on = false; this.log = []; }
  // steps: [{ id, dot, ms, tapText, show(api) -> { tap?() => true if consumed, end?() } }]; o: { root, skip, onDone }
  run(steps, o = {}) {
    this.stop();
    this.steps = steps.filter(Boolean); this.i = -1; this.o = o; this.on = true; this.t0 = now(); this.log = [];
    const root = this.root = o.root || document.body;
    root.classList.add('intro-on'); this.dir.hold(120000); this.dir.clearHints();
    const dots = this.steps.filter((s) => s.dot).length;
    const mk = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return root.appendChild(t.content.firstChild); };
    this.tapEl = mk(`<div class="intro-tap" id="intro-tap"><span class="it-hint"></span></div>`);
    this.barEl = mk(`<div class="intro-bar" id="intro-bar">${dots > 1 ? `<div class="ib-dots" aria-hidden="true">${'<i></i>'.repeat(dots)}</div>` : '<div></div>'}${o.skip ? '<button type="button" class="ib-skip" id="intro-skip">Skip intro</button>' : ''}</div>`);
    this.tapEl.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); this.tap(); });
    const sk = this.barEl.querySelector('.ib-skip'); if (sk) sk.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); this.skipAll(); });
    this.next();
  }
  mark(id) { this.log.push({ id, t: Math.round(now() - this.t0) }); }
  // the outgoing step fades for INTRO.gap before the next one appears: never two intro panels on screen at once
  next() {
    if (!this.on || this.gapping) return;
    clearTimeout(this.timer); const had = this.i >= 0;
    if (!had) { this.show(); return; }
    this.gapping = true; this.stepAt = now() + 1e6; this.endCur(); // gapping first: a step's end() may call api.next()
    this.timer = setTimeout(() => { this.gapping = false; if (this.on) this.show(); }, INTRO.gap);
  }
  show() {
    if (++this.i >= this.steps.length) { this.finish(false); return; }
    const st = this.steps[this.i]; this.stepAt = now(); this.mark(st.id);
    const di = this.steps.slice(0, this.i + 1).filter((s) => s.dot).length - 1;
    this.barEl.querySelectorAll('.ib-dots i').forEach((d, k) => { d.className = k < di ? 'past' : k === di ? 'on' : ''; });
    this.barEl.classList.toggle('quiet', !st.dot);
    this.tapEl.querySelector('.it-hint').textContent = st.tapText ?? 'Tap to continue';
    this.tapEl.classList.toggle('wait', !!st.wait);
    let cur = {}; try { cur = st.show({ next: () => { if (this.on && this.steps[this.i] === st) this.next(); } }) || {}; } catch (e) { console.warn('intro step', st.id, e); }
    this.cur = cur;
    if (st.ms > 0) this.timer = setTimeout(() => { if (this.on && this.steps[this.i] === st) this.next(); }, st.ms);
  }
  endCur() { const c = this.cur; this.cur = null; if (c && c.end) { try { c.end(); } catch {} } }
  tap() {
    if (!this.on || now() - this.stepAt < INTRO.minTap) return;
    const st = this.steps[this.i]; if (st && st.wait) return;
    const c = this.cur; if (c && c.tap) { let used = false; try { used = c.tap() === true; } catch {} if (used) { this.mark(st.id + ':tap'); return; } }
    this.next();
  }
  skipAll() { if (!this.on) return; this.mark('skip'); clearTimeout(this.timer); this.gapping = true; this.endCur(); this.finish(true); }
  finish(skipped) {
    if (!this.on) return; this.on = false; this.mark('done');
    this.cleanup();
    const f = this.o.onDone; this.o = {};
    if (f) { try { f(!!skipped); } catch (e) { console.warn('intro done', e); } }
  }
  cleanup() {
    clearTimeout(this.timer); this.gapping = false;
    for (const el of [this.tapEl, this.barEl]) if (el) el.remove();
    this.tapEl = this.barEl = null;
    if (this.root) this.root.classList.remove('intro-on');
    this.dir.release();
  }
  // leaving the match: drop everything, no onDone
  stop() { if (!this.on) return; this.on = false; clearTimeout(this.timer); this.endCur(); this.o = {}; this.cleanup(); }
}
export const intro = new Intro(director);
