# Chess Complex 18.0 "Rivals" (lead spec, A0)

The game now has a real online home (Cloudflare rooms, Quick Play, cloud identity, leaderboards, replays). 18.0 makes
the people you play against matter, and makes the bots smart enough for the 16.0 tactics.

Budget rules for every specialist: be efficient (grep + line ranges, docs/V10_NOTES.md is huge — grep it, append to the
END only), no hour-long online suites; targeted tests + one final relevant run. Hard rules in docs/V10_BRIEF.md (Edit
tool, never git checkout/reset/stash/commit/push). Engine changes must keep lockstep determinism: if a rule changes, bump
PROTO in js/statehash.js. Server is live on the free plan (requests 100k/day, DO duration 13,000 GB-s/day): no
always-on alarms, no per-frame polling.

## 1. Nemesis (innovation, gameplay + UI) — owner NE
Every player has a Nemesis: whoever eliminated you most recently (online: by cloud id; solo: the bot by name). In your
next match against them, they wear a red crown-of-thorns marker; eliminating your Nemesis pays a **Vendetta** bonus
(+1 shard in-match, Marks after), and if they eliminate you again the streak grows ("Nemesis x3"). Being someone's
Nemesis and surviving them pays a small **Thorn in their side** bonus. Engine: a per-match `nemesis` map set from match
start args (deterministic, part of createMatch inputs, so lockstep holds; PROTO bump). UI: lobby card ("Your Nemesis is
in this match"), HUD marker, callout on Vendetta, results line, profile stat. Bots: a bot that has you as its Nemesis
prioritises you slightly.

## 2. Ranks + season rewards — owner NE (same specialist, shared UI)
Crown Rating tiers shown everywhere a name appears online (lobby, tags, results, leaderboards): Pawn < Knight <
Bishop < Rook < Queen < King tiers with rating bands (provisional until 10 games). Weekly Season: top finishers get a
title + profile banner at Monday rollover (Board DO cron already exists), delivered to the player's cloud save on next
sync (Player DO "inbox" field). Small rank badge art.

## 3. Rivals social — owner SO
Recent Players (last 30 people you matched with online, from match records on the client + cloud save), add Friend
(by tap in Recent or by player tag: a short public tag derived from the cloud id, never the secret), friend list with
online/in-lobby/in-match status (presence via the Player DO, updated on room join/leave only — no polling faster than
30 s while the Friends screen is open), Invite to party (a pending invite in the friend's Player DO, shown as a toast +
Friends badge; accepting joins the room code). Block / remove. Privacy: opt-out "Appear offline".

## 4. Live spectate + server leftovers — owner LV
Watch live public matches (and friends' matches) from Browse/Friends: a spectator socket on the Room receives the
lockstep stream (snapshot + actions), read-only, capped spectators per room (e.g. 8), counts toward nothing. Plus the
17.3 leftovers: Matchmaker listings stay fresh (Room re-reports while listed — piggyback on existing room activity, not a
new alarm loop), /turn requires a valid room/player context, prune moderation cache + old replay/player-rate rows.

## 5. Smarter bots — owner BT
Bots that understand 16.0+: plan around Overkill (finish low targets next to others), Guard (don't waste big hits on
high-DEF targets when a lower one is available), Speed Edge, Second Wind (finish before it triggers / bait it), Hold
(hold when the enemy that threatens them acts later), Shard Interest (bank toward Queen on the queen road), cogs and
Reversal at the Spire, Bishop Sidestep, Sudden Death (stay off the burning centre only if possible). Difficulty tiers
(Easy / Normal / Hard) wired to Quick Play fill bots (Normal) and solo setup. Keep planner CPU under the server budget
(p99 < 6 ms per step, measured with server/test/cpu-node.mjs). Balance after: tools/sim15.mjs 800 royale (roads within
~11-14.5%, King 36-42%), modesim co-op within ~5 pts.
