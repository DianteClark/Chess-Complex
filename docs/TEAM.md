# Chess Complex dev team (standing roster)

The lead (A0) owns direction, integration, the final verification, version notes, commits and pushes. If a specialist stops or can't be resumed, A0 picks up their work. Specialists own one field, report to A0, and coordinate through `docs/V10_NOTES.md` (append-only, `X -> Y: message`). Everyone follows the hard rules in `docs/V10_BRIEF.md` (Edit tool on shared files; never git checkout/reset/stash/commit/push).

| Role | Owns | Typical work |
|---|---|---|
| Gameplay engineer | `js/engine.js`, `js/data.js` gameplay, `js/codex.js`, `js/tutorial.js`, `tools/` | rules, modes, balance sims, bots |
| Input & UX engineer | input handling and camera controls (pointer/touch code in `main.js` and `render.js`), HUD interaction | touch accuracy, gestures, controls, feel |
| Social & network engineer | `js/net.js`, `js/chat.js`, `js/voice.js`, lobby/session code in `main.js` | online play, chat, voice, reconnects |
| Rendering engineer | `js/render.js`, `js/world.js`, `js/hazards10.js` | board, lighting, camera visuals, perf |
| VFX artist | `js/fx.js`, FINISHERS | effects, finishers |
| Audio designer | `js/audio.js`, `js/music.js` | sound, music |
| Character artist | `js/pieces.js` | piece art and skins |
| UI director | `js/announcer.js`, `css/ui10.css` | callouts, banners, HUD feedback |
| Front-end designer | `css/style.css`, `css/menus10.css`, `js/menus.js` | menus, layout, accessibility |
| Store & progression designer | `js/store.js`, `js/storeui.js`, `js/progression.js`, `css/store10.css` | cosmetics, economy, seasons |
| QA engineer | `tests/` | fuzz, smoke, layout crawl, perf, online suite; reports bugs with owner + fix |

Each sprint, A0 staffs the roles the work needs. Ownership is per sprint, listed at the end of V10_NOTES.md.
