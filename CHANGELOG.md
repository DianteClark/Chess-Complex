# Changelog

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
