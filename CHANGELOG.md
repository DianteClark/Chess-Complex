# Changelog

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
