// Chess Complex 10.2 - Quick Chat.
// Curated phrases in categories, store emote packs as extra phrase packs, favourites, recently used,
// and up to 12 custom phrases per player. Custom text is free text going to other players, so every
// device treats it as hostile: the host validates, sanitizes, masks and rate-limits before relaying,
// and every receiver sanitizes and masks again (the host could be malicious too). Custom text is only
// ever drawn with textContent or canvas fillText, never innerHTML.
//
// Wire format (client -> host):   { t: 'chat', k: '<phrase id>' , tm?: 1 }   or   { t: 'chat', x: '<text>', tm?: 1 }
// Host -> peers (after checks):   { t: 'chat', id: <unit id>, pid, k | x, tm? }
// Host -> sender when throttled:  { t: 'chat', a: 'slow' }
import { EMOTES } from './data.js';

export const MAX_CUSTOM = 12, CUSTOM_LEN = 40, FAV_SLOTS = 8, FAV_MIN = 6, FAV_MAX = 10, RECENT_MAX = 10, LOG_MAX = 300, STRIP_ROWS = 3;
export const DEFAULT_FAV = ['g.glhf', 't.storm', 't.help', 't.omw', 'r.nice', 'x.slow', 'k.gg', 'k.wp'];

// ---------------------------------------------------------------- phrases
export const CATS = [
  { id: 'greet', name: 'Hello', phrases: {
    'g.hi': 'Hello!', 'g.hey': 'Hi all', 'g.gl': 'Good luck', 'g.hf': 'Have fun', 'g.glhf': 'Good luck, have fun', 'g.ready': 'Ready?',
    'g.play': "Let's play", 'g.back': 'Back again', 'g.welcome': 'Welcome!', 'g.first': 'First game today', 'g.onemore': 'One more?', 'g.lets': "Let's go!",
  } },
  { id: 'tactic', name: 'Tactics', phrases: {
    't.storm': 'Storm closing', 't.king': 'Go for the King', 't.help': 'Need help', 't.omw': 'On my way', 't.hollow': 'Watch the Hollow',
    't.safe': 'Get to the safe zone', 't.crown': 'Crown is up', 't.takecrown': 'Take the Crown', 't.ult': 'Ult ready', 't.ultsoon': 'Ult charging',
    't.low': 'Low HP', 't.back': 'Fall back', 't.push': 'Push now', 't.leader': 'Focus the leader', 't.wait': 'Wait for it',
    't.trap': 'Trap here', 't.hazard': 'Hazard ahead', 't.careful': 'Careful', 't.shards': 'Shards here', 't.promo': 'Promoting soon',
  } },
  { id: 'team', name: 'Squad', team: true, phrases: {
    's.with': 'With you', 's.cover': 'Cover me', 's.revive': 'Revive me', 's.reviving': 'Reviving you', 's.stick': 'Stick together',
    's.split': 'Split up', 's.left': 'Take left', 's.right': 'Take right', 's.target': 'Hit my target', 's.bait': "I'll bait",
    's.hold': 'Hold here', 's.regroup': 'Regroup', 's.follow': 'Follow me', 's.back': 'Watch my back', 's.bond': 'Stay close for Bond', 's.go': 'Go go go',
  } },
  { id: 'react', name: 'React', phrases: {
    'r.nice': 'Nice!', 'r.wow': 'Wow', 'r.close': 'Close one', 'r.unlucky': 'Unlucky', 'r.oops': 'Oops', 'r.noway': 'No way',
    'r.phew': 'Phew', 'r.ouch': 'Ouch', 'r.move': 'What a move', 'r.clutch': 'Clutch!', 'r.lucky': 'Lucky!', 'r.hmm': 'Hmm...',
    'r.called': 'Called it', 'r.brain': 'Big brain', 'r.again': 'Not again',
  } },
  { id: 'taunt', name: 'Taunt', phrases: {
    'x.slow': 'Too slow', 'x.all': 'Is that all?', 'x.catch': 'Catch me if you can', 'x.yourmove': 'Your move', 'x.check': 'Check!',
    'x.soon': 'Checkmate soon', 'x.today': 'Not today', 'x.retry': 'Try again', 'x.mine': 'Mine now', 'x.bring': 'Bring it on',
    'x.box': 'Back in the box', 'x.see': 'I see you',
  } },
  { id: 'thanks', name: 'GG', phrases: {
    'k.gg': 'GG', 'k.ggwp': 'GG WP', 'k.wp': 'Well played', 'k.ty': 'Thanks!', 'k.sorry': 'Sorry!', 'k.bad': 'My bad',
    'k.nw': 'No worries', 'k.rematch': 'Rematch?', 'k.respect': 'Respect', 'k.great': 'Great game', 'k.fun': 'That was fun', 'k.cya': 'See you next time',
  } },
];
export const PHRASES = {}; export const PHRASE_CAT = {};
for (const c of CATS) for (const [k, v] of Object.entries(c.phrases)) { PHRASES[k] = v; PHRASE_CAT[k] = c.id; }
export const PHRASE_COUNT = Object.keys(PHRASES).length;
const own = (T, k) => typeof k === 'string' && k.length <= 24 && Object.prototype.hasOwnProperty.call(T, k);
export const isPreset = (k) => own(PHRASES, k) || own(EMOTES, k);
export const presetText = (k) => (own(PHRASES, k) ? PHRASES[k] : own(EMOTES, k) ? EMOTES[k] : null);

// Bots only ever speak curated lines.
export const BOT_LINES = {
  kill: ['r.nice', 'x.check', 'x.slow', 'x.mine', 'x.box', 'r.called', 'x.retry', 'r.move', 'gg', 'come'],
  start: ['g.gl', 'g.glhf', 'g.hf', 'g.hi', 'g.ready'],
  hurt: ['r.ouch', 'r.close', 'r.phew', 't.low'],
  win: ['k.gg', 'k.ggwp', 'k.wp', 'k.fun'],
  crown: ['t.crown', 'x.mine'],
};

// ---------------------------------------------------------------- sanitizing and masking
// Strip markup, control/format/bidi characters, emoji, private-use and stacked combining marks; mask links; cap length.
export function sanitize(raw, max = CUSTOM_LEN) {
  if (typeof raw !== 'string') return '';
  let s = raw.slice(0, 400);
  try { s = s.normalize('NFKC'); } catch {}
  s = s.replace(/<[^>]*>?/g, ' ').replace(/[<>]/g, '')
    .replace(/[\p{Cc}\p{Cf}\p{Co}\p{Cs}\p{Zl}\p{Zp}]/gu, '')
    .replace(/[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}\uFE00-\uFE0F\u20E3]/gu, '')
    .replace(/(\p{M})\p{M}+/gu, '$1')
    .replace(/\s+/g, ' ').trim();
  s = s.replace(/\b(?:https?:\/\/|www\.)\S+/gi, '***').replace(/\b[\w-]+(?:\.[\w-]+)*\.(?:com|net|org|gg|io|ly|me|co|xyz|ru|tk|app|link|site|info|biz|tv)\b\S*/gi, '***');
  const cp = Array.from(s); if (cp.length > max) s = cp.slice(0, max).join('').trim();
  return s;
}
// A basic filter: whole-word matching after leet/diacritic folding, so "class" or "assassin" stay clean.
const LEET = { 0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 7: 't', 8: 'b', 9: 'g', '@': 'a', $: 's', '!': 'i', '|': 'i', '+': 't', '€': 'e' };
const PREFIX = ['fuck', 'fuk', 'fck', 'fvck', 'phuck', 'motherf', 'shit', 'sh1t', 'bullshit', 'cunt', 'bitch', 'biatch', 'whore', 'slut', 'nigg', 'nigga', 'niga', 'fagg', 'faggot', 'retard', 'rape', 'rapist', 'wank', 'twat', 'bastard', 'asshole', 'asshat', 'asswipe', 'arsehole', 'dickhead', 'pussy', 'porn', 'nazi', 'kike', 'chink', 'tranny', 'spastic', 'cocksuck', 'jackass', 'dumbass', 'jizz', 'dildo', 'penis', 'vagina', 'blowjob'];
const EXACT = new Set(['ass', 'arse', 'asses', 'dick', 'dicks', 'cock', 'cocks', 'fag', 'fags', 'cum', 'tits', 'tit', 'kys', 'spic', 'coon', 'coons', 'dyke', 'dykes', 'hoe', 'hoes', 'piss', 'prick', 'nonce', 'wop', 'gook', 'negro', 'sex', 'nude', 'nudes', 'boob', 'boobs', 'kms']);
const PHRASES_BAD = ['killyourself', 'killurself', 'killyoself', 'hangyourself', 'neckyourself', 'gokys', 'killyaself', 'unaliveyourself', 'drinkbleach'];
const fold = (w) => { let s = w.toLowerCase(); try { s = s.normalize('NFKD').replace(/\p{M}/gu, ''); } catch {} return Array.from(s).map((c) => LEET[c] || c).join('').replace(/[^a-z]/g, ''); };
const squeeze = (w) => w.replace(/(.)\1+/g, '$1');
const vsq = (w) => w.replace(/([aeiouy])\1+/g, '$1'); // "fuuuck", "shiiit"; consonants stay doubled so "Niger" is not "nigg"
const badWord = (w) => {
  const a = fold(w); if (!a) return false; const b = vsq(a), c = squeeze(a);
  return EXACT.has(a) || EXACT.has(b) || EXACT.has(c) || PREFIX.some((p) => a.startsWith(p) || b.startsWith(p));
};
export function mask(text) {
  if (!text) return '';
  const all = fold(text);
  if (PHRASES_BAD.some((p) => all.includes(p) || squeeze(all).includes(squeeze(p)))) return text.replace(/\S/g, '*');
  const parts = text.split(/(\s+)/); const words = [];
  for (let i = 0; i < parts.length; i += 2) words.push(i);
  const bad = new Set(words.filter((i) => badWord(parts[i])));
  // spaced out letters: "f u c k"
  for (let a = 0; a < words.length; a++) {
    if (fold(parts[words[a]]).length !== 1) continue;
    let b = a; while (b + 1 < words.length && fold(parts[words[b + 1]]).length === 1) b++;
    if (b - a >= 2) { const run = words.slice(a, b + 1); const joined = run.map((i) => parts[i]).join(''); if (badWord(joined) || PREFIX.some((p) => fold(joined).includes(p))) run.forEach((i) => bad.add(i)); }
    a = b;
  }
  return parts.map((p, i) => (bad.has(i) ? p.replace(/\S/g, '*') : p)).join('');
}
export const clean = (raw) => mask(sanitize(raw));

// ---------------------------------------------------------------- host-side checks
// Token bucket per player: 3 messages, one back every 1.5 s; customs at most one per 3 s; the same text
// twice within 8 s is dropped; 6 throttled sends inside 10 s silence that player for 20 s.
const CAP = 3, REFILL = 1500, CUSTOM_GAP = 3000, DUP_MS = 8000, STRIKES = 6, TIMEOUT = 20000;
export function rateCheck(book, pid, now, { custom = false, text = '' } = {}) {
  const key = 'p:' + String(pid); // prefixed so ids like __proto__ can never touch Object.prototype
  const st = book[key] || (book[key] = { tokens: CAP, at: now, lastC: -1e9, lastT: '', lastTAt: -1e9, strikes: 0, strikeAt: 0, quiet: 0 });
  st.tokens = Math.min(CAP, st.tokens + (now - st.at) / REFILL); st.at = now;
  const strike = () => { if (now - st.strikeAt > 10000) st.strikes = 0; st.strikes++; st.strikeAt = now; if (st.strikes >= STRIKES) { st.quiet = now + TIMEOUT; st.strikes = 0; } return false; };
  if (now < st.quiet) return false;
  if (st.tokens < 1) return strike();
  if (custom && now - st.lastC < CUSTOM_GAP) return strike();
  if (text && text === st.lastT && now - st.lastTAt < DUP_MS) return strike();
  st.tokens -= 1; if (custom) st.lastC = now; st.lastT = text; st.lastTAt = now;
  return true;
}
// Validate a raw chat payload from player `pid`. Returns { out } to relay, { slow: true } when throttled, or null (dropped).
export function hostCheck(book, pid, raw, s, now = Date.now()) {
  if (!raw || typeof raw !== 'object' || !s || !Array.isArray(s.units)) return null;
  const u = s.units.find((v) => v.pid === pid && v.kind === 'player'); if (!u) return null;
  const tm = !!raw.tm && s.teams != null && u.team != null;
  let out;
  if (raw.k != null) {
    if (!isPreset(raw.k)) return null;
    out = { t: 'chat', id: u.id, pid, k: raw.k };
  } else if (raw.x != null) {
    if (typeof raw.x !== 'string' || raw.x.length > 200 || u.bot) return null; // bots never send free text
    const x = clean(raw.x); if (!x || !/[\p{L}\p{N}]/u.test(x)) return null;
    out = { t: 'chat', id: u.id, pid, x };
  } else return null;
  if (!rateCheck(book, pid, now, { custom: !!out.x, text: out.k || out.x })) return { slow: true };
  if (tm) { out.tm = 1; out.team = u.team; }
  return { out };
}

// ---------------------------------------------------------------- profile data
export function ensureChat(p) {
  if (!p) return { fav: [], custom: [], recent: [] };
  const c = p.chat && typeof p.chat === 'object' ? p.chat : {};
  const okRef = (r) => typeof r === 'string' && (isPreset(r) || /^c:\d{1,2}$/.test(r));
  c.custom = (Array.isArray(c.custom) ? c.custom : []).slice(0, MAX_CUSTOM).map((x) => (typeof x === 'string' ? sanitize(x) : ''));
  while (c.custom.length && !c.custom[c.custom.length - 1]) c.custom.pop();
  // 15.0: 6-10 favourite slots (default 8). setup = the player has picked them (asked on the first open of the picker);
  // older profiles that already changed their favourites count as set up.
  const had = Array.isArray(c.fav);
  c.favN = Math.max(FAV_MIN, Math.min(FAV_MAX, Math.floor(+c.favN) || (had ? Math.max(FAV_SLOTS, c.fav.length) : FAV_SLOTS)));
  c.fav = had ? c.fav.slice(0, c.favN).map((r) => (okRef(r) ? r : null)) : DEFAULT_FAV.slice();
  while (c.fav.length < c.favN) c.fav.push(null);
  if (typeof c.setup !== 'boolean') c.setup = had && c.fav.some((r, i) => r !== (DEFAULT_FAV[i] || null));
  c.recent = (Array.isArray(c.recent) ? c.recent : []).filter(okRef).slice(0, RECENT_MAX);
  p.chat = c; return c;
}

// ---------------------------------------------------------------- UI
const $ = (s, r = document) => r.querySelector(s);
const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
// 15.0: the picker opens on Favourites; every phrase lives in one organised All Phrases view (category chips filter it)
const TABS = [['fav', 'Favourites'], ['all', 'All Phrases'], ['recent', 'Recent'], ['log', 'Log'], ['players', 'Players']];
const ALL_CATS = [...CATS.map((c) => [c.id, c.name]), ['packs', 'Packs'], ['mine', 'Mine']];

export class ChatUI {
  constructor() { this.cat = null; this.pick = null; this.tab = 'fav'; this.log = []; this.muted = new Set(); this.teamOnly = false; this.mounted = false; this.rl = {}; this.sessKey = null; this.unread = 0; this.lastAt = 0; }
  // deps: { profile(), save(), settings, saveSettings(), activeEmotes(profile), game, session(), toast(msg), sfx, director, voice }
  mount(deps) {
    if (this.mounted) return; this.mounted = true; this.d = deps;
    this.menu = $('#emote-menu'); this.menu.classList.add('qc'); this.menu.setAttribute('role', 'dialog'); this.menu.setAttribute('aria-label', 'Quick chat');
    // 10.3: the strip (last 3 lines, always on in matches) and the full history sheet
    this.logEl = el('div', 'chat-log'); this.logEl.id = 'chat-log'; this.logEl.setAttribute('aria-live', 'polite'); $('#s-game').appendChild(this.logEl);
    this.logEl.addEventListener('click', (e) => { if (e.target.closest('.cl-row')) { this.openSheet(); this.d.sfx && this.d.sfx.tap(); } });
    if (deps.director && deps.director.claim) deps.director.claim(this.logEl);
    this.buildSheet();
    this.menu.addEventListener('click', (e) => this.onClick(e));
    this.menu.addEventListener('input', (e) => { const r = e.target.closest('[data-vol]'); if (r && this.d.voice) this.d.voice.setVolume(r.dataset.vol, +r.value); });
    this.buildModal();
    this.bindSettings();
    setInterval(() => this.tickLog(), 250);
    // while the strip has lines in a match, track every other frame so it steps aside before a cine band or a
    // gliding piece settles under it
    const game = $('#s-game'); let fr = 0;
    const loop = () => { requestAnimationFrame(loop); if ((fr++ & 1) || !this.logEl.childElementCount || !game.classList.contains('active') || document.hidden) return; this.tickLog(); };
    requestAnimationFrame(loop);
  }
  get p() { return this.d.profile(); }
  get c() { return ensureChat(this.p); }
  inMatch() { const g = this.d.game; return !!(g && g.s && this.d.session()); }
  resetSession(key) { if (key === this.sessKey) return; this.sessKey = key; this.muted.clear(); this.rl = {}; this.teamOnly = false; this.clearHistory(); }

  // ---- references: preset id, store emote id, or 'c:N' for a custom phrase
  refText(r) { if (typeof r !== 'string') return null; if (r.startsWith('c:')) return this.c.custom[+r.slice(2)] || null; return presetText(r); }
  owned(r) { if (!r) return false; if (r.startsWith('c:')) return !!this.refText(r); if (own(PHRASES, r)) return true; return own(this.d.activeEmotes(this.p), r); }
  listFor(tab) {
    const c = this.c;
    if (tab === 'fav') return c.fav.map((r, i) => (this.owned(r) ? r : null)).filter(Boolean);
    if (tab === 'recent') return c.recent.filter((r) => this.owned(r));
    if (tab === 'packs') return Object.keys(this.d.activeEmotes(this.p));
    if (tab === 'mine') return c.custom.map((x, i) => (x ? 'c:' + i : null)).filter(Boolean);
    const cat = CATS.find((x) => x.id === tab); return cat ? Object.keys(cat.phrases) : [];
  }
  teams() { const g = this.d.game; return !!(g && g.s && g.s.teams && g.me && g.me.team != null); }

  // ---- picker
  // While the picker is open the Director pauses its lanes (messages queue, nothing draws over the picker)
  open() { if (!this.c.setup) this.startPick(); this.render(); this.menu.classList.remove('hidden'); this.logEl.classList.add('yield'); this.wrapOpen(true); this.holdDir(); }
  close() { if (this.pick && this.pick.first) this.finishPick(true); this.pick = null; this.menu.classList.add('hidden'); this.wrapOpen(false); }
  // ---- favourites chooser (first open, or Edit in the Favourites view): tap phrases in the order you want them
  startPick() { const c = this.c; this.pick = { first: !c.setup, sel: c.fav.filter((r) => this.owned(r)) }; }
  finishPick(suggested) {
    const c = this.c, P = this.pick; if (!P) return;
    const sel = suggested ? DEFAULT_FAV.filter((r) => this.owned(r)) : P.sel.slice(0, FAV_MAX);
    c.favN = Math.max(FAV_MIN, Math.min(FAV_MAX, sel.length)); c.fav = sel.slice(0, c.favN); while (c.fav.length < c.favN) c.fav.push(null);
    c.setup = true; this.pick = null; this.tab = 'fav'; this.d.save();
  }
  renderPick(m) {
    const P = this.pick, n = P.sel.length;
    const head = el('div', 'qc-pick-h');
    head.append(el('b', '', P.first ? 'Pick your favourites' : 'Edit favourites'), el('small', '', `Tap ${FAV_MIN} to ${FAV_MAX} phrases in the order you want them. Quick chat opens on these.`));
    const cnt = el('span', 'qc-pick-n' + (n >= FAV_MIN ? ' ok' : ''), `${n} / ${FAV_MAX}`); cnt.setAttribute('aria-live', 'polite'); head.appendChild(cnt);
    const body = el('div', 'qc-body qc-all'); body.dataset.tab = 'pick';
    for (const [id, name] of ALL_CATS) {
      if (id === 'packs' || (id === 'team' && !this.teamsHere())) continue;
      const list = this.listFor(id); if (!list.length) continue;
      body.appendChild(el('div', 'qc-h', name));
      for (const r of list) {
        const i = P.sel.indexOf(r), b = el('button', 'qc-p qc-tog' + (i >= 0 ? ' on' : ''), this.refText(r));
        b.dataset.tog = r; b.setAttribute('aria-pressed', i >= 0 ? 'true' : 'false'); if (i >= 0) b.dataset.n = i + 1;
        body.appendChild(b);
      }
    }
    const foot = el('div', 'qc-foot');
    const sug = el('button', 'qc-edit', 'Use Suggested'); sug.dataset.qc = 'pick-default'; foot.appendChild(sug);
    if (!P.first) { const x = el('button', '', 'Cancel'); x.dataset.qc = 'pick-cancel'; foot.appendChild(x); }
    const done = el('button', 'qc-done', n >= FAV_MIN ? `Done (${n})` : `Pick ${FAV_MIN - n} more`); done.dataset.qc = 'pick-done'; done.disabled = n < FAV_MIN; foot.appendChild(done);
    m.append(head, body, foot);
  }
  teamsHere() { const g = this.d.game; return !(g && g.s && !g.s.teams && !g.s.siege); }
  wrapOpen(on) { const w = this.menu.closest('.emote-wrap'); if (w) w.classList.toggle('qc-open', on); }
  holdDir() { const D = this.d.director; if (D && D.hold && !this.menu.classList.contains('hidden')) D.hold(400); }
  toggle() { if (this.menu.classList.contains('hidden')) this.open(); else this.close(); }
  render() {
    if (!this.menu) return;
    const c = this.c, m = this.menu; m.textContent = '';
    m.classList.toggle('qc-picking', !!this.pick);
    if (this.pick) { this.renderPick(m); return; }
    if (ALL_CATS.some(([id]) => id === this.tab)) { this.cat = this.tab; this.tab = 'all'; } // old category tabs live in All Phrases now
    if (this.tab === 'fav' && !this.listFor('fav').length) this.tab = 'all';
    if (this.tab === 'recent' && !c.recent.length) this.tab = 'fav';
    if (this.tab === 'log') this.tab = 'fav'; // the Log tab opens the history sheet
    const body = el('div', 'qc-body'); body.dataset.tab = this.tab;
    if (this.tab === 'players') this.renderPlayers(body);
    else if (this.tab === 'all') this.renderAll(body);
    else {
      const list = this.listFor(this.tab);
      if (!list.length) body.appendChild(el('p', 'qc-empty', this.tab === 'mine' ? 'No phrases yet. Tap Customise to write up to 12 of your own.' : 'Nothing here yet.'));
      for (const r of list) { const b = el('button', 'qc-p', this.refText(r)); b.dataset.say = r; if (CATS.find((x) => x.id === PHRASE_CAT[r] && x.team) && this.teams()) b.classList.add('team'); body.appendChild(b); }
    }
    const tabs = el('div', 'qc-tabs'); tabs.setAttribute('role', 'tablist');
    for (const [id, name] of TABS) {
      if (id === 'recent' && !c.recent.length) continue;
      const b = el('button', 'qc-tab' + (id === this.tab ? ' on' : ''), id === 'log' && this.unread ? `${name} (${this.unread > 9 ? '9+' : this.unread})` : name); b.dataset.tab = id; b.setAttribute('role', 'tab'); b.setAttribute('aria-selected', id === this.tab ? 'true' : 'false'); tabs.appendChild(b);
    }
    const foot = el('div', 'qc-foot');
    if (this.tab === 'fav') { const ef = el('button', 'qc-edit', 'Edit Favourites'); ef.dataset.qc = 'favs'; foot.appendChild(ef); }
    if (this.teams()) { const t = el('button', 'qc-team' + (this.teamOnly ? ' on' : ''), this.teamOnly ? 'Team only: On' : 'Team only: Off'); t.dataset.qc = 'team'; t.setAttribute('aria-pressed', this.teamOnly ? 'true' : 'false'); foot.appendChild(t); }
    const cu = el('button', 'qc-edit', 'Customise'); cu.dataset.qc = 'custom'; foot.appendChild(cu);
    const cl = el('button', 'qc-close', 'Close'); cl.dataset.qc = 'close'; cl.setAttribute('aria-label', 'Close quick chat'); foot.appendChild(cl);
    m.append(body, tabs, foot);
    const on = tabs.querySelector('.on'); if (on) requestAnimationFrame(() => { try { on.scrollIntoView({ inline: 'nearest', block: 'nearest' }); } catch {} });
  }
  // All Phrases: category chips (All, Hello, Tactics, ...) over one list with a header per category
  renderAll(body) {
    const cats = ALL_CATS.filter(([id]) => !(id === 'team' && !this.teamsHere()) && this.listFor(id).length);
    if (this.cat && !cats.some(([id]) => id === this.cat)) this.cat = null;
    const chips = el('div', 'qc-cats'); chips.setAttribute('role', 'group'); chips.setAttribute('aria-label', 'Categories');
    for (const [id, name] of [[null, 'All'], ...cats]) { const b = el('button', 'qc-cat' + ((id || null) === this.cat ? ' on' : ''), name); b.dataset.tab = id || 'all'; b.setAttribute('aria-pressed', (id || null) === this.cat ? 'true' : 'false'); chips.appendChild(b); }
    body.appendChild(chips);
    const fav = new Set(this.c.fav);
    for (const [id, name] of cats) {
      if (this.cat && this.cat !== id) continue;
      body.appendChild(el('div', 'qc-h', name));
      for (const r of this.listFor(id)) { const b = el('button', 'qc-p' + (fav.has(r) ? ' fav' : ''), this.refText(r)); b.dataset.say = r; if (CATS.find((x) => x.id === PHRASE_CAT[r] && x.team) && this.teams()) b.classList.add('team'); body.appendChild(b); }
    }
  }
  renderPlayers(body) {
    const g = this.d.game, s = g && g.s, sess = this.d.session(), V = this.d.voice;
    if (V && sess && (sess.mode === 'host' || sess.mode === 'client')) V.controls(body);
    const units = s ? s.units.filter((u) => u.kind === 'player' && u.pid !== (sess && sess.myPid)) : [];
    if (!units.length) body.appendChild(el('p', 'qc-empty', 'No other players.'));
    for (const u of units) {
      const row = el('div', 'qc-pl'); row.dataset.pid = u.pid;
      const n = el('b', '', u.name); n.style.color = u.color; row.appendChild(n);
      if (u.bot || String(u.pid).startsWith('bot')) row.appendChild(el('small', '', 'Bot'));
      const mb = el('button', 'qc-mute' + (this.muted.has(u.pid) ? ' on' : ''), this.muted.has(u.pid) ? 'Chat muted' : 'Mute chat'); mb.dataset.mute = u.pid; mb.setAttribute('aria-pressed', this.muted.has(u.pid) ? 'true' : 'false'); row.appendChild(mb);
      if (V) V.playerControls(row, u.pid);
      body.appendChild(row);
    }
  }
  onClick(e) {
    const t = e.target.closest('button'); if (!t || !this.menu.contains(t)) return;
    const sfx = this.d.sfx;
    if (t.dataset.tab === 'log') { this.close(); this.openSheet(); sfx && sfx.tap(); return; }
    if (t.dataset.tog && this.pick) { const P = this.pick, i = P.sel.indexOf(t.dataset.tog); if (i >= 0) P.sel.splice(i, 1); else if (P.sel.length >= FAV_MAX) { this.d.toast(`Up to ${FAV_MAX} favourites`); return; } else P.sel.push(t.dataset.tog); this.render(); sfx && sfx.tap(); return; }
    if (t.dataset.tab) { const id = t.dataset.tab; if (t.classList.contains('qc-cat') || ALL_CATS.some(([k]) => k === id)) { this.tab = 'all'; this.cat = id === 'all' ? null : id; } else { this.tab = id; if (id === 'all') this.cat = null; } this.render(); sfx && sfx.tap(); return; }
    if (t.dataset.say) { this.say(t.dataset.say); this.close(); return; }
    if (t.dataset.mute) { const pid = t.dataset.mute; if (this.muted.has(pid)) this.muted.delete(pid); else this.muted.add(pid); this.render(); this.renderStrip(); if (this.sheetOpen()) this.renderSheet(); sfx && sfx.tap(); return; }
    if (t.dataset.vc && this.d.voice) { this.d.voice.onControl(t.dataset.vc, t.dataset.pid); setTimeout(() => this.tab === 'players' && !this.menu.classList.contains('hidden') && this.render(), 50); return; }
    const q = t.dataset.qc;
    if (q === 'favs') { this.startPick(); this.render(); sfx && sfx.tap(); return; }
    if (q === 'pick-done') { if (this.pick && this.pick.sel.length >= FAV_MIN) { this.finishPick(false); this.render(); sfx && sfx.select && sfx.select(); } return; }
    if (q === 'pick-default') { this.finishPick(true); this.render(); sfx && sfx.select && sfx.select(); return; }
    if (q === 'pick-cancel') { this.pick = null; this.render(); sfx && sfx.tap(); return; }
    if (q === 'team') { this.teamOnly = !this.teamOnly; this.render(); sfx && sfx.tap(); }
    else if (q === 'custom') { this.close(); this.openModal(); }
    else if (q === 'close') { this.close(); sfx && sfx.tap(); }
  }
  // Send a reference. Local throttle mirrors the host so the player gets instant feedback; the host decides.
  say(ref) {
    const sess = this.d.session(); if (!sess || !sess.chat) return false;
    const text = this.refText(ref); if (!text || !this.owned(ref)) return false;
    const custom = ref.startsWith('c:');
    if (!rateCheck(this.rl, 'me', Date.now(), { custom, text })) { this.slow(); return false; }
    const tm = this.teams() && (this.teamOnly || CATS.some((c) => c.team && own(c.phrases, ref))) ? 1 : 0;
    const msg = custom ? { x: text } : { k: ref }; if (tm) msg.tm = 1;
    sess.chat(msg);
    const c = this.c; c.recent = [ref, ...c.recent.filter((r) => r !== ref)].slice(0, RECENT_MAX); this.d.save();
    this.d.sfx && this.d.sfx.tap();
    return true;
  }
  slow() { this.d.toast('Slow down a little'); this.d.sfx && this.d.sfx.error && this.d.sfx.error(); }

  // ---- receiving (every device, including the host's own view). Never trust the payload.
  receive(m) {
    if (!m || typeof m !== 'object') return;
    if (m.a === 'slow') { this.slow(); return; }
    const g = this.d.game, s = g && g.s, sess = this.d.session(); if (!s || !sess) return;
    const pid = typeof m.pid === 'string' ? m.pid.slice(0, 40) : null;
    const u = s.units.find((v) => v.id === m.id && v.kind === 'player'); if (!u || (pid && u.pid !== pid)) return;
    const mine = u.pid === sess.myPid;
    if (!mine && this.muted.has(u.pid)) return;
    const st = this.d.settings;
    if (!mine && st.chatOff) return;
    let text = null, custom = false;
    if (m.k != null) text = isPreset(m.k) ? presetText(m.k) : null;
    else if (m.x != null) { custom = true; if (!mine && st.chatPresetOnly) return; text = typeof m.x === 'string' && m.x.length <= 200 ? clean(m.x) : null; }
    if (!text) return;
    if (m.tm && g.me && !mine && u.team !== g.me.team) return; // a team message that reached the wrong side
    if (u.alive && g.r) g.r.emote(u.id, text);
    const entry = { pid: u.pid, name: u.name, color: u.color, text, tm: !!m.tm, custom, mine, at: Date.now() };
    this.push(entry);
    this.d.sfx && this.d.sfx.emote && this.d.sfx.emote();
  }
  // system lines (voice joins and leaves): history sheet only, never the strip, never unread
  system(text) {
    const g = this.d && this.d.game; if (!g || !g.s || !this.d.session() || typeof text !== 'string') return;
    this.push({ sys: true, text: text.slice(0, 80), at: Date.now() });
  }
  push(L) {
    this.log.push(L); if (this.log.length > LOG_MAX) this.log.splice(0, this.log.length - LOG_MAX);
    if (!L.sys) { this.lastAt = performance.now(); this.renderStrip(true); }
    this.appendSheet(L);
    this.tickLog(true);
  }
  shown(L) { return L.sys || !this.muted.has(L.pid); }
  clearHistory() { this.log = []; this.unread = 0; this.renderStrip(); if (this.sheet) { this.sheetList.textContent = ''; this.closeSheet(); } this.badge(); }

  // ---- strip: the last 3 lines above the chat button. Older lines fade, the strip dims when idle, and it yields to
  // any Director message it would touch (the Director avoids it too: claim()). Tap it to open the history.
  renderStrip(fresh) {
    if (!this.logEl) return;
    const rows = this.log.filter((L) => !L.sys && this.shown(L)).slice(-STRIP_ROWS);
    this.logEl.textContent = '';
    rows.forEach((L, i) => {
      const age = rows.length - 1 - i;
      const row = el('div', `cl-row a${age}` + (L.tm ? ' tm' : '') + (fresh && age === 0 ? ' new' : ''));
      if (L.tm) row.appendChild(el('i', '', 'Team'));
      const n = el('b', '', L.name); n.style.color = L.color || ''; row.append(n, document.createTextNode(' ' + L.text));
      this.logEl.appendChild(row);
    });
    this.stripRows = rows;
  }
  stripOff() { return !!this.d.settings.chatStripOff; }
  tickLog(force) {
    if (!this.logEl) return;
    if (this.menu.classList.contains('hidden')) this.wrapOpen(false); else this.holdDir(); // closed by other code (board tap, new match)
    const wrap = $('.emote-wrap'); let base = null;
    if (wrap && wrap.offsetParent) { const btn = wrap.querySelector('.emote-btn'); const top = (this.menu.classList.contains('hidden') ? wrap : btn).getBoundingClientRect().top; base = Math.max(8, Math.round(innerHeight - top + 8)); }
    let yieldIt = this.stripOff() || this.sheetOpen() || !this.menu.classList.contains('hidden') || !this.logEl.childElementCount;
    if (!yieldIt && this.d.director && this.d.director.cineActive && this.d.director.cineActive()) yieldIt = true; // ultimate cinematics own the screen
    if (!yieldIt && base != null) {
      // Dodge, then yield: if a Director message (hint, callout, cine band, lethal...) or my / the active piece is
      // under the strip, lift it just above the obstacle (not higher than 30% from the top); hide it only if that fails.
      const me = this.logEl.getBoundingClientRect(), H = this.logEl.offsetHeight;
      const D = this.d.director;
      const occ = D && D.occupied ? D.occupied().filter((r) => !(Math.abs(r.x - (me.left - 4)) < 3 && Math.abs(r.w - (me.width + 8)) < 3)) : [];
      const obs = occ.concat(this.pieceRects());
      const hits = (b) => { const t = innerHeight - b - H, bt = innerHeight - b; return obs.filter((r) => r.x < me.right && r.x + r.w > me.left && r.y < bt && r.y + r.h > t); };
      let b = base, ok = false;
      for (let i = 0; i < 4; i++) {
        const hh = hits(b); if (!hh.length) { ok = true; break; }
        const nb = Math.round(innerHeight - Math.min(...hh.map((r) => r.y)) + 6);
        if (nb <= b || innerHeight - nb - H < innerHeight * 0.3) break;
        b = nb;
      }
      if (ok) this.logEl.style.bottom = b + 'px'; else yieldIt = true;
    } else if (base != null) this.logEl.style.bottom = base + 'px';
    this.logEl.classList.toggle('yield', yieldIt);
    this.logEl.classList.toggle('idle', performance.now() - this.lastAt > 10000);
    // on my turn the strip lets taps through to the board (the log stays one tap away: chat button > Log)
    const g = this.d.game; let mine = false; try { mine = !!(g && g.s && g.myTurn && g.myTurn()); } catch {}
    this.logEl.classList.toggle('pass', mine);
    // unread: lines nobody could see (strip hidden, yielded or switched off, or older than the 3 it shows)
    const stripVisible = !yieldIt && !!this.logEl.offsetParent && getComputedStyle(this.logEl).visibility !== 'hidden';
    if (this.sheetOpen()) { for (const L of this.log) L.seen = true; }
    else if (stripVisible) for (const L of this.stripRows || []) L.seen = true;
    const n = this.log.reduce((a, L) => a + (!L.seen && !L.sys && !L.mine && this.shown(L) ? 1 : 0), 0);
    if (n !== this.unread || force) { this.unread = n; this.badge(); }
  }
  pieceRects() {
    const g = this.d.game, r = g && g.r, s = g && g.s, out = []; if (!r || !s || !r.disp || !r.toScreen || !r.c) return out;
    const c = r.c.getBoundingClientRect(), h = Math.max(14, r.z * 0.5);
    for (const id of new Set([r.myId, s.active])) {
      const d = id != null && r.disp.get(id), u = d && s.units.find((v) => v.id === id); if (!u || !u.alive) continue;
      const [sx, sy] = r.toScreen(d.x + 0.5, d.y + 0.5), m = 10; // margin: the camera and pieces glide between checks
      out.push({ x: c.left + sx - h - m, y: c.top + sy - h * 1.5 - m, w: 2 * h + 2 * m, h: 2.4 * h + 2 * m });
    }
    return out;
  }
  badge() {
    const btn = $('.emote-wrap .emote-btn'); if (!btn) return;
    let b = btn.querySelector('.qc-badge');
    if (!this.unread) { if (b) b.remove(); btn.setAttribute('aria-label', 'Quick chat'); return; }
    if (!b) { b = el('b', 'qc-badge'); b.setAttribute('aria-hidden', 'true'); btn.appendChild(b); }
    b.textContent = this.unread > 9 ? '9+' : String(this.unread);
    btn.setAttribute('aria-label', `Quick chat, ${this.unread} unread`);
    const lt = this.menu && this.menu.querySelector('[data-tab="log"]'); if (lt) lt.textContent = `Log (${b.textContent})`;
  }
  clearMatch() { this.clearHistory(); this.close(); }

  // ---- history sheet: the whole match (up to 300 lines), newest at the bottom, sticks to the bottom unless the
  // player scrolled up (then a "new messages" pill). Bottom sheet in portrait, a left panel beside the HUD in landscape.
  buildSheet() {
    const s = el('section', 'chat-sheet hidden'); s.id = 'chat-sheet'; s.setAttribute('role', 'dialog'); s.setAttribute('aria-label', 'Chat log');
    s.innerHTML = `<header class="cs-head"><b>Chat</b><small class="cs-n"></small><button class="cs-strip" data-cs="strip"></button><button class="cs-close" data-cs="close" aria-label="Close chat log">Close</button></header>
      <div class="cs-list" role="log" aria-live="off" tabindex="0"></div><button class="cs-new hidden" data-cs="bottom">New messages</button>
      <footer class="cs-foot"><button class="cs-say" data-cs="say">Quick Chat</button></footer>`;
    $('#s-game').appendChild(s); this.sheet = s; this.sheetList = s.querySelector('.cs-list'); this.newPill = s.querySelector('.cs-new');
    s.addEventListener('click', (e) => {
      const b = e.target.closest('[data-cs]'); if (!b) return; const a = b.dataset.cs, sfx = this.d.sfx;
      if (a === 'close') this.closeSheet();
      else if (a === 'bottom') this.toBottom(true);
      else if (a === 'strip') { this.d.settings.chatStripOff = !this.d.settings.chatStripOff; this.d.saveSettings(); this.syncSheetHead(); for (const t of document.querySelectorAll('[data-chatset="chatStripOff"]')) t.checked = !!this.d.settings.chatStripOff; }
      else if (a === 'say') { this.closeSheet(); this.open(); }
      sfx && sfx.tap && sfx.tap();
    });
    this.sheetList.addEventListener('scroll', () => { if (this.atBottom()) this.newPill.classList.add('hidden'); }, { passive: true });
    addEventListener('keydown', (e) => { if (e.key === 'Escape' && this.sheetOpen()) this.closeSheet(); });
  }
  sheetOpen() { return !!(this.sheet && !this.sheet.classList.contains('hidden')); }
  openSheet() { if (!this.sheet) return; this.close(); this.renderSheet(); this.sheet.classList.remove('hidden'); this.toBottom(); this.tickLog(true); try { this.sheet.querySelector('.cs-close').focus({ preventScroll: true }); } catch {} }
  closeSheet() { if (!this.sheet || !this.sheetOpen()) return; this.sheet.classList.add('hidden'); this.newPill.classList.add('hidden'); this.tickLog(true); }
  toggleSheet() { if (this.sheetOpen()) this.closeSheet(); else this.openSheet(); }
  atBottom() { const l = this.sheetList; return l.scrollHeight - l.scrollTop - l.clientHeight < 24; }
  toBottom(smooth) { const l = this.sheetList; if (!l) return; try { l.scrollTo({ top: l.scrollHeight, behavior: smooth && !this.d.settings.motion ? 'smooth' : 'auto' }); } catch { l.scrollTop = l.scrollHeight; } this.newPill.classList.add('hidden'); }
  syncSheetHead() {
    if (!this.sheet) return; const n = this.log.filter((L) => !L.sys && this.shown(L)).length;
    this.sheet.querySelector('.cs-n').textContent = n ? `${n} message${n === 1 ? '' : 's'}` : '';
    const b = this.sheet.querySelector('.cs-strip'), on = !this.stripOff(); b.textContent = on ? 'On board: On' : 'On board: Off'; b.setAttribute('aria-pressed', on ? 'true' : 'false'); b.classList.toggle('on', on);
  }
  sheetRow(L) {
    const r = el('div', 'cs-row' + (L.sys ? ' sys' : '') + (L.tm ? ' tm' : '') + (L.mine ? ' mine' : ''));
    let t = ''; try { t = new Date(L.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); } catch {}
    r.appendChild(el('time', '', t));
    if (L.sys) { r.appendChild(el('span', 'cs-t', L.text)); return r; }
    if (L.tm) r.appendChild(el('i', 'qc-tm', 'Team'));
    const n = el('b', '', L.name); n.style.color = L.color || ''; r.appendChild(n);
    r.appendChild(el('span', 'cs-t', L.text)); // plain text only, even for custom phrases
    return r;
  }
  renderSheet() {
    if (!this.sheet) return; const l = this.sheetList; l.textContent = '';
    const rows = this.log.filter((L) => this.shown(L));
    if (!rows.length) l.appendChild(el('p', 'qc-empty cs-empty', 'No messages yet. Tap Quick Chat to say something.'));
    for (const L of rows) l.appendChild(this.sheetRow(L));
    this.syncSheetHead();
  }
  appendSheet(L) {
    if (!this.sheetOpen()) return;
    const stick = this.atBottom(), l = this.sheetList;
    const e = l.querySelector('.cs-empty'); if (e) e.remove();
    l.appendChild(this.sheetRow(L));
    while (l.childElementCount > LOG_MAX) l.firstElementChild.remove();
    this.syncSheetHead();
    if (stick || L.mine) this.toBottom(); else if (!L.sys) this.newPill.classList.remove('hidden');
  }

  // ---- customisation screen
  buildModal() {
    const m = el('div', 'modal hidden global'); m.id = 'm-chat'; m.setAttribute('role', 'dialog'); m.setAttribute('aria-modal', 'true'); m.setAttribute('aria-label', 'Quick chat');
    m.innerHTML = `<div class="modal-box qc-box"><h3>Quick Chat</h3>
      <div class="set-sec">Favourites <small>Tap a slot, then a phrase</small></div><div class="qcm-favn" role="group" aria-label="Number of favourites"><span>Slots</span><button class="btn small" data-favn="-1" aria-label="Fewer favourites">-</button><b id="qcm-favn">8</b><button class="btn small" data-favn="1" aria-label="More favourites">+</button></div><div class="qcm-favs" id="qcm-favs"></div>
      <div class="qcm-tabs" id="qcm-tabs" role="tablist"></div><div class="qcm-lib" id="qcm-lib"></div>
      <div class="set-sec">My Phrases <small>Up to ${MAX_CUSTOM}, ${CUSTOM_LEN} characters each</small></div><div class="qcm-custom" id="qcm-custom"></div>
      <div class="set-sec">Safety</div>
      <label class="setting toggle"><span>Preset Chat Only<small>Hide phrases other players typed themselves</small></span><input type="checkbox" data-chatset="chatPresetOnly"><i></i></label>
      <label class="setting toggle"><span>Hide Chat From Others<small>No bubbles or log from other players</small></span><input type="checkbox" data-chatset="chatOff"><i></i></label>
      <p class="qcm-note">Custom phrases are cleaned and filtered before anyone sees them. Mute any player from the Players tab in a match.</p>
      <button class="btn wide" id="qcm-done">Done</button></div>`;
    document.body.appendChild(m); this.modal = m; this.slot = 0; this.libTab = 'greet';
    m.addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) { if (e.target === m) this.closeModal(); return; }
      if (b.id === 'qcm-done') return this.closeModal();
      if (b.dataset.favn) { const c = this.c, n = Math.max(FAV_MIN, Math.min(FAV_MAX, c.favN + +b.dataset.favn)); if (n !== c.favN) { c.favN = n; c.fav = c.fav.slice(0, n); while (c.fav.length < n) c.fav.push(null); c.setup = true; this.slot = Math.min(this.slot, n - 1); this.d.save(); this.d.sfx && this.d.sfx.tap(); } this.renderModal(); return; }
      if (b.dataset.slot != null) { this.slot = +b.dataset.slot; this.renderModal(); this.d.sfx && this.d.sfx.tap(); return; }
      if (b.dataset.clear != null) { this.c.fav[+b.dataset.clear] = null; this.d.save(); this.renderModal(); return; }
      if (b.dataset.lt) { this.libTab = b.dataset.lt; this.renderModal(); return; }
      if (b.dataset.pick) { const c = this.c; const i = c.fav.indexOf(b.dataset.pick); if (i >= 0 && i !== this.slot) c.fav[i] = c.fav[this.slot]; c.fav[this.slot] = b.dataset.pick; c.setup = true; this.slot = (this.slot + 1) % c.favN; this.d.save(); this.renderModal(); this.d.sfx && this.d.sfx.select && this.d.sfx.select(); }
    });
    m.addEventListener('change', (e) => {
      const inp = e.target.closest('[data-ci]'); if (!inp) return;
      const i = +inp.dataset.ci, c = this.c, v = sanitize(inp.value);
      while (c.custom.length <= i) c.custom.push('');
      c.custom[i] = v; inp.value = v;
      if (!v) c.fav = c.fav.map((r) => (r === 'c:' + i ? null : r));
      ensureChat(this.p); this.d.save();
      setTimeout(() => { const a = document.activeElement, f = a && a.dataset ? a.dataset.ci : null; this.renderModal(); if (f != null) { const n = m.querySelector(`[data-ci="${f}"]`); if (n) n.focus(); } }, 0);
    });
    m.addEventListener('input', (e) => { const inp = e.target.closest('[data-ci]'); if (!inp) return; const n = inp.parentElement.querySelector('.qcm-n'); if (n) n.textContent = `${Array.from(inp.value).length}/${CUSTOM_LEN}`; });
  }
  openModal() { this.renderModal(); this.modal.classList.remove('hidden'); this.d.sfx && this.d.sfx.tap(); }
  closeModal() { this.modal.classList.add('hidden'); this.d.sfx && this.d.sfx.tap(); if (this.menu && !this.menu.classList.contains('hidden')) this.render(); }
  renderModal(keepCustom) {
    const c = this.c, m = this.modal;
    const favs = $('#qcm-favs', m); favs.textContent = ''; $('#qcm-favn', m).textContent = c.favN;
    for (const b of m.querySelectorAll('[data-favn]')) b.disabled = +b.dataset.favn < 0 ? c.favN <= FAV_MIN : c.favN >= FAV_MAX;
    c.fav.forEach((r, i) => {
      const w = el('div', 'qcm-slot' + (i === this.slot ? ' on' : ''));
      const b = el('button', 'qcm-sb', this.owned(r) ? this.refText(r) : 'Empty'); b.dataset.slot = i; b.setAttribute('aria-label', `Favourite slot ${i + 1}: ${this.owned(r) ? this.refText(r) : 'empty'}`);
      w.appendChild(b);
      if (r) { const x = el('button', 'qcm-x', '\u00d7'); x.dataset.clear = i; x.setAttribute('aria-label', `Clear slot ${i + 1}`); w.appendChild(x); }
      favs.appendChild(w);
    });
    const tabs = $('#qcm-tabs', m); tabs.textContent = '';
    for (const [id, name] of ALL_CATS) { if (id === 'packs' && !this.listFor('packs').length) continue; const b = el('button', 'qc-tab' + (id === this.libTab ? ' on' : ''), name); b.dataset.lt = id; tabs.appendChild(b); }
    const lib = $('#qcm-lib', m); lib.textContent = '';
    const list = this.listFor(this.libTab);
    if (!list.length) lib.appendChild(el('p', 'qc-empty', this.libTab === 'mine' ? 'Write a phrase below first.' : 'Nothing here yet.'));
    for (const r of list) { const b = el('button', 'qc-p' + (c.fav.includes(r) ? ' fav' : ''), this.refText(r)); b.dataset.pick = r; lib.appendChild(b); }
    if (keepCustom) return;
    const cu = $('#qcm-custom', m); cu.textContent = '';
    for (let i = 0; i < MAX_CUSTOM; i++) {
      const w = el('label', 'qcm-ci'); const inp = el('input'); inp.type = 'text'; inp.maxLength = CUSTOM_LEN; inp.dataset.ci = i; inp.value = c.custom[i] || ''; inp.placeholder = `Phrase ${i + 1}`; inp.autocomplete = 'off'; inp.spellcheck = true; inp.setAttribute('aria-label', `Custom phrase ${i + 1}`);
      w.append(inp, el('span', 'qcm-n', `${Array.from(inp.value).length}/${CUSTOM_LEN}`)); cu.appendChild(w);
      const shown = mask(c.custom[i] || ''); if (shown && shown !== c.custom[i]) cu.appendChild(el('p', 'qcm-warn', `Others will see: ${shown}`));
    }
    for (const t of m.querySelectorAll('[data-chatset]')) t.checked = !!this.d.settings[t.dataset.chatset];
  }
  bindSettings() {
    const sync = () => { for (const t of document.querySelectorAll('[data-chatset]')) t.checked = !!this.d.settings[t.dataset.chatset]; };
    document.addEventListener('change', (e) => { const t = e.target.closest && e.target.closest('[data-chatset]'); if (!t) return; this.d.settings[t.dataset.chatset] = t.checked; this.d.saveSettings(); sync(); });
    document.addEventListener('click', (e) => { if (e.target.closest && e.target.closest('#btn-chat-custom')) this.openModal(); });
    sync();
  }
}
export const chat = new ChatUI();
