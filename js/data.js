// Chess Complex — static game data
export const SIZE = 16;
export const MAX_PLAYERS = 8;
export const TURN_MS = 30000;

export const PIECES = {
  pawn:   { name: 'Pawn',   tier: 1, hp: 60,  atk: 10, def: 5,  spd: 10, attack: 'pawnStrike', sig: 'shove',     equips: ['sprint', 'digin', 'pickpocket'],
            moveDesc: 'Steps 1 tile in any direction.' },
  knight: { name: 'Knight', tier: 2, hp: 90,  atk: 16, def: 8,  spd: 12, attack: 'tstrike',    sig: 'vault',     equips: ['trample', 'stagger', 'rally'],
            moveDesc: 'L-shaped jump. Ignores anything in the way.' },
  bishop: { name: 'Bishop', tier: 2, hp: 80,  atk: 14, def: 6,  spd: 11, attack: 'ray',        sig: 'transpose', equips: ['sanctuary', 'cross', 'blink'],
            moveDesc: 'Slides diagonally up to 4 tiles.' },
  rook:   { name: 'Rook',   tier: 3, hp: 140, atk: 18, def: 14, spd: 7,  attack: 'slam',       sig: 'charge',    equips: ['rampart', 'fortify', 'siege'],
            moveDesc: 'Slides straight up to 4 tiles.' },
  queen:  { name: 'Queen',  tier: 4, hp: 120, atk: 22, def: 10, spd: 10, attack: 'starburst',  sig: 'decree',    equips: ['dominion', 'execute', 'checkmate'],
            moveDesc: 'Slides any direction up to 5 tiles.' },
  king:   { name: 'King',   tier: 5, hp: 0,   atk: 0,  def: 0,  spd: 0,  attack: 'royalStrike', sig: 'royalGuard', equips: [],
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
  tstrike:     { name: 'T-Strike',      cd: 0, desc: 'T-shaped blow: the tile ahead plus a 3-wide crossbar behind it.' },
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
  tank:     { name: 'Tank',     pts: { hp: 5, atk: 0, def: 5, spd: 0 }, passive: 'regen',     blurb: 'Outlast everyone.' },
  assassin: { name: 'Assassin', pts: { hp: 0, atk: 6, def: 0, spd: 4 }, passive: 'first',     blurb: 'Delete anyone at full health.' },
};

export const PLAYER_COLORS = ['#ff4d6d', '#4dabff', '#ffd24d', '#5cff9d', '#c77dff', '#ff8f3d', '#3dfff0', '#ff6ad5'];

export const SKINS = {
  ivory:    { name: 'Ivory',        price: 0,   body: ['#fbf4e2', '#b3a383'], rim: '#fffaf0', glow: '#ffe7a8', line: '#6b5d45', fx: 'dust' },
  obsidian: { name: 'Obsidian',     price: 0,   body: ['#4a4466', '#0e0c16'], rim: '#a59bea', glow: '#7f6bff', line: '#05040a', fx: 'dust' },
  ember:    { name: 'Ember',        price: 150, body: ['#ffa25c', '#6e1404'], rim: '#ffe0b0', glow: '#ff5a1f', line: '#2a0700', fx: 'ember' },
  glacier:  { name: 'Glacier',      price: 150, body: ['#e8fbff', '#3b7aa3'], rim: '#ffffff', glow: '#7fe0ff', line: '#163246', fx: 'frost' },
  verdant:  { name: 'Verdant',      price: 200, body: ['#b4f09f', '#1b4f27'], rim: '#efffe6', glow: '#6dff7a', line: '#0b2411', fx: 'leaf' },
  neon:     { name: 'Neon Circuit', price: 450, body: ['#24123d', '#08040f'], rim: '#ff3df2', glow: '#00f0ff', line: '#00f0ff', fx: 'spark', wire: true },
  gilded:   { name: 'Gilded',       price: 500, body: ['#fff0b8', '#9b6a12'], rim: '#fffbe6', glow: '#ffcf4a', line: '#4a3006', fx: 'glint' },
  voidborn: { name: 'Voidborn',     price: 750, body: ['#2a0a3a', '#000000'], rim: '#d6a6ff', glow: '#b04dff', line: '#000000', fx: 'star' },
};
export const DEFAULT_SKINS = ['ivory', 'obsidian'];

export const HOLLOW_STATS = { hp: 45, atk: 9, def: 4, spd: 8 };
