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

// hero timing per tier (ms on screen, not counting the gap)
const LIFE = { 1: 1650, 2: 1900, 3: 2350, disc: 2600 };
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
    this.heroEl = mk(`<div class="dh" id="dir-hero" aria-live="polite"><div class="dh-plate"><i class="dh-sweep"></i></div><div class="dh-ring"></div><div class="dh-in" data-msg="hero"><div class="dh-kick"></div><div class="dh-title"></div><div class="dh-sub"></div><div class="dh-tags"></div></div></div>`);
    this.turnEl = mk(`<div class="dt" id="dir-turn" data-msg="turn"><b></b><span></span></div>`);
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
    this.q = []; this.cur = null; this.lastEnd = 0; this.holdUntil = 0; this.turnUntil = 0;
    for (const r of this.feedRows) r.el.remove();
    this.feedRows = []; this.hintQ = []; this.hintCur = null; this.occ = []; this.pendFeed = []; this.pendTurn = null;
    if (!this.mounted) return;
    this.heroEl.className = 'dh'; this.turnEl.className = 'dt';
    if (this.hintEl) this.hintEl.classList.add('hidden');
    this.root.classList.remove('dir-turn');
    this.layoutAt = 0;
  }
  // Pause every lane except status (contender intro, modals).
  hold(ms) { this.holdUntil = Math.max(this.holdUntil, now() + ms); this.root && this.root.classList.add('dir-hold'); }
  release() { this.holdUntil = 0; this.root && this.root.classList.remove('dir-hold'); }
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
    const big = document.body.classList.contains('bigtext') ? 1.12 : 1;
    const short = H < 520;
    const laneTop = Math.round(top + 6);
    const feedTop = laneTop + (short ? 30 : 34);
    this.feedMax = short ? 2 : FEED_MAX;
    const rowH = Math.round((short ? 22 : 24) * big), feedH = this.feedMax * rowH + (this.feedMax - 1) * 4;
    const heroTop = feedTop + feedH + (short ? 6 : 12);
    // bottom: lowest obstacle among buttons and the status slot
    let floor = side ? H : hb ? hb.top : H;
    for (const el of [$('#ult-btn'), $('.emote-wrap'), this.lethalEl]) { const r = rect(el); if (r && r.height > 4 && r.top > H * 0.4) floor = Math.min(floor, r.top); }
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
    if (!this.hintCur && !held && this.hintQ.length && t >= (this.hintRetry || 0)) { const h = this.hintQ.shift(); this.showHint(h); if (this.cur && this.hitsHero(this.hintEl)) { this.endHint(); this.hintQ.unshift(h); this.hintRetry = t + 300; } }
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
    const L = this.L, avail = Math.max(200, L.W - L.side - 32), base = { 1: 36, 2: 44, 3: 56, disc: 34 }[m.tier] || 36;
    const px = Math.max(18, Math.min(base * (L.W >= 760 && !L.side ? 1.25 : 1), avail / (String(m.text).length * 0.74 + 0.6), L.heroH * (m.tags && m.tags.length ? 0.38 : 0.46)));
    el.style.setProperty('--tpx', px.toFixed(1) + 'px');
    el.style.setProperty('--life', ((m.end - m.start) / 1000).toFixed(2) + 's');
    const tier = m.tier === 'disc' ? 'disc' : 't' + (m.tier || 1);
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
}

export const director = new Director();
