# Changelog

## 18.1: Warden Rating
- Co-op (Siege, Gauntlet) gets its own rating: run score from waves held, win, mode (Gauntlet x1.2), party size and contribution (±15%); rating = mean of the best third of the last 30 runs; provisional below 5 runs.
- Tiers Squire, Sentinel (450), Guardian (650), Bulwark (800), Paladin (920), Warden (1050); Co-op leaderboard; weekly co-op season top 50 titles and banners.
- Online cloud runs count automatically; solo runs only when server-replay-verified.
- Fix: co-op lobby Ally tag no longer overlaps names (now a badge on the card border).
- Engine unchanged (PROTO stays 3).

## 18.0 "Rivals" (November 2026)
- **Nemesis** (NE): deterministic per-match nemesis map from createMatch inputs (solo bots by name, phone-hosted via join, cloud from verified seats); Vendetta (+1 shard, +40 Marks), streaks, Thorn bonus; lobby card, HUD crown of thorns, callouts, results, profile Rivals panel. PROTO 3.
- **Ranks** (NE): Pawn-King tiers from Crown Rating (1100/1250/1400/1550/1750), badges on online names; weekly top-50 season titles + banners delivered through a Player DO inbox.
- **Friends** (SO): player tags (hash of cloud id), mutual friends, Recent Players, push-on-change presence (one request per refresh), party invites with live push and 10 min expiry, block, Appear Offline, abuse caps.
- **Watch live** (LV): read-only spectator sockets (8/room, 3/IP) on the lockstep stream, Watch from Browse and Friends, ?watch=CODE; Matchmaker listings refresh on activity; /turn needs a room token; daily pruning of moderation/rate rows.
- **Smarter bots** (BT): Overkill/Guard/Speed Edge/Second Wind/turn-order/Sidestep/cogs/Sudden Death/Interest-aware planning, Easy/Normal/Hard (Hard 58% vs Normal, Normal 69% vs Easy), Hollow focus fire; ice-slide stacking fix. Balance: King 37.8-38.3%, roads 11.4-14.4%, presets 22.6-27.8%.
- Tests: q18 engine (34), rivals18, social (+e2e 26), lv (+e2e 15), mm e2e 37; online cloud subset and smoke green.

## 17.3 (November 2026) - scrub
- **Server (QS)**: gzip-bomb-safe replay uploads (streamed, capped at 200 KB), per-player flood limit on lobby-changing messages, alarm/handler error guards so a throw can never freeze a match (failing bot step ends its turn, 3 retries), bounded Daily verify retries, worker origin in CORS, 500s no longer echo internals.
- **Client (QC)**: duplicate range-slider listeners, unused intro method with listener leak, unhandled Daily promise, unguarded rating read, Reduce Motion selector in lb17.css; ~120 lines of dead exports/imports/locals/CSS removed; sw.js CORE verified.
- New-player title card 44 px tall; README updated for the Cloudflare home.

## 17.2 (November 2026)
- **Combat info hierarchy** (announcer.js, ui10.css, small render/main edits): one action line per turn that replaces the previous one (feed rows gone), merged per-target damage numbers with small tags, center callouts only for the viewer's moments and headline events, minor callouts skipped when a newer turn starts, callouts on the board's playback clock, tips only when the board is quiet, tap-open Match Log by round. Busiest moment clutter 14 -> 7-8 elements; overlap test 0.
- **Quick Play Back to Party**: app switch no longer ends the cloud session (pagehide), dropped leader keeps leadership 8 s, Rejoin Party when the link is lost, online results never start a solo match, post-QP party is private and unlisted. mm.e2e 37/37.
- Action line is a 40 px tap target and hides behind results; online tests wait up to 25 s for results (they follow the board's playback).

## 17.1 (November 2026)
- **Quick Play + Browse** (server/src/match.js Matchmaker DO, mmcore.js, js/matchmaking.js): public online matches without a code; fullest open lobby for the mode (region preferred) or a new one; 45 s countdown with 2+ humans, bots fill, 3 s when full; Public/Private switch for hosts; per-IP limits; stale cleanup. Tests 9 + 21 e2e.
- **Taps**: the tile above your piece is no longer swallowed by the piece's sprite (128/128 in tests/tap/above.cjs, was 25/96 failing).
- **Camera**: held-back moves no longer replay stale positions; a pan on your turn ends at the next player's turn; Follow-every-turn resumes after 6 s; stuck touches release after 8 s.
- **Voice**: Open Mic mic button mutes/unmutes (no silent switch to PTT); mode switch both ways in lobby and match; speaking glow survives Back to Party (CSS specificity); voice rejoins after a dropped link; talk-off always relayed (client and Room).
- **Ops**: Workers Logs head sampling 2% (one online match was ~3,300 log events at 100%).
- Second Wind verified once per match across promotions (test added).

## 17.0 "Cloud" (November 2026)
- **Cloudflare server** (server/, one Worker serving the game as static assets plus the API): Room Durable Objects run online matches authoritatively in lockstep (clients replay ~100-byte actions with the same engine, 32-bit state hash every 8 actions, snapshot on mismatch); WebSocket Hibernation + alarms; seats held 60 s for reconnects, leader handoff, chat filter and voice-signaling relay. Phone-hosted PeerJS play remains the automatic fallback.
- **Cloud save + transfer codes** (Player DO): automatic, no sign-up; 26-char code with check character + offline QR; merge rules that never duplicate Marks; GitHub Pages -> Cloudflare move card that carries progress over (#transfer=).
- **Leaderboards** (Board DO): Crown Rating (multiplayer Elo, verified players only), weekly Seasons (Monday cron), Daily Challenge verified server-side by replaying the run in chunks; first run of the day counts, quitting is a DNF.
- **Replays** (Replay DO): share links, viewer with play/pause, 1x/2x/4x, jump to round, Play of the Match for online games; 30-day expiry.
- **Platform**: Cloudflare TURN for voice (when the key is set), Workers AI moderation of custom chat phrases (cached, budgeted, word-filter fallback), Turnstile on player creation (when set), rate limits, Analytics Engine events, room location hints, /admin real-match balance dashboard (ADMIN_KEY).
- **Gameplay**: Bishops can Sidestep (1 orthogonal step, uses the action); Sudden Death is labelled and explained (it was reading as storm damage on a safe tile); co-op retune (Gauntlet scaling 0.42 / 0.87); presets Bruiser 4/3/1/2, Assassin 3/4/0/3; King floor 0.9, HP 1.09. Roads 11.9-13.2%, King ~39%.
- **Readability**: damage/heal/status numbers 2.1 s and fanned out, camera holds per hit, callouts and ultimate cut-ins longer, location briefing waits for a tap; location random outside Custom on a fitted card; spoken announcer removed; Witchwood poison pools aligned to tiles; canvas guard for negative radii.
- **Fixes**: party member reconnecting at match start keeps their seat (no intro restart), duplicate Start refused, leave buttons after a reconnect; bot planner memoized (server p99 ~6 ms per step).
- **Tests**: server/test suites (rooms 26, platform 19 + 10 e2e, replays 7, leaderboards 26 + 28 e2e, stats 8, player 33, merge 15, cloud save 42 e2e), tests/q17, online suite in cloud and phone-hosted modes, smoke 29/29.

## 16.0 "Tactics" (November 2026)
- **Stat edges:** every stat now has a named secondary rule. SPD: Speed Edge (15.2). ATK: **Overkill**, damage past a kill spills 50% into the attacker's nearest enemy adjacent to the victim (players only, one hop). DEF: **Guard**, a single hit takes at most (60 - DEF)% of max HP, floor 35% (players and the King; not ticks, storm or Hollows). HP: **Second Wind**, once per match a hit that leaves you under 25% heals 10% max HP + 1 per HP point (not the crowned King). Damage previews and bot estimates respect Guard.
- **Hold:** `{type:'hold'}` on your turn before moving, acting or using an ability, once per round, not while frozen or stunned: you act after everyone still waiting; next round starts 3 SPD later. Held turns don't re-tick statuses or cooldowns. Bots hold ~2% of turns.
- **Shard Interest:** +1 shard per 5 held at the start of each round (max +2; not the King).
- **Tempo equips:** Seize (Knight, 1000 Marks), Hourglass (Bishop, 1200), Anchor (Rook, 1000), Time Fracture (Queen, 1500).
- **Clockwork Spire** (9th location): clock-tower backdrop, spire music theme, sparks weather, **Cogwheels** hazard (2x2 gears carry pieces one step clockwise at round end) and the **Reversal** signature event (slowest first for one round, telegraphed a round early).
- **UI:** Hold button (H key), turn strip round dividers, held badges and REVERSED tag; Overkill / Guarded / Second Wind / Hold / Reversal callouts through the director lanes; interest shown on the shard counter; stat edges on the loadout, inspect panel, Codex and How to Play.
- **FX/audio** for every new event (overkill arc, guard plate, second wind updraft, hourglass, rewind sweep, gear grind), reduced-motion and low-quality variants.
- **Balance** (800 8-bot Royales): roads Pawn 14.5%, Rook 13.3%, Ascend 11.5%, Queen 11.5%; King 38.3%; presets 22-27%. KING_T.hp 1.06; Champion cost 7, HP 98; Assassin 2/4/0/4; Bruiser 4/4/2/0; Siege c0 1.5, boss 0.84.
- **Tools:** sim runner no longer skips back-to-back turns (affected Siege/Gauntlet baselines); new tests/q16/engine16.mjs; Hold and Reversal in tests/turns/order.mjs.

## 15.2 (November 2026)
- **Turns (Engine):** the speed-gauge system let fast pieces act twice before slow ones acted once, and every match started with a random 0-40% gauge, so a slow piece could move first. Turns are now round-based: every living unit acts exactly once per round, highest SPD first, ties broken by a seeded coin flip each round. Stagger, brambles, Haste pickups, Rally and revives still nudge order (up to 6 SPD's worth) until the unit acts. New test tests/turns/order.mjs: 0 double turns and 0 order inversions over 14k turns in every mode.
- **Speed Edge:** with one turn per round, SPD lost most of its value (0-SPD Bruiser won 32% vs ~22% for the rest). SPD now also gives +3% damage per point over the target and -3% per point under (cap 15%). Presets now win 24-27% each.
- **Promotion balance:** Queen SPD 10 to 12, Rook HP 140 to 134, King HP 0.88x to 0.92x. 400 8-bot Royales: bot roads Pawn line 13.0%, Ascend 12.1%, Rook 14.6%, Queen 11.4% (fair 12.5%); King 38.3%. Siege ATK growth 0.3 to 0.24 and bosses 0.8x to 0.74x to keep co-op win rates at 15.1 levels.
- **Party freeze (Net):** a member waiting in the party lobby whose phone reconnected (screen lock) received the host's "resume match" for the finished match and got stuck on the old board, blocking the next match. The host no longer sends it to lobby members, members ignore it in the lobby, and a final board that arrives without its "over" event opens results. New online scenarios P5a-P5d.
- **Voice:** remote voices play through the audio element again (Web Audio routing was silent on iPhone); the volume slider fill matches its value (all range inputs). Note: iPhone ignores per-element volume, so there the slider effectively mutes/unmutes.
- **Screen stays awake** in matches and lobbies (Wake Lock API, muted-video fallback on iPhone).
- **Match intro:** one sequence (contenders, wheel, one location card) instead of three rushed pop-ups; tap to advance, Skip for returning players; the host holds the first turn until it ends.
- **Promote menu:** the pawn line (Veteran, Champion) is its own section; fixed its cards overflowing the frame.
- **Spectating:** the board no longer collapses to a strip when the action bar hides; zoom works. **Playback** runs at real speed (max 1.4x only when far behind), and bots wait for the host's playback.

## 15.1 (November 2026)
- **Performance (Rendering):** on a CPU canvas a scaled drawImage costs 5-10x a 1:1 copy, and 15.0 scaled the backdrop layers, fog, glows and walls every frame, filled full-board gradients for tint and edge glow, rescaled the floor when the camera rested slightly off its bake zoom, rebaked the whole floor when a crate broke, and kept drawing the board under the opaque location wheel (which pushed auto quality down for the whole match). Now: cached screen-size layers copied 1:1 while the camera holds, solid-band tint, size-exact sprite caches, one resample when zoom settles, dirty-tile floor repaints, the board bakes during the wheel, piece warm-up only in idle time. Quiet machine, 390x844 DPR 2, 8-bot Royale: 16.9-17.0 ms average and 16.8 ms p95 (10.3: 16.8-16.9 / 16.8; 15.0: 17.6-19.3 / 33).
- **Balance:** pawn road win share 18.6% to 13.9% (Veteran 92 HP / 14 ATK; Champion 6 shards, 104 HP / 17 ATK / 10 DEF); all four bot roads now 10.7-13.9% (fair 12.5%). King retuned to 40.0% over 400 8-bot Royales (HP 0.88x plus 3% per rival).
- **Accessibility:** Royal Pass labels, ability status tags, World Tour badges, quick-chat counters and the Wishlist button meet the 11px / 40px floors; smoke a11y: 0 text under 11px.
- Verified: engine15 292/292, fuzz clean, smoke 29/29 (portrait and landscape), online party, Siege rejoin, spectate and chat pass.

## 15.0 (November 2026): World Tour
Built by a 13-specialist team (combat, world, social, audio, rendering, two environment artists incl. a new hire, character art, VFX, front end, UI director, store, QA) against `docs/DESIGN_15.md`.

**Combat (C):** status effects (burn, poison, freeze, stun, slow, shield, haste, plus Exposed and Enrage) with interactions and cleanses; 7 new passives and 10 new equips with Marks unlock prices (start kit: 5 passives, 2 equips per piece); Queen costs 11 from a Pawn; hone costs reworked; Ascension at hone 3 for Knight, Bishop, Rook and Queen; pawn-only Veteran and Champion promotions; the boss King (crown telegraph one round ahead, aura, 66%/33% phase shockwaves, Exposed from multiple attackers, HP pool scaled by rivals). Sims: King wins about 40% of 8-bot Royales; presets 23.7-27.0%; final placement by piece: Ascended Knight 1.34, Archbishop 1.88, Queen 1.90, Champion 2.64, Rook 3.22.
**World (W):** `js/locations.js` with 8 locations driving hazards, events, weather and music; 8 new location events (5 telegraphed), bog poison pools; modes grouped (competitive, co-op, party, challenge, custom); Mirror folded into Daily (same build for everyone, location of the day); Custom lobby rules validated on the host.
**Online (N):** parties that survive matches (Back to Party, leader picks mode/location/rules, ready checks, leader-leave closes cleanly); fixed the join lobby not clearing (the host now always says goodbye); fixed the late-Siege disconnect (PeerJS rejects messages over about 16 KB and 4-player Siege states reach that by wave 5: messages are now chunked, with heartbeats and automatic token rejoin while a bot holds the seat); per-tab rejoin tokens; quick chat favourites; pinned Opus parameters.
**Audio (AU):** mic crackle fix (the game's AudioContext is rebuilt at the hardware rate with a larger buffer and no reverbs while the mic is live; one shared context for meters and remote voices; `?audiodebug` overlay); location soundtracks; sounds for everything new.
**Rendering (R):** 8x8 default zoom with an 8x8 / Board toggle; name tags just above pieces with collision avoidance; status visuals on units; boss King presentation and crown marker; location weather and backdrop hook; menu slowdown fixed (a stuck piece-icon queue forcing hundreds of layout reads, plus match canvases and backdrop layers now released when leaving the game screen).
**Art:** location backdrops with parallax for all 8 locations and the World Tour wheel (E1, E2); Veteran, Champion, Ascended and boss-King piece art (CA); VFX for statuses, new abilities, Ascension, boss phases, Regicide, location events, and 4 location finishers (V).
**UI and front end (D, F):** boss bar, status icons and turn-state on the HUD, location cards and callouts; title shows level/title/XP; profile editor from the top-left chip; Play screen by group; Custom card with 3 build slots and ability unlocks in Loadout; the World Tour wheel in the match intro; party lobby styling; How to Play rewritten.
**Lead fixes at integration:** King retuned to 43.5% wins over 400 bot Royales (HP 0.93x plus 3.5% per rival, 1.25% regen); sudden death now escalates (+2% per round) after QA's harness found a match where two healing Bishops in the final tiles could never finish; offline cache lists every shipped file; Royal Pass finisher ids connected; wheel preview canvases released after the intro; new piece models pre-warmed; HUD status names match the rules.
**Store (S):** Season 4: World Tour with a 3,000-Mark Royal Pass premium lane, Abilities tab for unlocks, profile banners and showcase, 8 location collections, 14 trophies and 4 quests. Typical Royale pays about 67 Marks; regular play earns about 2,400 Marks a week.

## 10.3 (November 2026)
- **Turn camera (Rendering):** new `js/camdir.js`. Each turn is a beat: eased glide to the actor, framing of the actor and everything its action touches, hold until the turn's events finish, then the next actor. Turns queue instead of interleaving; backlogs speed playback up (to 2.8x) instead of snapping. One ultimate card at a time; banners wait for their visuals. Manual pan/pinch is respected until your next turn. Settings > Camera: Every turn / My turns / Free. Back-to-back ultimates: turns framed 65% to 82%, max pan speed 1601 to 884 px/s, max zoom rate 8.9 to 2.3/s. Turn timers get a 2 s host-side grace for the playback delay.
- **Microphone flow (Social):** pre-permission card on first Join Voice whose Allow button calls getUserMedia inside the tap after switching the iOS audio session; remembered per device; blocked-state steps for iOS Home Screen, Safari, Android and desktop; permission state line; Settings Microphone row with Allow, Test (live meter) and Hide Chat Strip.
- **Chat log (Social):** 3-line strip that dodges Director callouts and important pieces, full scrollable history (300 lines) with timestamps, team tags, voice join/leave lines, a new-messages pill and unread counts; works in landscape and while spectating.
- Verified: mic 8/8, chat log 6/7 (one 250 ms landscape timing sample), fuzz clean, smoke 30/30 (landscape path re-run alone), online 35/35.

## 10.2.2 (November 2026)
- **Voice chat on iPhone (owner report: app and Safari both said "no mic" even with the microphone allowed):** `audio.js` set `navigator.audioSession.type = 'playback'` (Safari 16.4+) so game sound plays through the silent switch. That session type refuses microphone capture. `getMic()` now switches to `'play-and-record'` before asking, restores `'playback'` on failure or when leaving voice, and resumes game audio after the switch; `audio.js` no longer overrides the session while voice holds the mic. Verified against a simulated Safari audio session (old code: NotReadableError, "No microphone found"; new: mic live).

## 10.2.1 (November 2026)
- **Voice chat microphone (owner report: "Join Voice says no mic"):** every microphone failure used to show "No microphone found". Now `getMic()` asks with voice-tuned settings, then falls back to a plain audio request (some phones reject the processing hints or report the mic busy), keeps the more telling error, and checks for a secure page. Errors are explained per platform: blocked permission (iPhone Safari aA > Website Settings, home-screen app via Settings > Safari > Microphone, Android site and app permissions, desktop), mic busy in another app, in-app browsers that cannot use the mic, or no mic at all. A new Turn On Mic button asks again from a tap and swaps the live mic into open calls without reconnecting.

## 10.2 (November 2026)
First sprint of the standing team (docs/TEAM.md), from the owner's online match with a friend.
- **Tap accuracy (Input & UX):** seven causes fixed: a 600 ms touch cut-off dropped taps on busy frames; the lift point (not touch-down) picked the tile; the camera moved under the finger; landscape resize read the board mid-transition (taps up to 15 px off); piece sprites taller than their tile; hint/inspect cards swallowed taps; stale pointers turned taps into pinches. New `js/input.js`: touch-down resolution with a frozen camera, target assist, DPR-scaled pan threshold, preview-then-confirm with a loupe when tiles are under 30 px. Zoomed out on phones: 22-27% to 97-100% correct, 0 wrong actions; online client 70% to 100%.
- **Storm movement (Gameplay):** collapsed rings kept their walls, crates and pits as invisible solid tiles, boxing pieces in the void. Collapse now turns void tiles into floor; void moves render red; bots climb out. Match lengths unchanged.
- **Quick chat (Social & Network):** `js/chat.js` with 87 phrases, favourites, recent, 12 custom phrases (40 characters), team-only lines, chat bubbles and log routed through the Director. Host and receivers sanitize and filter custom text; rate limits and timeouts on the host; per-player mute; preset-only and hide-chat settings.
- **Voice chat beta:** `js/voice.js`, opt-in push-to-talk or open mic over separate WebRTC calls, roster-checked, per-player mute and volume, speaking indicators, ducking, listen-only fallback when the mic is blocked. Needs real-device testing (iOS Safari, strict networks, Bluetooth).
- Spectators keep chat and voice.

## 10.1 (November 2026)
From the owner's playtest of 10.0, plus a four-handler polish round.
- **Fixed (owner reports):** emote names in store Collections were clipped and off-centre; the Lesson Complete card's Lessons button sat flush with the card edge; the Board lesson said the Crown appears at the centre (it spawns on a random safe tile, and the Crown banner now names the area).
- **Performance:** menu scene renders cheaper layers (title 12 to 40 fps in the same test), store compositor layers 219 to 33, match main-thread time per frame below 5.0, three-step auto quality that reacts in about 1 s, boot about 0.4 s, memory levels off over 10 matches.
- **Hazard art:** Throne dais with capture ring and contested state, geysers that escalate before erupting, conveyor belts, cracking and collapsing floors, Rift Storm tears; baked into the board layer and lit.
- **Layout and accessibility:** a crawler over about 84 states at four sizes; text under 11px 86 to 0, tap targets under 40px 20 to 0, low contrast 3 to 0, nine overlap and spacing fixes (lobby cards, action buttons, landscape turn strip, small-phone HUD and titles, item sheet, results bar).
- **Copy:** tutorials, Codex, How to Play, banners and descriptions checked against the engine (bounty rules, Gauntlet heal and bosses, Crown boost for Pawns, event timing, Steadfast and more). The bounty world event is renamed Royal Bounty so it no longer clashes with the Queen's Royal Decree. Lesson Complete shows progress and the next lesson.

## 10.0 (November 2026): the sequel
Built by ten specialist handlers working in parallel (messaging, music, sound, piece art, world rendering, effects, store and progression, menus, gameplay, QA), coordinated through `docs/V10_BRIEF.md` and `docs/V10_NOTES.md`.

**Gameplay**
- Four new modes: King of the Hill (hold the central Throne: +2 a turn alone, +1 contested, first to 10), Chaos (two hazards plus a world event every round), Gauntlet (co-op boss rush for 1-4) and Mirror Match (everyone gets the same random build).
- Six new world events: Eclipse, Earthquake, Mana Surge, Royal Decree (a bounty on the leader), War Drums, Restless Dead.
- Four new hazards: Geyser Field, Iron Works conveyors, Crumbling Keep, Rift Storm.
- Siege enemies: Stalker, Hexer, Splitter and Brute, plus a new boss, the Wraith Regent. Bosses enrage in long fights; walled-off hunters relocate.
- Six new abilities (Phalanx, Outflank, Consecrate, Repel, Bombard, Gravity Well) and two passives (Bastion, Predator). New tutorial lesson and Codex entries.
- Balance (sims): Royale King wins about 32%, presets 22.5-27.5%.

**Presentation**
- The Director (`js/announcer.js`): every callout, banner, tip, feed line, toast and ultimate cinematic is scheduled into fixed lanes. Measured overlapping message pairs in bot matches: 348 to 2 (portrait), 1290 to 1 (landscape). Three callout tiers, combined kill badges, a new Your Turn handoff and ultimate cinematic, HUD chip-down, shard pops, ult sweep, cooldown flashes.
- World (`js/world.js`): 11 tile materials, board slab, redrawn props, dynamic lighting and contact shadows, a storm that tears the floor into the void, weather (rain, ash, aurora, sand, leaves, void, fog, starfield), path previews with ghost pieces, threat outlines, status icons, shield domes, a cinematic camera with an intro fly-over.
- Pieces: re-sculpted 3D-lit Staunton forms, a jewelled King, a hooded Hollow and the new Colossus, 16 materials and 11 patterns, animated premium sets, lazy incremental sprite building.
- Effects: pooled particle core, cached glows, lingering floor decals, impact frames; every ability reworked; 11 new finishers (Resignation, Petal Storm, Riptide, Cyclone, Glitch, Grand Finale, Soul Harvest, Phoenix, Judgement, Supernova, Checkmate). Gallery at `tools/vfx.html`.
- Music: a composition engine with a recurring main theme, 11 themes and stingers, bar-quantised transitions and ducking.
- Sound: per-category buses with volume sliders, generated reverbs, unique sounds for every ability, finisher and hazard, rarity-tiered reveals and a synthesised announcer voice.
- Menus: new visual identity, title scene, a one-time sequel reveal, illustrated mode cards, a loadout showroom, cinematic results, lobby seat cards.

**Store and progression**
- Mythic rarity; 25 piece sets, 13 boards, 14 trails, 6 emote packs, 10 store finishers; 15 Collections with completion rewards; Featured and Deal of the Day; try-on preview and wishlist; a new reveal sequence.
- Season 3: The Endgame, a free 40-tier Crown Path (older seasons migrate, owned items stay owned).
- Daily login streak rewards (never shown over invite links), a Profile screen with showcase, 26 new trophies.

**Performance and fixes**
- First-tap audio stall (about 1.5 s) removed: audio and music start in idle slices; the tap handler now runs in a few ms.
- Piece sprite and effect caches are bounded; QA harness in `tests/` (engine fuzzer, browser smoke, perf, leak probe, overlap probe, online suite).

## 5.0 (November 2026)
**New modes**
- **Squads:** teams of two (up to four teams). No friendly fire, shared victory, teammates share a colour. Starting a turn within 2 tiles of your teammate grants Bond (+15% DEF). A fallen teammate leaves a soul for 3 rounds: step on it to revive them at 40% HP, or as an enemy shatter it for a shard.
- **Siege (co-op, 1-4 players):** eight waves of Hollows that hunt you down from the edges, with a Colossus boss on waves 4 and 8 (the first drops the Crown). The next wave arrives one round after you clear the last, or after 4 rounds; Hollows still standing count against its size, so the board never floods. Clearing a wave heals everyone 20%. The final Elder Colossus must be beaten to win. Difficulty scales with the number of defenders.

**New content**
- **Map hazards:** each Royale, Blitz or Squads match rolls Classic, Magma Rift (lava burns 8% max HP at turn start), Frostbite (ice keeps you sliding) or Warpgates (paired portals across the board).
- **Five new equippable abilities:** Tripwire (Pawn: hidden traps), Lance (Knight: 2-tile thrust with knockback), Penance (Bishop: diagonal strike that heals you), Quake (Rook: shockwaves down four lines), Gambit (Queen: pay HP for +40% ATK).
- **Two new base abilities:** Lifesteal and Last Stand.
- **The Announcer:** First Blood, kill streaks, Double/Triple Take, Shutdown, Regicide, Final Two, revives and boss waves get big callouts with their own stingers.
- **Play of the Match:** the most dramatic action of every game is replayed in slow motion from the results screen.
- **Piece Mastery:** every piece levels from 1 to 10. Titles at 3, 6 and 10, Marks every level.
- **Season 2: The Middlegame:** a new 30-tier Crown Path with the Warden and Colossus piece sets, the Riftgate board and the Soulfire finisher. Six new trophies and two new daily quests.

**Balance** (balance lab, about 25,000 simulated matches)
- The ~50% King win rate came from the Crown being recycled: a dead King dropped it and the endgame winner usually picked it up. Now the Crown **shatters into 4 shards** when the King falls, so there is one King per match and a real bounty for toppling them.
- A Knight or Bishop who claims the Crown with 4+ players left is lifted to about 85% of Rook stats, so the Crown is no longer a trap that ends their evolution.
- Thorns 20% to 30%. First Strike now triggers above 60% HP. Regen 2 to 1 base HP per turn. Lifesteal 10%.
- Result at 8 players: King wins 53% to 29%. Tank / Bruiser / Scout / Assassin 33 / 21 / 28 / 18% to 27 / 23 / 27 / 23%.
- Siege: an independent playtest caught an early build where nobody ever cleared a wave and Hollows piled up past 40. Waves are now sized to the defenders, leftovers count against the next wave (never more than 14 Hollows), Hollows scale in speed and damage rather than HP, and the final Elder Colossus must be beaten. Bot squads of 2-4 win about 90%, a solo bot about 50%, in roughly 40-50 rounds.

**Fixes from the 5.0 code scrub** (three review bots: rules fuzzing, client/online/mobile audit, balance lab)
- Rules: a revived King no longer duplicates the Crown; Lance can't hit the same piece twice; evolving a honed piece no longer drops HP to 1; Steadfast now protects against every hit of a multi-hit action; picking up the Crown mid-ability no longer locks Royal Guard; T-Strike and Stagger no longer reach through walls; crate loot never lands in the void; storm collapse moves the Crown somewhere safe instead of the next ring to fall; bots read each mode's own storm timing; the AI uses its own dice so replays are exact.
- Online safety: lobby messages and imported backups are validated against real item lists (a crafted join could previously crash the host's lobby).
- Stability: the game and menu render loops survive any single error instead of freezing.
- Mobile: the title screen scrolls in landscape, tap targets are at least 40px, small HUD text is larger.
- Performance: the static board, background and walls are cached instead of redrawn every frame (about 20-40% less frame time in profiling).

## 3.1 (October 2026)
**Online: spectating and leaving** (from a real match report)
- Getting eliminated no longer risks ending the match. Results opened mid-match have a Spectate button. A spectator bar lets you follow any surviving player or the action (Auto). Final results with a podium appear when the match ends.
- Hosts get a clear warning before leaving a live match ("the match runs on your device"), with Keep Spectating as the default. Friends see "Host Ended the Match" rather than "Forfeit". Closing the tab while hosting asks for confirmation.
- A host who forfeits keeps spectating while a bot plays their piece.
- **Rejoin:** a player who reloads or drops can rejoin with the same code and take their piece back from the bot.
- Clear messages for a full lobby, a match that has already started, being removed by the host, or the host ending the match.
- New automated online suite (`tests/online`): 22 lifecycle scenarios, all passing.

**Economy rework** (from a 1,000-match analysis per config)
- Promotion costs: Knight or Bishop 2, Rook +4, Queen +7 (Pawn to Rook 6, Pawn to Queen 13). Climbing step by step always costs the same as jumping, and the Promote menu now says so.
- Hone costs scale with tier and start cheap: Pawn 1/2/3, Knight or Bishop 3/4/5, Rook 4/6/8, Queen 6/8/10.
- Everyone starts with 1 shard, plus a starter shard two tiles from each spawn. Board content scales with player count. Shard Rain scales with players alive.
- **Steadfast:** before round 6, a player at full HP cannot be eliminated by a single hit. They are left at 1 HP with a callout. In simulation, full-HP one-shots before round 6 went from about 1 per 100 games to 0.
- No Blood Moon or Meteor Storm before round 6.
- Result in simulation: almost every player reaches Knight or Bishop by round 3 (was 67% by round 6), and Rook reach went from 17% to 37%, Queen from 2% to 8%. Pawn deaths fell from 2.4 per game to 0.3.
- Preset pass: Tank 4/2/2/2, Scout 3/3/1/3, Assassin 2/5/0/3.

**Life and readability**
- **Lethal Range warning:** on your turn, if an enemy can eliminate you next turn, a red banner names them, threatening pieces get pulsing red rings, and it tells you how much HP evolving would add.
- Knights face the way they move. Pieces have idle personalities: Knights toss their heads, Bishops sway, Rooks breathe, Queens and Kings float, Pawns hop.
- New first-match tip for Steadfast; the shard tip explains the 2-shard Knight.


## 3.0 (October 2026)
**Promotion ladder**
- The Promote menu shows the whole fixed ladder with a path strip, your shard count and the total cost of every rung. Climb several rungs in one tap: Pawn to Rook for 8, Pawn to Queen for 15, Knight or Bishop to Queen for 12. Unaffordable rungs show how many shards you still need. Bots climb the ladder too.

**The Store** (replaces the Armory)
- Featured: four daily offers, including a 30% Deal of the Day, plus a Founder's Pack placeholder for the future app store release.
- Bundles: Inferno Collection, Winter Court, Spring Bloom and Regal Treasury, 20-25% off, charging only for items you don't own.
- Rarity tiers (Common, Rare, Epic, Legendary, Season) with coloured cards and a shimmer on Legendaries.
- Item reveal: every purchase plays a full-screen reveal with rays in its rarity colour and an Equip button. Purchases need a confirm tap.
- New cosmetics: Jade, Amethyst, Onyx, Frostfire and Solar Flare piece sets; Sakura Terrace, Frozen Tundra (snow) and Abyssal Deep (bubbles) boards; Party Popper, Deep Freeze and Ascension finishers.
- New cosmetic types: Trails (Sparks, Embers, Frost, Petals, Stardust, Royal Procession) that follow your piece for everyone to see, and Emote packs (Good Sport, Trash Talk, Royal Court).

**Showtime**
- A contender reveal before every match, with a VS screen for Duels.
- A podium on the results screen once a match ends.
- Your equipped piece set and trail on a pedestal on the title screen.

**Fixes and polish from 3.0 QA**
- The Featured shop is now fixed for the whole day. Buying an offer no longer reshuffles the shop or rolls a new 30% deal.
- Paid trails and board weather stay visible when graphics drop to Low (just lighter).
- Coaching tips and info cards no longer sit above menus or eat taps.
- Store tabs sit in a grid with owned/total counts. The Deal of the Day is a full-width hero card with "You save". Confirm shows your balance after purchase. Bundles reveal every item in turn.
- Finisher previews keep the victim visible between loops, with staggered timing and a lighter piece.
- The HUD's next-promotion text matches the ladder (for example "Rook 8" when you can afford it).
- Queen base HP raised to 150, so evolving from Rook no longer lowers max HP.
- Bots no longer wear Crown Path exclusives. Backup codes carry a checksum, so edited codes are rejected. Duplicate forfeit lines in the feed and "is taking their turn" after a match are gone.

**Fixes from the 3.0 code review**
- A host pressing Play Again mid-match could leave friends frozen. Rematch is now only available after the match ends.
- A friend's forfeit left their piece human-controlled, wasting turn timers, and paid 15 Marks. A bot now takes over and nothing is paid. Forfeits count as a loss and reset win streaks.
- The Graduation match now always uses Battle Royale instead of the Play screen's mode.
- Importing an old or malformed backup code could break Host Online and other screens. All profiles are now validated on load and import.
- The Daily Challenge's equipped abilities were wrong on about 45% of days, and its bots differed between attempts. Both are now seeded.
- Animations could pause for a second after a backlog flush.
- Rejected lobby joiners are disconnected. Clients see the lobby's mode. A host can no longer start a 1-player match.


## 2.0 (October 2026)
**Modes**
- Battle Royale, Blitz (faster storm, 15 second turns, 2 starting shards), Duel (1v1 in a 10x10 arena) and Daily Challenge (seeded map and loadout, 7 Hard bots, best-score tracking).
- Hosts pick the mode for friend-code lobbies (Royale, Blitz or Duel).

**Progression**
- Crown Path: a free 30-tier season track with Marks, titles and four season-exclusive cosmetics (Arcane, Throne Room, Sovereign, Coronation finisher).
- Trophies: 21 achievements, each paying Marks and unlocking a title. Selected titles show in lobbies, inspect cards and results.
- Lifetime career stats and win streaks.

**Balance**
- "Heavy is the Head": the King no longer gains attunement, charges ultimates at half speed, takes 10% more damage and heals 2% a turn instead of 3%. The Crown spawns at a random safe tile instead of the centre. In simulation the Crown holder's win rate dropped from about 70% to about 45%.
- Tank preset reworked (HP 4 / ATK 2 / DEF 4). Regen now scales with attunement.

**Play experience**
- Danger-zone overlay shows every tile enemies can hit next turn.
- Post-match recap: who eliminated you and where your damage came from. A "Since your last turn" line in the feed.
- The camera recenters on your piece every turn; tap your portrait to recenter any time.
- No turn timer in solo matches, except Blitz. A toast tells you when a turn is skipped.
- The turn-order strip has its own row and shows evolved pieces. Banners moved to the top band. Name and HP labels draw above terrain.
- Two-tap confirm for Armory purchases. Cooldowns are a corner badge.

**Settings and accessibility**
- Graphics quality (Auto drops to Low on slow devices), reduced motion (follows the system setting), one-tap attacks, colorblind-safe player colours, larger text.
- Profile backup and restore codes. Privacy page, credits, What's New.
- Pinch-zoom allowed on menus. Dialogs are labelled for screen readers. Escape closes dialogs.

**Fixes (from the code review and playtests)**
- Hollows could spawn stacked on one tile (44% of matches).
- Rampart could permanently delete the Crown or other items.
- Evolving could leave a piece alive at zero or negative HP.
- The storm could drop the Crown inside a chest or wall.
- Thorns and push damage could change the result after the match ended.
- A client could add ghost players by sending join repeatedly. Malformed actions no longer throw on the host.
- Castling's damage preview missed the swapped piece.
- Results from a previous match could fire during a rematch and pay out twice.
- Leaving a match no longer pays full rewards and now stops the match.
- Tutorial steps could advance after leaving a lesson. Lesson 4's Ultimate button could jump off-screen on phones.
- Animation backlog could make pieces rubber-band. It is now capped and sequenced.
- The service worker no longer serves HTML in place of a missing script offline, and it now times out on flaky networks.
- iOS audio recovers after interruptions. Music no longer bursts after backgrounding.

- QA round 2: portrait recenter from full-board view, correct killer shown for the final elimination, no fake timer in untimed modes, correct leaderboard ranks on early or forfeited results, results buttons pinned on small screens, banners, tips and chips no longer overlap, the danger overlay shows enemy piece attacks only, and the Crown can no longer land on a chest in the last storm ring.
- One-time Grandmaster tips the first time you meet the storm, Hollows, world events, a full ultimate and the Crown.
- Public TURN relay fallback for friend-code play on strict networks.

**Performance**
- Pieces are drawn from cached high-resolution sprites (animated skins excepted). Background and vignette gradients are cached. Particles are capped. Noise buffers are reused. The menu background runs at 30 fps and pauses under dialogs. Backdrop blur removed.

## 1.3
Tutorial (5 lessons + graduation), Codex with engine-generated shape diagrams, 10 secret combo discoveries, hold-to-inspect abilities.

## 1.2
Shard Attunement, ultimates, world events, daily quests, victory cinematic, board weather, app icon and PWA.

## 1.1
Juice pass: sequenced combat, hit-stop, finishers, music, board themes, XP and levels.

## 1.0
First release: 8-player chess battle royale with evolution, abilities, storm, Crown and friend-code multiplayer.
