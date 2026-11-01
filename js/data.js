// Chess Complex — static game data
export const SIZE = 16;
export const MAX_PLAYERS = 8;
export const TURN_MS = 30000;

export const PIECES = {
  pawn:   { ult: 'enPassant', name: 'Pawn',   tier: 1, hp: 60,  atk: 10, def: 5,  spd: 10, attack: 'pawnStrike', sig: 'shove',     equips: ['sprint', 'digin', 'pickpocket'],
            moveDesc: 'Steps 1 tile in any direction.' },
  knight: { ult: 'fork', name: 'Knight', tier: 2, hp: 90,  atk: 16, def: 8,  spd: 12, attack: 'tstrike',    sig: 'vault',     equips: ['trample', 'stagger', 'rally'],
            moveDesc: 'L-shaped jump. Ignores anything in the way.' },
  bishop: { ult: 'excommunicate', name: 'Bishop', tier: 2, hp: 80,  atk: 14, def: 6,  spd: 11, attack: 'ray',        sig: 'transpose', equips: ['sanctuary', 'cross', 'blink'],
            moveDesc: 'Slides diagonally up to 4 tiles.' },
  rook:   { ult: 'castling', name: 'Rook',   tier: 3, hp: 140, atk: 18, def: 14, spd: 7,  attack: 'slam',       sig: 'charge',    equips: ['rampart', 'fortify', 'siege'],
            moveDesc: 'Slides straight up to 4 tiles.' },
  queen:  { ult: 'nova', name: 'Queen',  tier: 4, hp: 150, atk: 22, def: 10, spd: 10, attack: 'starburst',  sig: 'decree',    equips: ['dominion', 'execute', 'checkmate'],
            moveDesc: 'Slides any direction up to 5 tiles.' },
  king:   { ult: 'divineRight', name: 'King',   tier: 5, hp: 0,   atk: 0,  def: 0,  spd: 0,  attack: 'royalStrike', sig: 'royalGuard', equips: [],
            moveDesc: 'Steps 1 tile. Wears the Crown.' },
};

export const EVOLVE = { pawn: ['knight', 'bishop'], knight: ['rook'], bishop: ['rook'], rook: ['queen'], queen: [], king: [] };
export const EVOLVE_COST = { 2: 3, 3: 5, 4: 7 };
export const MAX_HONE = 3;
export const honeCost = (h) => 4 + h * 2;

// slot: atk = basic attack, sig = signature, eq = equipped
export const ABILITIES = {
  // basic attacks
  pawnStrike:  { name: 'Strike',        cd: 0, desc: 'Hit one diagonally adjacent tile.' },
  tstrike:     { name: 'T-Strike',      cd: 0, desc: 'T-shaped blow: the tile ahead plus a 3-wide crossbar just beyond it.' },
  ray:         { name: 'Piercing Ray',  cd: 0, desc: 'Diagonal beam, 3 tiles. Pierces every piece in the line.' },
  slam:        { name: 'Slam',          cd: 0, desc: 'Crushes the 3-wide row directly in front.' },
  starburst:   { name: 'Starburst',     cd: 0, desc: 'Explodes on every tile around the Queen.' },
  royalStrike: { name: 'Royal Strike',  cd: 0, desc: 'A heavy blow to one adjacent tile.' },
  hollowClaw:  { name: 'Claw',          cd: 0, desc: '' },
  // signatures
  shove:      { name: 'Shove',            cd: 2, desc: 'Push an adjacent piece back. Slamming it into something deals bonus damage.', honed: 'Pushes 2 tiles.' },
  vault:      { name: 'Vault',            cd: 3, free: true, desc: 'Free action: gain an extra jump this turn.', honed: 'Cooldown 2.' },
  transpose:  { name: 'Transpose',        cd: 3, desc: 'Swap places with any piece in diagonal line of sight.', honed: 'Range 8, cooldown 2.' },
  charge:     { name: 'Battering Charge', cd: 3, desc: 'Ram in a straight line. The first piece hit takes heavy damage and is knocked back.', honed: 'Hits harder, knocks back 3.' },
  decree:     { name: 'Royal Decree',     cd: 3, desc: 'Dash along any line, cutting through every piece in the path.', honed: 'Hits harder, cooldown 2.' },
  royalGuard: { name: 'Royal Guard',      cd: 3, desc: 'Double DEF until your next turn and heal 15%.' },
  // ultimates (charge by dealing and taking damage)
  enPassant:     { name: 'En Passant',     cd: 0, ult: true, desc: 'Leap up to 2 tiles and strike everything around where you land.' },
  fork:          { name: 'Fork',           cd: 0, ult: true, desc: 'Jump, then hit every square a knight could reach from your landing.' },
  excommunicate: { name: 'Excommunicate',  cd: 0, ult: true, desc: 'Holy beams down all four diagonals, the full length of the board.' },
  castling:      { name: 'Castling',       cd: 0, ult: true, desc: 'Swap with any piece in a straight line, then crush everything around you.' },
  nova:          { name: 'Checkmate Nova', cd: 0, ult: true, desc: 'Detonate a 5x5 blast centred on the Queen. Survivors are staggered.' },
  divineRight:   { name: 'Divine Right',   cd: 0, ult: true, desc: 'Heal 25% and smite every adjacent tile.' },
  // pawn equips
  sprint:     { name: 'Sprint',       cd: 3, free: true, desc: 'Free action: gain an extra step this turn.' },
  digin:      { name: 'Dig In',       cd: 3, desc: '+60% DEF until your next turn.' },
  pickpocket: { name: 'Pickpocket',   cd: 3, desc: 'Hit an adjacent piece and steal 1 shard.' },
  // knight equips
  trample:    { name: 'Trample',      cd: 3, desc: 'Leap in an L and crash down, hitting every tile around the landing.' },
  stagger:    { name: 'Stagger',      cd: 3, desc: 'A T-Strike that knocks targets back in the turn order.' },
  rally:      { name: 'Rally Cry',    cd: 4, desc: '+4 SPD for 2 turns and a burst of initiative.' },
  // bishop equips
  sanctuary:  { name: 'Sanctuary',    cd: 4, desc: 'Heal 30% of max HP.' },
  cross:      { name: 'Cross',        cd: 3, desc: 'Fire both diagonals at once, 2 tiles each way.' },
  blink:      { name: 'Blink Mark',   cd: 4, desc: 'Mark your tile. Use again to teleport back to it.' },
  // rook equips
  rampart:    { name: 'Rampart',      cd: 3, desc: 'Raise a stone barricade on an adjacent tile.' },
  fortify:    { name: 'Fortify',      cd: 4, desc: 'Double DEF until your next turn. You cannot move after.' },
  siege:      { name: 'Siege Shot',   cd: 3, desc: 'Long-range shot down a straight line, 6 tiles.' },
  // queen equips
  dominion:   { name: 'Dominion',     cd: 4, desc: 'Nearby enemies are slowed and pushed back in the turn order.' },
  execute:    { name: 'Execute',      cd: 3, desc: 'Strike a piece within 2 tiles. Massive damage below 30% HP.' },
  checkmate:  { name: 'Checkmate',    cd: 4, desc: 'Rays in all 8 directions, 3 tiles each.' },
};

export const PASSIVES = {
  regen:     { name: 'Regen',       desc: 'Recover 3 HP at the start of every turn.' },
  scavenger: { name: 'Scavenger',   desc: 'Crates you break always drop an extra shard.' },
  momentum:  { name: 'Momentum',    desc: '+2 SPD for every elimination (max 4 stacks).' },
  thorns:    { name: 'Thorns',      desc: 'Reflect 20% of damage taken from adjacent attackers.' },
  first:     { name: 'First Strike', desc: '+50% damage against targets at full HP.' },
};

export const STAT_POINTS = 10;
export const STAT_GAIN = { hp: 7, atk: 2, def: 1.5, spd: 1 };
export const PRESETS = {
  bruiser:  { name: 'Bruiser',  pts: { hp: 3, atk: 5, def: 2, spd: 0 }, passive: 'thorns',    blurb: 'Hits hard, takes a punch.' },
  scout:    { name: 'Scout',    pts: { hp: 2, atk: 3, def: 0, spd: 5 }, passive: 'scavenger', blurb: 'First to the loot, first to evolve.' },
  tank:     { name: 'Tank',     pts: { hp: 4, atk: 2, def: 4, spd: 0 }, passive: 'regen',     blurb: 'Outlast everyone.' },
  assassin: { name: 'Assassin', pts: { hp: 0, atk: 6, def: 0, spd: 4 }, passive: 'first',     blurb: 'Delete anyone at full health.' },
};

export const PLAYER_COLORS = ['#ff4d6d', '#4dabff', '#ffd24d', '#5cff9d', '#c77dff', '#ff8f3d', '#3dfff0', '#ff6ad5'];

export const ATTUNE = { max: 30, hp: 0.01, atk: 0.008, def: 0.005, spdEvery: 6 };

export const SKINS = {
  ivory:    { name: 'Ivory',        price: 0,   body: ['#fbf4e2', '#b3a383'], rim: '#fffaf0', glow: '#ffe7a8', line: '#6b5d45', fx: 'dust' },
  obsidian: { name: 'Obsidian',     price: 0,   body: ['#4a4466', '#0e0c16'], rim: '#a59bea', glow: '#7f6bff', line: '#05040a', fx: 'dust' },
  ember:    { name: 'Ember',        price: 150, body: ['#ffa25c', '#6e1404'], rim: '#ffe0b0', glow: '#ff5a1f', line: '#2a0700', fx: 'ember' },
  glacier:  { name: 'Glacier',      price: 150, body: ['#e8fbff', '#3b7aa3'], rim: '#ffffff', glow: '#7fe0ff', line: '#163246', fx: 'frost' },
  verdant:  { name: 'Verdant',      price: 200, body: ['#b4f09f', '#1b4f27'], rim: '#efffe6', glow: '#6dff7a', line: '#0b2411', fx: 'leaf' },
  neon:     { name: 'Neon Circuit', price: 450, body: ['#24123d', '#08040f'], rim: '#ff3df2', glow: '#00f0ff', line: '#00f0ff', fx: 'spark', wire: true },
  gilded:   { name: 'Gilded',       price: 500, body: ['#fff0b8', '#9b6a12'], rim: '#fffbe6', glow: '#ffcf4a', line: '#4a3006', fx: 'glint' },
  crimson:  { name: 'Crimson Regalia', price: 600, body: ['#ff6b7d', '#4a0010'], rim: '#ffe3a1', glow: '#ff2a4a', line: '#1a0006', fx: 'glint' },
  celestial:{ name: 'Celestial',    price: 1000, body: ['#ffffff', '#5a3aa8'], rim: '#ffffff', glow: '#9df3ff', line: '#1a1040', fx: 'aurora' },
  voidborn: { name: 'Voidborn',     price: 750, body: ['#2a0a3a', '#000000'], rim: '#d6a6ff', glow: '#b04dff', line: '#000000', fx: 'star' },
};
export const DEFAULT_SKINS = ['ivory', 'obsidian'];

export const HOLLOW_STATS = { hp: 45, atk: 9, def: 4, spd: 8 };

// ---------- cosmetics: boards ----------
export const BOARDS = {
  hall:   { weather: 'dust', name: 'Obsidian Hall', price: 0,   light: '#2a2638', dark: '#1c1928', vein: 'rgba(255,255,255,0.035)', frame: '#d6b05c', grid: 'rgba(214,176,92,0.07)', wallTop: ['#4b4560', '#353047'], wallFront: '#272335', bg: ['#1a1626', '#07060b'], mote: '#ffe7a8' },
  marble: { weather: 'petals', name: 'Marble Court',  price: 300, light: '#d9d4cc', dark: '#a8a196', vein: 'rgba(90,80,70,0.18)',      frame: '#c9a24a', grid: 'rgba(60,40,10,0.12)',  wallTop: ['#f1ece4', '#bdb5a8'], wallFront: '#8a8274', bg: ['#2a2622', '#0c0b0a'], mote: '#fff6dc' },
  neon:   { weather: 'pixels', name: 'Neon Grid',     price: 400, light: '#0f0b1f', dark: '#0a0716', vein: 'rgba(0,240,255,0.05)',     frame: '#ff3df2', grid: 'rgba(0,240,255,0.28)', wallTop: ['#2a1450', '#160a2e'], wallFront: '#0d0620', bg: ['#160a2e', '#030108'], mote: '#00f0ff', glowGrid: true },
  forge:  { weather: 'embers', name: 'Ember Forge',   price: 500, light: '#2b1712', dark: '#1d0f0b', vein: 'rgba(255,90,30,0.10)',     frame: '#ff7a2a', grid: 'rgba(255,110,40,0.10)', wallTop: ['#4a2a20', '#2e1a14'], wallFront: '#1e100b', bg: ['#2a0f08', '#070302'], mote: '#ff8a3d', lava: true },
  garden: { weather: 'fireflies', name: 'Moonlit Garden', price: 250, light: '#1f2b26', dark: '#16201c', vein: 'rgba(140,255,190,0.05)',  frame: '#9be3b4', grid: 'rgba(155,227,180,0.08)', wallTop: ['#3b4f45', '#283a32'], wallFront: '#1a2721', bg: ['#14241e', '#040807'], mote: '#c8ffd9' },
};
BOARDS.astral = { weather: 'stars', name: 'Astral Sanctum', price: 700, light: '#1b1840', dark: '#110e2c', vein: 'rgba(180,160,255,0.08)', frame: '#9df3ff', grid: 'rgba(157,243,255,0.12)', wallTop: ['#3a3270', '#251f52'], wallFront: '#17123a', bg: ['#1a1450', '#02010a'], mote: '#d8f6ff', stars: true };
export const DEFAULT_BOARDS = ['hall'];

// ---------- cosmetics: finishers (how pieces you eliminate die) ----------
export const FINISHERS = {
  shatter:   { name: 'Shatter',      price: 0,   desc: 'Your victims break apart like glass.' },
  inferno:   { name: 'Inferno',      price: 300, desc: 'A pillar of fire, then ash.' },
  lightning: { name: 'Thunderclap',  price: 350, desc: 'Struck down by a bolt from above.' },
  voidrift:  { name: 'Void Rift',    price: 500, desc: 'Pulled into a collapsing singularity.' },
  midas:     { name: 'Midas Touch',  price: 600, desc: 'Turned to gold, then crumbled to coins.' },
  starfall:  { name: 'Starfall',     price: 800, desc: 'A falling star crashes down on them.' },
};
export const DEFAULT_FINISHERS = ['shatter'];

export const EMOTES = { gg: 'GG', check: 'Check!', nice: 'Nice one', oops: 'Oops', come: 'Come at me', mercy: 'Mercy!' };

// ---------- progression ----------
export const TITLES = ['Recruit', 'Squire', 'Footsoldier', 'Knight Errant', 'Bishop\'s Hand', 'Castellan', 'Warden', 'Champion', 'Master', 'Grandmaster', 'Legend'];
export const xpForLevel = (lv) => Math.round(120 * Math.pow(lv, 1.25));
export const titleFor = (lv) => TITLES[Math.min(TITLES.length - 1, Math.floor((lv - 1) / 3))];

export const WORLD_EVENTS = {
  shardRain: { name: 'Shard Rain',  desc: 'Shards are falling across the board' },
  meteor:    { name: 'Meteor Storm', desc: 'Impacts next round. Get off the marked tiles' },
  bloodMoon: { name: 'Blood Moon',   desc: 'All damage +30% this round' },
  supply:    { name: 'Supply Drop',  desc: 'A royal cache has landed. Break it open' },
};

export const QUESTS = {
  win:      { text: 'Win a match', goal: 1, reward: 150 },
  kills:    { text: 'Eliminate 3 players', goal: 3, reward: 100 },
  rook:     { text: 'Evolve into a Rook', goal: 1, reward: 80 },
  crown:    { text: 'Claim the Crown', goal: 1, reward: 120 },
  shards:   { text: 'Collect 15 shards in one match', goal: 15, reward: 100, best: true },
  top3:     { text: 'Finish in the top 3', goal: 1, reward: 80 },
  damage:   { text: 'Deal 300 damage in one match', goal: 300, reward: 90, best: true },
  ults:     { text: 'Use 2 Ultimates', goal: 2, reward: 90 },
  hollows:  { text: 'Defeat 3 Hollows', goal: 3, reward: 70 },
  attune:   { text: 'Reach Attunement 3', goal: 3, reward: 90, best: true },
};
export const BOT_LEVELS = { easy: 'Easy', normal: 'Normal', hard: 'Hard' };

// Example combos shown in the Codex. The strongest ones are left for players to find.
export const COMBOS = [
  { name: 'Wall Slam', pieces: ['Pawn'], text: 'Line up a Shove so the target hits a wall, rubble or another piece. The collision adds bonus damage, and if it hits a piece, both take it.' },
  { name: 'Double Jump', pieces: ['Knight'], text: 'Vault is free. Vault, jump twice to close distance, and you still have your action for a T-Strike.' },
  { name: 'Initiative Lock', pieces: ['Knight'], text: 'Stagger knocks targets back in the turn order. Pair it with Rally Cry and you can act again before they recover.' },
  { name: 'Shrine Anchor', pieces: ['Bishop'], text: 'Drop a Blink Mark on a shrine, go fight, then blink home when you are hurt.' },
  { name: 'Hostile Takeover', pieces: ['Bishop'], text: 'Transpose swaps places with ANY piece in diagonal sight, enemies included. Think about where that leaves them.' },
  { name: 'Barricade and Ram', pieces: ['Rook'], text: 'Raise a Rampart behind a target, then Battering Charge into them. The knockback has nowhere to go.' },
  { name: 'Dash and Finish', pieces: ['Queen'], text: 'Royal Decree through a group to soften them up, then Execute whoever drops below 30%.' },
  { name: 'Blood Moon Burst', pieces: ['Any'], text: 'Hold a full ultimate until a Blood Moon round. All damage is +30% for that round.' },
  { name: 'Meteor Bait', pieces: ['Any'], text: 'Meteor tiles are marked a round early. Push, swap or pin enemies onto them before impact.' },
];
export const DISCOVERIES = {
  wallbanger: { name: 'Wallbanger', hint: 'Introduce someone to a wall.', desc: 'Slam a piece into something solid.' },
  leap:       { name: 'Leap of Faith', hint: 'A knight that refuses to stay grounded.', desc: 'Vault, then unleash Fork in the same turn.' },
  collateral: { name: 'Collateral', hint: 'Why hit one when you can hit three?', desc: 'Damage 3 or more pieces with one ability.' },
  overkill:   { name: 'Overkill', hint: 'Some hits are just rude.', desc: 'Deal 60 or more damage in a single hit.' },
  tax:        { name: 'Royal Tax', hint: 'Even kings pay their dues.', desc: 'Pickpocket a shard from the King.' },
  kingslayer: { name: 'Kingslayer', hint: 'Heavy is the head.', desc: 'Eliminate the King.' },
  checkmate:  { name: 'Checkmate', hint: 'One move, many endings.', desc: 'Eliminate 2 players with a single ultimate.' },
  ascended:   { name: 'Ascended', hint: 'Collect everything.', desc: 'Reach Attunement 30.' },
  clutch:     { name: 'Clutch', hint: 'Win with your last breath.', desc: 'Win a match below 10% HP.' },
  hostile:    { name: 'Hostile Takeover', hint: 'Trade places with destiny.', desc: 'Transpose an enemy into the storm\'s cracked ring or the void.' },
};

// ---------- 2.0: modes ----------
export const MODES = {
  royale: { name: 'Battle Royale', short: 'Royale', desc: 'The full experience. Up to 8 pieces, one survivor.', players: [2, 8], storm: { first: 5, every: 3 }, crown: 7, turnMs: 30000, startShards: 0, events: 3 },
  blitz:  { name: 'Blitz', short: 'Blitz', desc: 'Five-minute chaos. Faster storm, 15 second turns, everyone starts with 2 shards.', players: [2, 8], storm: { first: 3, every: 2 }, crown: 5, turnMs: 15000, startShards: 2, events: 2 },
  duel:   { name: 'Duel', short: 'Duel', desc: 'One on one in a tight 10x10 arena. Pure skill.', players: [2, 2], storm: { first: 6, every: 3 }, crown: 6, turnMs: 30000, startShards: 1, events: 4, arena: { x0: 3, y0: 3, x1: 12, y1: 12 } },
  daily:  { name: 'Daily Challenge', short: 'Daily', desc: 'Same map, same loadout for everyone today. Seven Hard bots. Chase your best score.', players: [8, 8], storm: { first: 5, every: 3 }, crown: 7, turnMs: 30000, startShards: 0, events: 3 },
};

// ---------- 2.0: season ----------
export const SEASON = { id: 1, name: 'Season 1: The Opening', tierXp: 250, tiers: 30 };
export const SEASON_REWARDS = (() => {
  const r = {};
  for (let t = 1; t <= 30; t++) r[t] = { marks: t % 5 === 0 ? 150 : t % 2 ? 40 : 60 };
  r[4] = { title: 'Opening Theory' };
  r[8] = { skin: 'arcane' };
  r[12] = { title: 'Tactician' };
  r[15] = { board: 'throne' };
  r[18] = { title: 'Endgame Specialist' };
  r[22] = { skin: 'sovereign' };
  r[26] = { title: 'Season One Legend' };
  r[30] = { finisher: 'coronation' };
  return r;
})();
SKINS.arcane = { name: 'Arcane', price: null, season: 1, body: ['#7ff7e8', '#3a1060'], rim: '#e8fffb', glow: '#ff5af0', line: '#12052a', fx: 'spark' };
SKINS.sovereign = { name: 'Sovereign', price: null, season: 1, body: ['#3a3a44', '#050507'], rim: '#ffd76a', glow: '#ffcf4a', line: '#ffd76a', fx: 'glint' };
BOARDS.throne = { weather: 'embers', name: 'Throne Room', price: null, season: 1, light: '#4a1820', dark: '#33101a', vein: 'rgba(255,210,120,0.08)', frame: '#ffd76a', grid: 'rgba(255,210,120,0.14)', wallTop: ['#6a2a30', '#4a1a22'], wallFront: '#2a0c12', bg: ['#3a0c14', '#060203'], mote: '#ffd76a' };
FINISHERS.coronation = { name: 'Coronation', price: null, season: 1, desc: 'A golden crown slams down, then the victim bursts into light.' };

// ---------- 2.0: achievements ----------
export const ACHIEVEMENTS = {
  first_win:  { name: 'First Victory', desc: 'Win a match.', stat: 'wins', goal: 1, reward: 100 },
  wins10:     { name: 'Seasoned', desc: 'Win 10 matches.', stat: 'wins', goal: 10, reward: 300 },
  wins50:     { name: 'Grandmaster', desc: 'Win 50 matches.', stat: 'wins', goal: 50, reward: 1000 },
  games25:    { name: 'Regular', desc: 'Play 25 matches.', stat: 'games', goal: 25, reward: 150 },
  kills50:    { name: 'Hunter', desc: 'Eliminate 50 players.', stat: 'kills', goal: 50, reward: 200 },
  kills250:   { name: 'Executioner', desc: 'Eliminate 250 players.', stat: 'kills', goal: 250, reward: 600 },
  queens:     { name: 'Promotion', desc: 'Evolve into a Queen.', stat: 'queens', goal: 1, reward: 100 },
  crowns5:    { name: 'Usurper', desc: 'Claim the Crown 5 times.', stat: 'crowns', goal: 5, reward: 200 },
  shards200:  { name: 'Crystal Hoarder', desc: 'Collect 200 shards.', stat: 'shardsTotal', goal: 200, reward: 200 },
  ults25:     { name: 'Showstopper', desc: 'Use 25 ultimates.', stat: 'ults', goal: 25, reward: 150 },
  hollows25:  { name: 'Ghostbuster', desc: 'Defeat 25 Hollows.', stat: 'hollows', goal: 25, reward: 100 },
  streak3:    { name: 'On a Roll', desc: 'Win 3 matches in a row.', stat: 'bestStreak', goal: 3, reward: 300 },
  hard_win:   { name: 'No Mercy', desc: 'Win against Hard bots.', stat: 'hardWins', goal: 1, reward: 250 },
  flawless:   { name: 'Untouchable', desc: 'Win without dropping below 50% HP.', stat: 'flawless', goal: 1, reward: 300 },
  blitz_win:  { name: 'Speed Chess', desc: 'Win a Blitz match.', stat: 'blitzWins', goal: 1, reward: 150 },
  duel_win5:  { name: 'Duelist', desc: 'Win 5 Duels.', stat: 'duelWins', goal: 5, reward: 200 },
  daily3:     { name: 'Daily Devotion', desc: 'Play the Daily Challenge on 3 different days.', stat: 'dailyDays', goal: 3, reward: 150 },
  discover5:  { name: 'Theorist', desc: 'Find 5 secret combos.', stat: 'discoveries', goal: 5, reward: 200 },
  tutorial:   { name: 'Graduate', desc: 'Complete the tutorial.', stat: 'tutorialDone', goal: 1, reward: 50 },
  level10:    { name: 'Veteran', desc: 'Reach level 10.', stat: 'level', goal: 10, reward: 200 },
  collector:  { name: 'Collector', desc: 'Own 12 cosmetics.', stat: 'cosmetics', goal: 12, reward: 250 },
};

// ---------- 3.0: store ----------
export const RARITY = {
  common:    { name: 'Common',    color: '#b8b2c8' },
  rare:      { name: 'Rare',      color: '#4dabff' },
  epic:      { name: 'Epic',      color: '#c77dff' },
  legendary: { name: 'Legendary', color: '#ffb347' },
  season:    { name: 'Season',    color: '#5cff9d' },
};
Object.assign(SKINS, {
  jade:      { name: 'Jade',       price: 220, body: ['#9cf0c4', '#0e5a3a'], rim: '#eafff4', glow: '#3dffa8', line: '#03281a', fx: 'leaf' },
  amethyst:  { name: 'Amethyst',   price: 220, body: ['#e2b8ff', '#4a1a7a'], rim: '#f7ecff', glow: '#b06bff', line: '#1e0636', fx: 'glint' },
  onyx:      { name: 'Onyx',       price: 480, body: ['#5a5560', '#000000'], rim: '#ff5a5a', glow: '#ff2a2a', line: '#ff3b3b', fx: 'ember' },
  frostfire: { name: 'Frostfire',  price: 520, body: ['#9df3ff', '#c4361a'], rim: '#ffffff', glow: '#ff8a3d', line: '#2a0a10', fx: 'frost' },
  solar:     { name: 'Solar Flare', price: 950, body: ['#fffbe6', '#ff6a00'], rim: '#ffffff', glow: '#ffcf4a', line: '#5a1a00', fx: 'glint' },
});
Object.assign(BOARDS, {
  sakura: { weather: 'petals', name: 'Sakura Terrace', price: 350, light: '#3a2430', dark: '#2a1822', vein: 'rgba(255,180,210,0.08)', frame: '#ffb7d0', grid: 'rgba(255,183,208,0.12)', wallTop: ['#5a3a48', '#3e2632'], wallFront: '#2a1820', bg: ['#2e1624', '#070306'], mote: '#ffd1dc' },
  tundra: { weather: 'snow', name: 'Frozen Tundra', price: 350, light: '#d6e4ee', dark: '#a9bccb', vein: 'rgba(60,90,120,0.14)', frame: '#9df3ff', grid: 'rgba(40,70,100,0.14)', wallTop: ['#f2f8fc', '#b9cad8'], wallFront: '#7a8fa0', bg: ['#1a2a3a', '#05080c'], mote: '#ffffff' },
  abyss:  { weather: 'bubbles', name: 'Abyssal Deep', price: 550, light: '#0f2a33', dark: '#0a1d24', vein: 'rgba(80,220,255,0.07)', frame: '#3dfff0', grid: 'rgba(61,255,240,0.12)', wallTop: ['#1f4a55', '#14333b'], wallFront: '#0a1f25', bg: ['#0a2a36', '#010508'], mote: '#9dfff6' },
});
Object.assign(FINISHERS, {
  confetti: { name: 'Party Popper', price: 300, desc: 'Pop! Your victim bursts into confetti.' },
  frozen:   { name: 'Deep Freeze',  price: 550, desc: 'Flash-frozen solid, then shattered into ice.' },
  ascend:   { name: 'Ascension',    price: 900, desc: 'Lifted into a beam of light and dissolved.' },
});
export const TRAILS = {
  none:     { name: 'None',      price: 0,   rarity: 'common', colors: [] },
  sparks:   { name: 'Sparks',    price: 120, rarity: 'common', colors: ['#fff1c4', '#ffd24d'] },
  embers:   { name: 'Embers',    price: 250, rarity: 'rare', colors: ['#ff8a3d', '#ffd27a', '#ff4d1f'] },
  frost:    { name: 'Frost',     price: 250, rarity: 'rare', colors: ['#d8fbff', '#7fe0ff', '#ffffff'] },
  petals:   { name: 'Petals',    price: 250, rarity: 'rare', colors: ['#ffd1dc', '#ff9ec0', '#ffffff'] },
  stardust: { name: 'Stardust',  price: 450, rarity: 'epic', colors: ['#c99bff', '#9df3ff', '#ffffff'] },
  royal:    { name: 'Royal Procession', price: 800, rarity: 'legendary', colors: ['#ffd24d', '#fff6d0', '#ff4d6d'] },
};
export const EMOTE_PACKS = {
  basic:    { name: 'Classic',   price: 0,   rarity: 'common', emotes: { gg: 'GG', check: 'Check!', nice: 'Nice one', oops: 'Oops', come: 'Come at me', mercy: 'Mercy!' } },
  friendly: { name: 'Good Sport', price: 100, rarity: 'common', emotes: { gl: 'Good luck', wp: 'Well played', ty: 'Thanks!', sorry: 'Sorry!' } },
  taunts:   { name: 'Trash Talk', price: 200, rarity: 'rare', emotes: { slow: 'Too slow', soon: 'Checkmate soon', all: 'Is that all?', bye: 'Bye bye' } },
  royal:    { name: 'Royal Court', price: 400, rarity: 'epic', emotes: { kneel: 'Kneel', long: 'Long live me', yourmove: 'Your move', crown: 'Mine now' } },
};
for (const p of Object.values(EMOTE_PACKS)) Object.assign(EMOTES, p.emotes);
export const RARITIES = {
  skin: { ivory: 'common', obsidian: 'common', ember: 'rare', glacier: 'rare', verdant: 'rare', jade: 'rare', amethyst: 'rare', crimson: 'epic', neon: 'epic', gilded: 'epic', onyx: 'epic', frostfire: 'epic', voidborn: 'legendary', celestial: 'legendary', solar: 'legendary', arcane: 'season', sovereign: 'season' },
  board: { hall: 'common', garden: 'rare', marble: 'rare', sakura: 'rare', tundra: 'rare', neon: 'epic', forge: 'epic', abyss: 'epic', astral: 'legendary', throne: 'season' },
  finisher: { shatter: 'common', inferno: 'rare', lightning: 'rare', confetti: 'rare', voidrift: 'epic', midas: 'epic', frozen: 'epic', starfall: 'legendary', ascend: 'legendary', coronation: 'season' },
};
export const BUNDLES = {
  inferno: { name: 'Inferno Collection', items: [['skin', 'ember'], ['board', 'forge'], ['finisher', 'inferno'], ['trail', 'embers']], off: 0.25 },
  winter:  { name: 'Winter Court', items: [['skin', 'glacier'], ['board', 'tundra'], ['finisher', 'frozen'], ['trail', 'frost']], off: 0.25 },
  bloom:   { name: 'Spring Bloom', items: [['skin', 'verdant'], ['board', 'sakura'], ['trail', 'petals'], ['emote', 'friendly']], off: 0.25 },
  regal:   { name: 'Regal Treasury', items: [['skin', 'gilded'], ['board', 'marble'], ['finisher', 'midas'], ['trail', 'royal']], off: 0.2 },
};
