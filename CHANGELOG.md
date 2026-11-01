# Changelog

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
