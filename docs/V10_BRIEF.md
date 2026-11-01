# Chess Complex 10.0 — team brief (read fully before touching anything)

Goal: the next time the owner opens the game it should feel like a **sequel**: a flood of new content, dramatically better graphics, sound, music, juice and polish. Ten handlers (A1–A10) work **at the same time in the same folder**. Quality bar: a commercial mobile game. No emojis anywhere. Keep it readable on a 390x844 phone first, then landscape (844x390) and desktop.

Repo: `/home/claude/chess-complex` (vanilla JS ES modules, no build step, static site + PWA). Live site is GitHub Pages; the integrator (A0, the lead) commits and pushes. Read `README.md`, `CHANGELOG.md` (5.0 section) and skim the files you own before starting.

Test server: `http://localhost:8123/` (if down: `cd /home/claude/chess-complex && setsid nohup python3 -m http.server 8123 >/dev/null 2>&1 &`). Playwright + Chromium are preinstalled: run Node scripts with `NODE_PATH=$(npm root -g)`, `require('playwright')`, `chromium.launch()` needs no options. Use viewport 390x844 with `hasTouch: true, isMobile: true`. Engine sims run headless in Node (`import` js/engine.js). Online can be tested offline with `?net=local` (BroadcastChannel). The online suite: `tests/online/` (25 scenarios; server on 8141 from repo root; `node tests/online/scenarios.js --iters 1`).

## Hard rules (breaking these destroys other people's work)
1. **Never** run `git checkout`, `git reset`, `git stash`, `git clean`, `git commit`, `git push`, or anything that rewrites files you don't own. Read-only git (`git diff`, `git log`) is fine.
2. Files you **own** you may edit freely. For files you **share** (marked below), use **only the Edit tool with small, unique `old_string` anchors**, re-Read right before each Edit, and never rewrite the whole file (no `Write`, no python/sed/awk rewrite, no formatter). If an Edit fails because the file changed, re-read and retry.
3. Put new CSS in **your own CSS file** (already linked in index.html): A1 `css/ui10.css`, A8 `css/menus10.css`, A7 `css/store10.css`, everyone else `css/game10.css` (shared: Edit-tool appends only, each block starting with a `/* A# ... */` comment). `css/style.css` is A8's.
4. Prefer **new modules** for big new systems (e.g. `js/announcer.js`, `js/weather.js`) and wire them in with small Edits. If you add a JS file, also add it to the `CORE` list in `sw.js` (Edit tool).
5. Keep **performance** sane on phones: cache static drawing, cap particles, respect the existing low-quality mode (`lowQ`) and the reduced-motion setting (`settings.motion`). A5/A10 will measure frame times.
6. Keep everything **working**: solo, online host/join, tutorial, codex, store, save data (old profiles must load; add fields with defaults via `normalizeProfile` / `ensureProgress` / `ensureStore`). Run your own browser checks for console errors before you report.
7. Coordinate through **`docs/V10_NOTES.md`** (append-only, Edit tool; one line per note, prefix with your id and the target, e.g. `A9 -> A5: new event {e:'eclipse'} needs a visual`). Check it every so often (at least when you start each big chunk) and answer notes addressed to you.
8. Engine events and state are documented by reading `js/engine.js`. Don't change event shapes others rely on without leaving a note.

## Ownership
| Id | Area | Owns | Shares (Edit-tool only) |
|---|---|---|---|
| A1 | **Director: on-screen messaging + HUD juice.** Fix clutter: ultimate cine, announcer, banners, coach tips, feed, floats and toasts overlap today. One prioritised queue/layout system for everything that talks to the player. | `js/announcer.js` (new), `css/ui10.css` | `js/main.js` (banner/announce/onStreak/tip/feed/toast/handleEvents callout lines, HUD refresh), `js/render.js` (only `drawCine`, `drawScreenText`, the screen-banner code and float text layout) |
| A2 | **Music** | `js/music.js` | `js/main.js` (only `music.*` call sites) |
| A3 | **Sound effects** | `js/audio.js` | — |
| A4 | **Piece art** (the chess pieces, skins rendering, portraits, icons) | `js/pieces.js` | `js/data.js` (SKINS visual fields only if needed) |
| A5 | **World renderer**: board, tiles, lighting, shadows, weather, camera, unit drawing, HP bars, overlays | `js/render.js` (all except A1's parts) | `js/data.js` (BOARDS visual fields, new weather ids) |
| A6 | **VFX**: particles, ability effects, hits, deaths, finishers | `js/fx.js` | `js/data.js` (FINISHERS block: add new finishers you implement) |
| A7 | **Store, cosmetics and progression content** | `js/store.js`, `js/progression.js`, `css/store10.css` | `js/data.js` (SKINS, BOARDS, TRAILS, EMOTE_PACKS, RARITIES, BUNDLES, SEASON*, ACHIEVEMENTS), `js/main.js` (store / Crown Path / trophies / profile screens), `index.html` (those screens) |
| A8 | **Menus and front-end art**: splash, title, play, loadout, settings, results, transitions, typography | `css/style.css`, `css/menus10.css` | `index.html` (non-store screens), `js/main.js` (menu render functions, `bgInit`, splash) |
| A9 | **Gameplay content**: new modes, abilities, events, bosses, hazards, AI | `js/engine.js`, `js/codex.js`, `js/tutorial.js`, `tools/` | `js/data.js` (PIECES, ABILITIES, PASSIVES, MODES, WORLD_EVENTS, QUESTS, MUTATORS), `js/net.js`, small Edits to `render.js`/`fx.js` only to hook visuals for brand-new events if A5/A6 haven't (leave a note first) |
| A10 | **QA, scrub, performance, accessibility** | `tests/` | report-only elsewhere until the final phase (post findings in V10_NOTES.md to the owner) |

Version label, What's New, CHANGELOG, README and the final commit are A0's (the lead). Tell A0 what to write in your final report.
