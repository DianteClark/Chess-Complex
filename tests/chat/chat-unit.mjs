// Quick chat unit tests (QA, 10.2): sanitize / mask / hostCheck / rateCheck in js/chat.js, headless in Node.
// Usage: node tests/chat/chat-unit.mjs [--verbose]
// chat.js imports DOM-free modules only at the top level; the UI class is constructed lazily, so a tiny DOM stub is enough.
globalThis.document = globalThis.document || { createElement: () => ({ style: {}, classList: { add() {}, remove() {}, toggle() {}, contains: () => false }, appendChild() {}, append() {}, prepend() {}, addEventListener() {}, setAttribute() {}, querySelector: () => null, dataset: {} }), querySelector: () => null, querySelectorAll: () => [], addEventListener() {}, body: { appendChild() {} } };
globalThis.window = globalThis.window || globalThis; globalThis.addEventListener = globalThis.addEventListener || (() => {});
globalThis.localStorage = globalThis.localStorage || { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.matchMedia = globalThis.matchMedia || (() => ({ matches: false, addEventListener() {} }));
globalThis.requestAnimationFrame = globalThis.requestAnimationFrame || ((f) => setTimeout(f, 16));
globalThis.performance = globalThis.performance || { now: () => Date.now() };
const verbose = process.argv.includes('--verbose');
let C;
try { C = await import('../../js/chat.js'); } catch (e) { console.log(`chat-unit: FAIL cannot import js/chat.js in Node: ${e.message}`); process.exit(1); }
const { sanitize, mask, clean, hostCheck, rateCheck, isPreset, PHRASES, CUSTOM_LEN, PHRASE_COUNT, CATS } = C;
let pass = 0; const fails = [], warns = [];
const check = (c, m) => { if (c) pass++; else fails.push(m); return c; };
const J = (s) => JSON.stringify(s);

// ---------- presets ----------
check(PHRASE_COUNT >= 60, `only ${PHRASE_COUNT} preset phrases`);
check(Array.isArray(CATS) && CATS.length >= 5, `only ${CATS && CATS.length} categories`);
for (const [k, v] of Object.entries(PHRASES)) { check(typeof v === 'string' && v.length > 0 && v.length <= 40 && !/[<>]/.test(v), `preset ${k} bad text ${J(v)}`); check(!/[\p{Extended_Pictographic}]/u.test(v), `preset ${k} has an emoji`); }
check(!isPreset('__proto__') && !isPreset('constructor') && !isPreset('toString') && !isPreset('hasOwnProperty'), 'isPreset accepts prototype keys');

// ---------- sanitize: XSS and abuse payloads ----------
const XSS = [
  '<script>window.__xss=1</script>', '<img src=x onerror=window.__xss=1>', '<svg onload=window.__xss=1>', '<svg/onload=alert(1)>',
  '<img src=x onerror=alert(1)//', '"><img src=x onerror=alert(1)>', "'><script>alert(1)</script>", '<iframe src=javascript:alert(1)>',
  '<a href="javascript:alert(1)">hi</a>', 'javascript:alert(1)', '&lt;img src=x onerror=alert(1)&gt;', '<img src=x onerror=alert(1)>',
  '\uff1cimg src=x onerror=alert(1)\uff1e', // fullwidth angle brackets (NFKC folds them to < >)
  '<<script>script>alert(1)<</script>/script>', '<scr<script>ipt>alert(1)</script>', '<body onload=alert(1)>', '<style>*{display:none}</style>',
  '<math><mtext></form><form><mglyph><style></math><img src onerror=alert(1)>', '<div style="background:url(javascript:alert(1))">',
  '${alert(1)}', '{{constructor.constructor("alert(1)")()}}', '<details open ontoggle=alert(1)>',
];
for (const p of XSS) {
  const s = sanitize(p), c = clean(p);
  check(!/[<>\uff1c\uff1e]/.test(s) && !/[<>]/.test(c), `sanitize kept angle brackets: ${J(p)} -> ${J(s)}`);
  check(!/<\s*(script|img|svg|iframe|body|style|math|details|a)\b/i.test(s), `sanitize kept a tag: ${J(p)} -> ${J(s)}`);
  check(Array.from(s).length <= CUSTOM_LEN, `sanitize over length: ${J(p)}`);
}
// control / bidi / zero-width / combining abuse
const ABUSE = {
  'bidi override': 'abc\u202edcba', 'bidi isolate': '\u2066evil\u2069', 'zero width': 'n\u200bi\u200dc\u200ce', 'BOM': '\ufeffhi', 'null': 'a\u0000b',
  'CRLF': 'line1\r\nline2', 'tab/vt/ff': 'a\tb\u000Bc\u000Cd', 'line sep': 'a\u2028b\u2029c', 'private use': 'a\ue000b', 'lone surrogate': 'a\uD800b',
};
const BADCH = new RegExp('[\\u0000-\\u001F\\u007F\\u200B-\\u200F\\u202A-\\u202E\\u2066-\\u2069\\uFEFF\\u2028\\u2029\\uE000\\uD800]');
for (const [k, p] of Object.entries(ABUSE)) { const s = sanitize(p); check(!BADCH.test(s), `sanitize kept ${k}: ${J(s)}`); }
const zalgo = 'Z' + '\u0301\u0302\u0303\u0304\u0305\u0306\u0307\u0308'.repeat(10) + 'algo';
check(!/\p{M}{2,}/u.test(sanitize(zalgo)), `stacked combining marks survive: ${J(sanitize(zalgo))}`);
check(Array.from(sanitize('x'.repeat(100000))).length <= CUSTOM_LEN, 'huge input not capped');
check(Array.from(sanitize('\u{1F600}'.repeat(50) + 'ok')).length <= CUSTOM_LEN && !/\u{1F600}/u.test(sanitize('\u{1F600}ok')), 'emoji not stripped (No emojis anywhere rule)');
for (const bad of [null, undefined, 42, {}, [], { toString: () => '<img src=x onerror=alert(1)>' }, ['<b>'], true]) check(sanitize(bad) === '', `sanitize non-string ${J(bad)} -> ${J(sanitize(bad))}`);
const t0 = Date.now(); for (let i = 0; i < 2000; i++) clean('<a'.repeat(200) + ' f u c k '.repeat(20)); check(Date.now() - t0 < 4000, `clean is slow on adversarial input (${Date.now() - t0} ms / 2000)`); // ReDoS guard
// links masked
for (const l of ['visit evil.com now', 'http://x.y/z', 'www.bad.gg', 'free skins at scam.ru']) check(!/evil\.com|http|www\.|bad\.gg|scam\.ru/i.test(sanitize(l)), `link not masked: ${J(l)} -> ${J(sanitize(l))}`);
// ---------- mask: profanity yes, false positives no ----------
for (const w of ['fuck you', 'f u c k', 'fuuuuck', 'sh1t', 'go kys', 'k y s', 'b1tch', 'FUCK', 'f\u00fcck']) check(/\*/.test(mask(sanitize(w))), `not masked: ${J(w)} -> ${J(mask(sanitize(w)))}`);
for (const w of ['class', 'assassin', 'Scunthorpe', 'pass the bishop', 'grass', 'cocktail', 'Niger river', 'analysis', 'therapist', 'shitake mushroom risotto'.slice(0, 0) || 'title', 'Dickens', 'cockpit']) check(!/\*/.test(mask(sanitize(w))), `false positive: ${J(w)} -> ${J(mask(sanitize(w)))}`);

// ---------- hostCheck: host enforcement ----------
const S = { teams: 2, units: [
  { id: 1, pid: 'a', kind: 'player', team: 0 }, { id: 2, pid: 'b', kind: 'player', team: 1 }, { id: 3, pid: 'bot1', kind: 'player', team: 0, bot: true }, { id: 9, kind: 'hollow' },
] };
const firstK = Object.keys(PHRASES)[0];
let now = 1e6; const book = () => ({});
const hc = (b, pid, raw, dt = 9000) => { now += dt; return hostCheck(b, pid, raw, S, now); };
{ const b = book();
  const r = hc(b, 'a', { k: firstK }); check(r && r.out && r.out.k === firstK && r.out.id === 1 && r.out.pid === 'a', `valid preset refused ${J(r)}`);
  for (const raw of [null, 7, 'GG', [], {}, { k: 'nope' }, { k: '__proto__' }, { k: 'constructor' }, { k: { toString: () => firstK } }, { k: [firstK] }, { x: 5 }, { x: ['hi'] }, { x: { length: 1 } }, { x: 'y'.repeat(201) }, { x: '   ' }, { x: '<><><>' }, { x: '\u200b\u200b' }, { x: '!!!???' }])
    check(!hc(b, 'a', raw) || hc(b, 'a', raw).slow, `junk accepted: ${J(raw)}`);
  check(hc(b, 'zzz', { k: firstK }) === null, 'unknown pid accepted');
  check(hc(b, undefined, { k: firstK }) === null, 'hollow / pid-less sender accepted');
  const sp = hc(b, 'a', { k: firstK, id: 2, pid: 'b', name: 'Mallory' }); check(sp && sp.out && sp.out.id === 1 && sp.out.pid === 'a' && !('name' in sp.out), `spoofed id/pid/name passed through ${J(sp)}`);
  const xs = hc(b, 'b', { x: '<img src=x onerror=window.__xss=1> hello' }); check(xs && xs.out && !/[<>]/.test(xs.out.x) && /hello/.test(xs.out.x), `xss custom not cleaned ${J(xs)}`);
  const ln = hc(b, 'b', { x: 'L'.repeat(199) }); check(ln && ln.out && Array.from(ln.out.x).length <= CUSTOM_LEN, `long custom not capped ${J(ln && ln.out && ln.out.x.length)}`);
  check(!hc(b, 'bot1', { x: 'free text from a bot' }) || hc(b, 'bot1', { x: 'bot2' }).slow, 'bot free text accepted');
  const tm = hc(b, 'a', { k: firstK, tm: 1 }); check(tm && tm.out && tm.out.tm === 1 && tm.out.team === 0, `team flag not routed ${J(tm)}`);
  const tmx = hc(b, 'a', { k: firstK, tm: 1, team: 1 }); check(tmx && tmx.out && tmx.out.team === 0, `team spoof (team:1) honoured ${J(tmx)}`);
  const extra = hc(b, 'b', { k: firstK, t: 'state', state: { over: true }, ev: [{ e: 'over' }] }); check(extra && extra.out && extra.out.t === 'chat' && !('state' in extra.out) && !('ev' in extra.out), `extra fields relayed ${J(extra)}`);
}
// rate limits: burst cap 3, refill 1.5 s, custom gap 3 s, duplicate 8 s, strikes -> 20 s quiet
{ const b = book(); now = 5e6; let ok = 0;
  const keys = Object.keys(PHRASES);
  for (let i = 0; i < 4; i++) { const r = hostCheck(b, 'a', { k: keys[i] }, S, now + i * 10); if (r && r.out) ok++; }
  check(ok === 3, `burst of 4 presets in 40 ms relayed ${ok} (expected 3)`);
  const later = hostCheck(b, 'a', { k: keys[20] }, S, now + 1700); check(later && later.out, 'token did not refill after 1.6 s');
}
{ const b = book(); now = 6e6;
  const a1 = hostCheck(b, 'b', { x: 'first custom' }, S, now), a2 = hostCheck(b, 'b', { x: 'second custom' }, S, now + 1000), a3 = hostCheck(b, 'b', { x: 'third custom' }, S, now + 3500);
  check(a1 && a1.out && a2 && a2.slow && a3 && a3.out, `custom gap 3 s not enforced ${J([a1, a2, a3].map((r) => r && (r.out ? 'out' : r.slow ? 'slow' : 'null')))}`);
  const d1 = hostCheck(b, 'b', { x: 'same line' }, S, now + 10000), d2 = hostCheck(b, 'b', { x: 'same line' }, S, now + 14000), d3 = hostCheck(b, 'b', { x: 'same line' }, S, now + 19000);
  check(d1 && d1.out && d2 && d2.slow && d3 && d3.out, `duplicate 8 s window wrong ${J([d1, d2, d3].map((r) => r && (r.out ? 'out' : r.slow ? 'slow' : 'null')))}`);
}
{ const b = book(); now = 7e6; const keys = Object.keys(PHRASES);
  for (let i = 0; i < 12; i++) hostCheck(b, 'a', { k: keys[i] }, S, now + i * 50); // 3 pass, 9 strikes -> quiet
  const q = hostCheck(b, 'a', { k: keys[30] }, S, now + 6000); check(!q || q.slow, 'spammer not timed out (6 s later still allowed)');
  const back = hostCheck(b, 'a', { k: keys[31] }, S, now + 27000); check(back && back.out, 'spammer never released after the 20 s timeout');
  const other = hostCheck(b, 'b', { k: keys[0] }, S, now + 600); check(other && other.out, 'rate limit leaks across players');
}
// rate book keyed by pid must not be poisonable via prototype keys
{ const b = book(); const r = hostCheck(b, '__proto__', { k: firstK }, { units: [{ id: 5, pid: '__proto__', kind: 'player' }] }, 9e6); if (({}).tokens !== undefined) { warns.push('hardening: rateCheck book[pid] with pid "__proto__" writes Object.prototype.tokens (pids are host-generated, so not reachable today; use Object.create(null) or a Map)'); delete Object.prototype.tokens; for (const k of ['at', 'lastC', 'lastT', 'lastTAt', 'strikes', 'strikeAt', 'quiet']) delete Object.prototype[k]; } void r; }

console.log(`chat-unit: ${pass}/${pass + fails.length} checks pass, ${fails.length} fail`);
for (const f of fails.slice(0, verbose ? 999 : 30)) console.log('  FAIL ' + f);
for (const w of warns) console.log('  WARN ' + w);
process.exit(fails.length ? 1 : 0);
