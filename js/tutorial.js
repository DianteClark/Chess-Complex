// Guided tutorial lessons. Each step can set up the arena, mark tiles, glow UI, and wait for an objective.
import { spawnDummy, unitAt, canStand, ARENA, stats } from './engine.js';

const KN = [[1, 2], [2, 1], [-1, 2], [-2, 1], [1, -2], [2, -1], [-1, -2], [-2, -1]];
const inArena = (x, y) => x >= ARENA.x0 && x <= ARENA.x1 && y >= ARENA.y0 && y <= ARENA.y1;

// helpers available to steps as `c`
function helpers(ctl) {
  const c = {
    get s() { return ctl.host.s; },
    get me() { return ctl.host.s.units.find((u) => u.pid === 'me'); },
    fresh() { const s = ctl.host.s; s.active = c.me.id; s.turn = { moved: false, acted: false, extraMoves: 0, rooted: false }; },
    clear() { const s = ctl.host.s; s.units = s.units.filter((u) => u.kind === 'player'); s.items = []; for (let y = ARENA.y0; y <= ARENA.y1; y++) for (let x = ARENA.x0; x <= ARENA.x1; x++) s.tiles[y * 16 + x] = { t: 'floor' }; s.storm = { ring: 0, crack: false }; },
    place(x, y) { const m = c.me; m.x = x; m.y = y; },
    reset(piece = 'pawn', x = 6, y = 8) { const m = c.me; m.piece = piece; m.hp = stats(m).maxHp; m.cd = { sig: 0, eq: 0 }; m.buffs = []; c.place(x, y); },
    dummy(x, y, hp = 40) { return spawnDummy(ctl.host.s, x, y, hp); },
    item(x, y, k = 'shard', n = 1) { ctl.host.s.items.push({ x, y, k, n }); },
    tile(x, y, t, extra = {}) { ctl.host.s.tiles[y * 16 + x] = { t, ...extra }; },
    dummies() { return ctl.host.s.units.filter((u) => u.dummy && u.alive); },
    ev: (ev, f) => ev.some(f),
    t: ctl.track,
    pub() { setTimeout(() => { if (!ctl.dead) ctl.host.publish([]); }, 0); },
  };
  return c;
}

export const LESSONS = [
  {
    id: 'basics', name: 'First Steps', blurb: 'Moving, turns, shards and attunement.',
    start(c) { c.clear(); c.reset('pawn', 5, 9); },
    steps: [
      { say: 'Welcome to Chess Complex. I am the Grandmaster, and I will teach you to survive the board. Every match, everyone starts as a lowly Pawn. Including you.', next: true },
      { say: 'Your Pawn steps one tile in any direction. Tap the glowing tile to move there.', obj: 'Move to the glowing tile', mark: () => [{ x: 6, y: 8 }], check: (c) => c.me.x === 6 && c.me.y === 8 },
      { say: 'Each turn you get one move and one action, in either order. When you are done, end your turn.', obj: 'End your turn', glow: '[data-slot=end]', check: (c) => c.t.turns >= 1 },
      { say: 'Turn order runs on SPD. The strip at the top shows who acts next. Faster pieces get more turns, so speed is a real stat here.', glow: '#h-order', next: true },
      { say: 'See those cyan crystals? Promotion Shards. Walk onto them to collect them. It may take a couple of turns.', obj: 'Collect 2 shards', setup: (c) => { c.item(7, 7); c.item(8, 8); c.fresh(); }, mark: () => [{ x: 7, y: 7 }, { x: 8, y: 8 }], check: (c) => (c.me.attune || 0) >= 2 },
      { say: 'Every shard you collect also attunes you: a little more HP, ATK and DEF for the rest of the match. You spend shards to evolve, but attunement stays. Keep collecting all game.', glow: '#h-attune', next: true },
    ],
  },
  {
    id: 'combat', name: 'Combat', blurb: 'Attacking, previews, signatures and collisions.',
    start(c) { c.clear(); c.reset('pawn', 6, 8); },
    steps: [
      { say: 'Time to fight. Pawns strike diagonally. I have placed a training dummy for you.', setup: (c) => { c.dummy(c.me.x + 1, c.me.y - 1, 70); c.fresh(); }, next: true },
      { say: 'Tap Attack, then tap the dummy. The first tap previews the damage. Tap again to confirm.', obj: 'Strike the dummy', glow: '[data-slot=atk]', mark: (c) => c.dummies().map((d) => ({ x: d.x, y: d.y })), check: (c, ev) => c.ev(ev, (e) => e.e === 'dmg' && e.src === c.me.id) },
      { say: 'Every piece has a Signature. The Pawn\'s is Shove: push a piece away. Slam it into a wall or another piece for bonus damage. Shove the dummy into that wall.', obj: 'Shove the dummy into the wall', glow: '[data-slot=sig]',
        setup: (c) => { c.clear(); c.reset('pawn', 6, 8); c.dummy(7, 8, 70); c.tile(8, 8, 'wall'); c.fresh(); }, mark: () => [{ x: 7, y: 8 }], check: (c, ev) => c.ev(ev, (e) => e.e === 'impact') },
      { say: 'Crunch. Collisions hurt. Now finish it. Remember, Pawns strike diagonally, so step into position first.', obj: 'Defeat the dummy', glow: (c) => (c.s.turn && c.s.turn.acted ? '[data-slot=end]' : '[data-slot=atk]'), setup: (c) => { const d = c.dummies()[0]; if (d) d.hp = Math.min(d.hp, 18); }, check: (c) => c.dummies().length === 0 },
      { say: 'Every piece you defeat drops all the shards it was carrying. In a real match, hunting is how you grow.', next: true },
    ],
  },
  {
    id: 'evolve', name: 'Evolution', blurb: 'Promoting, the Knight, free actions and attack shapes.',
    start(c) { c.clear(); c.reset('pawn', 6, 8); c.me.shards = 3; },
    steps: [
      { say: 'You are carrying 3 shards, and a Knight costs 2. Tap Promote and choose the Knight. Promoting never costs your action.', obj: 'Evolve into a Knight', glow: '[data-slot=promote]', setup: (c) => { c.me.shards = Math.max(3, c.me.shards); c.fresh(); },
        check: (c) => { if (c.me.piece === 'bishop' || c.me.piece === 'rook') { c.reset('pawn', c.me.x, c.me.y); c.me.shards = 3; c.fresh(); c.pub(); } return c.me.piece === 'knight'; } }, // wrong pick: back to Pawn to try again
      { say: 'Knights jump in an L and ignore anything in the way. Their Signature, Vault, is a free action that grants a second jump.', next: true },
      { say: 'Use Vault, then make two jumps this turn.', obj: 'Vault, then jump twice', glow: '[data-slot=sig]', setup: (c) => { c.me.cd.sig = 0; c.fresh(); }, check: (c) => c.t.vaulted && c.t.moves >= 2 },
      { say: 'The Knight\'s attack, T-Strike, hits the tile ahead plus a 3-wide crossbar just beyond it. Line it up and hit both dummies at once.', obj: 'Hit 2 dummies with one T-Strike', glow: '[data-slot=atk]',
        setup: (c) => {
          c.clear(); c.reset('knight', 7, 10); c.fresh();
          c.dummy(7, 9, 60); c.dummy(8, 8, 60);
        }, mark: (c) => c.dummies().map((d) => ({ x: d.x, y: d.y })), check: (c, ev) => ev.filter((e) => e.e === 'dmg' && e.src === c.me.id).length >= 2 },
      { say: 'Later you can evolve into a Rook, then a Queen. Or Hone your current piece instead: +15% stats and an upgraded Signature, up to three times, and the third Hone Ascends it with a new passive and an empowered ultimate. Love the Knight? Stay a Knight. Love the Pawn? The Veteran and the Champion keep you a Pawn to the very end.', next: true },
    ],
  },
  {
    id: 'ultimate', name: 'Ultimates', blurb: 'Charging and unleashing your ultimate.',
    start(c) { c.clear(); c.reset('knight', 6, 8); },
    steps: [
      { say: 'Dealing and taking damage charges your ultimate, the gold button. I have filled yours.', glow: '#ult-btn', setup: (c) => { c.me.ult = 100; c.fresh(); }, next: true },
      { say: 'The Knight\'s ultimate, Fork, jumps and then hits every square a knight could reach from the landing. Land on the marked tile to catch every dummy.', obj: 'Unleash Fork', glow: '#ult-btn',
        setup: (c) => {
          c.me.ult = 100; c.fresh();
          const L = { x: 7, y: 10 };
          let n = 0;
          for (const [dx, dy] of KN) { const x = L.x + dx, y = L.y + dy; if (n < 4 && inArena(x, y) && canStand(c.s, x, y) && !(x === c.me.x && y === c.me.y)) { c.dummy(x, y, 50); n++; } }
          c.t.landing = L;
        }, mark: (c) => [c.t.landing || { x: 7, y: 10 }], check: (c, ev) => c.ev(ev, (e) => e.e === 'ability' && e.slot === 'ult' && e.id === c.me.id) },
      { say: 'Every piece has its own ultimate. Save it for the right moment: a crowd, a wounded enemy, or a Blood Moon round when all damage is boosted.', next: true },
    ],
  },
  {
    id: 'hazards', name: 'The Board', blurb: 'Storm, terrain, world events and the Crown.',
    start(c) { c.clear(); c.reset('knight', 7, 8); },
    steps: [
      { say: 'The board fights back. From round 5 the outer ring cracks, then falls into the void a round later, and the storm closes in again every 3 rounds. The void burns 20% of your max HP a turn. You can still move if you get caught, so get out fast. These red tiles are cracking now.', setup: (c) => { c.s.storm = { ring: 4, crack: true }; c.fresh(); }, next: true },
      { say: 'Walls block movement and shots. Rubble and crates break when hit. Brambles stop slides and cost you initiative. Shrines heal 40% once, then recharge.', setup: (c) => { c.s.storm = { ring: 0, crack: false }; c.tile(9, 7, 'wall'); c.tile(9, 8, 'wall'); c.tile(5, 6, 'rubble', { hp: 2 }); c.tile(10, 10, 'crate', { hp: 1 }); c.tile(5, 10, 'bramble'); c.tile(9, 10, 'shrine', { cd: 0 }); }, mark: () => [{ x: 9, y: 7, label: 'Wall' }, { x: 5, y: 6, label: 'Rubble' }, { x: 10, y: 10, label: 'Crate' }, { x: 5, y: 10, label: 'Bramble' }, { x: 9, y: 10, label: 'Shrine' }], next: true },
      { say: 'Every third round a world event hits, such as Shard Rain, a Meteor Storm, a Blood Moon or a Supply Drop. A supply cache just landed. Break it open with T-Strike. This one takes two hits, so end your turn between them.', obj: 'Break open the cache', glow: (c) => (c.s.turn && c.s.turn.acted ? '[data-slot=end]' : '[data-slot=atk]'),
        setup: (c) => { c.clear(); c.reset('knight', 7, 9); c.tile(7, 8, 'chest', { hp: 2 }); c.fresh(); }, mark: () => [{ x: 7, y: 8 }], check: (c, ev) => c.ev(ev, (e) => e.e === 'chest' && e.broke) },
      { say: 'A round before the Crown appears, a gold marker shows where it will land, and whoever stands there first wins it. The King is a raid boss: a huge HP pool, a royal aura that slows rivals, and a shockwave each time it drops a third of its health. But every different attacker that hits it strips its armour, so rivals will team up against you. If the King falls, the Crown shatters into 4 shards. Go on, take it.', obj: 'Claim the Crown',
        setup: (c) => { c.clear(); c.reset('knight', 6, 9); c.item(7, 7, 'crown'); c.fresh(); }, mark: () => [{ x: 7, y: 7 }], check: (c) => c.me.piece === 'king' },
      { say: 'That is the core of it. One more lesson covers hazard themes, the Throne and Siege, or you can jump straight into the Graduation match.', next: true },
    ],
  },
  {
    id: 'frontier', name: 'New Ground', blurb: 'Hazard themes, the Throne and Siege Hollows.',
    start(c) { c.clear(); c.reset('knight', 7, 8); },
    steps: [
      { say: 'Some boards roll a hazard theme. This is a geyser vent, and the steam means it erupts at the end of the round: it scalds the vent and the four tiles beside it, and throws whoever stands on it. You are standing on it. Jump clear.', obj: 'Get clear of the geyser',
        setup: (c) => { c.clear(); c.reset('knight', 7, 8); c.tile(7, 8, 'geyser', { ph: 2 }); c.fresh(); }, mark: () => [{ x: 7, y: 8, label: 'Geyser' }],
        check: (c) => Math.abs(c.me.x - 7) + Math.abs(c.me.y - 8) > 1 },
      { say: 'Cracked floor holds the first step and gives way under the second, leaving a pit. Conveyor tracks carry anything on them one tile at the end of every round. Use both to put enemies where you want them.',
        setup: (c) => { c.clear(); c.reset('knight', 6, 9); c.tile(8, 9, 'crumble', { hp: 2 }); c.tile(9, 9, 'crumble', { hp: 1 }); for (let x = 5; x <= 9; x++) c.tile(x, 6, 'conveyor', { dx: 1, dy: 0 }); c.fresh(); },
        mark: () => [{ x: 9, y: 9, label: 'Cracked' }, { x: 7, y: 6, label: 'Conveyor' }], next: true },
      { say: 'In King of the Hill the golden Throne sits at the centre. Start your turn on it for 2 points, or 1 if an enemy shares it. First to 10 wins. Step onto the Throne.', obj: 'Step onto the Throne',
        setup: (c) => { c.clear(); c.reset('pawn', 5, 10); for (let y = 6; y <= 9; y++) for (let x = 6; x <= 9; x++) c.tile(x, y, 'throne'); c.fresh(); },
        mark: () => [{ x: 6, y: 9 }], check: (c) => { const t = c.s.tiles[c.me.y * 16 + c.me.x]; return !!t && t.t === 'throne'; } },
      { say: 'In Siege and the Gauntlet, Hollows come in waves and hunt you: fast Stalkers, Hexers that shoot from range, Splitters that burst into Mites, and Brutes behind a shield. A shield soaks damage until it breaks. Break this one.', obj: 'Break the shield', glow: (c) => (c.s.turn && c.s.turn.acted ? '[data-slot=end]' : '[data-slot=atk]'),
        setup: (c) => { c.clear(); c.reset('knight', 7, 10); const d = c.dummy(7, 9, 60); d.shield = 10; d.shieldMax = 10; d.role = 'brute'; d.name = 'Brute'; c.fresh(); },
        mark: (c) => c.dummies().map((d) => ({ x: d.x, y: d.y })), check: (c, ev) => c.ev(ev, (e) => e.e === 'shieldBreak') },
      { say: 'Status effects. For this lesson your Pawn carries Firebrand, an equippable ability. Set the dummy on fire.', obj: 'Burn the dummy', glow: (c) => (c.s.turn && c.s.turn.acted ? '[data-slot=end]' : '[data-slot=eq]'),
        setup: (c) => { c.clear(); c.reset('pawn', 6, 9); c.me.equips = { ...c.me.equips, pawn: 'firebrand' }; c.me.cd.eq = 0; c.dummy(7, 8, 80); c.fresh(); },
        mark: (c) => c.dummies().map((d) => ({ x: d.x, y: d.y })), check: (c, ev) => c.ev(ev, (e) => e.e === 'status' && e.k === 'burn' && e.on) },
      { say: 'Burning pieces lose health at the start of each turn. Poison stacks and halves healing, Freeze stops a piece moving, Stun stops it acting, and Slow and Haste change its speed. Shields soak damage first. Fire and frost cancel each other out, and shrines and potions wash off the harmful ones. Watch the icons over every piece.', next: true },
      { say: 'Watch the banners for the other world events: an Eclipse hides distant pieces, an Earthquake reshapes the walls, a Mana Surge charges every ultimate, a Royal Bounty marks the leader, War Drums speed everyone up, and the Restless Dead rise to hunt. The Codex has the details. Now prove yourself in the Graduation match.', next: true },
    ],
  },
];

export class Tutorial {
  constructor(lesson, host, ui) {
    this.lesson = lesson; this.host = host; this.ui = ui;
    this.i = -1; this.track = { turns: 0, moves: 0, vaulted: false }; this.pending = false; this.done = false;
    this.c = helpers(this);
  }
  begin() { this.lesson.start(this.c); this.host.publish([]); this.advance(); }
  get step() { return this.lesson.steps[this.i]; }
  advance() {
    this.i++;
    if (this.i >= this.lesson.steps.length) { this.done = true; this.ui.marks([]); this.ui.glow(null); this.ui.complete(this.lesson); return; }
    this.track.turns = 0; this.track.moves = 0; this.track.vaulted = false; this.checked = false;
    this.pending = !!this.step.setup;
    this.trySetup();
    this.show();
  }
  trySetup() {
    if (this.dead) return;
    const s = this.host.s, me = this.c.me;
    if (!this.pending || !me || s.active !== me.id) return;
    this.pending = false;
    this.step.setup(this.c);
    this.host.publish([]);
    this.host.schedule();
    this.show();
  }
  show() {
    const st = this.step;
    this.ui.coach(st.say, st.obj || null, !!st.next);
    this.ui.glow(typeof st.glow === 'function' ? st.glow(this.c) : st.glow || null);
    this.ui.marks(st.mark ? st.mark(this.c) : []);
  }
  next() { if (this.step && this.step.next && !this.pending) this.advance(); }
  onState(ev) {
    if (this.dead || this.done || !this.step) return;
    const me = this.c.me;
    for (const e of ev) {
      if (e.e === 'turn' && me && e.id === me.id) { this.track.turns++; this.track.moves = 0; this.track.vaulted = false; }
      if (e.e === 'move' && me && e.id === me.id && e.how !== 'push' && e.how !== 'swap') this.track.moves++;
      if (e.e === 'ability' && me && e.id === me.id && e.ab === 'vault') this.track.vaulted = true;
    }
    if (this.pending) { this.trySetup(); return; }
    const st = this.step;
    if (st.mark) this.ui.marks(st.mark(this.c));
    if (typeof st.glow === 'function') this.ui.glow(st.glow(this.c));
    if (!this.checked && st.check && st.check(this.c, ev)) { this.checked = true; this.ui.objDone(); setTimeout(() => { if (!this.dead) this.advance(); }, 900); }
  }
}
