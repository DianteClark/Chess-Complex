// Chess Complex — static game data
export const SIZE = 16;
export const MAX_PLAYERS = 8;
export const TURN_MS = 30000;

export const PIECES = {
  pawn:   { ult: 'enPassant', name: 'Pawn',   tier: 1, hp: 60,  atk: 10, def: 5,  spd: 10, attack: 'pawnStrike', sig: 'shove',     equips: ['sprint', 'digin', 'pickpocket', 'tripwire', 'phalanx', 'firebrand', 'dart'],
            moveDesc: 'Steps 1 tile in any direction.' },
  knight: { ult: 'fork', name: 'Knight', tier: 2, hp: 90,  atk: 16, def: 8,  spd: 12, attack: 'tstrike',    sig: 'vault',     equips: ['trample', 'stagger', 'rally', 'lance', 'outflank', 'hoarfrost', 'skirmish'],
            moveDesc: 'L-shaped jump. Ignores anything in the way.' },
  bishop: { ult: 'excommunicate', name: 'Bishop', tier: 2, hp: 80,  atk: 14, def: 6,  spd: 11, attack: 'ray',        sig: 'transpose', equips: ['sanctuary', 'cross', 'blink', 'penance', 'consecrate', 'blessing', 'hex'],
            moveDesc: 'Slides diagonally up to 4 tiles. Or Sidestep 1 tile straight to change colour: it uses your action, so strike first.' },
  rook:   { ult: 'castling', name: 'Rook',   tier: 3, hp: 134, atk: 18, def: 14, spd: 7,  attack: 'slam',       sig: 'charge',    equips: ['rampart', 'fortify', 'siege', 'quake', 'repel', 'bombard', 'scorch', 'concuss'],
            moveDesc: 'Slides straight up to 4 tiles.' },
  queen:  { ult: 'nova', name: 'Queen',  tier: 4, hp: 150, atk: 22, def: 10, spd: 12, attack: 'starburst',  sig: 'decree',    equips: ['dominion', 'execute', 'checkmate', 'gambit', 'gravity', 'frostNova', 'plague'],
            moveDesc: 'Slides any direction up to 5 tiles.' },
  king:   { ult: 'divineRight', name: 'King',   tier: 5, hp: 0,   atk: 0,  def: 0,  spd: 0,  attack: 'royalStrike', sig: 'royalGuard', equips: [],
            moveDesc: 'Steps 1 tile. Wears the Crown.' },
  // 15.0 pawn line (C): pawn-shaped, single steps, keep the Pawn's equipped ability (equipFrom). cost overrides EVOLVE_COST.
  veteran:  { ult: 'warcry', name: 'Veteran',  tier: 2, cost: 3, hp: 92, atk: 14, def: 9, spd: 10, attack: 'halberd', sig: 'shieldWall', equips: [], equipFrom: 'pawn', line: 'pawn',
            moveDesc: 'Steps 1 tile in any direction. A Pawn that refused to change.' },
  champion: { ult: 'valor',  name: 'Champion', tier: 3, cost: 7, hp: 98, atk: 17, def: 10, spd: 10, attack: 'sweep',   sig: 'heroicLeap', equips: [], equipFrom: 'pawn', line: 'pawn',
            moveDesc: 'Steps 1 tile in any direction. Heroic Leap covers the distance.' },
};

export const EVOLVE = { pawn: ['knight', 'bishop', 'veteran'], knight: ['rook'], bishop: ['rook'], rook: ['queen'], queen: [], king: [], veteran: ['champion'], champion: [] };
export const EVOLVE_COST = { 2: 2, 3: 4, 4: 5 }; // Pawn→Rook 6, Pawn→Queen 11. Pawn line: Veteran 3, Champion 5 more (PIECES[x].cost)
export const evolveCost = (pc) => PIECES[pc].cost ?? EVOLVE_COST[PIECES[pc].tier];
// 15.0 Ascension (C): honing one of these pieces to MAX_HONE adds a piece passive and an empowered ultimate.
export const ASCEND = {
  knight: { name: 'Ascended Knight', passive: 'Cavalry',   desc: '+20% damage, and every jump raises a shield of 12% max HP until your next turn.', ult: 'Fork hits 30% harder and stuns everything it hits.' },
  bishop: { name: 'Archbishop',      passive: 'Grace',     desc: '+15% damage, heal 5% max HP at the start of each turn, and Piercing Ray poisons everything it hits.', ult: 'Excommunicate hits 30% harder and sets everything it hits on fire.' },
  rook:   { name: 'Fortress Rook',   passive: 'Fortress',  desc: 'Take 15% less damage. Slam slows everything it hits.', ult: 'Castling hits 30% harder and raises a shield of 25% max HP.' },
  queen:  { name: 'Empress Queen',   passive: 'Sovereign', desc: '+10% damage. Immune to slow and freeze.', ult: 'Checkmate Nova hits 30% harder and freezes the survivors.' },
};
// 15.0 status effects (C). t = default turns (counts down at the affected piece's turn start). bad = harmful (cleansed by shrines, potions, Blessing).
export const STATUS = {
  burn:    { name: 'Burn',    t: 2, bad: true,  desc: 'Loses 6% max HP at the start of each turn. Freezing it puts the fire out.' },
  poison:  { name: 'Poison',  t: 3, bad: true,  desc: 'Loses 3% max HP per stack at the start of each turn, up to 3 stacks. Healing is halved.' },
  freeze:  { name: 'Freeze',  t: 1, bad: true,  desc: 'Cannot move next turn, but can still act. Fire thaws it.' },
  stun:    { name: 'Stun',    t: 1, bad: true,  desc: 'Cannot act next turn, but can still move.' },
  slow:    { name: 'Slow',    t: 2, bad: true,  desc: '-3 SPD.' },
  shield:  { name: 'Shield',  t: 2, bad: false, desc: 'Absorbs damage before HP.' },
  haste:   { name: 'Haste',   t: 2, bad: false, desc: '+3 SPD.' },
  exposed: { name: 'Exposed', t: 1, bad: true,  desc: 'The King only: -20% DEF for each different attacker since its last turn, up to 4.' },
  enrage:  { name: 'Enrage',  t: 2, bad: false, desc: 'The King only: +25% ATK after a phase shockwave.' },
};
export const MAX_HONE = 3;
export const honeCost = (h, tier = 1) => tier + h; // 15.0 (C): T1 1/2/3, T2 2/3/4, T3 3/4/5, T4 4/5/6. Ascended Knight/Bishop = 11 shards from a Pawn, same as a Queen
export const STEADFAST_ROUND = 6;    // before this round a full-HP player cannot be one-shot
export const CALM_ROUNDS = 6;        // no Blood Moon or Meteor Storm before this round

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
  transpose:  { name: 'Transpose',        cd: 3, desc: 'Swap places with the first piece in diagonal line of sight, up to 6 tiles away.', honed: 'Range 8, cooldown 2.' },
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
  rally:      { name: 'Rally Cry',    cd: 4, desc: '+4 SPD for 2 turns, and you act earlier next round.' },
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
  // 5.0 equips
  tripwire:   { name: 'Tripwire',     cd: 3, desc: 'Hide a trap on an adjacent tile. Enemies who step on it take damage and lose initiative. Two traps at a time.' },
  lance:      { name: 'Lance',        cd: 2, desc: 'Thrust 2 tiles straight ahead. Everything hit is knocked back a tile.' },
  penance:    { name: 'Penance',      cd: 3, desc: 'Strike the first piece on a diagonal within 4 tiles and heal half the damage dealt.' },
  quake:      { name: 'Quake',        cd: 3, desc: 'Shockwaves 2 tiles down all four straight lines. Survivors lose initiative.' },
  gambit:     { name: 'Gambit',       cd: 5, free: true, desc: 'Free action: pay 12% of your HP for +40% ATK this turn and next.' },
  // siege boss
  colossusSlam: { name: 'Colossus Slam', cd: 0, desc: '' },
  // 10.0 equips
  phalanx:    { name: 'Phalanx',      cd: 3, desc: 'Strike all four straight neighbours at once.' },
  outflank:   { name: 'Outflank',     cd: 2, desc: 'Strike one tile a knight\'s jump away without moving. Ignores anything in the way.' },
  consecrate: { name: 'Consecrate',   cd: 3, desc: 'Call down a 3x3 holy burst centred 2 or 3 tiles away on a clear diagonal.' },
  repel:      { name: 'Repel',        cd: 3, desc: 'A shockwave on every adjacent tile that knocks everything back a tile. Collisions hurt.' },
  bombard:    { name: 'Bombard',      cd: 3, desc: 'Lob a shell exactly 3 tiles in a straight line, over walls. It bursts in a plus shape.' },
  gravity:    { name: 'Singularity', cd: 4, desc: 'Pull every enemy within 3 tiles one step toward you, then crush every tile around you.' },
  // 10.0 Siege enemies
  hexBolt:    { name: 'Hex Bolt',     cd: 0, desc: '' },
  soulLance:  { name: 'Soul Lance',   cd: 0, desc: '' },
  wraithStep: { name: 'Wraith Step',  cd: 3, free: true, desc: '' },
};

export const PASSIVES = {
  regen:     { name: 'Regen',       desc: 'Recover 1 HP at the start of every turn, plus 1 for every 10 shards attuned.' },
  scavenger: { name: 'Scavenger',   desc: 'Crates you break always drop an extra shard.' },
  momentum:  { name: 'Momentum',    desc: '+2 SPD for every elimination (max 4 stacks).' },
  thorns:    { name: 'Thorns',      desc: 'Reflect 30% of damage taken from adjacent attackers.' },
  first:     { name: 'First Strike', desc: '+50% damage against targets above 60% HP.' },
  lifesteal: { name: 'Lifesteal',   desc: 'Heal 14% of all damage you deal.' },
  laststand: { name: 'Last Stand',  desc: '+30% ATK while below 30% HP.' },
  bastion:   { name: 'Bastion',     desc: 'End your turn without moving and take 20% less damage until your next turn.' },
  predator:  { name: 'Predator',    desc: '+25% damage against targets below 35% HP.' },
  // 15.0 (C): status passives
  kindle:      { name: 'Kindle',      desc: 'Your basic attack sets its targets on fire (Burn).' },
  venom:       { name: 'Venom',       desc: 'Every ability that damages a piece adds a Poison stack.' },
  rime:        { name: 'Rime',        desc: 'Your hits Slow their targets. Damage against frozen targets +25%.' },
  aegis:       { name: 'Aegis',       desc: 'Every third turn, start with a Shield of 10% max HP.' },
  adrenaline:  { name: 'Adrenaline',  desc: 'Drop below 50% HP and gain Haste and a Shield of 12% max HP. Recharges after 3 rounds.' },
  ward:        { name: 'Ward',        desc: 'Immune to Freeze, Stun and Slow. Burn and Poison on you last 1 turn less.' },
  opportunist: { name: 'Opportunist', desc: '+25% damage against targets with a harmful status.' },
};
// 15.0 (C) equips, pawn line and ascended ultimates. st: statuses each hit applies (for bots, codex and the UI).
Object.assign(ABILITIES, {
  firebrand:  { name: 'Firebrand',     cd: 3, desc: 'Strike any adjacent tile with a burning brand and set the target on fire.', st: ['burn'] },
  dart:       { name: 'Venom Dart',    cd: 3, desc: 'Throw a dart at the first piece within 4 tiles in any straight or diagonal line. Two Poison stacks.', st: ['poison'] },
  hoarfrost:  { name: 'Hoarfrost',     cd: 4, desc: 'Leap in an L and land in a frost shockwave. Everything around the landing is frozen.', st: ['freeze'] },
  skirmish:   { name: 'Skirmish',      cd: 3, desc: 'Strike any adjacent tile, then gain Haste for 2 turns.', self: ['haste'] },
  blessing:   { name: 'Blessing',      cd: 4, desc: 'Gain a Shield of 25% max HP and shake off every harmful status.', self: ['shield'] },
  hex:        { name: 'Hex',           cd: 3, desc: 'A cursed bolt hits the first piece on a diagonal within 5 tiles: two Poison stacks and Slow.', st: ['poison', 'slow'] },
  scorch:     { name: 'Scorch',        cd: 3, desc: 'Sweep the 3-wide row in front with flame. Everything hit burns.', st: ['burn'] },
  concuss:    { name: 'Concussion',    cd: 4, desc: 'A crushing blow to one straight neighbour. The target is stunned.', st: ['stun'] },
  frostNova:  { name: 'Glacial Nova',  cd: 4, desc: 'Frost bursts 2 tiles around the Queen. Everything hit is slowed, and adjacent pieces freeze.', st: ['slow', 'freeze'] },
  plague:     { name: 'Plague',        cd: 4, desc: 'A sickly cloud 2 tiles around the Queen. Two Poison stacks on everything in it.', st: ['poison'] },
  // pawn line
  halberd:    { name: 'Halberd',       cd: 0, desc: 'A heavy strike on any adjacent tile.' },
  shieldWall: { name: 'Shield Wall',   cd: 3, desc: 'Gain a Shield of 22% max HP. Adjacent enemies are slowed.', self: ['shield'], st: ['slow'] },
  warcry:     { name: 'War Cry',       cd: 0, ult: true, desc: 'Smash every adjacent tile and stun the survivors, then gain Haste.', st: ['stun'], self: ['haste'] },
  sweep:      { name: 'Sweep',         cd: 0, desc: 'A wide arc: the adjacent tile you pick and the two beside it.' },
  heroicLeap: { name: 'Heroic Leap',   cd: 3, desc: 'Leap 2 or 3 tiles in any straight or diagonal line, over anything, and strike around the landing.', honed: 'Cooldown 2.' },
  valor:      { name: 'Valor',         cd: 0, ult: true, desc: 'Leap up to 3 tiles and bring the banner down: hits everything within 2 tiles of the landing and sets it on fire.', st: ['burn'] },
});
Object.assign(ABILITIES.dominion, { desc: 'Nearby enemies are slowed and pushed back in the turn order.', st: ['slow'] });
// 15.0 (C) unlock prices in Marks (missing = free). Free kit: 5 base abilities and the first 2 equips of each piece.
// Unlocks live in profile.unlocked as 'passive:<id>' / 'ability:<id>' (S owns the store side).
// Bands agreed with S: base abilities 600 / 900 (status builders) / 1200 (top picks); equips 400 (3rd), 600 (4th), 800 (5th+), 1000-1500 (15.0).
for (const [k, v] of Object.entries({ lifesteal: 600, laststand: 600, bastion: 600, predator: 600, kindle: 900, venom: 900, rime: 900, ward: 900, adrenaline: 900, aegis: 1200, opportunist: 1200 })) PASSIVES[k].unlock = v;
for (const [k, v] of Object.entries({ pickpocket: 400, tripwire: 600, phalanx: 800, firebrand: 1000, dart: 1000,
  rally: 400, lance: 600, outflank: 800, hoarfrost: 1500, skirmish: 1000,
  blink: 400, penance: 600, consecrate: 800, blessing: 1200, hex: 1200,
  siege: 400, quake: 600, repel: 800, bombard: 800, scorch: 1000, concuss: 1400,
  checkmate: 400, gambit: 600, gravity: 800, frostNova: 1500, plague: 1200 })) ABILITIES[k].unlock = v;
// 16.0 (C) tempo equips, built on the turn order. tempo: 'first' = you act first next round, 'last' = pieces hit act
// last next round, 'both' = both. Engine event {e:'tempo', id, k:'first'|'last', by}.
Object.assign(ABILITIES, {
  seize:     { name: 'Seize',         cd: 4, unlock: 1000, tempo: 'first', desc: 'Strike one tile a knight\'s jump away without moving, then act first next round.' },
  hourglass: { name: 'Hourglass',     cd: 4, unlock: 1200, tempo: 'last', st: ['slow'], desc: 'A bolt of sand hits the first piece on a diagonal within 5 tiles. It is slowed and acts last next round.' },
  anchor:    { name: 'Anchor',        cd: 4, unlock: 1000, tempo: 'last', desc: 'Drop anchor: crush every adjacent tile and gain +25% DEF until your next turn. Enemies hit act last next round.' },
  fracture:  { name: 'Time Fracture', cd: 5, unlock: 1500, tempo: 'both', desc: 'Shatter time 2 tiles around the Queen. Everything hit acts last next round, and you act first.' },
});
PIECES.knight.equips.push('seize'); PIECES.bishop.equips.push('hourglass'); PIECES.rook.equips.push('anchor'); PIECES.queen.equips.push('fracture');

export const STAT_POINTS = 10;
export const STAT_GAIN = { hp: 7, atk: 2, def: 1.5, spd: 1 };
export const PRESETS = {
  bruiser:  { name: 'Bruiser',  pts: { hp: 4, atk: 3, def: 1, spd: 2 }, /* 16.0 (C): was hp 3 atk 5 (Overkill + Thorns won 30%); 17.0 (C2): was atk 4 def 2 spd 0 (28-30% after Bishop Sidestep) */ passive: 'thorns',    blurb: 'Takes a punch and hits back.' },
  scout:    { name: 'Scout',    pts: { hp: 3, atk: 3, def: 1, spd: 3 }, passive: 'scavenger', blurb: 'First to the loot, first to evolve.' },
  tank:     { name: 'Tank',     pts: { hp: 4, atk: 2, def: 2, spd: 2 }, passive: 'regen',     blurb: 'Outlast everyone.' },
  assassin: { name: 'Assassin', pts: { hp: 3, atk: 4, def: 0, spd: 3 }, /* 17.0 (C2): was hp 2 spd 4 (19-21%) */ passive: 'first',     blurb: 'Opens fights with a devastating first blow.' },
};

export const TEAM_COLORS = ['#4dabff', '#ffd24d', '#5cff9d', '#c77dff']; // no red: red reads as danger
export const MUTATORS = {
  none:    { name: 'Classic', desc: 'No hazards.' },
  lava:    { name: 'Magma Rift', desc: 'Lava pools burn anyone who starts a turn on them.' },
  ice:     { name: 'Frostbite', desc: 'Ice patches. Anything that lands on ice keeps sliding.' },
  portals: { name: 'Warpgates', desc: 'Paired portals. Step in, step out across the board.' },
  geysers:  { name: 'Geyser Field', desc: 'Vents rumble for a round, then erupt, scalding and throwing anyone on or beside them.' },
  conveyor: { name: 'Iron Works', desc: 'Conveyor tracks carry anything standing on them one tile at the end of every round.' },
  crumble:  { name: 'Crumbling Keep', desc: 'Cracked floor gives way the second time it is stepped on, leaving a pit.' },
  rift:     { name: 'Rift Storm', desc: 'Every third round the rift swaps two random pieces across the board.' },
  chaos:    { name: 'Chaos Stack', desc: 'Two hazards at once. Check the board.' },
  // 15.0 (W): location hazards
  brambles: { name: 'Overgrowth', desc: 'Thorny hedges everywhere. Landing in brambles pushes you later in the turn order.' },
  poison:   { name: 'Poison Pools', desc: 'Bubbling bog pools. Land on one or start a turn in it and you are poisoned.' },
  cogs:     { name: 'Cogwheels', desc: 'Giant brass gears in the floor. At the end of every round they turn and carry anyone on them one tile clockwise.' }, // 16.0 (L) spire
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
// 10.0 finishers (A6): each is a mini-cinematic in js/fx.js finisher(); sound id is 'kill:<id>'
Object.assign(FINISHERS, {
  resign:    { name: 'Resignation',  price: 300, rarity: 'rare',      desc: 'They tip over like a resigned king and crumble into board squares.' },
  sakura:    { name: 'Petal Storm',  price: 350, rarity: 'rare',      desc: 'Dissolved into cherry blossoms and carried off on the wind.' },
  riptide:   { name: 'Riptide',      price: 400, rarity: 'rare',      desc: 'A whirlpool opens and a column of water drags them under.' },
  cyclone:   { name: 'Cyclone',      price: 400, rarity: 'rare',      desc: 'A tornado whips them up, spins them and flings them away.' },
  glitch:    { name: 'Glitch',       price: 550, rarity: 'epic',      desc: 'Torn into scanlines and deleted in a burst of pixels.' },
  finale:    { name: 'Grand Finale', price: 600, rarity: 'epic',      desc: 'Launched skyward like a rocket and burst into fireworks.' },
  reaper:    { name: 'Soul Harvest', price: 650, rarity: 'epic',      desc: 'A spectral scythe tears the soul free. The body turns to dust.' },
  phoenix:   { name: 'Phoenix',      price: 900, rarity: 'legendary', desc: 'A firebird sweeps through them, then rises from the ashes.' },
  judgement: { name: 'Judgement',    price: 950, rarity: 'legendary', desc: 'A colossal blade falls from the heavens and cleaves them in two.' },
  supernova: { name: 'Supernova',    price: 1000, rarity: 'legendary', desc: 'They swell into a star, collapse, and detonate.' },
  checkmate: { name: 'Checkmate',    price: null, season: 3, rarity: 'season', desc: 'A colossal king topples onto them and the board cracks in a shockwave.' },
});
// 15.0 World Tour finishers (V): one per signature location, Royal Pass premium lane (S); loc = js/locations.js id; sound id is 'kill:<id>'
Object.assign(FINISHERS, {
  glacial:   { name: 'Glacial Tomb', price: null, season: 4, royal: true, rarity: 'royal', loc: 'citadel', desc: 'A snow vortex closes in, ice entombs them and an icicle splits the tomb.' },
  magma:     { name: 'Magma Core',   price: null, season: 4, royal: true, rarity: 'royal', loc: 'forge',   desc: 'The floor splits, they glow red-hot and sink, then the core erupts.' },
  abyssal:   { name: 'Abyssal Maw',  price: null, season: 4, royal: true, rarity: 'royal', loc: 'temple',  desc: 'Black water opens and tentacles drag them under.' },
  witchfire: { name: 'Witch-fire',   price: null, season: 4, royal: true, rarity: 'royal', loc: 'bog',     desc: 'A hex circle ignites, they melt into ooze and a skull wisp cackles away.' },
});
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
  eclipse:   { name: 'Eclipse',      desc: 'Darkness falls. Distant pieces vanish from sight and critical hits are twice as likely this round' },
  earthquake:{ name: 'Earthquake',   desc: 'The ground shifts. Walls crack into rubble and new rubble rises' },
  manaSurge: { name: 'Mana Surge',   desc: 'Raw power floods the board. Every ultimate gains 35% charge' },
  bounty:    { name: 'Royal Bounty', desc: 'A price is placed on the leader. Whoever eliminates them gains 3 shards and ultimate charge' },
  frenzy:    { name: 'War Drums',    desc: 'Every piece gains +3 SPD for a round' },
  restless:  { name: 'Restless Dead', desc: 'Hollows claw their way out of the ground and hunt the nearest piece' },
  // 15.0 (W): location signature events (see js/locations.js LOC_EVENTS). warn = the telegraph line, desc = the strike.
  blizzard:   { name: 'Blizzard',     tone: 'cyan',   warn: 'A blizzard is coming. Shelter next to a wall or freeze', desc: 'The blizzard hits. Pieces in the open are frozen and ice spreads' },
  eruption:   { name: 'Eruption',     tone: 'red',    warn: 'The volcano rumbles. Get off the marked tiles', desc: 'Molten rock rains down and sets pieces on fire' },
  flood:      { name: 'Flood',        tone: 'cyan',   warn: 'The tide is rising. Head for the high ground in the centre', desc: 'The water rises over the low ground and slows everyone caught in it' },
  bloom:      { name: 'Bloom',        tone: 'gold',   desc: 'The gardens bloom. Every piece heals and shakes off burns and poison' },
  sandstorm:  { name: 'Sandstorm',    tone: 'gold',   desc: 'Sand fills the air. Distant pieces vanish from sight and everyone is slowed' },
  overcharge: { name: 'Overcharge',   tone: 'violet', desc: 'The machines surge. Cooldowns refresh, ultimates charge, and anyone on a belt is stunned' },
  gravityWell:{ name: 'Gravity Well', tone: 'violet', warn: 'Space is bending. Stay clear of the marked rift', desc: 'The well collapses and drags nearby pieces toward its heart' },
  toxicFog:   { name: 'Toxic Fog',    tone: 'red',    warn: 'A green fog creeps in. Leave the marked area', desc: 'The fog chokes everyone inside it with poison' },
  reversal:   { name: 'Reversal',     tone: 'gold',   warn: 'The clock winds back. Next round the slowest act first', desc: 'Time runs backwards. For one round the slowest pieces act first' }, // 16.0 (L) spire
};

export const QUESTS = {
  win:      { text: 'Win a match', goal: 1, reward: 150 },
  kills:    { text: 'Eliminate 3 players', goal: 3, reward: 100 },
  rook:     { text: 'Evolve into a Rook', goal: 1, reward: 80 },
  crown:    { text: 'Claim the Crown', goal: 1, reward: 120 },
  shards:   { text: 'Collect 15 shards in one match', goal: 15, reward: 100, best: true },
  top3:     { text: 'Finish in the top 3', goal: 1, reward: 80 },
  damage:   { text: 'Deal 300 damage in one match', goal: 300, reward: 90, best: true },
  ults:     { text: 'Use 2 ultimates', goal: 2, reward: 90 },
  hollows:  { text: 'Defeat 3 Hollows', goal: 3, reward: 70 },
  attune:   { text: 'Reach attunement 3', goal: 3, reward: 90, best: true },
  revive:   { text: 'Revive a teammate in Squads, Siege or the Gauntlet', goal: 1, reward: 100 },
  waves:    { text: 'Clear 4 waves in one Siege', goal: 4, reward: 110, best: true },
  bosses:   { text: 'Topple 2 bosses in Siege or the Gauntlet', goal: 2, reward: 120, stat: 'colossi' },
};

// Example combos shown in the Codex. The strongest ones are left for players to find.
export const COMBOS = [
  { name: 'Wall Slam', pieces: ['Pawn'], text: 'Line up a Shove so the target hits a wall, rubble or another piece. The collision adds bonus damage, and if it hits a piece, both take it.' },
  { name: 'Double Jump', pieces: ['Knight'], text: 'Vault is free. Vault, jump twice to close distance, and you still have your action for a T-Strike.' },
  { name: 'Initiative Lock', pieces: ['Knight'], text: 'Stagger pushes targets later in the next round\'s turn order. Pair it with Rally Cry and you act before them two rounds running.' },
  { name: 'Shrine Anchor', pieces: ['Bishop'], text: 'Drop a Blink Mark on a shrine, go fight, then blink home when you are hurt.' },
  { name: 'Change Colour', pieces: ['Bishop'], text: 'Fire your Piercing Ray first, then Sidestep 1 tile straight: next turn your diagonals cover the other colour.' }, // 17.0 (C2)
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
  royale: { name: 'Battle Royale', short: 'Royale', desc: 'The full experience. Up to 8 pieces, one survivor.', players: [2, 8], storm: { first: 5, every: 3 }, crown: 7, turnMs: 30000, startShards: 1, events: 3 },
  blitz:  { name: 'Blitz', short: 'Blitz', desc: 'Five-minute chaos. Faster storm, 15 second turns, quicker everything.', players: [2, 8], storm: { first: 3, every: 2 }, crown: 5, turnMs: 15000, startShards: 1, events: 2 },
  duel:   { name: 'Duel', short: 'Duel', desc: 'One on one in a tight 10x10 arena. Pure skill.', players: [2, 2], storm: { first: 6, every: 3 }, crown: 6, turnMs: 30000, startShards: 1, events: 4, arena: { x0: 3, y0: 3, x1: 12, y1: 12 } },
  squads: { name: 'Squads', short: 'Squads', desc: 'Teams of two. No friendly fire. Stand close for Bond, and step on a fallen ally\'s soul to bring them back.', players: [4, 8], storm: { first: 5, every: 3 }, crown: 7, turnMs: 30000, startShards: 1, events: 3, teams: 2 },
  siege:  { name: 'Siege', short: 'Siege', desc: 'Co-op. Hold the board against eight waves of hunting Hollows, with a Colossus on wave 4 and the Elder Colossus on wave 8.', players: [1, 4], storm: { first: 999, every: 3 }, crown: 999, turnMs: 30000, startShards: 1, events: 3, siege: { waves: 8 } },
  daily:  { name: 'Daily Challenge', short: 'Daily', desc: 'The location of the day, and the same build of the day for every piece on the board. Seven Hard bots. Chase your best score.', players: [8, 8], storm: { first: 5, every: 3 }, crown: 7, turnMs: 30000, startShards: 1, events: 3, mirror: true },
  // 10.0 modes. icon: [piece, skin] for the mode card; bots: solo bot slider config.
  hill:     { name: 'King of the Hill', short: 'Hill', desc: 'Hold the golden Throne at the centre. Start your turn on it for 2 points, or 1 if an enemy is on it too. First to 10, or last piece standing.', players: [2, 8], storm: { first: 6, every: 3 }, crown: 7, turnMs: 30000, startShards: 1, events: 3, hill: { goal: 10, alone: 2, contested: 1 }, icon: ['king', 'crimson'] },
  chaos:    { name: 'Chaos', short: 'Chaos', desc: 'Two hazards stacked on one board and a world event every single round. Anything goes.', players: [2, 8], storm: { first: 5, every: 3 }, crown: 7, turnMs: 30000, startShards: 1, events: 1, chaos: true, icon: ['queen', 'neon'] },
  gauntlet: { name: 'Gauntlet', short: 'Gauntlet', desc: 'Co-op boss rush. The Colossus, the Wraith Regent, the Elder Colossus, then the Regent Ascendant and a Colossus at once.', players: [1, 4], storm: { first: 999, every: 3 }, crown: 999, turnMs: 30000, startShards: 4, events: 3, siege: { waves: 4, gauntlet: true }, icon: ['rook', 'voidborn'], bots: { min: 0, max: 3, def: 3, label: 'Bot Allies' } },
};
MODES.siege.bots = { min: 0, max: 3, def: 3, label: 'Bot Allies' };
// 15.0 (W): modes regrouped. Mirror Match is no longer its own mode: Daily gives everyone the build of the day, and a
// Custom lobby can turn on mirror builds. Old ids still load: MODE_ALIAS maps them (createMatch and saves use it).
const MODE_GROUP_OF = { royale: 'competitive', blitz: 'competitive', duel: 'competitive', squads: 'competitive', siege: 'coop', gauntlet: 'coop', hill: 'party', chaos: 'party', daily: 'challenge' };
for (const [k, g] of Object.entries(MODE_GROUP_OF)) if (MODES[k]) MODES[k].group = g;
export const MODE_GROUPS = [
  { id: 'competitive', name: 'Competitive', desc: 'Every piece for itself, or for your squad.', modes: ['royale', 'blitz', 'duel', 'squads'] },
  { id: 'coop', name: 'Co-op', desc: 'Team up against the Hollows.', modes: ['siege', 'gauntlet'] },
  { id: 'party', name: 'Party', desc: 'Wild rules for a good time.', modes: ['hill', 'chaos'] },
  { id: 'challenge', name: 'Challenge', desc: 'One location, one build, one score to beat. New every day.', modes: ['daily'] },
  { id: 'custom', name: 'Custom', desc: 'Your lobby, your rules: mode, location, mirror builds, hazards, storm speed and bots.', modes: [], custom: true },
];
// Modes a Custom lobby may host (Daily stays solo, one per day).
export const CUSTOM_MODES = ['royale', 'blitz', 'duel', 'squads', 'siege', 'gauntlet', 'hill', 'chaos'];
// Retired mode ids -> { mode, custom } (custom = rules to merge into opts.custom).
export const MODE_ALIAS = { mirror: { mode: 'royale', custom: { mirror: true } } };

// ---------- 2.0: season ----------
// 15.0 (S): Season 4, the World Tour. Older seasons are listed for the profile history; their rewards stay owned forever.
// Pace: ~160 season XP per Royale match, so 40 tiers x 700 XP = 28,000 XP is about 175 matches (12 weeks at 15 matches a week).
export const SEASON = { id: 4, name: 'Season 4: World Tour', short: 'World Tour', tierXp: 700, tiers: 40, ends: '2027-03-01' };
export const PAST_SEASONS = { 1: 'Season 1: The Opening', 2: 'Season 2: The Middlegame', 3: 'Season 3: The Endgame' };
// Free lane (everyone).
export const SEASON_REWARDS = (() => {
  const r = {};
  for (let t = 1; t <= 40; t++) r[t] = { marks: t % 5 === 0 ? 150 : t % 2 ? 50 : 70 };
  r[3] = { title: 'Wanderer' };
  r[7] = { emote: 'postcards' };
  r[10] = { skin: 'voyager' };
  r[14] = { title: 'Passport Stamped' };
  r[18] = { trail: 'compass' };
  r[20] = { marks: 400 };
  r[25] = { board: 'atlas' };
  r[29] = { title: 'Seen It All' };
  r[32] = { banner: 'tourflag' };
  r[36] = { title: 'Season Four Legend' };
  r[40] = { skin: 'worldwalker' };
  return r;
})();
// Royal Pass: the premium lane, bought once per season with Marks (never real money). Tier 0 is granted on purchase.
// Every tier has a reward; 1,500 of the 3,000 Marks come back as rebates along the way.
export const ROYAL_PASS = { price: 3000, name: 'Royal Pass', blurb: 'A second reward lane on the Crown Path: 4 piece sets, 3 boards, 3 trails, 4 location finishers, 5 banners, titles and 1,500 Marks back.' };
export const ROYAL_REWARDS = (() => {
  const r = {};
  const fin = (id) => ({ finisher: id, fallback: { marks: 300 } });
  Object.assign(r, {
    0: { skin: 'cartographer' }, 1: { title: 'Royal Patron' }, 2: { marks: 100 }, 3: { banner: 'royalviolet' }, 4: { emote: 'grandtour' },
    5: { marks: 100 }, 6: { trail: 'jetstream' }, 7: { marks: 100 }, 8: fin('glacial'), 9: { title: 'Frequent Flyer' },
    10: { board: 'skyharbor' }, 11: { marks: 100 }, 12: { banner: 'northern' }, 13: { skin: 'stormchaser' }, 14: { marks: 100 },
    15: { title: 'Jet Set' }, 16: { trail: 'lanterns' }, 17: { marks: 100 }, 18: fin('magma'), 19: { banner: 'volcanic' },
    20: { marks: 200 }, 21: { title: 'Grand Tourist' }, 22: { board: 'mirage' }, 23: { marks: 100 }, 24: { skin: 'goldleaf' },
    25: { marks: 100 }, 26: { trail: 'ribbon' }, 27: { title: 'Cartographer' }, 28: fin('abyssal'), 29: { marks: 100 },
    30: { banner: 'starchart' }, 31: { marks: 100 }, 32: { board: 'worldtree' }, 33: { title: 'Royal Voyager' }, 34: { marks: 100 },
    35: { banner: 'royalgold' }, 36: { marks: 100 }, 37: { title: 'Crowned Traveller' }, 38: fin('witchfire'), 39: { marks: 100 },
    40: { skin: 'worldcrown' },
  });
  return r;
})();
SKINS.arcane = { name: 'Arcane', price: null, season: 1, body: ['#7ff7e8', '#3a1060'], rim: '#e8fffb', glow: '#ff5af0', line: '#12052a', fx: 'spark' };
SKINS.sovereign = { name: 'Sovereign', price: null, season: 1, body: ['#3a3a44', '#050507'], rim: '#ffd76a', glow: '#ffcf4a', line: '#ffd76a', fx: 'glint' };
BOARDS.throne = { weather: 'embers', name: 'Throne Room', price: null, season: 1, light: '#4a1820', dark: '#33101a', vein: 'rgba(255,210,120,0.08)', frame: '#ffd76a', grid: 'rgba(255,210,120,0.14)', wallTop: ['#6a2a30', '#4a1a22'], wallFront: '#2a0c12', bg: ['#3a0c14', '#060203'], mote: '#ffd76a' };
SKINS.warden = { name: 'Warden', price: null, season: 2, body: ['#cfe9ff', '#1d3b5c'], rim: '#f2fbff', glow: '#6dc8ff', line: '#0a1a2c', fx: 'frost' };
SKINS.colossus = { name: 'Colossus', price: null, season: 2, body: ['#b98cff', '#2a1046'], rim: '#efe2ff', glow: '#a06bff', line: '#12051f', fx: 'star' };
BOARDS.riftgate = { weather: 'stars', name: 'Riftgate', price: null, season: 2, light: '#1f2440', dark: '#151a30', vein: 'rgba(160,107,255,0.08)', frame: '#a06bff', grid: 'rgba(160,107,255,0.14)', wallTop: ['#3a3466', '#28244a'], wallFront: '#1a1730', bg: ['#141a33', '#04050b'], mote: '#c9a6ff' };
FINISHERS.soulfire = { name: 'Soulfire', price: null, season: 2, desc: 'Violet soulflame swallows the piece and carries it skyward.' };
FINISHERS.coronation = { name: 'Coronation', price: null, season: 1, desc: 'A golden crown slams down, then the victim bursts into light.' };

// ---------- 2.0: achievements ----------
// ---------- 5.0: piece mastery ----------
export const MASTERY_MAX = 10;
export const masteryCost = (lv) => 120 + 60 * (lv - 1);          // xp from level lv to lv+1
export const MASTERY_TITLES = { 3: 'Adept', 6: 'Expert', 10: 'Master' };

export const ACHIEVEMENTS = {
  first_win:  { name: 'First Victory', desc: 'Win a match.', stat: 'wins', goal: 1, reward: 100 },
  wins10:     { name: 'Seasoned', desc: 'Win 10 matches.', stat: 'wins', goal: 10, reward: 300 },
  wins50:     { name: 'Grandmaster', desc: 'Win 50 matches.', stat: 'wins', goal: 50, reward: 1000 },
  games25:    { name: 'Regular', desc: 'Play 25 matches.', stat: 'games', goal: 25, reward: 150 },
  kills50:    { name: 'Hunter', desc: 'Eliminate 50 players.', stat: 'kills', goal: 50, reward: 200 },
  kills250:   { name: 'Executioner', desc: 'Eliminate 250 players.', stat: 'kills', goal: 250, reward: 600 },
  squad1:     { name: 'Brothers in Arms', desc: 'Win a Squads match.', stat: 'squadWins', goal: 1, reward: 150 },
  revive5:    { name: 'Lifeline', desc: 'Revive 5 teammates.', stat: 'revives', goal: 5, reward: 200 },
  siege1:     { name: 'The Line Held', desc: 'Survive every wave of Siege.', stat: 'siegeWins', goal: 1, reward: 300 },
  wave5:      { name: 'Wavebreaker', desc: 'Clear 4 waves in one Siege.', stat: 'bestWave', goal: 4, reward: 120 },
  colossus3:  { name: 'Giant Slayer', desc: 'Help topple 3 bosses in Siege or the Gauntlet.', stat: 'colossi', goal: 3, reward: 250 },
  master1:    { name: 'Specialist', desc: 'Reach mastery 10 with any piece.', stat: 'topMastery', goal: 10, reward: 500 },
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
  mythic:    { name: 'Mythic',    color: '#ff4d8d' },
  season:    { name: 'Season',    color: '#5cff9d' },
};
export const RARITY_ORDER = ['common', 'rare', 'epic', 'legendary', 'mythic', 'season'];
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

// ---------- 10.0 cosmetics (A7) ----------
// Optional skin fields for A4: mat, accent, emissive (0..1), pattern. Optional board fields for A5: weather2, fog, tint, light2.
Object.assign(SKINS, {
  rimeguard:  { name: 'Rimeguard',     price: 260,  body: ['#eaf6ff', '#5d86a8'], rim: '#ffffff', glow: '#9fdcff', line: '#1c3044', fx: 'frost', mat: 'crystal', accent: '#cdeeff', emissive: 0.2, pattern: 'cracks' },
  frostking:  { name: 'Frost Court',   price: 1100, body: ['#ffffff', '#3d6fb8'], rim: '#f4fdff', glow: '#7fe8ff', line: '#0c1d3a', fx: 'frost', mat: 'crystal', accent: '#b8f4ff', emissive: 0.55, pattern: 'filigree' },
  brimstone:  { name: 'Brimstone',     price: 560,  body: ['#6b4a3a', '#1a0a06'], rim: '#ffb36b', glow: '#ff6a1f', line: '#ff8a3d', fx: 'ember', mat: 'magma', accent: '#ffd27a', emissive: 0.5, pattern: 'cracks' },
  infernal:   { name: 'Infernal',      price: 1150, body: ['#ff5a2a', '#2a0004'], rim: '#ffe0a0', glow: '#ff3a12', line: '#120000', fx: 'ember', mat: 'magma', accent: '#ffcf4a', emissive: 0.8, pattern: 'runes' },
  halcyon:    { name: 'Halcyon',       price: 280,  body: ['#fff8e8', '#c9b27a'], rim: '#ffffff', glow: '#fff1b8', line: '#6b5a2e', fx: 'glint', mat: 'porcelain', accent: '#ffd76a', emissive: 0.15 },
  seraph:     { name: 'Seraph',        price: 1200, body: ['#ffffff', '#e0c06a'], rim: '#ffffff', glow: '#fff4c0', line: '#8a6a1c', fx: 'glint', mat: 'metal', accent: '#9df3ff', emissive: 0.6, pattern: 'filigree' },
  coral:      { name: 'Coral Reef',    price: 240,  body: ['#ffb09a', '#a8324a'], rim: '#fff0ea', glow: '#ff7a8a', line: '#3a0a14', fx: 'leaf', mat: 'stone', accent: '#3dfff0', pattern: 'veins' },
  tidecaller: { name: 'Tidecaller',    price: 620,  body: ['#7ff0e0', '#0a3a5a'], rim: '#e8fffb', glow: '#3dfff0', line: '#021a26', fx: 'frost', mat: 'glass', accent: '#ffe7a8', emissive: 0.35, pattern: 'scales' },
  mossstone:  { name: 'Mossstone',     price: 140,  body: ['#a3b08a', '#3a4a30'], rim: '#e6f0d6', glow: '#9be36a', line: '#1a2410', fx: 'leaf', mat: 'stone', accent: '#6dff7a', pattern: 'veins' },
  thornwood:  { name: 'Thornwood',     price: 580,  body: ['#8a6a44', '#1e140a'], rim: '#d6ffb0', glow: '#7aff4a', line: '#0e0a04', fx: 'leaf', mat: 'wood', accent: '#ff5a7a', emissive: 0.25, pattern: 'veins' },
  synthwave:  { name: 'Synthwave',     price: 640,  body: ['#2a0a3a', '#0a0214'], rim: '#ffd24d', glow: '#ff3df2', line: '#ff3df2', fx: 'spark', wire: true, mat: 'glass', accent: '#00f0ff', emissive: 0.7, pattern: 'circuit' },
  glitch:     { name: 'Glitchborn',    price: 1050, body: ['#0a1a14', '#000000'], rim: '#ffffff', glow: '#3dff8a', line: '#3dff8a', fx: 'spark', wire: true, mat: 'ethereal', accent: '#ff3d5a', emissive: 0.8, pattern: 'circuit' },
  sandstone:  { name: 'Sandstone',     price: 130,  body: ['#f0d6a0', '#a07a44'], rim: '#fff6e0', glow: '#ffd27a', line: '#4a3418', fx: 'dust', mat: 'stone', accent: '#3dc8ff' },
  pharaoh:    { name: 'Sun Dynasty',   price: 600,  body: ['#2a3a6a', '#0a1028'], rim: '#ffd76a', glow: '#ffcf4a', line: '#ffd76a', fx: 'glint', mat: 'metal', accent: '#3dc8ff', emissive: 0.3, pattern: 'runes' },
  porcelain:  { name: 'Porcelain',     price: 300,  body: ['#ffffff', '#c8d4f0'], rim: '#ffffff', glow: '#5a7aff', line: '#2a3a8a', fx: 'glint', mat: 'porcelain', accent: '#2a4aff', pattern: 'filigree' },
  lacquer:    { name: 'Red Lacquer',   price: 540,  body: ['#ff4a3a', '#5a0408'], rim: '#ffe0a0', glow: '#ffcf4a', line: '#1a0002', fx: 'glint', mat: 'porcelain', accent: '#ffd76a', emissive: 0.1, pattern: 'filigree' },
  ossuary:    { name: 'Ossuary',       price: 520,  body: ['#ede4cc', '#7a6a50'], rim: '#fffaf0', glow: '#9dff9a', line: '#2a2214', fx: 'dust', mat: 'bone', accent: '#5aff7a', emissive: 0.2, pattern: 'cracks' },
  wraith:     { name: 'Wraith',        price: 980,  body: ['#9ab8c8', '#0a1418'], rim: '#e0fff4', glow: '#5affc8', line: '#02100c', fx: 'star', mat: 'ethereal', accent: '#b8ffe8', emissive: 0.65 },
  tempest:    { name: 'Tempest',       price: 600,  body: ['#c8d8ff', '#2a3a6a'], rim: '#ffffff', glow: '#9dc8ff', line: '#0a1430', fx: 'spark', mat: 'metal', accent: '#ffe04d', emissive: 0.4, pattern: 'cracks' },
  brass:      { name: 'Clockwork',     price: 320,  body: ['#e8c07a', '#6a4418'], rim: '#fff0c8', glow: '#ffb347', line: '#2a1806', fx: 'glint', mat: 'metal', accent: '#8ad8c8', pattern: 'filigree' },
  slate:      { name: 'Slate',         price: 120,  body: ['#8a909a', '#2a2e36'], rim: '#e0e6ee', glow: '#b8c8dc', line: '#101318', fx: 'dust', mat: 'stone' },
  rosequartz: { name: 'Rose Quartz',   price: 300,  body: ['#ffd6e4', '#b85a86'], rim: '#ffffff', glow: '#ff9ec0', line: '#4a1430', fx: 'glint', mat: 'crystal', accent: '#ffffff', emissive: 0.25 },
  eclipse:    { name: 'Eclipse',       price: 1800, body: ['#1a0a24', '#000000'], rim: '#ffd76a', glow: '#ff7a1f', line: '#ffcf4a', fx: 'star', mat: 'ethereal', accent: '#ff4d8d', emissive: 0.9, pattern: 'stars' },
  nebula:     { name: 'Nebula',        price: 1900, body: ['#ff9ee8', '#1a0a5a'], rim: '#ffffff', glow: '#c99bff', line: '#0a0428', fx: 'aurora', mat: 'ethereal', accent: '#3dfff0', emissive: 0.85, pattern: 'stars' },
  // Season 3 (Crown Path only)
  regent:     { name: 'Regent',        price: null, season: 3, body: ['#f4f0ff', '#3a2a6a'], rim: '#ffffff', glow: '#ffd76a', line: '#120a2a', fx: 'glint', mat: 'metal', accent: '#ff4d8d', emissive: 0.4, pattern: 'filigree' },
  endgame:    { name: 'Endgame',       price: null, season: 3, body: ['#2a2a30', '#000000'], rim: '#ff4d8d', glow: '#ff4d8d', line: '#ff4d8d', fx: 'star', mat: 'ethereal', accent: '#ffd76a', emissive: 0.75, pattern: 'runes' },
});
Object.assign(BOARDS, {
  frostcourt:   { weather: 'snow', weather2: 'aurora', mat: 'ice', name: 'Frost Court Throne', price: 750, light: '#e4f2fb', dark: '#9ec0d8', vein: 'rgba(60,120,180,0.14)', frame: '#b8f4ff', grid: 'rgba(30,80,130,0.16)', wallTop: ['#ffffff', '#c4dcec'], wallFront: '#7a9ab4', bg: ['#16314a', '#03070c'], mote: '#ffffff', fog: 'rgba(220,240,255,0.10)', light2: '#9df3ff' },
  hellgate:     { weather: 'embers', weather2: 'ash', mat: 'obsidian', name: 'Infernal Gate', price: 800, light: '#3a1410', dark: '#240a08', vein: 'rgba(255,80,20,0.14)', frame: '#ff3a12', grid: 'rgba(255,90,30,0.14)', wallTop: ['#5a1e14', '#3a120c'], wallFront: '#200604', bg: ['#3a0804', '#060100'], mote: '#ff6a1f', lava: true, tint: 'rgba(255,60,0,0.05)', light2: '#ff5a1f' },
  cloudspire:   { weather: 'stars', weather2: 'fog', mat: 'marble', name: 'Celestial Spire', price: 850, light: '#f2eedf', dark: '#c9c0a4', vein: 'rgba(200,170,90,0.14)', frame: '#ffd76a', grid: 'rgba(160,130,60,0.14)', wallTop: ['#ffffff', '#e0d6b8'], wallFront: '#a8986c', bg: ['#4a5a8a', '#0a1028'], mote: '#fff4c0', stars: true, fog: 'rgba(255,255,255,0.08)', light2: '#fff1b8' },
  coralreef:    { weather: 'bubbles', mat: 'coral', name: 'Coral Reef', price: 400, light: '#1a4a54', dark: '#12363e', vein: 'rgba(255,140,140,0.08)', frame: '#ff9a8a', grid: 'rgba(255,154,138,0.12)', wallTop: ['#a8505a', '#7a3440'], wallFront: '#3a1a20', bg: ['#0e3a4a', '#01080c'], mote: '#c8fff6', light2: '#3dfff0' },
  grove:        { weather: 'leaves', weather2: 'fireflies', mat: 'grass', name: 'Thornwood Grove', price: 450, light: '#2a2416', dark: '#1c180e', vein: 'rgba(160,255,120,0.06)', frame: '#7aff4a', grid: 'rgba(122,255,74,0.08)', wallTop: ['#4a3a22', '#33281a'], wallFront: '#1e170c', bg: ['#16200e', '#030502'], mote: '#d6ffb0', fog: 'rgba(120,200,90,0.07)' },
  arcade:       { weather: 'pixels', mat: 'neon', name: 'Synth Arcade', price: 600, light: '#1a0a2a', dark: '#10051c', vein: 'rgba(255,61,242,0.06)', frame: '#ffd24d', grid: 'rgba(255,61,242,0.30)', wallTop: ['#3a145a', '#22093a'], wallFront: '#12041f', bg: ['#2a0a3a', '#05010a'], mote: '#ff3df2', glowGrid: true, light2: '#00f0ff' },
  dunes:        { weather: 'sand', mat: 'sand', name: 'Sun Dynasty Dunes', price: 450, light: '#e8cc94', dark: '#c4a066', vein: 'rgba(120,80,30,0.14)', frame: '#3dc8ff', grid: 'rgba(90,60,20,0.14)', wallTop: ['#f6e0b0', '#c8a46a'], wallFront: '#8a6a3a', bg: ['#6a3a1a', '#0c0602'], mote: '#fff0c8', tint: 'rgba(255,180,80,0.05)' },
  pagoda:       { weather: 'petals', weather2: 'fog', mat: 'wood', name: 'Lacquer Pagoda', price: 500, light: '#3a0c0c', dark: '#280808', vein: 'rgba(255,215,106,0.08)', frame: '#ffd76a', grid: 'rgba(255,215,106,0.12)', wallTop: ['#7a1a14', '#54100c'], wallFront: '#2a0604', bg: ['#2a0808', '#060101'], mote: '#ffd1dc' },
  crypt:        { weather: 'fog', weather2: 'fireflies', mat: 'stone', name: 'Ossuary Crypt', price: 500, light: '#2a2a24', dark: '#1c1c18', vein: 'rgba(160,255,160,0.05)', frame: '#9dff9a', grid: 'rgba(157,255,154,0.08)', wallTop: ['#4a4638', '#33302a'], wallFront: '#1e1c16', bg: ['#141a14', '#020302'], mote: '#9dff9a', fog: 'rgba(120,255,140,0.06)' },
  stormpeak:    { weather: 'rain', weather2: 'fog', mat: 'stone', name: 'Storm Peak', price: 550, light: '#5a6478', dark: '#3e4658', vein: 'rgba(200,220,255,0.08)', frame: '#ffe04d', grid: 'rgba(200,220,255,0.12)', wallTop: ['#7a849a', '#555e72'], wallFront: '#2e3442', bg: ['#1e2638', '#04060a'], mote: '#dce8ff', light2: '#ffe04d' },
  clocktower:   { weather: 'dust', mat: 'metal', name: 'Clocktower', price: 350, light: '#3a2c1c', dark: '#2a1e12', vein: 'rgba(255,200,120,0.07)', frame: '#e8c07a', grid: 'rgba(232,192,122,0.10)', wallTop: ['#5a4428', '#3e2e1a'], wallFront: '#22180c', bg: ['#2a1c0c', '#060402'], mote: '#ffe0a0' },
  eventhorizon: { weather: 'void', weather2: 'stars', mat: 'obsidian', name: 'Event Horizon', price: 1700, light: '#0c0814', dark: '#06040c', vein: 'rgba(255,122,31,0.07)', frame: '#ff7a1f', grid: 'rgba(255,122,31,0.16)', wallTop: ['#24182e', '#140c1c'], wallFront: '#08040c', bg: ['#1a0a1a', '#000000'], mote: '#ffcf4a', stars: true, glowGrid: false, tint: 'rgba(255,100,40,0.04)', light2: '#ff4d8d' },
  zenith:       { weather: 'stars', weather2: 'aurora', mat: 'crystal', name: 'Zenith Observatory', price: null, season: 3, light: '#1e1a3a', dark: '#14102a', vein: 'rgba(255,215,106,0.08)', frame: '#ff4d8d', grid: 'rgba(255,77,141,0.14)', wallTop: ['#3e3266', '#2a2248'], wallFront: '#140f2a', bg: ['#2a1a4a', '#03020a'], mote: '#ffd76a', stars: true, light2: '#ff4d8d' },
});
Object.assign(TRAILS, {
  rime:      { name: 'Rime',            price: 280,  rarity: 'rare',      colors: ['#ffffff', '#cdeeff', '#7fe8ff'], kind: 'spark', g: 0.4, size: 0.04 },
  hellfire:  { name: 'Hellfire',        price: 520,  rarity: 'epic',      colors: ['#ff3a12', '#ffcf4a', '#5a0a04'], kind: 'fire', g: -1.2, size: 0.06 },
  halo:      { name: 'Halo',            price: 520,  rarity: 'epic',      colors: ['#fff4c0', '#ffffff', '#ffd76a'], kind: 'spark', g: -0.6, size: 0.045 },
  bubbles:   { name: 'Bubbles',         price: 160,  rarity: 'common',    colors: ['#c8fff6', '#9dfff6', '#ffffff'], kind: 'dust', g: -0.5, size: 0.04 },
  leaves:    { name: 'Falling Leaves',  price: 260,  rarity: 'rare',      colors: ['#7aff4a', '#c8a03a', '#ff7a3a'], kind: 'chunk', g: 0.8, size: 0.05, floor: true },
  glitch:    { name: 'Glitch',          price: 540,  rarity: 'epic',      colors: ['#3dff8a', '#ff3d5a', '#00f0ff'], kind: 'chunk', g: 0, size: 0.04 },
  sand:      { name: 'Sandstream',      price: 150,  rarity: 'common',    colors: ['#f0d6a0', '#c8a46a', '#fff0c8'], kind: 'dust', g: 0.6, size: 0.03 },
  wisps:     { name: 'Soul Wisps',      price: 560,  rarity: 'epic',      colors: ['#9dff9a', '#5affc8', '#e0fff4'], kind: 'spark', g: -0.9, size: 0.05 },
  static:    { name: 'Static',          price: 300,  rarity: 'rare',      colors: ['#ffe04d', '#9dc8ff', '#ffffff'], kind: 'spark', g: 0, size: 0.03 },
  cogs:      { name: 'Cogwork',         price: 300,  rarity: 'rare',      colors: ['#e8c07a', '#b88a44', '#fff0c8'], kind: 'coin', g: 2, size: 0.045, floor: true },
  hearts:    { name: 'Rosewater',       price: 280,  rarity: 'rare',      colors: ['#ff9ec0', '#ffd6e4', '#ffffff'], kind: 'chunk', g: -0.3, size: 0.045 },
  voidwake:  { name: 'Void Wake',       price: 1000, rarity: 'legendary', colors: ['#b04dff', '#ff4d8d', '#1a0a24'], kind: 'fire', g: -0.4, size: 0.07 },
  supernova: { name: 'Supernova',       price: 1600, rarity: 'mythic',    colors: ['#ffffff', '#ffcf4a', '#ff4d8d', '#3dfff0'], kind: 'spark', g: -0.2, size: 0.06 },
  comet:     { name: 'Comet Tail',      price: null, season: 3, rarity: 'season', colors: ['#ff4d8d', '#ffd76a', '#ffffff'], kind: 'spark', g: -0.1, size: 0.055 },
});
Object.assign(EMOTE_PACKS, {
  tactician: { name: 'Tactician',     price: 180, rarity: 'common', emotes: { fork: 'Fork!', pinned: 'Pinned', zug: 'Zugzwang', passant: 'En passant' } },
  hype:      { name: 'Hype Squad',    price: 220, rarity: 'rare',   emotes: { lets: 'Lets go!', clutch: 'Clutch', unreal: 'Unreal', again: 'Again!' } },
  frostcourt:{ name: 'Frost Court',   price: 320, rarity: 'rare',   emotes: { chill: 'Chill out', cold: 'Ice cold', frozen: 'Frozen solid', winter: 'Winter is here' } },
  infernal:  { name: 'Infernal',      price: 380, rarity: 'epic',   emotes: { burn: 'Burn!', ashes: 'Ashes to ashes', heat: 'Feel the heat', embers: 'Only embers' } },
  celestial: { name: 'Celestial Order', price: 380, rarity: 'epic', emotes: { blessed: 'Blessed', fate: 'Written in the stars', judged: 'Judged', light: 'Into the light' } },
  endgame:   { name: 'Endgame',       price: null, season: 3, rarity: 'season', emotes: { endgame: 'This is the endgame', mate: 'Mate in one', resign: 'Resign?', last: 'Last piece standing' } },
});
for (const p of Object.values(EMOTE_PACKS)) Object.assign(EMOTES, p.emotes);
Object.assign(RARITIES.skin, { warden: 'season', colossus: 'season', regent: 'season', endgame: 'season', slate: 'common', sandstone: 'common', mossstone: 'common', rimeguard: 'rare', halcyon: 'rare', coral: 'rare', porcelain: 'rare', brass: 'rare', rosequartz: 'rare', brimstone: 'epic', tidecaller: 'epic', thornwood: 'epic', synthwave: 'epic', pharaoh: 'epic', lacquer: 'epic', ossuary: 'epic', tempest: 'epic', frostking: 'legendary', infernal: 'legendary', seraph: 'legendary', glitch: 'legendary', wraith: 'legendary', eclipse: 'mythic', nebula: 'mythic' });
Object.assign(RARITIES.board, { riftgate: 'season', zenith: 'season', clocktower: 'rare', coralreef: 'rare', grove: 'rare', dunes: 'rare', pagoda: 'epic', crypt: 'epic', stormpeak: 'epic', arcade: 'epic', frostcourt: 'legendary', hellgate: 'legendary', cloudspire: 'legendary', eventhorizon: 'mythic' });
Object.assign(RARITIES.finisher, { soulfire: 'season', checkmate: 'season', resign: 'rare', sakura: 'rare', riptide: 'rare', cyclone: 'rare', glitch: 'epic', finale: 'epic', reaper: 'epic', phoenix: 'legendary', judgement: 'legendary', supernova: 'legendary' });
// Collections: themed sets. Buy the missing pieces at a discount, and owning every item claims the reward once.
Object.assign(BUNDLES, {
  frost:     { name: 'Frost Court', theme: 'frost', color: '#9df3ff', blurb: 'The winter throne, carved from glacier light.', items: [['skin', 'frostking'], ['skin', 'rimeguard'], ['board', 'frostcourt'], ['trail', 'rime'], ['finisher', 'frozen'], ['emote', 'frostcourt']], off: 0.25, reward: { marks: 300, title: 'Frost Monarch' } },
  hell:      { name: 'Infernal', theme: 'fire', color: '#ff5a1f', blurb: 'Forged below the board, where the storm began.', items: [['skin', 'infernal'], ['skin', 'brimstone'], ['board', 'hellgate'], ['trail', 'hellfire'], ['finisher', 'phoenix'], ['emote', 'infernal']], off: 0.25, reward: { marks: 300, title: 'Hellwarden' } },
  celestial: { name: 'Celestial Order', theme: 'holy', color: '#ffd76a', blurb: 'Gold, light, and a judgement from above.', items: [['skin', 'seraph'], ['skin', 'halcyon'], ['board', 'cloudspire'], ['trail', 'halo'], ['finisher', 'judgement'], ['emote', 'celestial']], off: 0.25, reward: { marks: 300, title: 'Archon' } },
  tide:      { name: 'Drowned Kingdom', theme: 'sea', color: '#3dfff0', blurb: 'A sunken court, rising with the tide.', items: [['skin', 'tidecaller'], ['skin', 'coral'], ['board', 'coralreef'], ['board', 'abyss'], ['trail', 'bubbles'], ['finisher', 'riptide']], off: 0.2, reward: { marks: 200, title: 'Tidelord' } },
  wild:      { name: 'Thornwood', theme: 'wild', color: '#7aff4a', blurb: 'Old roots, sharp thorns, and lights in the dark.', items: [['skin', 'thornwood'], ['skin', 'mossstone'], ['board', 'grove'], ['trail', 'leaves']], off: 0.2, reward: { marks: 200, title: 'Thornkeeper' } },
  synth:     { name: 'Synth Arcade', theme: 'neon', color: '#ff3df2', blurb: 'Insert coin. Press start. Checkmate.', items: [['skin', 'synthwave'], ['skin', 'glitch'], ['skin', 'neon'], ['board', 'arcade'], ['trail', 'glitch'], ['finisher', 'glitch'], ['emote', 'hype']], off: 0.25, reward: { marks: 300, title: 'High Score' } },
  dynasty:   { name: 'Sun Dynasty', theme: 'sand', color: '#3dc8ff', blurb: 'Lapis and gold beneath an endless sun.', items: [['skin', 'pharaoh'], ['skin', 'sandstone'], ['board', 'dunes'], ['trail', 'sand'], ['finisher', 'midas']], off: 0.2, reward: { marks: 200, title: 'Sun King' } },
  lacquer:   { name: 'Lacquer Palace', theme: 'east', color: '#ff4a3a', blurb: 'Red lacquer, porcelain and falling blossoms.', items: [['skin', 'lacquer'], ['skin', 'porcelain'], ['board', 'pagoda'], ['trail', 'petals'], ['finisher', 'sakura'], ['emote', 'tactician']], off: 0.2, reward: { marks: 200, title: 'Dynast' } },
  grave:     { name: 'Hollow Crypt', theme: 'grave', color: '#9dff9a', blurb: 'Where fallen pieces whisper.', items: [['skin', 'ossuary'], ['skin', 'wraith'], ['board', 'crypt'], ['trail', 'wisps'], ['finisher', 'reaper']], off: 0.2, reward: { marks: 250, title: 'Gravecaller' } },
  storm:     { name: 'Storm Front', theme: 'storm', color: '#ffe04d', blurb: 'Thunder on the mountain, steel in the gears.', items: [['skin', 'tempest'], ['skin', 'brass'], ['board', 'stormpeak'], ['board', 'clocktower'], ['trail', 'static'], ['trail', 'cogs'], ['finisher', 'cyclone']], off: 0.25, reward: { marks: 300, title: 'Stormbringer' } },
  cosmos:    { name: 'Cosmic Mythos', theme: 'mythic', color: '#ff4d8d', blurb: 'The rarest light in the sky. Mythic only.', items: [['skin', 'eclipse'], ['skin', 'nebula'], ['board', 'eventhorizon'], ['trail', 'supernova'], ['trail', 'voidwake'], ['finisher', 'supernova']], off: 0.15, reward: { marks: 500, title: 'Mythbearer' } },
});
for (const [k, v] of Object.entries({ inferno: ['fire', '#ff8a3d', 'The original flame.', 150, 'Kindled'], winter: ['frost', '#7fe0ff', 'The first frost of the board.', 150, 'Wintering'], bloom: ['wild', '#ffb7d0', 'Petals on the wind.', 120, 'In Bloom'], regal: ['holy', '#ffcf4a', 'Gold for a king.', 200, 'Treasurer'] })) Object.assign(BUNDLES[k], { theme: v[0], color: v[1], blurb: v[2], reward: { marks: v[3], title: v[4] } });
// ---------- 15.0 cosmetics (S): World Tour ----------
RARITY.royal = { name: 'Royal', color: '#ffd98a' };
RARITY_ORDER.push('royal');
Object.assign(SKINS, {
  // location collections (buyable)
  witchwood:    { name: 'Witchwood',    price: 560,  body: ['#7a8a5a', '#1a2410'], rim: '#e0ffc8', glow: '#a6ff4d', line: '#0a1004', fx: 'leaf', mat: 'wood', accent: '#c77dff', emissive: 0.35, pattern: 'runes' },
  ironclad:     { name: 'Ironclad',     price: 480,  body: ['#9aa0aa', '#2a2e36'], rim: '#ffe0a0', glow: '#ff8a3d', line: '#0a0c10', fx: 'spark', mat: 'metal', accent: '#ffb347', emissive: 0.3, pattern: 'circuit' },
  // Season 4 free lane
  voyager:      { name: 'Voyager',      price: null, season: 4, body: ['#e8d8b0', '#5a4a2e'], rim: '#fff6e0', glow: '#3dc8ff', line: '#2a2010', fx: 'dust', mat: 'metal', accent: '#3dc8ff', emissive: 0.25, pattern: 'filigree' },
  worldwalker:  { name: 'Worldwalker',  price: null, season: 4, body: ['#bfe8ff', '#1a3a5a'], rim: '#ffffff', glow: '#7affc8', line: '#081a2a', fx: 'aurora', mat: 'ethereal', accent: '#ffd76a', emissive: 0.6, pattern: 'stars' },
  // Season 4 Royal Pass
  cartographer: { name: 'Cartographer', price: null, season: 4, royal: true, body: ['#f4e6c4', '#8a6a3a'], rim: '#fffaf0', glow: '#ff4d6d', line: '#3a2410', fx: 'glint', mat: 'porcelain', accent: '#c8343a', emissive: 0.2, pattern: 'runes' },
  stormchaser:  { name: 'Stormchaser',  price: null, season: 4, royal: true, body: ['#a8b8d8', '#1a2238'], rim: '#ffffff', glow: '#9dc8ff', line: '#060a18', fx: 'spark', mat: 'metal', accent: '#ffe04d', emissive: 0.55, pattern: 'cracks' },
  goldleaf:     { name: 'Gold Leaf',    price: null, season: 4, royal: true, body: ['#fff0c0', '#a8781a'], rim: '#ffffff', glow: '#ffd76a', line: '#4a3006', fx: 'glint', mat: 'metal', accent: '#5cff9d', emissive: 0.45, pattern: 'veins' },
  worldcrown:   { name: 'World Crown',  price: null, season: 4, royal: true, body: ['#ffffff', '#4a2a8a'], rim: '#ffe08a', glow: '#ffcf4a', line: '#1a0a3a', fx: 'aurora', mat: 'crystal', accent: '#3dfff0', emissive: 0.85, pattern: 'filigree' },
});
// Location boards: tuned to sit on top of each World Tour backdrop (the location keeps its own weather in a match; these weathers show in the store).
Object.assign(BOARDS, {
  bastion:   { weather: 'snow', mat: 'ice', loc: 'citadel', name: 'Citadel Ramparts', price: 480, light: '#d8e6f0', dark: '#98b0c4', vein: 'rgba(40,80,120,0.14)', frame: '#7fe0ff', grid: 'rgba(30,60,100,0.16)', wallTop: ['#eef6fc', '#b0c6d8'], wallFront: '#6a8298', bg: ['#1c3448', '#04080c'], mote: '#ffffff', light2: '#bff4ff' },
  anvil:     { weather: 'embers', weather2: 'ash', mat: 'obsidian', loc: 'forge', name: 'Anvil Floor', price: 520, light: '#3a2a26', dark: '#241816', vein: 'rgba(255,120,40,0.12)', frame: '#ffb347', grid: 'rgba(255,140,60,0.12)', wallTop: ['#54403a', '#3a2a24'], wallFront: '#1a100c', bg: ['#2a1008', '#060201'], mote: '#ffb347', lava: true, light2: '#ff7a2a' },
  drowned:   { weather: 'rain', weather2: 'bubbles', mat: 'marble', loc: 'temple', name: 'Drowned Altar', price: 500, light: '#3a6a6a', dark: '#245050', vein: 'rgba(180,255,240,0.10)', frame: '#ffd76a', grid: 'rgba(160,255,230,0.12)', wallTop: ['#5a8a84', '#3a6662'], wallFront: '#14302e', bg: ['#0e3434', '#010606'], mote: '#c8fff6', fog: 'rgba(160,255,230,0.06)', light2: '#3dfff0' },
  topiary:   { weather: 'petals', weather2: 'leaves', mat: 'grass', loc: 'gardens', name: 'Topiary Lawn', price: 450, light: '#4a7a3a', dark: '#36602a', vein: 'rgba(255,255,200,0.06)', frame: '#f4f0e0', grid: 'rgba(20,40,10,0.14)', wallTop: ['#6a9a4a', '#4a7434'], wallFront: '#24401a', bg: ['#1e3a1a', '#040802'], mote: '#ffd1dc', light2: '#fff4c0' },
  oasis:     { weather: 'sand', mat: 'sand', loc: 'ruins', name: 'Oasis Court', price: 460, light: '#e4c48c', dark: '#b8925a', vein: 'rgba(60,180,200,0.12)', frame: '#2ab8c8', grid: 'rgba(90,60,20,0.14)', wallTop: ['#f0d8a8', '#c4a06a'], wallFront: '#7a5a30', bg: ['#5a3418', '#0a0502'], mote: '#fff0c8', tint: 'rgba(255,190,90,0.04)', light2: '#3dfff0' },
  foundry:   { weather: 'ash', weather2: 'fog', mat: 'metal', loc: 'works', name: 'Foundry Deck', price: 540, light: '#4a4c52', dark: '#34363c', vein: 'rgba(255,180,80,0.08)', frame: '#ffb347', grid: 'rgba(255,200,120,0.12)', wallTop: ['#6a6c74', '#4a4c54'], wallFront: '#1e2026', bg: ['#202228', '#040405'], mote: '#ffd27a', fog: 'rgba(200,200,210,0.06)', light2: '#ff8a3d' },
  riftveil:  { weather: 'void', weather2: 'stars', mat: 'crystal', loc: 'rift', name: 'Riftveil Dais', price: 650, light: '#221a44', dark: '#16102e', vein: 'rgba(200,120,255,0.10)', frame: '#d6a6ff', grid: 'rgba(214,166,255,0.16)', wallTop: ['#3e2e70', '#2a1e50'], wallFront: '#120a24', bg: ['#1e0e3a', '#020108'], mote: '#e8d0ff', stars: true, light2: '#b04dff' },
  mire:      { weather: 'fog', weather2: 'fireflies', mat: 'grass', loc: 'bog', name: 'Mire Boardwalk', price: 480, light: '#3a3a26', dark: '#28281a', vein: 'rgba(166,255,77,0.07)', frame: '#a6ff4d', grid: 'rgba(166,255,77,0.10)', wallTop: ['#4e4a30', '#363220'], wallFront: '#1a180e', bg: ['#16200e', '#020301'], mote: '#c8ff8a', fog: 'rgba(140,220,90,0.08)' },
  // Season 4 free lane
  atlas:     { weather: 'dust', weather2: 'stars', mat: 'wood', name: 'Atlas Table', price: null, season: 4, light: '#e8d6ac', dark: '#c4aa78', vein: 'rgba(120,70,20,0.16)', frame: '#3dc8ff', grid: 'rgba(80,50,20,0.16)', wallTop: ['#7a5a34', '#5a4024'], wallFront: '#3a2614', bg: ['#2a1c10', '#060402'], mote: '#fff0c8', light2: '#3dc8ff' },
  // Season 4 Royal Pass
  skyharbor: { weather: 'fog', weather2: 'stars', mat: 'marble', royal: true, name: 'Sky Harbor', price: null, season: 4, light: '#e6eef8', dark: '#b4c4dc', vein: 'rgba(60,90,160,0.12)', frame: '#ffd98a', grid: 'rgba(40,70,140,0.14)', wallTop: ['#ffffff', '#c8d6ec'], wallFront: '#8a9ab8', bg: ['#3a5a9a', '#0a1430'], mote: '#ffffff', fog: 'rgba(255,255,255,0.10)', light2: '#ffd98a' },
  mirage:    { weather: 'sand', weather2: 'stars', mat: 'sand', royal: true, name: 'Desert Mirage', price: null, season: 4, light: '#f0c890', dark: '#d09a5a', vein: 'rgba(255,240,200,0.14)', frame: '#c77dff', grid: 'rgba(120,60,20,0.14)', wallTop: ['#f8dcb0', '#d4a46a'], wallFront: '#8a5a30', bg: ['#6a2a4a', '#10040a'], mote: '#ffe8c8', tint: 'rgba(200,120,255,0.04)', light2: '#ff9ee8' },
  worldtree: { weather: 'leaves', weather2: 'fireflies', mat: 'grass', royal: true, name: 'World Tree', price: null, season: 4, light: '#2e3a22', dark: '#202a18', vein: 'rgba(255,217,138,0.10)', frame: '#ffd98a', grid: 'rgba(255,217,138,0.12)', wallTop: ['#5a4a2a', '#3e321c'], wallFront: '#1e180c', bg: ['#1a2a14', '#020401'], mote: '#ffe8a8', fog: 'rgba(255,230,160,0.05)', light2: '#7affc8' },
});
Object.assign(TRAILS, {
  snowdrift: { name: 'Snowdrift',     price: 240, rarity: 'rare',   colors: ['#ffffff', '#e0f4ff', '#bfe8ff'], kind: 'dust', g: 0.5, size: 0.04 },
  cinders:   { name: 'Cinders',       price: 300, rarity: 'rare',   colors: ['#ffb347', '#ff5a1f', '#3a1008'], kind: 'fire', g: -0.8, size: 0.05 },
  raindrops: { name: 'Raindrops',     price: 220, rarity: 'common', colors: ['#bfe8ff', '#7fc8ff', '#ffffff'], kind: 'dust', g: 1.6, size: 0.03, floor: true },
  blossom:   { name: 'Blossom Path',  price: 280, rarity: 'rare',   colors: ['#ffd1dc', '#fff4c0', '#ffffff'], kind: 'chunk', g: 0.3, size: 0.05, floor: true },
  scarab:    { name: 'Scarab Gold',   price: 380, rarity: 'epic',   colors: ['#ffd76a', '#2ab8c8', '#fff0c8'], kind: 'coin', g: 1.4, size: 0.04, floor: true },
  steam:     { name: 'Steam Vent',    price: 260, rarity: 'rare',   colors: ['#e8e8ee', '#b8bcc8', '#ffffff'], kind: 'dust', g: -1.0, size: 0.06 },
  riftspark: { name: 'Rift Sparks',   price: 460, rarity: 'epic',   colors: ['#d6a6ff', '#b04dff', '#ffffff'], kind: 'spark', g: -0.3, size: 0.045 },
  toxic:     { name: 'Toxic Drip',    price: 340, rarity: 'rare',   colors: ['#a6ff4d', '#5aff7a', '#2a4a10'], kind: 'chunk', g: 1.2, size: 0.04, floor: true },
  compass:   { name: 'Compass Needle', price: null, season: 4, rarity: 'season', colors: ['#3dc8ff', '#ff4d6d', '#fff0c8'], kind: 'spark', g: -0.2, size: 0.045 },
  jetstream: { name: 'Jetstream',     price: null, season: 4, royal: true, rarity: 'royal', colors: ['#ffffff', '#bfe8ff', '#ffd98a'], kind: 'dust', g: -0.1, size: 0.05 },
  lanterns:  { name: 'Sky Lanterns',  price: null, season: 4, royal: true, rarity: 'royal', colors: ['#ffb347', '#ffd98a', '#ff7a2a'], kind: 'fire', g: -1.4, size: 0.06 },
  ribbon:    { name: 'Aurora Ribbon', price: null, season: 4, royal: true, rarity: 'royal', colors: ['#7affc8', '#c99bff', '#3dc8ff', '#ffffff'], kind: 'spark', g: -0.5, size: 0.055 },
});
Object.assign(EMOTE_PACKS, {
  citadel:   { name: 'Frost Citadel',  price: 260, rarity: 'rare',   emotes: { holdgate: 'Hold the gate', brr: 'Brr', icewall: 'Walls of ice', thaw: 'Time to thaw' } },
  forgepack: { name: 'Volcanic Forge', price: 260, rarity: 'rare',   emotes: { forged: 'Forged in fire', hammer: 'Hammer time', molten: 'Molten', quench: 'Quenched' } },
  temple:    { name: 'Sunken Temple',  price: 260, rarity: 'rare',   emotes: { tideturn: 'The tide turns', sunk: 'Sunk', deepend: 'Off the deep end', glub: 'Glub glub' } },
  gardens:   { name: 'Royal Gardens',  price: 260, rarity: 'rare',   emotes: { pruned: 'Pruned', fullbloom: 'In full bloom', tea: 'Tea time', hedge: 'Lost in the hedges' } },
  ruins:     { name: 'Desert Ruins',   price: 260, rarity: 'rare',   emotes: { bitedust: 'Bite the dust', relic: 'Ancient history', mirage: 'Was that a mirage?', buried: 'Buried' } },
  works:     { name: 'Iron Works',     price: 260, rarity: 'rare',   emotes: { clank: 'Clank clank', gears: 'Gears turning', overtime: 'Overtime', oiled: 'Well oiled' } },
  riftpack:  { name: 'Astral Rift',    price: 320, rarity: 'epic',   emotes: { warp: 'Warping in', lostspace: 'Lost in space', mindrift: 'Mind the rift', cosmic: 'Cosmic' } },
  bog:       { name: 'Witchwood Bog',  price: 260, rarity: 'rare',   emotes: { croak: 'Croak', toxicx: 'Toxic', swamp: 'Swamp thing', hexed: 'Hexed' } },
  postcards: { name: 'Postcards',      price: null, season: 4, rarity: 'season', emotes: { voyage: 'Bon voyage', wish: 'Wish you were here', arewelost: 'Are we lost?', souvenir: 'Souvenir!' } },
  grandtour: { name: 'Grand Tour',     price: null, season: 4, royal: true, rarity: 'royal', emotes: { royalwave: 'A royal wave', firstclass: 'First class', nextstop: 'Next stop: you', passport: 'Stamp my passport' } },
});
for (const p of Object.values(EMOTE_PACKS)) Object.assign(EMOTES, p.emotes);
Object.assign(RARITIES.skin, { witchwood: 'epic', ironclad: 'epic', voyager: 'season', worldwalker: 'season', cartographer: 'royal', stormchaser: 'royal', goldleaf: 'royal', worldcrown: 'royal' });
Object.assign(RARITIES.board, { bastion: 'epic', anvil: 'epic', drowned: 'epic', topiary: 'rare', oasis: 'rare', foundry: 'epic', riftveil: 'legendary', mire: 'epic', atlas: 'season', skyharbor: 'royal', mirage: 'royal', worldtree: 'royal' });
// Profile banners (the strip behind your name card). Free colours, a season banner from the free lane and Royal Pass banners.
// pattern: stripes | damask | aurora | cracks | stars (drawn with CSS gradients by store.js bannerCss).
export const BANNERS = {
  gold:        { name: 'Gold',            colors: ['#d6b05c', '#4a3410'], price: 0 },
  crimson:     { name: 'Crimson',         colors: ['#ff4d6d', '#4a0814'], price: 0 },
  azure:       { name: 'Azure',           colors: ['#4dabff', '#0a2450'], price: 0 },
  emerald:     { name: 'Emerald',         colors: ['#5cff9d', '#0a3a22'], price: 0 },
  violet:      { name: 'Violet',          colors: ['#c77dff', '#260a44'], price: 0 },
  ember:       { name: 'Ember',           colors: ['#ff8f3d', '#401604'], price: 0 },
  frost:       { name: 'Frost',           colors: ['#bff4ff', '#20506e'], price: 0 },
  slate:       { name: 'Slate',           colors: ['#8a909a', '#16191f'], price: 0 },
  tourflag:    { name: 'Tour Flag',       colors: ['#3dc8ff', '#0a2a40'], accent: '#ffd76a', pattern: 'stripes', price: null, season: 4 },
  royalviolet: { name: 'Royal Violet',    colors: ['#b388ff', '#1e0848'], accent: '#ffd98a', pattern: 'damask', price: null, season: 4, royal: true },
  northern:    { name: 'Northern Lights', colors: ['#14304a', '#060a18'], accent: '#7affc8', pattern: 'aurora', price: null, season: 4, royal: true },
  volcanic:    { name: 'Volcanic',        colors: ['#3a0a04', '#0a0200'], accent: '#ff5a1f', pattern: 'cracks', price: null, season: 4, royal: true },
  starchart:   { name: 'Star Chart',      colors: ['#1a2a5a', '#04050e'], accent: '#ffe8a8', pattern: 'stars', price: null, season: 4, royal: true },
  royalgold:   { name: 'Royal Gold',      colors: ['#ffe08a', '#6a4008'], accent: '#ffffff', pattern: 'damask', price: null, season: 4, royal: true },
  // 18.0 (NE): weekly Season rewards (js/rivals.js SEASON_REWARDS), delivered by the Monday rollover to the cloud save
  season_champion:  { name: 'Season Champion',  colors: ['#ffd166', '#5a3208'], accent: '#fff4c8', pattern: 'stars', price: null, weekly: 'Weekly Season: finish 1st' },
  season_podium:    { name: 'Season Finalist',  colors: ['#e4ebf7', '#3a4660'], accent: '#ffffff', pattern: 'damask', price: null, weekly: 'Weekly Season: finish top 3' },
  season_elite:     { name: 'Season Elite',     colors: ['#c49bff', '#2a1458'], accent: '#ffd98a', pattern: 'stripes', price: null, weekly: 'Weekly Season: finish top 10' },
  season_contender: { name: 'Season Contender', colors: ['#7fb7ff', '#10264a'], accent: '#cfe4ff', pattern: 'stripes', price: null, weekly: 'Weekly Season: finish top 50' },
  // 18.1 (L3): weekly co-op season rewards (js/warden.js WSEASON_REWARDS), same inbox delivery
  warden_champion:  { name: 'Lord of the Keep', colors: ['#c6f27a', '#1d3a10'], accent: '#f4ffd8', pattern: 'runes', price: null, weekly: 'Weekly Co-op Season: finish 1st' },
  warden_podium:    { name: 'Keepwarden',       colors: ['#8fe0c8', '#123a32'], accent: '#e2fff6', pattern: 'filigree', price: null, weekly: 'Weekly Co-op Season: finish top 3' },
  warden_elite:     { name: 'Wavebreaker',      colors: ['#7ec8f2', '#0f2c44'], accent: '#d9f1ff', pattern: 'veins', price: null, weekly: 'Weekly Co-op Season: finish top 10' },
  warden_contender: { name: 'Hollowbane',       colors: ['#b9c2b0', '#2a3028'], accent: '#eef3e8', pattern: 'cracks', price: null, weekly: 'Weekly Co-op Season: finish top 50' },
};
export const DEFAULT_BANNERS = ['gold', 'crimson', 'azure', 'emerald', 'violet', 'ember', 'frost', 'slate'];
// World Tour collections: one per location. Items whose art is not in this build yet are skipped until they ship.
Object.assign(BUNDLES, {
  t_citadel: { name: 'Frost Citadel', tour: 'citadel', theme: 'frost', color: '#7fe0ff', blurb: 'Hold the walls through the blizzard.', items: [['skin', 'rimeguard'], ['board', 'bastion'], ['trail', 'snowdrift'], ['emote', 'citadel'], ['finisher', 'frozen']], off: 0.2, reward: { marks: 200, title: 'Gatekeeper' } },
  t_forge:   { name: 'Volcanic Forge', tour: 'forge', theme: 'fire', color: '#ffb347', blurb: 'Where the lava runs and the anvils ring.', items: [['skin', 'brimstone'], ['board', 'anvil'], ['trail', 'cinders'], ['emote', 'forgepack'], ['finisher', 'inferno']], off: 0.2, reward: { marks: 200, title: 'Forgeborn' } },
  t_temple:  { name: 'Sunken Temple', tour: 'temple', theme: 'sea', color: '#3dfff0', blurb: 'Rain on old stone and a flood on the rise.', items: [['skin', 'tidecaller'], ['board', 'drowned'], ['trail', 'raindrops'], ['emote', 'temple'], ['finisher', 'riptide']], off: 0.2, reward: { marks: 200, title: 'High Priest' } },
  t_gardens: { name: 'Royal Gardens', tour: 'gardens', theme: 'wild', color: '#ffd1dc', blurb: 'Hedges, petals and the King\'s own lawn.', items: [['skin', 'halcyon'], ['board', 'topiary'], ['trail', 'blossom'], ['emote', 'gardens'], ['finisher', 'sakura']], off: 0.2, reward: { marks: 200, title: 'Head Gardener' } },
  t_ruins:   { name: 'Desert Ruins', tour: 'ruins', theme: 'sand', color: '#2ab8c8', blurb: 'Sand over gold, and something stirring under it.', items: [['skin', 'sandstone'], ['board', 'oasis'], ['trail', 'scarab'], ['emote', 'ruins'], ['finisher', 'cyclone']], off: 0.2, reward: { marks: 200, title: 'Tomb Raider' } },
  t_works:   { name: 'Iron Works', tour: 'works', theme: 'storm', color: '#ff8a3d', blurb: 'Steam, gears and the war drums of industry.', items: [['skin', 'ironclad'], ['board', 'foundry'], ['trail', 'steam'], ['emote', 'works'], ['finisher', 'lightning']], off: 0.2, reward: { marks: 200, title: 'Foreman' } },
  t_rift:    { name: 'Astral Rift', tour: 'rift', theme: 'mythic', color: '#d6a6ff', blurb: 'The board is thin here. Mind the gaps.', items: [['skin', 'voidborn'], ['board', 'riftveil'], ['trail', 'riftspark'], ['emote', 'riftpack'], ['finisher', 'voidrift']], off: 0.2, reward: { marks: 250, title: 'Riftwalker' } },
  t_bog:     { name: 'Witchwood Bog', tour: 'bog', theme: 'grave', color: '#a6ff4d', blurb: 'Fog, poison pools and the restless dead.', items: [['skin', 'witchwood'], ['board', 'mire'], ['trail', 'toxic'], ['emote', 'bog'], ['finisher', 'reaper']], off: 0.2, reward: { marks: 200, title: 'Bog Witch' } },
});
// Daily login streak: day N of a 7-day cycle (the cycle repeats; day 7 is the big one).
export const LOGIN_REWARDS = [{ marks: 40 }, { marks: 50 }, { marks: 60 }, { marks: 80 }, { marks: 100 }, { marks: 120 }, { marks: 250, xp: 250 }];
// 10.0 trophies. cat groups them on the Trophies screen. Stats marked (computed) are derived in progression.js.
Object.assign(ACHIEVEMENTS, {
  games100:    { name: 'Centurion', desc: 'Play 100 matches.', stat: 'games', goal: 100, reward: 400 },
  wins100:     { name: 'Immortal', desc: 'Win 100 matches.', stat: 'wins', goal: 100, reward: 1500 },
  kills1000:   { name: 'Reaper', desc: 'Eliminate 1,000 players.', stat: 'kills', goal: 1000, reward: 1200 },
  crowns25:    { name: 'Kingmaker', desc: 'Claim the Crown 25 times.', stat: 'crowns', goal: 25, reward: 500 },
  ults100:     { name: 'Grand Finale', desc: 'Use 100 ultimates.', stat: 'ults', goal: 100, reward: 400 },
  squad10:     { name: 'Band of Brothers', desc: 'Win 10 Squads matches.', stat: 'squadWins', goal: 10, reward: 500 },
  siege5:      { name: 'Unbreakable Wall', desc: 'Win 5 Siege matches.', stat: 'siegeWins', goal: 5, reward: 600 },
  revive25:    { name: 'Second Wind', desc: 'Revive 25 teammates.', stat: 'revives', goal: 25, reward: 400 },
  colossus10:  { name: 'Titanfall', desc: 'Help topple 10 bosses in Siege or the Gauntlet.', stat: 'colossi', goal: 10, reward: 500 },
  blitz10:     { name: 'Bullet Chess', desc: 'Win 10 Blitz matches.', stat: 'blitzWins', goal: 10, reward: 400 },
  explorer:    { name: 'Explorer', desc: 'Play every game mode at least once.', stat: 'modesPlayed', goal: 'modes', reward: 300 },
  grandtour:   { name: 'Grand Tour', desc: 'Win in 5 different game modes.', stat: 'modesWon', goal: 5, reward: 600 },
  mastery3:    { name: 'Polymath', desc: 'Reach mastery 10 with 3 different pieces.', stat: 'mastered', goal: 3, reward: 800 },
  allround:    { name: 'Well Rounded', desc: 'Reach mastery 5 with every piece.', stat: 'minMastery', goal: 5, reward: 500 },
  collection1: { name: 'Curator', desc: 'Complete a Collection.', stat: 'collections', goal: 1, reward: 200 },
  collection5: { name: 'Museum Piece', desc: 'Complete 5 Collections.', stat: 'collections', goal: 5, reward: 800 },
  hoard30:     { name: 'Hoarder', desc: 'Own 30 cosmetics.', stat: 'cosmetics', goal: 30, reward: 500 },
  hoard60:     { name: 'Dragon\'s Hoard', desc: 'Own 60 cosmetics.', stat: 'cosmetics', goal: 60, reward: 1200 },
  mythic1:     { name: 'Mythmaker', desc: 'Own a Mythic item.', stat: 'mythics', goal: 1, reward: 300 },
  streak7:     { name: 'Devoted', desc: 'Log in 7 days in a row.', stat: 'bestLogin', goal: 7, reward: 300 },
  streak30:    { name: 'Unwavering', desc: 'Log in 30 days in a row.', stat: 'bestLogin', goal: 30, reward: 1000 },
  season3:     { name: 'The Endgame', desc: 'Reach tier 40 of the Season 3 Crown Path.', stat: 'season3Tier', goal: 40, reward: 1000 },
  veteranS:    { name: 'Old Guard', desc: 'Play in two different seasons.', stat: 'seasonsPlayed', goal: 2, reward: 250 },
  daily14:     { name: 'Fortnight', desc: 'Play the Daily Challenge on 14 different days.', stat: 'dailyDays', goal: 14, reward: 400 },
  level30:     { name: 'Paragon', desc: 'Reach level 30.', stat: 'level', goal: 30, reward: 800 },
  wishlist:    { name: 'Window Shopper', desc: 'Add an item to your wishlist.', stat: 'wished', goal: 1, reward: 50 },
});
export const ACH_CATS = { combat: 'Combat', modes: 'Modes', mastery: 'Mastery', collection: 'Collection', dedication: 'Dedication' };
export const ACH_CAT = { wins: 'combat', kills: 'combat', crowns: 'combat', ults: 'combat', hardWins: 'combat', flawless: 'combat', queens: 'combat', hollows: 'combat', shardsTotal: 'combat', bestStreak: 'combat', squadWins: 'modes', siegeWins: 'modes', revives: 'modes', bestWave: 'modes', colossi: 'modes', blitzWins: 'modes', duelWins: 'modes', modesPlayed: 'modes', modesWon: 'modes', topMastery: 'mastery', mastered: 'mastery', minMastery: 'mastery', discoveries: 'mastery', tutorialDone: 'mastery', cosmetics: 'collection', collections: 'collection', mythics: 'collection', wished: 'collection', games: 'dedication', dailyDays: 'dedication', level: 'dedication', bestLogin: 'dedication', seasonTier: 'dedication', seasonsPlayed: 'dedication' };
// ---------- 15.0 trophies (S): status effects, the boss King, the World Tour, Ascension, the pawn line and parties ----------
Object.assign(ACHIEVEMENTS, {
  status50:    { name: 'Afflicter', desc: 'Inflict 50 status effects on other pieces.', stat: 'statusApplied', goal: 50, reward: 200 },
  status500:   { name: 'Plaguebringer', desc: 'Inflict 500 status effects on other pieces.', stat: 'statusApplied', goal: 500, reward: 800 },
  regicide1:   { name: 'Regicide', desc: 'Land the final blow on the boss King.', stat: 'regicides', goal: 1, reward: 300 },
  regicide10:  { name: 'Kingsbane', desc: 'Topple the boss King 10 times.', stat: 'regicides', goal: 10, reward: 800 },
  tour4:       { name: 'Tourist', desc: 'Play at 4 different World Tour locations.', stat: 'locations', goal: 4, reward: 200 },
  tour8:       { name: 'Globetrotter', desc: 'Play at all 8 World Tour locations.', stat: 'locations', goal: 8, reward: 600 },
  ascend1:     { name: 'Ascendant', desc: 'Ascend a piece by honing it to level 3.', stat: 'ascensions', goal: 1, reward: 200 },
  ascend25:    { name: 'Transcendent', desc: 'Ascend 25 pieces.', stat: 'ascensions', goal: 25, reward: 600 },
  champion1:   { name: 'People\'s Champion', desc: 'Promote a pawn all the way to Champion.', stat: 'champions', goal: 1, reward: 250 },
  championWin: { name: 'The Long March', desc: 'Win a match as a Champion pawn.', stat: 'championWins', goal: 1, reward: 500 },
  party10:     { name: 'Party Animal', desc: 'Play 10 matches in a party.', stat: 'partyGames', goal: 10, reward: 250 },
  party50:     { name: 'Life of the Party', desc: 'Play 50 matches in a party.', stat: 'partyGames', goal: 50, reward: 700 },
  season4:     { name: 'Tour de Force', desc: 'Reach tier 40 of the Season 4 Crown Path.', stat: 'season4Tier', goal: 40, reward: 1000 },
  arsenal:     { name: 'Arsenal', desc: 'Unlock 10 abilities.', stat: 'unlocks', goal: 10, reward: 400 },
});
ACH_CATS.tour = 'World Tour';
Object.assign(ACH_CAT, { statusApplied: 'combat', regicides: 'combat', ascensions: 'mastery', champions: 'mastery', championWins: 'mastery', unlocks: 'mastery', locations: 'tour', partyGames: 'tour', season4Tier: 'tour', season3Tier: 'dedication' });
// 15.0 daily quests (S). stat = the main.js match-stat key (this.ms) they read.
Object.assign(QUESTS, {
  statuses: { text: 'Inflict 5 status effects', goal: 5, reward: 90, stat: 'statuses' },
  regicide: { text: 'Land a hit on the boss King', goal: 1, reward: 100, stat: 'kingHits' },
  ascend:   { text: 'Ascend a piece', goal: 1, reward: 110, stat: 'ascended' },
  pawnline: { text: 'Promote a pawn to Veteran', goal: 1, reward: 90, stat: 'veteran' },
});
