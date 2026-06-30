/* =========================================================================
   enemies.js — the Cursed Wisp enemy + the WaveManager.

   Phase 3: Enemy chases the witch, takes bolt damage, hurts on contact.
   Phase 6: WaveManager replaces the old trickle Spawner. It runs waves:
            an intermission ("WAVE N — get ready"), then spawns that wave's
            budget of enemies over time, and when they're ALL dead it moves
            to the next wave. Clearing the final wave sets `victory`.

   Difficulty per wave (all tunable):
     count   = 5 + wave * 2     (W1=7, W2=9, ... W10=25)
     speed   = 75 + wave * 4    (still well under the witch's 220)
     health  = 2 + floor(wave/3)  (+1 HP every 3 waves)
   ========================================================================= */

import { randomInt, randomRange, clamp, lerp, dirFromVector } from "./utils.js";
import { loadImage, getImage } from "./assets.js";
import { playSfx } from "./audio.js";

// --- Wisp enemy sprites (visual only) ------------------------------------
// 8-direction FLOAT (default, loops) + ATTACK (loops while the wisp is
// touching the player). The attack animation is purely cosmetic — contact
// damage is still handled exactly as before in game.js. Single-row strips in
// assets/sprites/enemies/, sliced at draw time (frameWidth = img.width/frames).
// Missing/loading strips fall back to the placeholder blob, per direction, so
// the game runs fine with partial or no wisp art.
const WISP_DIRS = ["n", "s", "e", "w", "ne", "nw", "se", "sw"];
const WISP_ANIMS = { float: 4, attack: 4 };
const WISP_FPS = { float: 6, attack: 10 };
const WISP_LOOPING = { float: true, attack: true };

// Register 8 dirs x 2 anims = 16 strips (graceful fallback if any are absent).
for (const anim of ["float", "attack"]) {
  for (const d of WISP_DIRS) {
    const key = `wisp_${anim}_${d}`;
    loadImage(key, `assets/sprites/enemies/${key}.png`);
  }
}

// Extra slack (px) beyond the touching radius before the wisp switches to its
// Attack animation. VISUAL ONLY — does not change when contact damage occurs.
const WISP_ATTACK_VISUAL_GAP = 6;

// Speed multiplier for a regular enemy standing in the Alchemist's acid (the
// "tar pit"). The Puddle (familiar.js) sets a short-lived `acidSlowTimer` on
// enemies it overlaps; while that timer is live, the chaser moves at this
// fraction so the swarm bogs down and actually eats the DoT. Lower = stickier
// pit. The clinginess (how long the slow lasts after leaving) is ACID_SLOW_LINGER
// in familiar.js. Bosses move via their own classes and never read this, so
// they're exempt; committed attacks (leap/cast) use their own step math, so only
// the generic chase is slowed.
const ACID_SLOW_MULT = 0.65;

// --- Enemy type table -------------------------------------------------------
// Data-driven per-type tuning (per the handoff guardrail: a new enemy is a
// table row, not a subclass). Wisp stats reproduce the original formula
// exactly. Multipliers apply on top of the wave/tier-scaled wisp baseline.
//   ranged: null = melee chaser; otherwise the skirmisher config:
//     preferredRange — distance it tries to hold from the witch
//     slack          — dead zone around preferredRange (no jitter dancing)
//     cooldown       — seconds between flings (with a little jitter)
//     projSpeed/projDamage/projLife — the flung ball
//     fireRange      — max distance it will fling from
//   separationWeight — soft crowd-separation strength (omit/0 = excluded). Regular
//     enemies that carry it gently push apart when overlapping so a swarm doesn't
//     collapse into one sprite (readability). See separateEnemies() below.
// 4-way facing (n/s/e/w) for enemies that ship cardinal-only art (e.g. the Tin
// Bulwark): pick the dominant axis so it never looks up a diagonal strip.
function dir4(dx, dy) {
  return Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "e" : "w") : (dy > 0 ? "s" : "n");
}

const ENEMY_TYPES = {
  wisp: {
    spritePrefix: "wisp",
    spriteScale: 0.8,
    speedMult: 1,
    healthMult: 1,
    damage: 8,
    fallbackOuter: "#e2536b",
    fallbackInner: "#7d1f2e",
    ambientSfx: "wisp", // creature chitter, picked at random by the scheduler
    ranged: null,
    separationWeight: 1.0, // soft crowd separation: how readily it yields when it
                           // overlaps a neighbor (the wisp swarm is the worst stacker)
  },
  gutter_gecko: {
    spritePrefix: "gecko",
    spriteScale: 0.6, // tune independently once the gecko art is in
    speedMult: 0.6,   // slower than a wisp — it fights from range
    healthMult: 0.75, // squishier — reach is its armor
    damage: 8,        // contact damage if you do touch it
    fallbackOuter: "#5ad1d1",
    fallbackInner: "#1f6b6b",
    ambientSfx: "gecko_chitter",
    separationWeight: 0.6, // lighter than a wisp — it fights from range, so it gives
                           // way less and isn't yanked off its preferred distance
    ranged: {
      preferredRange: 280,
      slack: 40,
      cooldown: 2.5,
      projSpeed: 220,
      projDamage: 8,
      projLife: 3,
      fireRange: 420,
      fireSfx: "gecko_fling", // played when it releases a projectile
    },
  },
  bone_mage: {
    spritePrefix: "bone_mage",
    spriteScale: 0.8,   // tune independently once the art is in (visual only)
    speedMult: 0,       // stationary — it relocates by BLINKING, not walking
    healthMult: 1.0,    // a priority target; squishy enough to punish ignoring it
    moteDrop: 2,        // priority caster — rewards killing it even though its HP ~ a wisp's; default 1
    damage: 8,          // contact damage if you crowd it
    fallbackOuter: "#b48cff", // pale bone-violet
    fallbackInner: "#4a3b6b",
    ambientSfx: "mage_murmur",
    ranged: null,
    // caster: stands at range, curses the GROUND (telegraph -> blast), and
    // phase-steps to reposition. The hazard zone forces the witch to move.
    caster: {
      preferredRange: 300, // distance it likes to keep (informational; it blinks)
      blinkRange: 150,     // if the witch gets this close, blink away (on cooldown)
      blinkDist: 200,      // how far each phase-step jumps
      castCooldown: 3.5,   // seconds between casts (+/- jitter)
      fireRange: 460,      // max distance it will curse from
      telegraph: 1.1,      // windup seconds before the blast (escape window)
      blastRadius: 70,     // damage circle radius
      blastDamage: 15,     // damage if you're inside at detonation
    },
  },
  goblin_bonker: {
    spritePrefix: "goblin",
    spriteScale: 0.9,    // tune independently once the art is in (visual only)
    speedMult: 0.6,      // slow bully — slower than a wisp
    healthMult: 3.0,     // the tank: ~3x a wisp's HP
    moteDrop: 3,         // the toughest regular foe — pays out the most XP packs; default 1
    damage: 8,           // contact damage if you crowd it
    fallbackOuter: "#7bbf5a", // goblin green
    fallbackInner: "#2f5a22",
    ambientSfx: "goblin_grunt",
    ranged: null,
    // bruiser: lumbers in, then COMMITS — a quick locked leap toward the witch
    // (closes distance so slow kiting isn't free), immediately followed by a
    // RADIAL ground stomp centered on its landing spot. The ring telegraphs for
    // `windup`, then BLASTS once and KNOCKS the witch back from the center. A
    // circle (not a front rect) means orbiting around it no longer dodges — you
    // must leave the ring. The stomp is a circle HazardZone, so game.js handles
    // the telegraph/hit/knockback for free.
    bruiser: {
      approachRange: 140,  // plants + commits when the witch is this close (center dist)
      windup: 0.55,       // ring telegraph after the leap: the witch must clear the circle
      recover: 0.8,       // planted recovery after the stomp (escape window)
      cooldown: 0.6,      // extra gap before it can commit again
      swingReach: 150,    // (legacy rect reach — retained; unused by the radial stomp)
      swingWidth: 96,     // (legacy rect width  — retained; unused by the radial stomp)
      swingDamage: 10,    // stomp damage — low/moderate; the knockback is the punishment
      knockback: 78,      // px the witch is shoved away from the goblin on a hit
      lunge: 120,          // px the goblin LEAPS forward into the stomp (capped at its distance to the witch)
      stompRadius: 96,    // radial stomp danger radius (+player ~16 = ~112px). Bigger = harder to outrun.
    },
  },
  pronggeist: {
    spritePrefix: "pronggeist",
    spriteScale: 0.8,         // tune independently once the art is in (visual only)
    speedMult: 0.95,          // shuffles at a modest pace — it fights by trapping, not chasing
    healthMult: 2.0,          // tanky enough to land several casts before it falls (still < the Goblin's 3.0)
    moteDrop: 2,              // tanky elite — extra XP packs for the effort; default 1
    damage: 8,                // contact damage if you crowd it (the spike line is the real threat)
    fallbackOuter: "#f1c359", // fork gold (matches the spikes)
    fallbackInner: "#8a6b1f",
    ambientSfx: "pronggeist_chitter", // creature chitter (data-driven scheduler; silent until registered)
    ranged: null,
    // lineCaster: shuffles into range, PLANTS, and LOCKS a BAND of `prongs` thin
    // parallel spike lines (a fork's tines) at the witch's position-at-cast — they
    // do NOT track. After `telegraph` they erupt together (one hit — her i-frames
    // swallow the simultaneous prongs), linger briefly, then it shuffles again.
    // Each prong is a rotated-rect HazardZone (skin "spikes"), so game.js draws +
    // collides them for free. Distinct from the Bone Mage: a wide DIRECTIONAL band
    // (sidestep the whole thing) vs a circular curse (leave it), and it WALKS.
    lineCaster: {
      castRange: 300,      // won't bother casting if she's beyond this (center dist)
      shuffleTime: 1.2,    // seconds of repositioning before each cast
      telegraph: 0.85,     // windup before the spikes erupt (the escape window)
      castWait: 1.85,      // planted/frozen time per cast (telegraph + eruption flash + recovery)
      lineMin: 140,        // shortest a prong can be (a point-blank cast still shows the band)
      lineMax: 320,        // longest a prong can be (>= castRange, so the lock is always reached)
      lineOvershoot: 40,   // each prong reaches this far PAST the locked spot
      prongs: 4,           // parallel spike lines (a fork's four tines)
      prongGap: 26,        // px between prong centers — tight enough that no gap is a safe slot
      prongWidth: 18,      // px across each prong (band spans ~prongGap*(prongs-1)+prongWidth ≈ 96px)
      damage: 12,          // damage per eruption (one hit total; moderate, < the Mage's 15)
      castFrame: 1,        // walk frame to freeze on while planted/casting
      spikesSfx: "pronggeist_spikes", // eruption cue, played by the first prong (graceful if missing)
    },
  },
  tin_bulwark: {
    spritePrefix: "tin_bulwark",
    spriteScale: 0.9,    // tune independently once the art is in (visual only)
    speedMult: 0.55,     // slow, deliberate trudge — slower than a wisp
    healthMult: 2.5,     // tanky controller (between the Pronggeist's 2.0 and the Goblin's 3.0)
    moteDrop: 3,         // tanky controller — pays out generously to reward bursting it; default 1
    damage: 8,           // standard contact damage if you stand on it (the WALL does none)
    fallbackOuter: "#9fb3c8", // tin/steel blue-grey
    fallbackInner: "#4a5a6b",
    ambientSfx: "tin_bulwark_step", // heavy footfall (data-driven scheduler; silent until registered)
    ranged: null,
    // bulwark: a position-control enemy. It advances to a casting distance, PLANTS,
    // and raises a telegraphed broadside PUSH WALL centered on the witch's spot. The
    // wall deals NO damage — while active it SHOVES her away from the Bulwark (she
    // starts at its rear edge, so the full thickness pushes her through). The threat
    // is being herded into other enemies / hazards / arena edges, not the wall
    // itself. The wall is a rect HazardZone in "push" mode (skin "wall"), so game.js
    // draws + applies it for free. WALK-ONLY art (freezes a frame while casting); it
    // drives its own 4-way facing + animation. Distinct from the Pronggeist: a force
    // barrier that MOVES you (no damage) vs a spike band that HITS you.
    bulwark: {
      castRange: 260,      // plants + walls when the witch is within this (center dist)
      approachTime: 1.0,   // seconds of advancing before each wall attempt
      windup: 0.9,         // wall telegraph — the escape window (sidestep it)
      active: 1.2,         // seconds the wall stays up and pushes
      recover: 0.8,        // planted recovery after the wall fades (before advancing again)
      wallWidth: 240,      // broadside length of the wall (across the push)
      wallThick: 90,       // push depth — she starts at the rear edge, shoved through this
      pushSpeed: 140,      // px/s shove while she's inside the wall (vs the witch's 220)
      wallSpeed: 130,      // px/s the ACTIVE wall ADVANCES along the push (moving barrier). Keep it a
                           // touch UNDER pushSpeed so a still witch is driven forward riding the front
                           // edge, then pops out (herded into danger, with a clear escape); and well
                           // under 220 so she can always outrun it or cut sideways out of the band.
      castFrame: 1,        // walk frame to freeze on while planted/casting
      chargeSfx: "tin_bulwark_charge", // windup cue (graceful if missing)
      wallSfx: "tin_bulwark_wall",     // wall-up cue, played as it goes active (graceful)
    },
  },
};

// Gutter Gecko sprite strips (anthropomorphic lizard with a pouch). Unlike
// the ghostly wisp (float doubles as movement), the gecko is a grounded
// creature with a full three-anim set, all single-row 4-frame strips in
// assets/sprites/enemies/:
//   gecko_idle_<dir>.png    (loops — tense stand-off sway in the dead zone)
//   gecko_walk_<dir>.png    (loops — scuttling toward/away from the witch)
//   gecko_attack_<dir>.png  (ONE-SHOT — the pouch fling; throw on frame 2-3)
// Missing strips fall back to the teal placeholder per direction.
for (const anim of ["idle", "walk", "attack"]) {
  for (const d of WISP_DIRS) {
    const key = `gecko_${anim}_${d}`;
    loadImage(key, `assets/sprites/enemies/${key}.png`);
  }
}

// Bone Mage sprite strips. Only TWO anims by design: the caster is stationary
// and BLINKS to reposition (so no walk), and its death is the parting curse rune
// (so no die anim). Single-row strips in assets/sprites/enemies/:
//   bone_mage_idle_<dir>.png    (6 frames, loops — channelling stance)
//   bone_mage_attack_<dir>.png  (6 frames, ONE-SHOT — the cast pose)
// Missing strips fall back to the bone-violet placeholder per direction.
for (const anim of ["idle", "attack"]) {
  for (const d of WISP_DIRS) {
    const key = `bone_mage_${anim}_${d}`;
    loadImage(key, `assets/sprites/enemies/${key}.png`);
  }
}

// Goblin Bonker sprite strips. Only TWO anims by design: it's always either
// advancing (walk) or planted mid-swing (attack), so no idle; death just removes
// it, so no die. Single-row strips in assets/sprites/enemies/:
//   goblin_walk_<dir>.png    (6 frames, loops — lumbering toward the witch)
//   goblin_attack_<dir>.png  (6 frames, PROGRESS-DRIVEN — wind-up then swing)
// Missing strips fall back to the goblin-green placeholder per direction.
for (const anim of ["walk", "attack"]) {
  for (const d of WISP_DIRS) {
    const key = `goblin_${anim}_${d}`;
    loadImage(key, `assets/sprites/enemies/${key}.png`);
  }
}

// Pronggeist sprite strips. WALK-ONLY by design (a low-animation caster): it
// animates while shuffling and FREEZES a walk frame while planted/casting, so no
// idle/attack/die strips are needed — the spike-line telegraph carries the read.
// Single-row strips in assets/sprites/enemies/:
//   pronggeist_walk_<dir>.png   (4 frames, loops — shuffling toward a cast spot)
// Missing strips fall back to the fork-gold placeholder per direction.
for (const anim of ["walk"]) {
  for (const d of WISP_DIRS) {
    const key = `pronggeist_${anim}_${d}`;
    loadImage(key, `assets/sprites/enemies/${key}.png`);
  }
}

// Tin Bulwark sprite strips. WALK-ONLY by design (like the Pronggeist): it walks
// while advancing and FREEZES a walk frame while planted/casting, so no idle/
// attack/die strips. FOUR directions only (n/s/e/w) — its facing is clamped to
// cardinals (dir4), so no diagonal strips are needed.
//   tin_bulwark_walk_<dir>.png   (6 frames, loops — a heavy trudge)
// Missing strips fall back to the steel placeholder per direction.
for (const d of ["n", "s", "e", "w"]) {
  const key = `tin_bulwark_walk_${d}`;
  loadImage(key, `assets/sprites/enemies/${key}.png`);
}

// Per-prefix animation tables.
const ENEMY_ANIMS = {
  wisp:  { anims: WISP_ANIMS, fps: WISP_FPS, looping: WISP_LOOPING },
  gecko: {
    anims:   { idle: 4, walk: 4, attack: 4 },
    fps:     { idle: 5, walk: 8, attack: 10 },
    looping: { idle: true, walk: true, attack: false }, // attack plays once
  },
  bone_mage: {
    anims:   { idle: 6, attack: 6 },
    fps:     { idle: 5, attack: 10 },
    looping: { idle: true, attack: false }, // attack (cast pose) plays once
  },
  goblin: {
    anims:   { walk: 6, attack: 6 },
    fps:     { walk: 8, attack: 10 }, // attack frame is PROGRESS-driven, fps unused for it
    looping: { walk: true, attack: false },
  },
  pronggeist: {
    anims:   { walk: 4 },
    fps:     { walk: 8 },
    looping: { walk: true }, // walk-only; the cast freezes a single walk frame
  },
  tin_bulwark: {
    anims:   { walk: 6 },
    fps:     { walk: 6 },    // a heavy, slow trudge
    looping: { walk: true }, // walk-only; the cast freezes a single walk frame
  },
};

// The gecko's flung ball sprite (60x60 canvas, ~34px swirl ball inside).
// Drawn at GECKO_BALL_SCALE (visual only — the gameplay hitbox stays radius 5)
// and spun in crisp 90-degree steps so the pixel grid never blurs.
loadImage("lizard_projectile", "assets/sprites/projectiles/lizard_projectile.png");
const GECKO_BALL_SCALE = 0.5;

// The fling pose lasts exactly one attack cycle (frames / fps = 4/10 = 0.4s).
const GECKO_ATTACK_POSE_SECONDS = ENEMY_ANIMS.gecko.anims.attack / ENEMY_ANIMS.gecko.fps.attack;

// --- Bone Mage timing / phase-step tuning (all visual-adjacent, tunable) ----
const MAGE_ATTACK_POSE_SECONDS = ENEMY_ANIMS.bone_mage.anims.attack / ENEMY_ANIMS.bone_mage.fps.attack;
const MAGE_BLINK_COOLDOWN = 2.5; // min seconds between phase-steps (any blink); higher = it flees less often, so ground DoT like the flask puddle can actually tick (was 1.5)
const BLINK_FX_LIFE = 0.35;      // phase-step poof ring fade duration (seconds)

// --- Goblin Bonker tuning ----
const GOBLIN_LUNGE_TIME = 0.18;  // seconds the forward swing-step plays out over

// --- A flung gecko ball ------------------------------------------------------
// Owned by game.js (this.enemyBolts) so shots outlive their shooter. Player
// collision/i-frames are handled in game.js; this is just motion + visuals.
export class EnemyBolt {
  constructor(x, y, targetX, targetY, speed, damage, life, opts = {}) {
    this.x = x;
    this.y = y;
    this.radius = 5;
    this.damage = damage;

    const dx = targetX - x;
    const dy = targetY - y;
    const len = Math.hypot(dx, dy) || 1;
    this.vx = (dx / len) * speed;
    this.vy = (dy / len) * speed;

    this.life = life;
    this.dead = false;
    this.spin = randomRange(0, Math.PI * 2); // wobble phase (visual only)

    // Visual style. Default = the Gutter Gecko ball (spinning sage orb). The Bee
    // passes opts to make a velocity-oriented amber stinger. Additive only —
    // existing callers (no opts) are unchanged.
    this.sprite = opts.sprite || "lizard_projectile";
    this.drawScale = opts.scale || GECKO_BALL_SCALE;
    this.fallbackColor = opts.color || null;       // null = teal gecko fallback
    this.orient = opts.orient || "spin";           // "spin" (quarter-turn) | "velocity"
  }

  update(dt) {
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.spin += dt * 9;
    this.life -= dt;
    if (this.life <= 0) this.dead = true;
  }

  draw(ctx) {
    const img = getImage(this.sprite);

    if (img && img.width > 0) {
      const dw = img.width * this.drawScale;
      const dh = img.height * this.drawScale;
      ctx.save();
      ctx.translate(this.x, this.y);
      if (this.orient === "velocity") {
        // Point along travel (sprite authored facing EAST). Small colored glow.
        ctx.rotate(Math.atan2(this.vy, this.vx));
        ctx.shadowColor = this.fallbackColor || "rgba(244, 197, 66, 0.7)";
        ctx.shadowBlur = 8;
      } else {
        // --- Gecko ball: soft sage halo, then art spun in quarter-turn steps. ---
        const haloR = this.radius * 2.4;
        const g = ctx.createRadialGradient(0, 0, 0, 0, 0, haloR);
        g.addColorStop(0, "rgba(140, 200, 150, 0.30)");
        g.addColorStop(1, "rgba(140, 200, 150, 0)");
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(0, 0, haloR, 0, Math.PI * 2);
        ctx.fill();
        const quarter = Math.floor(this.spin / (Math.PI / 2)) % 4; // 0..3
        ctx.rotate(quarter * (Math.PI / 2));
      }
      ctx.drawImage(img, -dw / 2, -dh / 2, dw, dh);
      ctx.restore();
      return;
    }

    // --- Velocity-oriented fallback: a pointed amber dart. ---
    if (this.orient === "velocity") {
      const col = this.fallbackColor || "#f4c542";
      ctx.save();
      ctx.translate(this.x, this.y);
      ctx.rotate(Math.atan2(this.vy, this.vx));
      ctx.shadowColor = col;
      ctx.shadowBlur = 8;
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.moveTo(10, 0);
      ctx.lineTo(-6, -4);
      ctx.lineTo(-6, 4);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
      return;
    }

    // --- Gecko fallback "ball": teal glowing orb with a bright core. ---
    const r = this.radius + Math.sin(this.spin) * 1;
    ctx.save();
    ctx.shadowColor = "#5ad1d1";
    ctx.shadowBlur = 10;
    ctx.fillStyle = "#5ad1d1";
    ctx.beginPath();
    ctx.arc(this.x, this.y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = "#d8fbfb";
    ctx.beginPath();
    ctx.arc(this.x, this.y, r * 0.45, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

// --- Bone Mage hazard zone (the reusable telegraph -> blast system) ----------
// Optional ground-rune art for the telegraph. Absent by default -> the zone
// uses its code-drawn warning ring. Drop the file in and it appears.
loadImage("hex_rune", "assets/sprites/enemies/hex_rune.png");

// A stationary patch of cursed ground. It WARNS for `telegraph` seconds (the
// ring fills toward detonation), then BLASTS once — anyone inside the radius at
// the instant of detonation takes `damage` (through the witch's normal i-frames)
// — then a brief flash fades out. Owned + drawn (world space, on the floor) by
// game.js, which also marks it dead. Reusable by any future enemy/boss.
const HAZARD_BLAST_TIME = 0.35; // brief impact flash AFTER the telegraph ends
export class HazardZone {
  // shape "circle" (Bone Mage) uses `radius`; shape "rect" (Goblin swing) uses
  // opts.angle/length/width. opts.knockback (px) + opts.ox/oy (the attacker's
  // locked position) shove the witch away on a LANDED hit. opts.sfx is the
  // detonation cue. Called with no opts -> a plain circle, exactly as before.
  constructor(x, y, radius, telegraph, damage, opts = {}) {
    this.x = x;
    this.y = y;
    this.radius = radius;
    this.telegraph = telegraph;
    this.damage = damage;
    this.phase = "telegraph"; // "telegraph" -> "blast"
    this.timer = telegraph;
    this.dead = false;
    this.hasHit = false;

    this.shape = opts.shape || "circle";
    this.angle = opts.angle || 0;
    this.length = opts.length || radius * 2; // rect reach along angle
    this.width = opts.width || radius * 2;   // rect width across angle
    this.knockback = opts.knockback || 0;
    this.ox = opts.ox != null ? opts.ox : x; // knockback origin (the attacker)
    this.oy = opts.oy != null ? opts.oy : y;
    this.sfx = opts.sfx === undefined ? "mage_blast" : opts.sfx; // explicit null = silent (extra prongs)
    // Circle look: "curse" = Bone Mage cursed ground (rune/violet), "stomp" =
    // Goblin shockwave (green/amber, no rune). Rect ignores this.
    this.skin = opts.skin || "curse";

    // Push mode (Tin Bulwark wall): when push > 0 the zone deals NO one-time hit
    // and instead SHOVES the witch along pushAngle every frame she overlaps the
    // ACTIVE phase, which lasts activeDuration (vs the brief blast flash). Default
    // push 0 -> the classic telegraph -> one-time blast, completely unchanged.
    this.push = opts.push || 0;            // sustained shove speed (px/s); 0 = off
    this.pushAngle = opts.pushAngle || 0;  // direction of the shove (radians)
    this.activeDuration = opts.activeDuration != null ? opts.activeDuration : HAZARD_BLAST_TIME;
    this.driftSpeed = opts.driftSpeed || 0; // px/s the ACTIVE wall advances along pushAngle (moving wall); 0 = stationary
  }

  // Is the witch inside the danger area right now? (expanded by her radius so a
  // graze counts, matching the circle's reach).
  hits(player) {
    if (this.shape === "rect") {
      // Un-rotate the witch into the rect's local space, then an AABB test.
      const dx = player.x - this.x, dy = player.y - this.y;
      const ca = Math.cos(-this.angle), sa = Math.sin(-this.angle);
      const lx = dx * ca - dy * sa;
      const ly = dx * sa + dy * ca;
      return Math.abs(lx) <= this.length / 2 + player.radius &&
             Math.abs(ly) <= this.width / 2 + player.radius;
    }
    return Math.hypot(player.x - this.x, player.y - this.y) <= this.radius + player.radius;
  }

  update(dt, player) {
    this.timer -= dt;
    if (this.phase === "telegraph") {
      if (this.timer <= 0) {
        // Push walls (Tin Bulwark) deal NO one-time hit — the shove happens over
        // the active phase below. Everything else detonates once: damage if she's
        // inside now, and a LANDED hit (one that beat her i-frames) knocks her
        // back from the origin.
        if (!this.push && !this.hasHit && player && !player.dead && this.hits(player)) {
          const landed = player.takeDamage(this.damage);
          if (landed && this.knockback > 0 && typeof player.applyKnockback === "function") {
            const kx = player.x - this.ox, ky = player.y - this.oy;
            const len = Math.hypot(kx, ky) || 1;
            player.applyKnockback(kx / len, ky / len, this.knockback);
          }
        }
        this.hasHit = true;
        this.phase = "blast";
        // A push wall stays "live" for its full active window; plain hazards just
        // flash briefly.
        this.timer = this.push > 0 ? this.activeDuration : HAZARD_BLAST_TIME;
        if (this.sfx) playSfx(this.sfx); // null (extra prongs) = silent; registry is graceful otherwise
      }
    } else {
      // ACTIVE phase. A "moving wall" first ADVANCES along pushAngle (driftSpeed)
      // so it FOLLOWS the witch instead of letting her step off the front — the
      // advancing barrier is the threat. Then it shoves anyone inside along
      // pushAngle (no damage); she keeps WASD control and escapes by cutting
      // sideways out of the band. Drift direction is LOCKED at cast (no tracking).
      if (this.driftSpeed > 0) {
        this.x += Math.cos(this.pushAngle) * this.driftSpeed * dt;
        this.y += Math.sin(this.pushAngle) * this.driftSpeed * dt;
      }
      if (this.push > 0 && player && !player.dead &&
          typeof player.applyPush === "function" && this.hits(player)) {
        player.applyPush(Math.cos(this.pushAngle), Math.sin(this.pushAngle), this.push);
      }
      if (this.timer <= 0) this.dead = true;
    }
  }

  draw(ctx) {
    if (this.shape === "rect") { this.drawRect(ctx); return; }
    this.drawCircle(ctx);
  }

  // Goblin swing: a rotated danger rectangle whose fill sweeps from the goblin
  // out to the tip as the swing loads, then a bright impact flash.
  drawRect(ctx) {
    if (this.skin === "spikes") { this.drawRectSpikes(ctx); return; } // Pronggeist look
    if (this.skin === "clock") { this.drawRectClock(ctx); return; }   // Hourkeeper clock hand
    if (this.skin === "wall") { this.drawRectWall(ctx); return; }     // Tin Bulwark push wall
    const hl = this.length / 2, hw = this.width / 2;
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(this.angle);
    if (this.phase === "blast") {
      const p = 1 - Math.max(0, this.timer) / HAZARD_BLAST_TIME;
      ctx.globalAlpha = 1 - p;
      ctx.fillStyle = "rgba(255, 230, 180, 0.85)";
      ctx.fillRect(-hl, -hw, this.length, this.width);
      ctx.lineWidth = 3;
      ctx.strokeStyle = "#e2536b";
      ctx.strokeRect(-hl, -hw, this.length, this.width);
      ctx.restore();
      return;
    }
    const fill = 1 - Math.max(0, this.timer) / this.telegraph;
    const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 110);
    ctx.lineWidth = 2;
    ctx.strokeStyle = `rgba(226, 83, 107, ${0.45 + 0.45 * fill})`;
    ctx.strokeRect(-hl, -hw, this.length, this.width);
    ctx.fillStyle = `rgba(226, 83, 107, ${0.10 + 0.16 * pulse})`;
    ctx.fillRect(-hl, -hw, this.length * fill, this.width); // sweeps outward
    ctx.restore();
  }

  // Tin Bulwark push wall (skin "wall"): a STEEL panel that telegraphs (outline +
  // pulsing fill) then turns near-solid while it shoves. The push-direction arrows
  // (drawn in WORLD space along pushAngle) make the shove unmistakable — that's the
  // whole read of the attack. Code-drawn; a panel sprite can replace it later, this
  // stays as the fallback. Distinct steel #9fb3c8 vs the goblin red / spike gold.
  drawRectWall(ctx) {
    const hl = this.length / 2, hw = this.width / 2;
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(this.angle);
    if (this.phase === "blast") {
      // ACTIVE: a near-solid slab, easing out across the active window.
      const p = 1 - Math.max(0, this.timer) / this.activeDuration; // 0 -> 1
      ctx.globalAlpha = 0.55 * (1 - p * 0.35);
      ctx.fillStyle = "#9fb3c8";
      ctx.fillRect(-hl, -hw, this.length, this.width);
      ctx.globalAlpha = 1;
      ctx.lineWidth = 3;
      ctx.strokeStyle = "#cfe0ef";
      ctx.strokeRect(-hl, -hw, this.length, this.width);
    } else {
      // TELEGRAPH: outline that brightens as it charges + a pulsing wash.
      const fill = 1 - Math.max(0, this.timer) / this.telegraph; // 0 -> 1
      const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 110);
      ctx.lineWidth = 2;
      ctx.strokeStyle = `rgba(159, 179, 200, ${0.4 + 0.45 * fill})`;
      ctx.strokeRect(-hl, -hw, this.length, this.width);
      ctx.fillStyle = `rgba(159, 179, 200, ${(0.08 + 0.14 * pulse) * (0.5 + 0.5 * fill)})`;
      ctx.fillRect(-hl, -hw, this.length, this.width);
    }
    ctx.restore();
    this.drawPushArrows(ctx);
  }

  // A short row of arrows pointing along pushAngle (world space) so the witch sees
  // which way the wall shoves her. Brighter once the wall is active.
  drawPushArrows(ctx) {
    const ax = Math.cos(this.pushAngle), ay = Math.sin(this.pushAngle); // push dir
    const px = -ay, py = ax;                                            // along the wall
    const reach = Math.min(this.width * 0.6, 26);
    const active = this.phase === "blast";
    ctx.save();
    ctx.strokeStyle = active ? "rgba(226, 240, 255, 0.95)" : "rgba(220, 235, 250, 0.7)";
    ctx.fillStyle = ctx.strokeStyle;
    ctx.lineWidth = 3;
    for (let i = -1; i <= 1; i++) {
      const ox = this.x + px * (i * this.length * 0.3);
      const oy = this.y + py * (i * this.length * 0.3);
      const tx = ox + ax * reach, ty = oy + ay * reach;
      ctx.beginPath();
      ctx.moveTo(ox - ax * reach * 0.5, oy - ay * reach * 0.5);
      ctx.lineTo(tx, ty);
      ctx.stroke();
      const hsz = 7;
      const la = this.pushAngle + 2.5, ra = this.pushAngle - 2.5;
      ctx.beginPath();
      ctx.moveTo(tx, ty);
      ctx.lineTo(tx + Math.cos(la) * hsz, ty + Math.sin(la) * hsz);
      ctx.lineTo(tx + Math.cos(ra) * hsz, ty + Math.sin(ra) * hsz);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  // Pronggeist spike line (skin "spikes"): a GOLD warning corridor that fills from
  // the fork toward the lock, then a row of erupting gold teeth that flash + fade.
  // Code-drawn (no art) in the fork's gold #f1c359 — visually distinct from the
  // Bone Mage's violet curse and the Goblin's green stomp. A spike sprite can
  // replace the teeth later; this stays as the fallback.
  drawRectSpikes(ctx) {
    const GOLD = "#f1c359";
    const hl = this.length / 2, hw = this.width / 2;
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(this.angle);

    if (this.phase === "blast") {
      const p = 1 - Math.max(0, this.timer) / HAZARD_BLAST_TIME; // 0 -> 1
      ctx.globalAlpha = 1 - p;                                   // fade as it retracts
      ctx.fillStyle = "rgba(241, 195, 89, 0.30)";                // hot fill under the teeth
      ctx.fillRect(-hl, -hw, this.length, this.width);
      // A jagged sawtooth ridge along the corridor reads as a row of spikes.
      const teeth = Math.max(3, Math.round(this.length / 16));
      ctx.beginPath();
      for (let i = 0; i <= teeth; i++) {
        const tx = -hl + (i * this.length) / teeth;
        const ty = (i % 2 === 0) ? -hw : hw;
        if (i === 0) ctx.moveTo(tx, ty); else ctx.lineTo(tx, ty);
      }
      ctx.lineWidth = 3;
      ctx.strokeStyle = GOLD;
      ctx.stroke();
      ctx.lineWidth = 2;
      ctx.strokeStyle = "#fff2c8"; // bright edge keeps the active lane legible
      ctx.strokeRect(-hl, -hw, this.length, this.width);
      ctx.restore();
      return;
    }

    // Telegraph: corridor outline + an inner fill that sweeps from the fork to the
    // tip as the windup loads, plus a pulsing centre guide so the lane reads early.
    const fill = 1 - Math.max(0, this.timer) / this.telegraph; // 0 -> 1
    const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 110);
    ctx.lineWidth = 2;
    ctx.strokeStyle = `rgba(241, 195, 89, ${0.45 + 0.45 * fill})`;
    ctx.strokeRect(-hl, -hw, this.length, this.width);
    ctx.fillStyle = `rgba(241, 195, 89, ${0.08 + 0.16 * pulse})`;
    ctx.fillRect(-hl, -hw, this.length * fill, this.width); // sweeps outward
    ctx.strokeStyle = `rgba(241, 195, 89, ${0.40 + 0.40 * fill})`;
    ctx.beginPath();
    ctx.moveTo(-hl, 0);
    ctx.lineTo(-hl + this.length * fill, 0);
    ctx.stroke();
    ctx.restore();
  }

  // Bone Mage cursed ground: warning ring/rune that fills, then an impact flash.
  drawCircle(ctx) {
    if (this.skin === "stomp") { this.drawStomp(ctx); return; }
    if (this.skin === "clock") { this.drawClockRune(ctx); return; } // Hourkeeper alarm rune
    const img = getImage("hex_rune");
    if (this.phase === "blast") {
      const p = 1 - Math.max(0, this.timer) / HAZARD_BLAST_TIME; // 0->1
      const r = this.radius * (1 + p * 0.18);
      ctx.save();
      ctx.globalAlpha = 1 - p;
      ctx.fillStyle = "rgba(255, 240, 200, 0.85)";
      ctx.beginPath(); ctx.arc(this.x, this.y, r, 0, Math.PI * 2); ctx.fill();
      ctx.lineWidth = 3;
      ctx.strokeStyle = "#e2536b";
      ctx.beginPath(); ctx.arc(this.x, this.y, r, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
      return;
    }
    const fill = 1 - Math.max(0, this.timer) / this.telegraph;
    ctx.save();
    if (img && img.width > 0) {
      const dw = this.radius * 2, dh = this.radius * 2;
      ctx.globalAlpha = 0.55 + 0.4 * fill;
      ctx.drawImage(img, this.x - dw / 2, this.y - dh / 2, dw, dh);
    } else {
      const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 120);
      ctx.lineWidth = 2;
      ctx.strokeStyle = `rgba(226, 83, 107, ${0.45 + 0.45 * fill})`;
      ctx.beginPath(); ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = `rgba(226, 83, 107, ${0.10 + 0.16 * pulse})`;
      ctx.beginPath(); ctx.arc(this.x, this.y, this.radius * fill, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = "rgba(180, 140, 255, 0.7)";
      ctx.beginPath();
      ctx.moveTo(this.x - 9, this.y); ctx.lineTo(this.x + 9, this.y);
      ctx.moveTo(this.x, this.y - 9); ctx.lineTo(this.x, this.y + 9);
      ctx.stroke();
    }
    ctx.restore();
  }

  // Goblin radial stomp: a warm ground ring that fills toward the slam, then a
  // dusty shockwave flash. No rune — visually distinct from the Bone Mage curse.
  drawStomp(ctx) {
    ctx.save();
    if (this.phase === "blast") {
      const p = 1 - Math.max(0, this.timer) / HAZARD_BLAST_TIME; // 0 -> 1
      const r = this.radius * (1 + p * 0.22);                    // expands outward
      ctx.globalAlpha = 1 - p;
      ctx.fillStyle = "rgba(214, 184, 122, 0.55)";               // dust
      ctx.beginPath(); ctx.arc(this.x, this.y, r, 0, Math.PI * 2); ctx.fill();
      ctx.lineWidth = 4;
      ctx.strokeStyle = "rgba(123, 191, 90, 0.9)";               // goblin green rim
      ctx.beginPath(); ctx.arc(this.x, this.y, r, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
      return;
    }
    // Telegraph: filled inner disc grows with the wind-up; pulsing outer rim.
    const fill = 1 - Math.max(0, this.timer) / this.telegraph;   // 0 -> 1
    const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 100);
    ctx.fillStyle = `rgba(170, 130, 70, ${0.10 + 0.20 * fill})`;
    ctx.beginPath(); ctx.arc(this.x, this.y, this.radius * fill, 0, Math.PI * 2); ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = `rgba(123, 191, 90, ${0.45 + 0.45 * pulse})`;
    ctx.beginPath(); ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2); ctx.stroke();
    // A few radial cracks for "ground slam" read.
    ctx.strokeStyle = `rgba(214, 184, 122, ${0.30 + 0.35 * fill})`;
    ctx.lineWidth = 2;
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + this.angle;
      ctx.beginPath();
      ctx.moveTo(this.x + Math.cos(a) * this.radius * 0.25, this.y + Math.sin(a) * this.radius * 0.25);
      ctx.lineTo(this.x + Math.cos(a) * this.radius * 0.92, this.y + Math.sin(a) * this.radius * 0.92);
      ctx.stroke();
    }
    ctx.restore();
  }

  // Hourkeeper clock hand (rect skin "clock"): a brass bar whose fill sweeps
  // OUTWARD from the locked pivot both ways (it's a full line through the
  // pivot), with a bright centre "hand" line + a hub, then a pale flash.
  // Distinct from the Goblin's red bar and the Pronggeist's toothed gold lane.
  drawRectClock(ctx) {
    const BRASS = "#f1c359";
    const hl = this.length / 2, hw = this.width / 2;
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(this.angle);
    if (this.phase === "blast") {
      const p = 1 - Math.max(0, this.timer) / HAZARD_BLAST_TIME;
      ctx.globalAlpha = 1 - p;
      ctx.fillStyle = "rgba(255, 242, 200, 0.85)";
      ctx.fillRect(-hl, -hw, this.length, this.width);
      ctx.lineWidth = 3;
      ctx.strokeStyle = BRASS;
      ctx.strokeRect(-hl, -hw, this.length, this.width);
      ctx.restore();
      return;
    }
    const fill = 1 - Math.max(0, this.timer) / this.telegraph;
    const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 110);
    ctx.lineWidth = 2;
    ctx.strokeStyle = `rgba(241, 195, 89, ${0.4 + 0.45 * fill})`;
    ctx.strokeRect(-hl, -hw, this.length, this.width);
    // Fill grows symmetrically from the centre (pivot) outward to both tips.
    ctx.fillStyle = `rgba(241, 195, 89, ${0.10 + 0.18 * pulse})`;
    ctx.fillRect(-hl * fill, -hw, this.length * fill, this.width);
    ctx.strokeStyle = `rgba(255, 242, 200, ${0.5 + 0.4 * fill})`;
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(-hl, 0); ctx.lineTo(hl, 0); ctx.stroke();
    ctx.fillStyle = BRASS;
    ctx.beginPath(); ctx.arc(0, 0, 4, 0, Math.PI * 2); ctx.fill(); // pivot hub
    ctx.restore();
  }

  // Hourkeeper alarm rune (circle skin "clock"): the clock_rune.png mark filling
  // toward the burst, then a pale flash. Falls back to a brass clock-face circle
  // with a sweeping hand if the art is absent.
  drawClockRune(ctx) {
    const img = getImage("clock_rune");
    if (this.phase === "blast") {
      const p = 1 - Math.max(0, this.timer) / HAZARD_BLAST_TIME;
      const r = this.radius * (1 + p * 0.2);
      ctx.save();
      ctx.globalAlpha = 1 - p;
      ctx.fillStyle = "rgba(255, 242, 200, 0.85)";
      ctx.beginPath(); ctx.arc(this.x, this.y, r, 0, Math.PI * 2); ctx.fill();
      ctx.lineWidth = 3;
      ctx.strokeStyle = "#f1c359";
      ctx.beginPath(); ctx.arc(this.x, this.y, r, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
      return;
    }
    const fill = 1 - Math.max(0, this.timer) / this.telegraph;
    ctx.save();
    if (img && img.width > 0) {
      const dw = this.radius * 2, dh = this.radius * 2;
      ctx.globalAlpha = 0.55 + 0.4 * fill;
      ctx.drawImage(img, this.x - dw / 2, this.y - dh / 2, dw, dh);
    } else {
      const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 120);
      ctx.lineWidth = 2;
      ctx.strokeStyle = `rgba(241, 195, 89, ${0.45 + 0.45 * fill})`;
      ctx.beginPath(); ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = `rgba(241, 195, 89, ${0.10 + 0.16 * pulse})`;
      ctx.beginPath(); ctx.arc(this.x, this.y, this.radius * fill, 0, Math.PI * 2); ctx.fill();
      // A clock hand sweeping toward 12 as the burst nears.
      const a = -Math.PI / 2 + fill * Math.PI * 2;
      ctx.strokeStyle = "rgba(255, 242, 200, 0.9)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(this.x, this.y);
      ctx.lineTo(this.x + Math.cos(a) * this.radius * 0.8, this.y + Math.sin(a) * this.radius * 0.8);
      ctx.stroke();
    }
    ctx.restore();
  }
}

// The dark pool a slain enemy leaves behind under the Vengeful Dead curse: a
// lingering ground DoT that damages the WITCH — the mirror of the Alchemist's
// acid Puddle (which damages enemies). Kept as its own class so neither's tuning
// disturbs the other and the shipped weapon stays untouched. game.js owns,
// updates, and draws these exactly like it does HazardZone. Visual + hitbox share
// `radius`. The witch's own 1.0s i-frames gate the ticks, so a fresh kill reads as
// "a bite if you're caught, a second if you camp the corpse," not a melt.
loadImage("puddle_dark", "assets/sprites/projectiles/puddle_dark.png");
export class HazardPuddle {
  // Required: position, radius, per-tick damage. Optional (with defaults): life,
  // tickInterval, fade window, sprite key — so the class is reusable for any future
  // ground DoT on the witch while Vengeful Dead's tuning lives in game.js.
  constructor(x, y, radius, damage, opts = {}) {
    this.x = x;
    this.y = y;
    this.radius = radius;       // gameplay hitbox == visible pool
    this.damage = damage;       // damage per landed tick
    this.life = opts.life != null ? opts.life : 1.8;
    this.tickInterval = opts.tickInterval != null ? opts.tickInterval : 0.5;
    this.fade = opts.fade != null ? opts.fade : 0.6; // fade-out window at end of life
    this.spriteKey = opts.sprite || "puddle_dark";
    this.tickTimer = this.tickInterval; // first tick one interval in (matches the Alchemist Puddle)
    this.dead = false;
  }

  // `player` is the single target. player.takeDamage() applies its own i-frames,
  // so we don't gate ticks here — a tick that lands during invulnerability is
  // simply absorbed. Called every play frame by game.js.
  update(dt, player) {
    this.life -= dt;
    if (this.life <= 0) { this.dead = true; return; }
    this.tickTimer -= dt;
    if (this.tickTimer <= 0) {
      this.tickTimer += this.tickInterval;
      if (player && !player.dead) {
        const d = Math.hypot(player.x - this.x, player.y - this.y);
        if (d <= this.radius + player.radius) player.takeDamage(this.damage);
      }
    }
  }

  draw(ctx) {
    const fadeMul = this.life < this.fade ? this.life / this.fade : 1;
    const pulse = 0.9 + 0.1 * Math.sin(performance.now() / 200);
    const img = getImage(this.spriteKey);
    ctx.save();
    ctx.globalAlpha = 0.75 * fadeMul;
    if (img && img.width > 0) {
      const d = this.radius * 2;
      ctx.drawImage(img, this.x - this.radius, this.y - this.radius, d, d);
    } else {
      // Fallback until the recolored sprite ships: a sinister dark pool with a
      // faint violet rim, so the hazard still reads clearly on the stone floor.
      const r = this.radius * pulse;
      ctx.fillStyle = "#140d1c";
      ctx.beginPath(); ctx.arc(this.x, this.y, r, 0, Math.PI * 2); ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = "rgba(124, 77, 158, 0.85)";
      ctx.beginPath(); ctx.arc(this.x, this.y, r, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.restore();
  }
}

export class Enemy {
  constructor(x, y, type = "wisp") {
    this.x = x;
    this.y = y;
    this.radius = 13;

    this.type = type;
    this.def = ENEMY_TYPES[type] || ENEMY_TYPES.wisp;

    this.speed = 75;
    this.maxHealth = 2;
    this.health = 2;
    this.damage = this.def.damage;
    this.ambientSfx = this.def.ambientSfx || null; // creature chitter voice (or none)

    this.dead = false;
    this.hitFlash = 0;
    this.wobble = randomRange(0, Math.PI * 2);
    this.acidSlowTimer = 0;     // >0 while standing in the Alchemist's acid (set by
                                // the Puddle in familiar.js); slows the generic chase

    // Ranged (Gutter Gecko) / caster (Bone Mage) state.
    this.fireTimer = this.def.ranged
      ? randomRange(0.8, this.def.ranged.cooldown)
      : (this.def.caster ? randomRange(0.8, this.def.caster.castCooldown) : 0);
    this.attackPoseTimer = 0; // holds the attack anim briefly after a fling/cast
    this.repositioning = false; // gecko: outside its dead zone → walk vs idle
    this.bondTickTimer = 0;     // Spirit Bond: per-enemy damage-tick cooldown
    this.blinkFx = [];          // Bone Mage phase-step poof rings (visual only)
    this.blinkCooldown = 0;     // min gap between "crowded me" blinks
    this.attackState = "chase"; // Goblin Bonker: "chase" | "leap" | "windup" | "recover"
    this.attackTimer = 0;       // windup/recover countdown
    this.attackCd = 0;          // gap before it can wind up again
    this.swingAng = 0;          // Goblin: locked aim of the committed swing/leap
    this.lungeTimer = 0;        // Goblin: forward swing-step countdown (legacy; unused by stomp)
    this.leapTimer = 0;         // Goblin: leap-step countdown (the commit hop)
    this.leapDist = 0;          // Goblin: total px the committed leap travels

    // Pronggeist (lineCaster) phase machine. Starts mid-shuffle with a randomized
    // timer so a group of forks doesn't plant + cast in perfect lockstep.
    this.ppPhase = "shuffle";   // "shuffle" (repositioning) | "cast" (planted, frozen)
    this.ppTimer = this.def.lineCaster ? randomRange(0.4, this.def.lineCaster.shuffleTime) : 0;

    // Tin Bulwark (bulwark) phase machine: advance -> plant + raise a push wall ->
    // recover. Randomized start so a pair doesn't wall in lockstep.
    this.tbPhase = "approach";  // "approach" (advancing) | "cast" (planted, frozen)
    this.tbTimer = this.def.bulwark ? randomRange(0.4, this.def.bulwark.approachTime) : 0;

    // Animation state (visual only). Start frame is randomized so a swarm
    // doesn't pulse in perfect lockstep.
    const animCfg = ENEMY_ANIMS[this.def.spritePrefix];
    this.facing = "s";
    // Resting state differs per model: the ghostly wisp floats; the grounded
    // gecko and the Bone Mage idle; the Goblin has no rest pose (it's always
    // advancing or mid-swing), so its "rest" is the walk loop.
    this.restState = (this.def.bruiser || this.def.lineCaster || this.def.bulwark) ? "walk" : (this.def.ranged || this.def.caster) ? "idle" : "float";
    this.animState = this.restState;
    this.animFrame = randomInt(0, animCfg.anims[this.restState] - 1);
    this.animTimer = 0;
    this.spriteScale = this.def.spriteScale; // per-type (native px * this)
  }

  // `enemyBolts` is the game-owned array ranged enemies fling into; `hazards`
  // is the array casters drop cursed-ground zones into. Melee types ignore both
  // (game.js handles bolt/hazard motion + collision after this).
  update(dt, player, enemyBolts, hazards) {
    const dx = player.x - this.x;
    const dy = player.y - this.y;
    const len = Math.hypot(dx, dy) || 1;

    if (this.def.ranged) {
      // --- Skirmisher (Gutter Gecko): hold preferredRange, strafe, fling ---
      const r = this.def.ranged;
      let mx = 0, my = 0;
      let repositioning = false; // outside the dead zone (drives walk vs idle)
      if (len > r.preferredRange + r.slack) {
        mx = dx / len; my = dy / len;          // too far — close in
        repositioning = true;
      } else if (len < r.preferredRange - r.slack) {
        mx = -dx / len; my = -dy / len;        // too close — back off
        repositioning = true;
      }
      // Sideways drift (perpendicular) so approach/retreat never runs on
      // rails — applied ONLY while repositioning. In the dead zone the gecko
      // stands truly still: the idle animation provides the motion (moving
      // while playing idle read as "sliding in place").
      if (repositioning) {
        const strafe = Math.sin(this.wobble * 0.7) * 0.45;
        mx += (-dy / len) * strafe;
        my += (dx / len) * strafe;
        const mlen = Math.hypot(mx, my);
        if (mlen > 1) { mx /= mlen; my /= mlen; }
        this.x += mx * this.speed * dt;
        this.y += my * this.speed * dt;
      }
      this.repositioning = repositioning;

      // Fling on cooldown whenever the witch is in range.
      this.fireTimer -= dt;
      if (this.fireTimer <= 0 && len <= r.fireRange && enemyBolts) {
        enemyBolts.push(new EnemyBolt(this.x, this.y, player.x, player.y, r.projSpeed, r.projDamage, r.projLife));
        if (r.fireSfx) playSfx(r.fireSfx); // missing file = silent
        this.fireTimer = r.cooldown + randomRange(-0.4, 0.4);
        this.attackPoseTimer = GECKO_ATTACK_POSE_SECONDS;
      }
      if (this.attackPoseTimer > 0) this.attackPoseTimer -= dt;
    } else if (this.def.caster) {
      // --- Bone Mage: a stationary caster. It curses the ground and BLINKS to
      // reposition (no walking) — all movement is via phase-step. ---
      this.updateCaster(dt, player, len, hazards);
    } else if (this.def.bruiser) {
      // --- Goblin Bonker: lumber in, plant, telegraph a LOCKED club swing, and
      // knock the witch back. (Handles its own facing + animation.) ---
      this.updateBruiser(dt, player, len, hazards);
    } else if (this.def.lineCaster) {
      // --- Pronggeist: shuffle into range, plant, and LOCK a thin spike line at
      // the witch's CURRENT spot (it does NOT track). Handles its own facing +
      // animation (walk while shuffling, frozen frame while casting). ---
      this.updatePronggeist(dt, player, len, hazards);
    } else if (this.def.bulwark) {
      // --- Tin Bulwark: advance, plant, and raise a telegraphed PUSH WALL on the
      // witch that shoves her away (NO damage — the danger is where it puts her).
      // Handles its own 4-way facing + animation (walk while advancing, frozen
      // frame while casting). ---
      this.updateBulwark(dt, player, len, hazards);
    } else {
      // --- Melee chaser (wisp): walk straight at the witch. The Alchemist's acid
      // (familiar.js) sets acidSlowTimer while it stands in a puddle, so the swarm
      // bogs down in the tar pit and eats the DoT instead of striding through. ---
      const slow = this.acidSlowTimer > 0 ? ACID_SLOW_MULT : 1;
      this.x += (dx / len) * this.speed * slow * dt;
      this.y += (dy / len) * this.speed * slow * dt;
    }

    // Keep the whole BODY (its visual footprint, not just the hitbox) on the
    // floor. The clamp funnels every kind of movement — walk, gecko strafe,
    // mage blink, and anything we add later — so no enemy's art can lap the wall
    // regardless of how it moved. Uses the live sprite size, so new enemies are
    // covered automatically; falls back to the hitbox before art has loaded.
    const half = this.boundaryHalfExtent();
    const bounded = clampToPlayfield(this.x, this.y, half.x, half.y);
    this.x = bounded.x;
    this.y = bounded.y;

    this.wobble += dt * 6;
    if (this.hitFlash > 0) this.hitFlash -= dt;
    // The acid slow is re-set every frame the enemy stands in a puddle, so this
    // just lets it lapse a few frames after it steps out (smooth, no flicker).
    if (this.acidSlowTimer > 0) this.acidSlowTimer -= dt;

    // --- Animation (visual only) ---
    // Both types always face the witch (the gecko backs away while facing her,
    // as a flinger should).
    // --- Facing + animation (visual only) ---
    // The Goblin (bruiser) drives its OWN facing + frame in updateBruiser (it
    // LOCKS them through the wind-up/swing), and the Pronggeist (lineCaster) does
    // the same in updatePronggeist (walk while shuffling, frozen while casting), so
    // both opt out of the generic path.
    if (!this.def.bruiser && !this.def.lineCaster && !this.def.bulwark) {
      this.facing = dirFromVector(dx, dy);

      // Wisp: ATTACK while touching (reads the same proximity the contact-damage
      // check uses; damage itself is untouched, handled in game.js), FLOAT
      // otherwise. Gecko: ATTACK (one-shot) during the fling pose, WALK while
      // repositioning, IDLE while holding its distance.
      const touching = len <= this.radius + player.radius + WISP_ATTACK_VISUAL_GAP;
      let newState;
      if (this.def.ranged) {
        newState = this.attackPoseTimer > 0 ? "attack" : (this.repositioning ? "walk" : "idle");
      } else if (this.def.caster) {
        newState = this.attackPoseTimer > 0 ? "attack" : "idle";
      } else {
        newState = touching ? "attack" : "float";
      }
      if (newState !== this.animState) {
        this.animState = newState;
        this.animFrame = 0;
        this.animTimer = 0;
      }
      this.advanceFrames(dt);
    }
  }

  // Bone Mage brain: blink to keep distance, curse the ground on cooldown.
  updateCaster(dt, player, len, hazards) {
    const c = this.def.caster;

    if (this.blinkCooldown > 0) this.blinkCooldown -= dt;
    // Reposition (gated by the blink cooldown so it can't spam-blink): shove off if
    // the witch crowds it, or phase-step TOWARD her if she's beyond cast range so it
    // doesn't sit idle out of range. blink() reads the distance to pick the direction.
    if (len < c.blinkRange && this.blinkCooldown <= 0) this.blink(player, c);
    else if (len > c.fireRange && this.blinkCooldown <= 0) this.blink(player, c);

    // Curse the witch's CURRENT spot on cooldown, then blink off its own rune so
    // casts come from varied angles and it never gets pinned.
    this.fireTimer -= dt;
    if (this.fireTimer <= 0 && len <= c.fireRange && hazards) {
      hazards.push(new HazardZone(player.x, player.y, c.blastRadius, c.telegraph, c.blastDamage));
      this.fireTimer = c.castCooldown + randomRange(-0.5, 0.5);
      this.attackPoseTimer = MAGE_ATTACK_POSE_SECONDS;
      this.facing = dirFromVector(player.x - this.x, player.y - this.y); // face the cast
      playSfx("mage_cast"); // missing file = silent (registry is graceful)
      this.blink(player, c);
    }
    if (this.attackPoseTimer > 0) this.attackPoseTimer -= dt;

    // Age the phase-step poof rings.
    for (const f of this.blinkFx) f.t -= dt;
    this.blinkFx = this.blinkFx.filter((f) => f.t > 0);
  }

  // Phase-step: vanish (poof at the old spot) and reappear a fixed distance away,
  // clamped to the floor. Direction depends on spacing: it closes the gap when the
  // witch is beyond cast range (so it stops stranding itself idle), shoves off when
  // she crowds it, and otherwise drifts off its own rune for varied cast angles.
  // Same fixed step distance either way — it phase-steps, it never walk-chases.
  blink(player, c) {
    const dx = player.x - this.x;
    const dy = player.y - this.y;
    const len = Math.hypot(dx, dy) || 1; // guard a zero-length overlap
    const toward = Math.atan2(dy, dx);
    // toward when too far to cast; otherwise away (toward + PI == the old behavior).
    const base = len > c.fireRange ? toward : toward + Math.PI;
    const ang = base + randomRange(-0.8, 0.8);
    const dest = clampToPlayfield(
      this.x + Math.cos(ang) * c.blinkDist,
      this.y + Math.sin(ang) * c.blinkDist,
      this.radius
    );
    this.blinkFx.push({ x: this.x, y: this.y, t: BLINK_FX_LIFE });
    this.x = dest.x;
    this.y = dest.y;
    this.blinkFx.push({ x: this.x, y: this.y, t: BLINK_FX_LIFE });
    this.blinkCooldown = MAGE_BLINK_COOLDOWN;
  }

  // Goblin Bonker brain: chase -> COMMIT (a locked forward LEAP) -> radial STOMP
  // (telegraph + blast + knockback) -> recover. The leap closes distance so slow
  // kiting isn't free; the stomp is a CIRCLE HazardZone centered on the landing
  // spot, so orbiting around it no longer dodges and game.js handles the
  // telegraph/hit/knockback. Drives its own facing + animation: WALK while
  // advancing; a progress-driven ATTACK pose while leaping/planted.
  updateBruiser(dt, player, len, hazards) {
    const b = this.def.bruiser;
    const attackFrames = ENEMY_ANIMS.goblin.anims.attack; // 6
    if (this.attackCd > 0) this.attackCd -= dt;

    if (this.attackState === "leap") {
      // Quick committed hop along the LOCKED aim. No hazard yet — the leap
      // itself is the tell; the stomp ring spawns where it lands.
      const step = (this.leapDist / GOBLIN_LUNGE_TIME) * dt;
      this.x += Math.cos(this.swingAng) * step;
      this.y += Math.sin(this.swingAng) * step;
      this.leapTimer -= dt;
      this.animState = "attack";
      this.animFrame = 0; // rear-back pose during the lunge
      if (this.leapTimer <= 0 && hazards) {
        // Landed: drop the radial stomp centered HERE. telegraph == windup, so
        // it detonates exactly as the windup phase ends (same as the old swing).
        hazards.push(new HazardZone(this.x, this.y, b.stompRadius, b.windup, b.swingDamage, {
          shape: "circle", skin: "stomp",
          knockback: b.knockback, ox: this.x, oy: this.y, sfx: "goblin_bonk",
        }));
        this.attackState = "windup";
        this.attackTimer = b.windup;
      }
      return;
    }

    if (this.attackState === "windup") {
      this.attackTimer -= dt; // planted; facing stays locked from when it committed
      const p = 1 - Math.max(0, this.attackTimer) / b.windup; // 0 -> 1
      // Wind-up rides the early frames; the FINAL frame is the slam itself.
      this.animState = "attack";
      this.animFrame = Math.min(attackFrames - 2, Math.floor(p * (attackFrames - 1)));
      if (this.attackTimer <= 0) {
        this.attackState = "recover";
        this.attackTimer = b.recover;
        this.animFrame = attackFrames - 1; // snap to the slam frame as it connects
      }
      return;
    }

    if (this.attackState === "recover") {
      this.attackTimer -= dt; // planted; hold the slam frame (winded follow-through)
      this.animState = "attack";
      this.animFrame = attackFrames - 1;
      if (this.attackTimer <= 0) {
        this.attackState = "chase";
        this.attackCd = b.cooldown;
      }
      return;
    }

    // --- chase ---
    this.facing = dirFromVector(player.x - this.x, player.y - this.y);
    if (len > b.approachRange) {
      this.x += ((player.x - this.x) / len) * this.speed * dt;
      this.y += ((player.y - this.y) / len) * this.speed * dt;
      if (this.animState !== "walk") { this.animState = "walk"; this.animFrame = 0; this.animTimer = 0; }
      this.advanceFrames(dt);
      return;
    }
    if (this.attackCd <= 0 && hazards) {
      // In range + off cooldown: COMMIT. Lock the aim and LEAP toward the witch
      // (capped at the current distance so it doesn't sail past). The stomp ring
      // spawns when the leap lands, in the "leap" branch above.
      const ang = Math.atan2(player.y - this.y, player.x - this.x);
      this.swingAng = ang;
      this.facing = dirFromVector(Math.cos(ang), Math.sin(ang));
      this.leapDist = Math.min(b.lunge, len); // don't overshoot the witch's spot
      this.leapTimer = GOBLIN_LUNGE_TIME;
      this.attackState = "leap";
      this.animState = "attack";
      this.animFrame = 0;
      this.animTimer = 0;
      playSfx("goblin_windup"); // the lunge tell (missing file = silent)
      return;
    }
    // In range but still on cooldown — shuffle in place (walk loop).
    if (this.animState !== "walk") { this.animState = "walk"; this.animFrame = 0; this.animTimer = 0; }
    this.advanceFrames(dt);
  }

  // Pronggeist brain. SHUFFLE into a mid-range standoff (with a perpendicular
  // wobble so it never runs on rails), then PLANT and LOCK a thin spike line at
  // the witch's CURRENT spot. The locked line does NOT track — stepping out of the
  // narrow corridor before it erupts is the whole dodge. It freezes a single walk
  // frame while planted (no attack strip by design). The spike line is a rotated-
  // rect HazardZone (skin "spikes"): game.js updates/draws/collides it for free.
  updatePronggeist(dt, player, len, hazards) {
    const lc = this.def.lineCaster;
    const dx = player.x - this.x, dy = player.y - this.y;
    this.ppTimer -= dt;

    if (this.ppPhase === "shuffle") {
      // Ease toward a comfortable casting distance: close in if far, back off if
      // crowded, hold otherwise — plus a sideways drift so firing angles vary.
      let mx = 0, my = 0;
      if (len > lc.castRange * 0.7)        { mx = dx / len;  my = dy / len; }  // too far
      else if (len < lc.castRange * 0.35)  { mx = -dx / len; my = -dy / len; } // too close
      const strafe = Math.sin(this.wobble * 0.6) * 0.6;
      mx += (-dy / len) * strafe;
      my += (dx / len) * strafe;
      const mlen = Math.hypot(mx, my);
      if (mlen > 1) { mx /= mlen; my /= mlen; }
      this.x += mx * this.speed * dt;
      this.y += my * this.speed * dt;

      this.facing = dirFromVector(dx, dy); // faces the witch while repositioning
      if (this.animState !== "walk") { this.animState = "walk"; this.animFrame = 0; this.animTimer = 0; }
      this.advanceFrames(dt);

      // Shuffle window up: plant + cast if she's in range; otherwise reset the
      // window so it keeps closing the gap instead of casting at empty floor.
      if (this.ppTimer <= 0) {
        if (len <= lc.castRange && hazards) {
          // LOCK the aim NOW. Center the rect half a line-length along the aim so
          // the corridor STARTS at the fork and reaches out to the locked spot.
          const ang = Math.atan2(dy, dx);
          // Each prong reaches from the fork to just PAST the locked spot, so a cast
          // always threatens where she stood (clamped: point-blank still shows a
          // band; max-range isn't absurdly long).
          const reach = clamp(len + lc.lineOvershoot, lc.lineMin, lc.lineMax);
          // Lock a BAND of parallel prongs (a fork's tines) straddling the aim line,
          // so she's dead-center and must clear the whole band sideways. Gaps stay
          // tighter than her body, so there's no safe slot between tines. Only the
          // first prong carries the eruption SFX (4 at once would quadruple it).
          const px = -Math.sin(ang), py = Math.cos(ang); // unit perpendicular to the aim
          for (let i = 0; i < lc.prongs; i++) {
            const off = (i - (lc.prongs - 1) / 2) * lc.prongGap; // centered offsets
            const cx = this.x + px * off + Math.cos(ang) * (reach / 2);
            const cy = this.y + py * off + Math.sin(ang) * (reach / 2);
            hazards.push(new HazardZone(cx, cy, 0, lc.telegraph, lc.damage, {
              shape: "rect", angle: ang, length: reach, width: lc.prongWidth,
              skin: "spikes", sfx: i === 0 ? lc.spikesSfx : null, knockback: 0,
            }));
          }
          this.facing = dirFromVector(Math.cos(ang), Math.sin(ang)); // face the cast
          this.ppPhase = "cast";
          this.ppTimer = lc.castWait;     // stay planted through telegraph + eruption + recovery
          this.animState = "walk";
          this.animFrame = lc.castFrame;  // freeze a "planted" frame (no attack anim)
          this.animTimer = 0;
        } else {
          this.ppTimer = lc.shuffleTime;  // out of range — shuffle again toward her
        }
      }
    } else {
      // CAST: planted + frozen. The HazardZone owns the telegraph -> eruption ->
      // fade; the fork just holds its locked frame until recovery elapses.
      this.animState = "walk";
      this.animFrame = lc.castFrame;
      if (this.ppTimer <= 0) {
        this.ppPhase = "shuffle";
        this.ppTimer = lc.shuffleTime;
      }
    }
  }

  // Tin Bulwark brain: advance toward a wall-casting distance, PLANT, and raise a
  // broadside PUSH WALL centered on the witch (she sits at its rear edge, so the
  // full thickness shoves her AWAY from the Bulwark — toward whatever's behind her).
  // The wall is a rect HazardZone in "push" mode (no damage; game.js draws + shoves
  // for free). Drives its own 4-way facing + animation: WALK while advancing, a
  // frozen frame while planted. The push is LOCKED at cast time — she dodges by
  // sidestepping the telegraphed wall during the windup.
  updateBulwark(dt, player, len, hazards) {
    const bw = this.def.bulwark;
    const dx = player.x - this.x, dy = player.y - this.y;
    this.tbTimer -= dt;

    if (this.tbPhase === "approach") {
      // Ease toward a comfortable casting distance: close in if far, back off if
      // crowded, hold otherwise — plus a slight strafe so the push angle varies.
      let mx = 0, my = 0;
      if (len > bw.castRange * 0.8)        { mx = dx / len;  my = dy / len; }  // too far
      else if (len < bw.castRange * 0.35)  { mx = -dx / len; my = -dy / len; } // too close
      const strafe = Math.sin(this.wobble * 0.5) * 0.4;
      mx += (-dy / len) * strafe;
      my += (dx / len) * strafe;
      const mlen = Math.hypot(mx, my);
      if (mlen > 1) { mx /= mlen; my /= mlen; }
      this.x += mx * this.speed * dt;
      this.y += my * this.speed * dt;

      this.facing = dir4(dx, dy); // cardinal-only art
      if (this.animState !== "walk") { this.animState = "walk"; this.animFrame = 0; this.animTimer = 0; }
      this.advanceFrames(dt);

      // Approach window up: plant + wall if she's in range; otherwise reset it so
      // it keeps closing the gap instead of walling empty floor.
      if (this.tbTimer <= 0) {
        if (len <= bw.castRange && hazards) {
          // Push AWAY from the Bulwark (bulwark -> witch). Center the wall a half-
          // thickness PAST her along that line, so she's at the rear edge and the
          // whole depth shoves her forward. Long axis is broadside to the push.
          const pushAng = Math.atan2(dy, dx);
          const cx = player.x + Math.cos(pushAng) * (bw.wallThick / 2);
          const cy = player.y + Math.sin(pushAng) * (bw.wallThick / 2);
          hazards.push(new HazardZone(cx, cy, 0, bw.windup, 0, {
            shape: "rect",
            angle: pushAng + Math.PI / 2, // long axis perpendicular to the shove
            length: bw.wallWidth,
            width: bw.wallThick,
            skin: "wall",
            push: bw.pushSpeed,
            pushAngle: pushAng,
            driftSpeed: bw.wallSpeed, // moving wall: advances along the push, locked at cast
            activeDuration: bw.active,
            sfx: bw.wallSfx,
          }));
          playSfx(bw.chargeSfx); // windup cue (graceful if missing)
          this.facing = dir4(dx, dy);
          this.tbPhase = "cast";
          this.tbTimer = bw.windup + bw.active + bw.recover; // planted through the whole wall + recovery
          this.animState = "walk";
          this.animFrame = bw.castFrame; // freeze a planted frame (no attack anim)
          this.animTimer = 0;
        } else {
          this.tbTimer = bw.approachTime; // out of range — keep advancing
        }
      }
    } else {
      // CAST: planted + frozen. The wall HazardZone owns telegraph -> push -> fade;
      // the Bulwark just holds its locked frame until recovery elapses.
      this.animState = "walk";
      this.animFrame = bw.castFrame;
      if (this.tbTimer <= 0) {
        this.tbPhase = "approach";
        this.tbTimer = bw.approachTime;
      }
    }
  }

  // Step the current animation. Both anims loop; the non-looping branch is
  // kept for parity with the player/familiar steppers in case a one-shot
  // (e.g. a future death anim) is added later.
  advanceFrames(dt) {
    const cfg = ENEMY_ANIMS[this.def.spritePrefix];
    const fps = cfg.fps[this.animState];
    const frameCount = cfg.anims[this.animState];
    const frameDur = 1 / fps;
    const loops = cfg.looping[this.animState];

    this.animTimer += dt;
    while (this.animTimer >= frameDur) {
      this.animTimer -= frameDur;
      if (loops) {
        this.animFrame = (this.animFrame + 1) % frameCount;
      } else if (this.animFrame < frameCount - 1) {
        this.animFrame += 1;
      } else {
        break;
      }
    }
  }

  // Per-axis half-extent used for wall clamping: the larger of the gameplay
  // hitbox and the loaded sprite's drawn half-size, so the whole body stays off
  // the wall. Width/height handled separately so a tall sprite isn't pushed
  // needlessly far from the side walls. Hitbox fallback before art loads.
  boundaryHalfExtent() {
    const cfg = ENEMY_ANIMS[this.def.spritePrefix];
    const key = `${this.def.spritePrefix}_${this.animState}_${this.facing}`;
    const img = getImage(key);
    if (img && img.width > 0 && cfg) {
      const frames = cfg.anims[this.animState] || 1;
      const halfW = (img.width / frames) * this.spriteScale / 2;
      const halfH = img.height * this.spriteScale / 2;
      return { x: Math.max(this.radius, halfW), y: Math.max(this.radius, halfH) };
    }
    return { x: this.radius, y: this.radius };
  }

  takeDamage(amount) {
    this.health -= amount;
    this.hitFlash = 0.1;
    if (this.health <= 0) this.dead = true;
  }

  draw(ctx) {
    // Phase-step poofs: an expanding, fading ring at each end of a blink.
    if (this.blinkFx && this.blinkFx.length) {
      for (const f of this.blinkFx) {
        const p = 1 - f.t / BLINK_FX_LIFE; // 0 -> 1 over its life
        const r = 6 + p * (this.radius + 10);
        ctx.save();
        ctx.globalAlpha = (1 - p) * 0.7;
        ctx.strokeStyle = "#b48cff";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(f.x, f.y, r, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
    }

    const flash = this.hitFlash > 0;
    const key = `${this.def.spritePrefix}_${this.animState}_${this.facing}`;
    const img = getImage(key);

    // --- Sprite path (real art) ---
    if (img && img.width > 0) {
      const frames = ENEMY_ANIMS[this.def.spritePrefix].anims[this.animState];
      const fw = img.width / frames;
      const fh = img.height;
      const dw = fw * this.spriteScale;
      const dh = fh * this.spriteScale;
      const sx = Math.floor(this.animFrame) * fw;

      ctx.save();
      ctx.drawImage(img, sx, 0, fw, fh, this.x - dw / 2, this.y - dh / 2, dw, dh);

      // Brief white hit flash: redraw the same frame additively so damage still
      // reads on the sprite (cheap; no offscreen canvas / tinting needed).
      if (flash) {
        ctx.globalAlpha = 0.55;
        ctx.globalCompositeOperation = "lighter";
        ctx.drawImage(img, sx, 0, fw, fh, this.x - dw / 2, this.y - dh / 2, dw, dh);
      }
      ctx.restore();
      return;
    }

    // --- Fallback placeholder blob (per-direction, if a strip is missing) ---
    // Type-colored: wisps keep their original red; the Gutter Gecko is teal.
    ctx.save();
    const r = this.radius + Math.sin(this.wobble) * 1.5;

    ctx.shadowColor = this.def.fallbackOuter;
    ctx.shadowBlur = 14;
    ctx.fillStyle = flash ? "#ffffff" : this.def.fallbackOuter;
    ctx.beginPath();
    ctx.arc(this.x, this.y, r, 0, Math.PI * 2);
    ctx.fill();

    ctx.shadowBlur = 0;
    ctx.fillStyle = flash ? "#ffd0d8" : this.def.fallbackInner;
    ctx.beginPath();
    ctx.arc(this.x, this.y, r * 0.5, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }
}

// Spawn just OUTSIDE the current viewport so wisps approach from the screen
// edges wherever the player is, then clamp into the world so none spawn out of
// bounds. `view` = { camX, camY, viewW, viewH, worldW, worldH }.
function spawnOutsideView(view, margin = 40) {
  const left = view.camX;
  const top = view.camY;
  const right = view.camX + view.viewW;
  const bottom = view.camY + view.viewH;

  const edge = randomInt(0, 3); // 0 top, 1 right, 2 bottom, 3 left
  let x, y;
  if (edge === 0)      { x = randomRange(left, right);  y = top - margin; }
  else if (edge === 1) { x = right + margin;            y = randomRange(top, bottom); }
  else if (edge === 2) { x = randomRange(left, right);  y = bottom + margin; }
  else                 { x = left - margin;             y = randomRange(top, bottom); }

  return {
    x: clamp(x, 0, view.worldW),
    y: clamp(y, 0, view.worldH),
  };
}

// --- Playfield bounds (the walkable floor inside the wall ring) --------------
// The arena has a one-tile (WALL_INSET) wall border. Enemies, boss summons,
// hop targets, and slam markers must stay on the FLOOR accounting for their
// own body radius — otherwise things spawn/land half-buried in the wall and,
// near the world edge, sit outside the camera view. The WaveManager refreshes
// PLAYFIELD from the live view each frame; clampToPlayfield(x, y, radius)
// keeps a body fully on the floor.
const WALL_INSET = 32; // matches game.js TILE wall ring
const PLAYFIELD = { worldW: 2400, worldH: 1344 };

function clampToPlayfield(x, y, radius = 0, radiusY = radius) {
  const mx = WALL_INSET + radius;
  const my = WALL_INSET + radiusY;
  return {
    x: clamp(x, mx, PLAYFIELD.worldW - mx),
    y: clamp(y, my, PLAYFIELD.worldH - my),
  };
}

// --- Soft crowd separation (regular enemies only) ----------------------------
// Why: every regular enemy homes on the witch's EXACT position with zero
// awareness of its neighbors, so a swarm converges to one point and N sprites
// stack into a single blob (the wisp readability complaint). This is a gentle
// post-MOVEMENT nudge — NOT a physics collider. For each overlapping pair it
// pushes both apart by a FRACTION of the overlap (scaled by each one's weight),
// the push shrinking to zero exactly at "just touching", so they ease apart
// instead of snapping (no jitter, no rigid lattice). It only pushes enemies off
// EACH OTHER, never off the witch, so the swarm still surrounds her and melee
// can still reach her — swarm pressure is preserved.
//
// Scope is data-driven + deliberately narrow: only enemies whose ENEMY_TYPES row
// carries `separationWeight > 0` take part (wisp + gecko for now). The stationary
// Bone Mage and the committed-attack types (Goblin / Pronggeist / Tin Bulwark)
// have no weight, so they're skipped and their locked positions are never
// disturbed; bosses are separate classes with no `.def` and are skipped too.
// Pairwise is correct here: the on-screen cap is ~18 (12 base + the Teeming
// curse's +6), i.e. at most ~150 distance checks/frame — a spatial grid would be
// over-engineering at this count.
const SEPARATION_PUSH = 0.3;     // fraction of the (above-deadband) overlap each enemy
                                 // moves per frame; <0.5 so a pair eases apart over a
                                 // few frames rather than snapping (raise = firmer)
const SEPARATION_DEADBAND = 2;   // px of overlap to ignore, and the point the push fades
                                 // to zero — stops micro-jitter at the contact boundary
const SEPARATION_MAX_STEP = 6;   // px hard cap on one enemy's separation move per frame
                                 // (well under enemy speed; stops a deep pileup launching)

// Mutates `enemies` in place: call ONCE per frame, AFTER every enemy.update() and
// BEFORE player-contact checks (so the witch is hit at each enemy's resolved spot).
export function separateEnemies(enemies) {
  // Gather only the participants once (skips dead enemies, bosses [no .def], and
  // any type without a separationWeight). Zero the per-frame accumulator here so
  // the result never depends on a previous frame.
  const movers = [];
  for (const e of enemies) {
    if (e.dead || !e.def || !e.def.separationWeight) continue;
    e._sepX = 0;
    e._sepY = 0;
    movers.push(e);
  }
  if (movers.length < 2) return;

  // Accumulate pushes over every unique pair (upper triangle), then apply once —
  // so a still pair separates symmetrically regardless of array order.
  for (let i = 0; i < movers.length; i++) {
    const a = movers[i];
    for (let j = i + 1; j < movers.length; j++) {
      const b = movers[j];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const minDist = a.radius + b.radius; // both 13 -> 26px of personal space
      const distSq = dx * dx + dy * dy;
      if (distSq >= minDist * minDist) continue; // not overlapping

      let dist = Math.sqrt(distSq);
      let nx, ny;
      if (dist > 1e-4) {
        nx = dx / dist;
        ny = dy / dist;
      } else {
        // Exactly coincident (the "stacked into one sprite" case): split along a
        // stable per-enemy angle so they fan out and we never divide by zero.
        nx = Math.cos(a.wobble);
        ny = Math.sin(a.wobble);
        dist = 0;
      }

      const overlap = minDist - dist;
      if (overlap <= SEPARATION_DEADBAND) continue;
      const push = (overlap - SEPARATION_DEADBAND) * SEPARATION_PUSH;
      // Each enemy yields in proportion to its OWN weight: a light gecko holds its
      // range better while a wisp gives way more readily.
      a._sepX -= nx * push * a.def.separationWeight;
      a._sepY -= ny * push * a.def.separationWeight;
      b._sepX += nx * push * b.def.separationWeight;
      b._sepY += ny * push * b.def.separationWeight;
    }
  }

  // Apply the accumulated nudges (magnitude-capped), then re-clamp to the floor so
  // nothing is shoved into or through the wall ring. Uses the live PLAYFIELD the
  // WaveManager refreshes each frame.
  for (const e of movers) {
    let sx = e._sepX;
    let sy = e._sepY;
    if (!sx && !sy) continue;
    const m = Math.hypot(sx, sy);
    if (m > SEPARATION_MAX_STEP) {
      const k = SEPARATION_MAX_STEP / m;
      sx *= k;
      sy *= k;
    }
    const pos = clampToPlayfield(e.x + sx, e.y + sy, e.radius);
    e.x = pos.x;
    e.y = pos.y;
  }
}

// --- Boss: Elder Wisp (Wave 10) ------------------------------------------
// Tunable constants (Endless can later pass a higher `tier` for tougher bosses).
const BOSS_HEALTH = 50;
const BOSS_DAMAGE = 20;
const BOSS_SPEED = 60;           // slightly slower than normal wisps (75)
const BOSS_DASH_COOLDOWN = 5;    // seconds between dashes
const BOSS_DASH_TELEGRAPH = 0.85; // wind-up warning before the dash (more time to dodge)
const BOSS_DASH_DURATION = 0.45; // length of the dash burst (reach = SPEED * DURATION)
const BOSS_DASH_SPEED = 640;     // dash velocity (640 * 0.45 = ~288px reach; slower charge than 720)
const BOSS_DASH_CONTACT_RADIUS = 22; // tighter body hitbox DURING the dash only (radius
                                 // stays 30 for bolt targeting). The dash barrels through
                                 // at 640px/s, so the full 30 swept a too-wide corridor;
                                 // 22 (+player ~16 = ~38px) narrows it. Bump toward 26 if
                                 // the dash now feels like it passes through you.
const BOSS_SUMMON_COOLDOWN = 13;     // base seconds between summon waves (was 9)
const BOSS_SUMMON_JITTER = 4;        // + up to this many seconds, so summons aren't clockwork
const BOSS_SUMMON_BATCH = 3;         // wisps queued per summon wave
const BOSS_SUMMON_RELEASE_GAP = 0.7; // seconds between each staggered add (so they don't pop at once)
const BOSS_WOBBLE_DRIFT = 55;    // px/s side-to-side amplitude

// --- Elder Wisp boss sprites (visual only) -------------------------------
// 8-direction FLOAT (4 frames, loops) used during normal movement, plus a
// 2-frame CHARGE that is STATE-DRIVEN, not looped: frame 0 plays during the
// dash wind-up (telegraph) and frame 1 during the release (dashing). Single-
// row strips in assets/sprites/enemies/, sliced at draw time. Missing/loading
// strips fall back to the placeholder boss draw, per direction — no crashes,
// no per-frame console spam.
const BOSS_FLOAT_FRAMES = 4;
const BOSS_CHARGE_FRAMES = 2;
const BOSS_FLOAT_FPS = 6;               // float loop speed
const BOSS_DASH_LINE_COLOR = "#D475ED"; // dash/charge telegraph line color

// Register 8 dirs x (float 4f + charge 2f) = 16 strips (graceful fallback).
for (const anim of ["float", "charge"]) {
  for (const d of WISP_DIRS) {
    const key = `elder_wisp_${anim}_${d}`;
    loadImage(key, `assets/sprites/enemies/${key}.png`);
  }
}

export class Boss {
  constructor(x, y, tier = 1) {
    this.x = x;
    this.y = y;
    this.radius = 30;            // large placeholder
    this.tier = tier;           // future Endless scaling hook

    this.maxHealth = BOSS_HEALTH * tier;
    this.health = this.maxHealth;
    this.damage = BOSS_DAMAGE + (tier - 1) * 5;
    this.speed = BOSS_SPEED;

    this.dead = false;
    this.hitFlash = 0;
    this.isBoss = true;
    this.name = "Elder Wisp";

    this.wobble = Math.random() * Math.PI * 2;
    this.phase = "normal";       // "normal" | "telegraph" | "dashing"
    this.dashCooldownTimer = BOSS_DASH_COOLDOWN;
    this.telegraphTimer = 0;
    this.dashTimer = 0;
    this.dashVX = 0;
    this.dashVY = 0;
    this.aimX = 0;
    this.aimY = 1;

    // Animation (visual only). Float loops; the charge frame is chosen by phase.
    this.facing = "s";
    this.animFrame = randomInt(0, BOSS_FLOAT_FRAMES - 1); // randomized float start
    this.animTimer = 0;
    this.spriteScale = 1.0; // tune once art is in (boss radius 30; native px * this)

    this.summonTimer = BOSS_SUMMON_COOLDOWN;
    this.summonPending = 0;      // adds queued by a summon wave, released one at a time
    this.summonReleaseTimer = 0; // gap between staggered releases
  }

  update(dt, player) {
    this.wobble += dt * 3;
    if (this.hitFlash > 0) this.hitFlash -= dt;

    // Summon timer: when it fires, QUEUE a batch of adds (released one at a
    // time below) and re-arm with a little jitter so summons aren't clockwork.
    this.summonTimer -= dt;
    if (this.summonTimer <= 0) {
      this.summonPending += BOSS_SUMMON_BATCH;
      this.summonTimer = BOSS_SUMMON_COOLDOWN + Math.random() * BOSS_SUMMON_JITTER;
    }
    if (this.summonPending > 0) this.summonReleaseTimer -= dt;

    if (this.phase === "normal") {
      this.moveToward(player, dt, this.speed, true);
      this.dashCooldownTimer -= dt;
      if (this.dashCooldownTimer <= 0) {
        this.phase = "telegraph";
        this.telegraphTimer = BOSS_DASH_TELEGRAPH;
        playSfx("elder_wisp_charge"); // dash wind-up warning (missing file = silent)
      }
    } else if (this.phase === "telegraph") {
      // Brace + aim; lock the dash direction when the wind-up ends.
      const dx = player.x - this.x;
      const dy = player.y - this.y;
      const len = Math.hypot(dx, dy) || 1;
      this.aimX = dx / len;
      this.aimY = dy / len;
      this.telegraphTimer -= dt;
      if (this.telegraphTimer <= 0) {
        this.dashVX = this.aimX * BOSS_DASH_SPEED;
        this.dashVY = this.aimY * BOSS_DASH_SPEED;
        this.phase = "dashing";
        this.dashTimer = BOSS_DASH_DURATION;
      }
    } else if (this.phase === "dashing") {
      this.x += this.dashVX * dt;
      this.y += this.dashVY * dt;
      this.dashTimer -= dt;
      if (this.dashTimer <= 0) {
        this.phase = "normal";
        this.dashCooldownTimer = BOSS_DASH_COOLDOWN;
      }
    }

    // --- Animation (visual only) ---
    // Normal: face the player and loop the Float strip. Telegraph/dashing:
    // face the locked dash vector (the charge frame is picked from the phase
    // at draw time, so it isn't stepped here).
    if (this.phase === "normal") {
      this.facing = dirFromVector(player.x - this.x, player.y - this.y);
      const frameDur = 1 / BOSS_FLOAT_FPS;
      this.animTimer += dt;
      while (this.animTimer >= frameDur) {
        this.animTimer -= frameDur;
        this.animFrame = (this.animFrame + 1) % BOSS_FLOAT_FRAMES;
      }
    } else {
      this.facing = dirFromVector(this.aimX, this.aimY);
    }
  }

  // Returns true at most once per release gap while adds are queued, so game.js
  // can spawn ONE summoned wisp at a time (staggered) instead of a burst.
  consumeSummon() {
    if (this.summonPending > 0 && this.summonReleaseTimer <= 0) {
      this.summonPending -= 1;
      this.summonReleaseTimer = BOSS_SUMMON_RELEASE_GAP;
      return true;
    }
    return false;
  }

  moveToward(player, dt, speed, wobble) {
    const dx = player.x - this.x;
    const dy = player.y - this.y;
    const len = Math.hypot(dx, dy) || 1;
    const nx = dx / len;
    const ny = dy / len;
    this.x += nx * speed * dt;
    this.y += ny * speed * dt;
    if (wobble) {
      // Perpendicular side-to-side drift for an erratic float.
      const drift = Math.sin(this.wobble) * BOSS_WOBBLE_DRIFT * dt;
      this.x += -ny * drift;
      this.y += nx * drift;
    }
  }

  takeDamage(amount) {
    this.health -= amount;
    this.hitFlash = 0.08;
    if (this.health <= 0) this.dead = true;
  }

  // Player-contact hitbox. Full `radius` normally (a fair, hittable body), but
  // tighter while DASHING so the fast sweep doesn't clip the witch from a
  // distance. game.js prefers this over `radius` for contact damage only;
  // bolt-targeting and Spirit Bond still use the full `radius`.
  get contactRadius() {
    return this.phase === "dashing" ? BOSS_DASH_CONTACT_RADIUS : this.radius;
  }

  draw(ctx) {
    ctx.save();
    const flash = this.hitFlash > 0;

    // Telegraph: scrolling chevrons marching along the exact dash path, so the
    // warning length always matches the real reach (SPEED * DURATION).
    if (this.phase === "telegraph") {
      const reach = BOSS_DASH_SPEED * BOSS_DASH_DURATION;
      const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 70);

      ctx.save();
      ctx.translate(this.x, this.y);
      ctx.rotate(Math.atan2(this.aimY, this.aimX));
      ctx.strokeStyle = BOSS_DASH_LINE_COLOR;
      ctx.lineWidth = 3;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";

      const spacing = 26;  // px between chevrons
      const size = 9;      // arm length of each ">"
      const start = 22;    // first chevron sits just past the boss body
      const scroll = ((performance.now() / 1000) * 80) % spacing; // marches outward

      for (let x = start; x <= reach; x += spacing) {
        const cx = x + scroll;
        if (cx > reach) continue;
        // Fade in just past the boss and out near the tip so the march has no pop.
        const fade = Math.min(1, (cx - start) / spacing) * Math.min(1, (reach - cx) / spacing);
        ctx.globalAlpha = (0.4 + 0.45 * pulse) * fade;
        ctx.beginPath();
        ctx.moveTo(cx - size, -size);
        ctx.lineTo(cx, 0);
        ctx.lineTo(cx - size, size);
        ctx.stroke();
      }
      ctx.restore();
    }

    // --- Sprite path: directional Float (normal) or state-driven Charge ---
    // The charge frame comes from the phase: telegraph = frame 0 (wind-up),
    // dashing = frame 1 (release). Float uses the looping frame from update().
    const charging = this.phase === "telegraph" || this.phase === "dashing";
    const anim = charging ? "charge" : "float";
    const frames = charging ? BOSS_CHARGE_FRAMES : BOSS_FLOAT_FRAMES;
    const img = getImage(`elder_wisp_${anim}_${this.facing}`);

    if (img && img.width > 0) {
      const frameIndex = charging
        ? (this.phase === "dashing" ? 1 : 0)
        : Math.floor(this.animFrame) % frames;
      const fw = img.width / frames;
      const fh = img.height;
      const dw = fw * this.spriteScale;
      const dh = fh * this.spriteScale;
      const sx = frameIndex * fw;
      // Snap the destination to whole pixels so the 116x116 art stays crisp —
      // sub-pixel positions soften pixel art even with image smoothing off.
      const dx = Math.round(this.x - dw / 2);
      const dy = Math.round(this.y - dh / 2);

      ctx.drawImage(img, sx, 0, fw, fh, dx, dy, dw, dh);

      // Brief white hit flash: additive redraw of the same frame (matches the
      // Wisp), so damage reads on the sprite without offscreen tinting.
      if (flash) {
        ctx.globalAlpha = 0.55;
        ctx.globalCompositeOperation = "lighter";
        ctx.drawImage(img, sx, 0, fw, fh, dx, dy, dw, dh);
      }
      ctx.restore();
      return;
    }

    // --- Fallback placeholder boss (used if a strip is missing/loading) ---
    // Body.
    ctx.shadowColor = "#e2536b";
    ctx.shadowBlur = 24;
    ctx.fillStyle = flash ? "#ffffff" : (this.phase === "dashing" ? "#ff8a5b" : "#c33a52");
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
    ctx.fill();

    ctx.shadowBlur = 0;
    ctx.fillStyle = flash ? "#ffd0d8" : "#5a0f1c";
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.radius * 0.5, 0, Math.PI * 2);
    ctx.fill();

    // Menacing gold eyes.
    ctx.fillStyle = "#f4d58d";
    ctx.beginPath(); ctx.arc(this.x - 10, this.y - 5, 3.5, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(this.x + 10, this.y - 5, 3.5, 0, Math.PI * 2); ctx.fill();

    ctx.restore();
  }
}

// --- Endless scaling (tunable) -------------------------------------------
// Tier = how many full blocks of 10 waves have passed: 0 for waves 1-10,
// 1 for 11-20, 2 for 21-30, ... Tutorial only ever reaches tier 0.
const ENEMY_SPEED_PER_TIER = 12;   // px/s added to wisp speed per tier
const ENEMY_HP_PER_TIER = 1;       // +HP to wisps per tier
const COUNT_PER_TIER = 3;          // extra wisps in the wave budget per tier
const SPAWN_DELAY_PER_TIER = 0.05; // spawn interval shaved per tier...
// Cursed Mode: a flat "harder from wave 1" bump applied on top of the normal
// per-wave/per-tier scaling (the FASTER escalation comes from the every-5 tier
// cadence — see reset()/endlessTier()). The stacking curses carry the rest.
const CURSED_SPEED_MULT = 1.12;    // enemies a touch faster from the start
const CURSED_HP_MULT = 1.12;       // a little tankier (trimmed from 1.25): the 2x-faster tier
                                   //   cadence + per-type healthMults still make Cursed clearly
                                   //   tankier than normal — the DANGER now comes from offense,
                                   //   not from a damage-sponge baseline.
const CURSED_DAMAGE_MULT = 1.20;   // Cursed enemies HIT HARDER from wave 1 (previously the game
                                   //   had NO damage scaling at all). A flat bump to CONTACT
                                   //   damage so getting surrounded actually hurts (the wisp
                                   //   swarm's 8 -> 10). Specials keep their tuned damage (mage
                                   //   blast / goblin stomp / gecko bolt / pronggeist eruption
                                   //   live in their own fields), and the Brittle curse already
                                   //   amplifies ALL incoming damage x1.5 later.
const MIN_SPAWN_INTERVAL = 0.35;   // ...but never faster than this

// Hard ceiling on a REGULAR enemy's final move speed (px/s), exported because the
// Quickening live-rescale in game.js must respect it too. The witch's move speed is
// a fixed 220 with no upgrade path, so without a cap the wave-scaled base x Cursed
// x Quickening eventually exceeds 220 and kiting becomes impossible (worst with
// Quickening, ~wave 15+ in Cursed). 205 keeps the witch a ~7% edge — always
// kiteable, still threatening. Bosses are EXEMPT (separate tuned classes). This only
// ever binds in deep/Cursed runs; normal Tutorial/Casual speeds never approach it.
export const MAX_ENEMY_SPEED = 205;

// --- Post-opening pacing (1.12.0, NON-Cursed) ----------------------------
// The base spawn gap (spawnInterval) sits FLAT across the whole opening run
// (tier 0 = waves 1-10): the per-tier shave above only starts at wave 11. With
// the wave budget still growing each wave, that left the mid waves (5-9) feeling
// slack once the player had leveled up and was clearing fast. These add a gentle
// per-wave tightening AFTER the opening so groups arrive quicker — WITHOUT
// touching the first 3-4 waves and WITHOUT raising maxAlive, HP, or the budget,
// so peak on-screen pressure is unchanged. CASUAL ONLY: Tutorial was eased back to
// the flat opening cadence (its waves 5-9 were too punishing for new players), and
// Cursed keeps its own tuned cadence (it's under live difficulty testing).
const POST_OPENING_WAVE = 4;          // waves 1-4 keep the original cozy cadence
const POST_OPENING_SPAWN_STEP = 0.04; // spawn gap shaved per wave past the opening
const POST_OPENING_SPAWN_MAX = 0.20;  // ...opening ramp caps here, so it tightens
                                      //   waves 5-9 without runaway-stacking on the
                                      //   per-tier shave in long runs (MIN_SPAWN_
                                      //   INTERVAL still floors the final value).
const INTERMISSION_SHORT = 2.0;       // between-wave break once past the opening
                                      //   (breaks entering waves 1-4 stay at 2.5s)

// DEBUG: when true, EVERY wave spawns the boss (handy for testing boss art /
// behavior without grinding to wave 10). Set to false for normal play and
// before committing a release build.
// --- Gutter Gecko wave composition (all tunable) -----------------------------
const GECKO_INTRO_WAVE = 5;       // geckos join the spawn mix from this wave on
const GECKO_SPAWN_CHANCE = 0.25;  // chance each spawn slot rolls a gecko
const GECKO_MAX_ALIVE = 3;        // never more than this many alive at once
const MAGE_INTRO_WAVE = 8;        // Bone Mages join the spawn mix from this wave on
const MAGE_SPAWN_CHANCE = 0.12;   // chance each eligible slot rolls a Bone Mage
const MAGE_MAX_ALIVE = 2;         // never more than this many alive at once (zoning is oppressive in bulk)
const GOBLIN_INTRO_WAVE = 6;      // Goblin Bonkers join the spawn mix from this wave on
const GOBLIN_SPAWN_CHANCE = 0.15; // chance each eligible slot rolls a Goblin
const GOBLIN_MAX_ALIVE = 2;       // never more than this many alive (displacement is oppressive in bulk)
const PRONG_INTRO_WAVE = 7;       // Pronggeists join the spawn mix from this wave on (spaces the intros: gecko 5, goblin 6, pronggeist 7, mage 8)
const PRONG_SPAWN_CHANCE = 0.18;  // chance each eligible slot rolls a Pronggeist (bumped 0.13 -> 0.18)
const PRONG_MAX_ALIVE = 2;        // never more than this many alive (line-zoning is oppressive in bulk)
const TIN_INTRO_WAVE = 9;         // Tin Bulwarks join the spawn mix from this wave on (after gecko 5, goblin 6, pronggeist 7, mage 8)
const TIN_SPAWN_CHANCE = 0.12;    // chance each eligible slot rolls a Tin Bulwark
const TIN_MAX_ALIVE = 1;          // never more than this many alive at once (position-control is oppressive in bulk — start at one)

// ===========================================================================
//  WATCHING HAND — second boss (Phase 1: skeleton).
//  A giant crawling hand that HOPS around the arena. Phase 1 implements only
//  the hop movement + placeholder art + boss-bar plumbing, so it's harmless
//  Hops + slam (with a locked telegraph) + a gecko-summon phase at HP
//  thresholds. Always faces south; jumps faked via shadow + position lerp.
//
//  Deliberately simple per design: always faces south, no directional sprites,
//  jumps shown via a shadow + position lerp (no jump sprite). Shares the same
//  public surface the HUD/boss systems expect: x, y, radius, health, maxHealth,
//  damage, dead, isBoss, name, hitFlash, takeDamage(), update(dt, player),
//  draw(ctx). Eventual art: watching_hand_idle, watching_hand_slam (face-south).
// ===========================================================================
const HAND_HEALTH = 60;          // base; scaled by tier like the Elder Wisp
const HAND_DAMAGE = 18;          // contact damage if you stand on the body
const HAND_HOP_MIN = 1.2;        // seconds resting between hops
const HAND_HOP_MAX = 1.8;
const HAND_HOP_AIR = 0.45;       // seconds airborne per hop
const HAND_HOP_RANGE = 260;      // max hop distance toward a new spot near the player
const HAND_HOPS_PER_SLAM = 2;    // hops it takes between slams

// --- Slam attack (the core threat) ------------------------------------------
// The marker LOCKS at windup start (+ a small velocity lead) and never moves —
// you dodge by walking out of the locked ring during the airborne window.
const SLAM_WINDUP = 0.4;         // crouch; marker fades in at the locked spot
const SLAM_AIR = 0.7;            // hand rises; marker solid + pulsing
const SLAM_IMPACT = 0.15;        // ring is LIVE DAMAGE for this instant
const SLAM_RECOVER = 0.8;        // grounded, vulnerable punish window
const SLAM_RADIUS = 72;          // danger ring radius (player radius is 16)
const SLAM_LEAD = 0.18;          // seconds of player velocity to lead the marker
const SLAM_DAMAGE_MULT = 1.0;    // slam damage = this.damage * this (tunable)

// --- Summon phase (event at HP thresholds) ----------------------------------
// Interrupts the loop (never concurrent with a slam — it only triggers from a
// safe phase). The Hand rises and a burst of Gutter Geckos crawls out around
// it, then it resumes hopping. Fits the theme far better than eye-beams: a
// giant hand calling forth crawling things. game.js does the actual spawning
// (it owns the enemy list) when consumeSummonBurst() returns the count.
const SUMMON_THRESHOLDS = [0.75, 0.50, 0.25]; // fire once each as HP drops past these
const SUMMON_WINDUP = 0.5;       // rise + telegraph before the geckos appear
const SUMMON_BURST = 3;          // geckos requested per event
const SUMMON_TOTAL_GECKO_CAP = 4; // game.js won't exceed this many geckos alive
const SUMMON_RECOVER = 0.5;      // settle beat before hopping resumes

loadImage("watching_hand_idle", "assets/sprites/enemies/watching_hand_idle.png");
loadImage("watching_hand_slam", "assets/sprites/enemies/watching_hand_slam.png");   // south (default)
loadImage("watching_hand_slam_n", "assets/sprites/enemies/watching_hand_slam_n.png"); // north (slamming upward)
const HAND_IDLE_FRAMES = 6; // idle strip: open hand, eyes shifting
const HAND_SLAM_FRAMES = 6; // slam strip: open -> fist
const HAND_IDLE_FPS = 6;    // idle is free-running; the slam is progress-driven

export class WatchingHand {
  constructor(x, y, tier = 1) {
    this.x = x;
    this.y = y;
    this.radius = 32;
    this.tier = tier;

    this.maxHealth = HAND_HEALTH * tier;
    this.health = this.maxHealth;
    this.damage = HAND_DAMAGE + (tier - 1) * 5;

    this.dead = false;
    this.hitFlash = 0;
    this.isBoss = true;
    this.name = "The Watching Hand";

    this.facing = "s"; // always south by design

    // Phases: "rest" (grounded, vulnerable) -> "air" (hop lerp) -> ... after
    // HAND_HOPS_PER_SLAM hops -> "windup" -> "slam_air" -> "impact" ->
    // "recover" -> rest. The shadow shrinks during airborne phases to fake the
    // jump arc; the slam marker is locked at windup start.
    this.phase = "rest";
    this.hopRestTimer = randomRange(HAND_HOP_MIN, HAND_HOP_MAX);
    this.hopsSinceSlam = 0;
    this.airTimer = 0;
    this.hopProgress = 0;        // 0..1 jump arc, drives shadow + body lift
    this.hopFromX = x; this.hopFromY = y;
    this.hopToX = x;   this.hopToY = y;

    // Slam state.
    this.phaseTimer = 0;         // counts the current slam/summon sub-phase
    this.slamX = x; this.slamY = y; // LOCKED marker position
    this.slamFacing = "s";          // "s" | "n" — which slam strip to use
    this.slamFired = false;         // ensures the impact damages once
    this.slamHitPending = false; // game.js reads + clears this to apply ring damage

    // Summon state.
    this.summonsUsed = 0;          // how many threshold events have fired
    this.summonBurstPending = 0;   // geckos game.js should spawn (it reads + clears)

    this.wobble = Math.random() * Math.PI * 2;
    this.animFrame = 0;
    this.animTimer = 0;
    this.spriteScale = 2.0; // tune once art is in (placeholder ignores this)

    // World bounds for hop clamping, learned from the view each update.
    this._worldW = 2400;
    this._worldH = 1344;
  }

  // Driven by the generic enemy loop as update(dt, player, enemyBolts). The
  // 3rd arg is ignored; world bounds come from the module-level PLAYFIELD set
  // by the WaveManager each frame (so hop/slam targets stay on the floor).
  update(dt, player) {
    this._worldW = PLAYFIELD.worldW;
    this._worldH = PLAYFIELD.worldH;
    this.wobble += dt * 3;
    if (this.hitFlash > 0) this.hitFlash -= dt;

    // HP-threshold check: if health has dropped past the next summon threshold,
    // call forth a gecko burst — but only from a safe phase (rest/air), so an
    // in-progress slam always completes first (no jarring mid-slam cancel).
    const hpFrac = this.health / this.maxHealth;
    const canSummon = this.phase === "rest" || this.phase === "air";
    if (canSummon && this.summonsUsed < SUMMON_THRESHOLDS.length && hpFrac <= SUMMON_THRESHOLDS[this.summonsUsed]) {
      this.beginSummon();
    }

    switch (this.phase) {
      case "rest":
        this.hopRestTimer -= dt;
        if (this.hopRestTimer <= 0) {
          if (this.hopsSinceSlam >= HAND_HOPS_PER_SLAM) this.beginSlam(player);
          else this.beginHop(player);
        }
        break;

      case "air": {
        this.airTimer += dt;
        const t = Math.min(1, this.airTimer / HAND_HOP_AIR);
        const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; // ease-in-out
        this.x = lerp(this.hopFromX, this.hopToX, e);
        this.y = lerp(this.hopFromY, this.hopToY, e);
        this.hopProgress = t;
        if (t >= 1) {
          this.phase = "rest";
          this.hopRestTimer = randomRange(HAND_HOP_MIN, HAND_HOP_MAX);
          this.hopProgress = 0;
          this.hopsSinceSlam += 1;
        }
        break;
      }

      // --- Slam cycle ---
      case "windup":
        // Marker is already locked; just brace. (Marker fades in via timer.)
        this.phaseTimer += dt;
        if (this.phaseTimer >= SLAM_WINDUP) { this.phase = "slam_air"; this.phaseTimer = 0; }
        break;

      case "slam_air": {
        // Hand lifts off and travels to OVER the locked marker; marker solid.
        this.phaseTimer += dt;
        const t = Math.min(1, this.phaseTimer / SLAM_AIR);
        this.hopProgress = t; // reuse arc for body lift + shadow
        this.x = lerp(this.hopFromX, this.slamX, t);
        this.y = lerp(this.hopFromY, this.slamY, t);
        if (t >= 1) { this.phase = "impact"; this.phaseTimer = 0; this.hopProgress = 0; }
        break;
      }

      case "impact":
        // The instant of contact: flag the ring as live ONCE; game.js reads it.
        if (!this.slamFired) { this.slamHitPending = true; this.slamFired = true; }
        this.phaseTimer += dt;
        if (this.phaseTimer >= SLAM_IMPACT) { this.phase = "recover"; this.phaseTimer = 0; }
        break;

      case "recover":
        this.phaseTimer += dt;
        if (this.phaseTimer >= SLAM_RECOVER) {
          this.phase = "rest";
          this.hopRestTimer = randomRange(HAND_HOP_MIN, HAND_HOP_MAX);
          this.hopsSinceSlam = 0;
        }
        break;

      // --- Summon (gecko burst) ---
      case "summon_windup":
        // Hand rises + telegraphs; the geckos appear when the windup ends.
        this.phaseTimer += dt;
        if (this.phaseTimer >= SUMMON_WINDUP) {
          this.summonBurstPending = SUMMON_BURST; // game.js spawns + clears
          this.phase = "summon_recover";
          this.phaseTimer = 0;
        }
        break;

      case "summon_recover":
        this.phaseTimer += dt;
        if (this.phaseTimer >= SUMMON_RECOVER) {
          this.phase = "rest";
          this.hopRestTimer = randomRange(HAND_HOP_MIN, HAND_HOP_MAX);
          this.hopsSinceSlam = 0;
        }
        break;
    }

    // Animation. Idle free-runs (loop). The slam/summon poses are PROGRESS-
    // DRIVEN, not clocked: the 6-frame open->fist strip is mapped across the
    // whole slam so the hand opens during the windup, hangs/rises through the
    // air on the early frames, then punches through the final frames exactly as
    // it descends to impact — keeping the art in sync with the real motion.
    const onSlamAnim = this.phase === "windup" || this.phase === "slam_air" ||
                       this.phase === "impact" || this.phase === "summon_windup";

    if (onSlamAnim) {
      const last = HAND_SLAM_FRAMES - 1;
      let p; // 0..1 progress across the slam/summon gesture
      if (this.phase === "windup") {
        // First ~40% of the strip spreads over the windup (hand opening).
        p = (this.phaseTimer / SLAM_WINDUP) * 0.4;
      } else if (this.phase === "slam_air") {
        // Next chunk over the airborne rise/hang (still early frames).
        p = 0.4 + (this.phaseTimer / SLAM_AIR) * 0.4;
      } else if (this.phase === "impact") {
        // The punch: final frames land during the brief impact window.
        p = 0.8 + Math.min(1, this.phaseTimer / SLAM_IMPACT) * 0.2;
      } else {
        // summon_windup: run the open->fist gesture across the rise.
        p = this.phaseTimer / SUMMON_WINDUP;
      }
      this.animFrame = Math.min(last, Math.floor(p * HAND_SLAM_FRAMES));
    } else {
      // Idle loops on a free-running clock.
      this.animTimer += dt;
      while (this.animTimer >= 1 / HAND_IDLE_FPS) {
        this.animTimer -= 1 / HAND_IDLE_FPS;
        this.animFrame = (this.animFrame + 1) % HAND_IDLE_FRAMES;
      }
    }
    // Reset the idle frame cleanly when leaving a slam pose.
    if (onSlamAnim !== this._onSlamAnimPrev && !onSlamAnim) { this.animFrame = 0; this.animTimer = 0; }
    this._onSlamAnimPrev = onSlamAnim;
  }

  // Lock the slam marker at the player's position + a small velocity lead, then
  // enter the windup. The marker NEVER moves after this — that's the fairness
  // contract: telegraph, then commit.
  beginSlam(player) {
    const vx = player.vx || 0; // player exposes velocity if available; 0 is fine
    const vy = player.vy || 0;
    // Lock the marker on the floor, keeping the whole ring off the wall.
    const lock = clampToPlayfield(player.x + vx * SLAM_LEAD, player.y + vy * SLAM_LEAD, SLAM_RADIUS);
    this.slamX = lock.x;
    this.slamY = lock.y;
    // Face north when slamming clearly upward, else south (its default pose).
    this.slamFacing = lock.y < this.y - 20 ? "n" : "s";
    this.hopFromX = this.x; this.hopFromY = this.y;
    this.phase = "windup";
    this.phaseTimer = 0;
    this.slamFired = false;
    this.hopProgress = 0;
  }

  // True only for the single frame the ring should deal damage; game.js calls
  // this, applies the ring check, and the flag self-clears.
  consumeSlamHit() {
    if (this.slamHitPending) { this.slamHitPending = false; return true; }
    return false;
  }

  // Slam danger geometry for game.js (marker draw + ring collision).
  get slamRadius() { return SLAM_RADIUS; }
  get slamDamage() { return Math.round(this.damage * SLAM_DAMAGE_MULT); }

  // Enter the summon phase: rise + telegraph, then a gecko burst crawls out.
  beginSummon() {
    this.summonsUsed += 1;
    this.phase = "summon_windup";
    this.phaseTimer = 0;
  }

  // game.js calls this each frame; when a burst is pending it returns the
  // requested count (and clears), so game.js can spawn against its own caps.
  consumeSummonBurst() {
    if (this.summonBurstPending > 0) {
      const n = this.summonBurstPending;
      this.summonBurstPending = 0;
      return n;
    }
    return 0;
  }
  get summonGeckoCap() { return SUMMON_TOTAL_GECKO_CAP; }

  // 0..1 telegraph intensity for the summon windup (a rising glow under the
  // Hand), 0 when not summoning.
  summonGlow() {
    if (this.phase === "summon_windup") return Math.min(1, this.phaseTimer / SUMMON_WINDUP);
    if (this.phase === "summon_recover") return 1 - Math.min(1, this.phaseTimer / SUMMON_RECOVER);
    return 0;
  }

  // 0..1 telegraph intensity for the marker: fades in over windup, full during
  // air, brightest at impact. 0 = don't draw.
  slamMarkerAlpha() {
    if (this.phase === "windup") return Math.min(1, this.phaseTimer / SLAM_WINDUP) * 0.7;
    if (this.phase === "slam_air") return 0.7 + 0.3 * Math.min(1, this.phaseTimer / SLAM_AIR);
    if (this.phase === "impact") return 1;
    return 0;
  }

  // Pick a landing spot: a hop toward the player (capped at HAND_HOP_RANGE),
  // so it closes in over several hops but never teleports onto them.
  beginHop(player) {
    const dx = player.x - this.x;
    const dy = player.y - this.y;
    const len = Math.hypot(dx, dy) || 1;
    const dist = Math.min(HAND_HOP_RANGE, len * 0.7);
    this.hopFromX = this.x; this.hopFromY = this.y;
    const dest = clampToPlayfield(this.x + (dx / len) * dist, this.y + (dy / len) * dist, this.radius);
    this.hopToX = dest.x;
    this.hopToY = dest.y;
    this.phase = "air";
    this.airTimer = 0;
    this.hopProgress = 0;
  }

  takeDamage(amount) {
    this.health -= amount;
    this.hitFlash = 0.08;
    if (this.health <= 0) this.dead = true;
  }

  // The Hand has no summon mechanic — stub keeps game.js's shared boss-summon
  // call a safe no-op (the Hand uses slam + gecko summons, not minions).
  consumeSummon() {
    return false;
  }

  draw(ctx) {
    const flash = this.hitFlash > 0;
    const airborne = this.phase === "air" || this.phase === "slam_air";
    const hopH = airborne ? Math.sin(this.hopProgress * Math.PI) * 46 : 0; // fake arc height
    const by = this.y - hopH; // body lifts while airborne; shadow stays grounded

    ctx.save();

    // Ground shadow (shrinks while airborne).
    const shadowScale = 1 - (hopH / 46) * 0.45;
    ctx.fillStyle = "rgba(0, 0, 0, 0.35)";
    ctx.beginPath();
    ctx.ellipse(this.x, this.y + this.radius * 0.7, this.radius * shadowScale, this.radius * 0.45 * shadowScale, 0, 0, Math.PI * 2);
    ctx.fill();

    const slamming = this.phase === "windup" || this.phase === "slam_air" ||
                     this.phase === "impact" || this.phase === "summon_windup";
    // North slam uses its own strip during the slam phases; the summon rise
    // always uses the south (default) gesture. Falls back to south if the
    // north strip is missing.
    const slamFacingN = this.slamFacing === "n" &&
      (this.phase === "windup" || this.phase === "slam_air" || this.phase === "impact");
    const slamKey = (slamFacingN && getImage("watching_hand_slam_n"))
      ? "watching_hand_slam_n" : "watching_hand_slam";
    const useSlam = slamming && getImage(slamKey);
    const img = useSlam ? getImage(slamKey) : getImage("watching_hand_idle");
    if (img && img.width > 0) {
      const frames = useSlam ? HAND_SLAM_FRAMES : HAND_IDLE_FRAMES;
      const fw = img.width / frames;
      const fh = img.height;
      const dw = fw * this.spriteScale;
      const dh = fh * this.spriteScale;
      const sx = Math.floor(this.animFrame) % frames * fw;
      if (flash) ctx.globalAlpha = 0.85;
      ctx.drawImage(img, sx, 0, fw, fh, this.x - dw / 2, by - dh / 2, dw, dh);
    } else {
      // --- Placeholder: pale fingered hand with watching eyes ---
      const r = this.radius;
      ctx.fillStyle = flash ? "#ffffff" : "#d9cdb8";
      for (let i = -1.5; i <= 1.5; i += 1) { // four knuckle bumps
        ctx.beginPath();
        ctx.arc(this.x + i * (r * 0.5), by - r * 0.6, r * 0.32, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.beginPath(); // palm
      ctx.ellipse(this.x, by, r, r * 0.85, 0, 0, Math.PI * 2);
      ctx.fill();
      const eyes = [[-0.4, -0.1], [0.4, -0.1], [-0.15, 0.35], [0.2, 0.3]];
      for (const [ex, ey] of eyes) {
        ctx.fillStyle = flash ? "#fff6dd" : "#f4d58d";
        ctx.beginPath();
        ctx.arc(this.x + ex * r, by + ey * r, r * 0.13, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#1c1a26"; // pupil
        ctx.beginPath();
        ctx.arc(this.x + ex * r, by + ey * r, r * 0.06, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    ctx.restore();
  }
}

// ===========================================================================
//  Boss: Hive Warden — the projectile-pattern boss (Elder Wisp = dash,
//  Watching Hand = slam, Hive Warden = stingers). Hovers at mid-range,
//  telegraphs, then fires LOCKED stinger patterns (no release tracking — the
//  pattern is set the instant it starts charging, so it's readable/dodgeable).
//  Shares the standard boss surface (x, y, radius, health, maxHealth, damage,
//  dead, isBoss, name, hitFlash, takeDamage(), update(dt, player, enemyBolts),
//  draw(ctx)). Stingers are EnemyBolts pushed into the game-owned array, so
//  game.js handles their motion + player collision exactly like gecko balls.
//  8-dir FLY art (6 frames) reused for hover AND charge; release = code flash.
// ===========================================================================
const BEE_HEALTH = 50;            // base; ×tier like the other bosses
const BEE_DAMAGE = 16;            // incidental body contact (the threat is stingers)
const BEE_RADIUS = 28;
const BEE_SPEED = 95;             // hover / reposition drift speed (px/s)
const BEE_HOVER_MIN = 240;        // preferred mid-range band from the player
const BEE_HOVER_MAX = 340;
const BEE_HOVER_TIME = 1.6;       // drift/reposition before the next charge
const BEE_CHARGE_TIME = 0.7;      // wind-up; aim/pattern LOCK at charge start
const BEE_RELEASE_TIME = 0.18;    // brief yellow flash window when stingers fire
const BEE_RECOVER_TIME = 0.6;     // vulnerable beat after firing
const BEE_CONE_CHANCE = 0.35;     // cone is easy to kite, so it's the MINORITY; the
                                  //   radial burst is the main threat (favored + may repeat)
const BEE_FLY_FRAMES = 6;
const BEE_FLY_FPS = 8;

// Stinger patterns (fired as EnemyBolts with the velocity-oriented amber style).
const STINGER_DAMAGE = 12;
const STINGER_LIFE = 2.5;
const STINGER_OPTS = { sprite: "bee_stinger", color: "#f4c542", orient: "velocity", scale: 1.1 };
const CONE_COUNT = 5;
const CONE_SPREAD = 0.87;         // total fan radians (~50°): ±25°, ~12.5° apart
const CONE_SPEED = 250;
const BURST_COUNT = 8;            // even radial ring, rotated to the locked aim
const BURST_SPEED = 210;

// 8-dir fly strips (6 frames each) + the stinger. Missing → graceful fallback.
for (const d of WISP_DIRS) {
  loadImage(`bee_fly_${d}`, `assets/sprites/enemies/bee_fly_${d}.png`);
}
loadImage("bee_stinger", "assets/sprites/projectiles/bee_stinger.png");

export class HiveWarden {
  constructor(x, y, tier = 1) {
    this.x = x;
    this.y = y;
    this.radius = BEE_RADIUS;
    this.tier = tier;

    this.maxHealth = BEE_HEALTH * tier;
    this.health = this.maxHealth;
    this.damage = BEE_DAMAGE + (tier - 1) * 5;

    this.dead = false;
    this.hitFlash = 0;
    this.isBoss = true;
    this.name = "Hive Warden";

    this.phase = "hover";         // "hover" | "charge" | "release" | "recover"
    this.phaseTimer = BEE_HOVER_TIME;
    this.hoverTarget = { x, y };
    this._needTarget = true;      // pick a real hover spot on the first update
    this.bob = Math.random() * Math.PI * 2;

    this.attack = "cone";         // pattern chosen for the current charge
    this.lastAttack = null;
    this.aimAngle = 0;            // LOCKED at charge start (no release tracking)
    this.released = false;
    this.flashTimer = 0;          // yellow release flash

    this.facing = "s";
    this.animFrame = randomInt(0, BEE_FLY_FRAMES - 1);
    this.animTimer = 0;
    this.spriteScale = 1.0;       // tune to the fly art's native size (radius 28)
  }

  update(dt, player, enemyBolts) {
    if (this.hitFlash > 0) this.hitFlash -= dt;
    if (this.flashTimer > 0) this.flashTimer -= dt;
    this.bob += dt * 2.4;
    if (this._needTarget) { this.pickHoverTarget(player); this._needTarget = false; }

    this.phaseTimer -= dt;

    if (this.phase === "hover") {
      this.driftToward(this.hoverTarget, dt, BEE_SPEED);
      if (this.phaseTimer <= 0) {
        // Choose + LOCK the pattern and aim now; they won't change during release.
        this.attack = this.pickAttack();
        this.aimAngle = Math.atan2(player.y - this.y, player.x - this.x);
        this.phase = "charge";
        this.phaseTimer = BEE_CHARGE_TIME;
        this.released = false;
        playSfx("bee_charge"); // missing file = silent
      }
    } else if (this.phase === "charge") {
      // Hold (bob only); the aim stays locked — this is the readable wind-up.
      if (this.phaseTimer <= 0) {
        this.phase = "release";
        this.phaseTimer = BEE_RELEASE_TIME;
        this.flashTimer = BEE_RELEASE_TIME;
      }
    } else if (this.phase === "release") {
      if (!this.released) {
        this.firePattern(enemyBolts);
        this.released = true;
        playSfx("bee_sting"); // missing file = silent
      }
      if (this.phaseTimer <= 0) {
        this.phase = "recover";
        this.phaseTimer = BEE_RECOVER_TIME;
      }
    } else { // recover
      if (this.phaseTimer <= 0) {
        this.pickHoverTarget(player);
        this.phase = "hover";
        this.phaseTimer = BEE_HOVER_TIME;
      }
    }

    // Facing: drift direction while hovering, the locked aim otherwise.
    if (this.phase === "hover") {
      const dx = this.hoverTarget.x - this.x, dy = this.hoverTarget.y - this.y;
      if (Math.abs(dx) > 1 || Math.abs(dy) > 1) this.facing = dirFromVector(dx, dy);
    } else {
      this.facing = dirFromVector(Math.cos(this.aimAngle), Math.sin(this.aimAngle));
    }

    // Fly loop (always animates — it's a hovering bee).
    const frameDur = 1 / BEE_FLY_FPS;
    this.animTimer += dt;
    while (this.animTimer >= frameDur) {
      this.animTimer -= frameDur;
      this.animFrame = (this.animFrame + 1) % BEE_FLY_FRAMES;
    }
  }

  pickHoverTarget(player) {
    const ang = Math.random() * Math.PI * 2;
    const dist = randomRange(BEE_HOVER_MIN, BEE_HOVER_MAX);
    const c = clampToPlayfield(
      player.x + Math.cos(ang) * dist,
      player.y + Math.sin(ang) * dist,
      this.radius
    );
    this.hoverTarget = { x: c.x, y: c.y };
  }

  driftToward(target, dt, speed) {
    const dx = target.x - this.x, dy = target.y - this.y;
    const len = Math.hypot(dx, dy);
    if (len < 2) return;
    const step = Math.min(len, speed * dt);
    this.x += (dx / len) * step;
    this.y += (dy / len) * step;
  }

  pickAttack() {
    // Burst (radial ring) is the main threat and MAY repeat; the easy-to-kite
    // cone is the minority and never doubles up (no back-to-back free lulls).
    let a = Math.random() < BEE_CONE_CHANCE ? "cone" : "burst";
    if (a === "cone" && this.lastAttack === "cone") a = "burst";
    this.lastAttack = a;
    return a;
  }

  firePattern(enemyBolts) {
    if (!enemyBolts) return;
    if (this.attack === "cone") {
      const half = CONE_SPREAD / 2;
      const stepA = CONE_COUNT > 1 ? CONE_SPREAD / (CONE_COUNT - 1) : 0;
      for (let i = 0; i < CONE_COUNT; i++) {
        this.spawnStinger(enemyBolts, this.aimAngle - half + stepA * i, CONE_SPEED);
      }
    } else { // burst: even radial ring, index 0 points at the locked aim
      const stepA = (Math.PI * 2) / BURST_COUNT;
      for (let i = 0; i < BURST_COUNT; i++) {
        this.spawnStinger(enemyBolts, this.aimAngle + stepA * i, BURST_SPEED);
      }
    }
  }

  spawnStinger(enemyBolts, angle, speed) {
    const tx = this.x + Math.cos(angle) * 100;
    const ty = this.y + Math.sin(angle) * 100;
    enemyBolts.push(new EnemyBolt(this.x, this.y, tx, ty, speed, STINGER_DAMAGE, STINGER_LIFE, STINGER_OPTS));
  }

  takeDamage(amount) {
    this.health -= amount;
    this.hitFlash = 0.08;
    if (this.health <= 0) this.dead = true;
  }

  // The Hive Warden has no summon mechanic — stub keeps game.js's shared
  // boss-summon call (boss.consumeSummon()) a safe no-op, same as the Hand.
  consumeSummon() {
    return false;
  }

  draw(ctx) {
    ctx.save();
    const flash = this.hitFlash > 0;
    const bobY = Math.sin(this.bob) * 3;

    // --- Charge telegraph (code-drawn, UNDER the body) ---
    if (this.phase === "charge") {
      const t = 1 - this.phaseTimer / BEE_CHARGE_TIME; // 0 -> 1 across the wind-up
      const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 80);
      ctx.save();
      ctx.globalAlpha = 0.22 + 0.26 * t;
      ctx.fillStyle = "#f4d54a";
      ctx.beginPath();
      ctx.arc(this.x, this.y + bobY, this.radius + 6 + t * 10, 0, Math.PI * 2);
      ctx.fill();
      // Faint aim guide so the pattern direction reads.
      ctx.globalAlpha = (0.18 + 0.22 * pulse) * t;
      ctx.strokeStyle = "#ffe27a";
      ctx.lineWidth = 2;
      if (this.attack === "cone") {
        const half = CONE_SPREAD / 2, r = 150;
        for (const s of [-1, 1]) {
          ctx.beginPath();
          ctx.moveTo(this.x, this.y + bobY);
          ctx.lineTo(this.x + Math.cos(this.aimAngle + s * half) * r, this.y + bobY + Math.sin(this.aimAngle + s * half) * r);
          ctx.stroke();
        }
      } else {
        ctx.beginPath();
        ctx.arc(this.x, this.y + bobY, this.radius + 20, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();
    }

    // --- Body: directional fly sprite, or fallback amber bee ---
    const img = getImage(`bee_fly_${this.facing}`);
    if (img && img.width > 0) {
      const fw = img.width / BEE_FLY_FRAMES;
      const fh = img.height;
      const dw = fw * this.spriteScale;
      const dh = fh * this.spriteScale;
      const sx = (Math.floor(this.animFrame) % BEE_FLY_FRAMES) * fw;
      const dx = Math.round(this.x - dw / 2);
      const dy = Math.round(this.y - dh / 2 + bobY);
      ctx.drawImage(img, sx, 0, fw, fh, dx, dy, dw, dh);
      if (flash) {
        ctx.globalAlpha = 0.55;
        ctx.globalCompositeOperation = "lighter";
        ctx.drawImage(img, sx, 0, fw, fh, dx, dy, dw, dh);
        ctx.globalCompositeOperation = "source-over";
        ctx.globalAlpha = 1;
      }
    } else {
      const cy = this.y + bobY;
      ctx.shadowColor = "#f4c542";
      ctx.shadowBlur = 20;
      ctx.fillStyle = flash ? "#fff3c0" : "#e0a92e";
      ctx.beginPath(); ctx.arc(this.x, cy, this.radius, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = "#3a2a10"; // stripes
      ctx.fillRect(this.x - this.radius * 0.7, cy - 5, this.radius * 1.4, 4);
      ctx.fillRect(this.x - this.radius * 0.5, cy + 5, this.radius * 1.0, 4);
      ctx.fillStyle = "#f4d58d"; // eyes
      ctx.beginPath(); ctx.arc(this.x - 8, cy - 7, 3, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(this.x + 8, cy - 7, 3, 0, Math.PI * 2); ctx.fill();
    }

    // --- Release flash (yellow burst, OVER the body) ---
    if (this.flashTimer > 0) {
      const k = this.flashTimer / BEE_RELEASE_TIME;
      ctx.globalAlpha = 0.5 * k;
      ctx.fillStyle = "#fff04a";
      ctx.beginPath();
      ctx.arc(this.x, this.y + bobY, this.radius + 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    ctx.restore();
  }
}

// --- Boss: The Hourkeeper (Wave 10) --------------------------------------
// A clockwork RHYTHM boss: timing / vulnerability-window pressure. It is
// UNTARGETABLE while it sweeps clock hands across the arena (survive), then
// REAPPEARS and stays VULNERABLE while it casts Alarm Rune bursts (punish it),
// blinking between sets. Every attack reuses HazardZone (rect hands + circle
// runes pushed into the shared `hazards` array), so game.js drives their
// telegraph / blast / damage / draw for free. Code-drawn + graceful: it runs
// with no art (a drawn clock + brass hazards) and lights up once the PNGs land.
//
// Targetability is enforced two ways: the familiar skips `untargetable` targets
// (familiar.js), and takeDamage() no-ops unless `vulnerable` — so it can ONLY be
// hurt during the alarm window. `noContactDamage` keeps its body harmless (its
// telegraphed hazards are its only damage), so standing close for the cat to
// reach it during the alarm phase never chips you.
const HK_RADIUS = 30;            // body hitbox (matches the other bosses)
const HK_HP_MULT = 1.0;          // x BOSS_HEALTH*tier; dial toward ~0.8 if the fight drags
const HK_DMG_BASE = 12;          // hand + rune damage at tier 1 (fair, not a one-shot)
const HK_DMG_PER_TIER = 4;       // + per Endless tier
const HK_RANGE = 220;            // how far from the witch it (re)appears — keeps it on-screen

// Fades + blink (code effects; no sprites needed for vanish/reappear/blink).
const HK_APPEAR_TIME = 0.6;
const HK_VANISH_TIME = 0.35;
const HK_REAPPEAR_TIME = 0.35;
const HK_BLINK_TIME = 0.2;
const HK_FX_LIFE = 0.35;         // poof-ring fade (matches the Bone Mage)

// Clock Hand Sweep (rect HazardZones through a locked pivot, one at a time).
const HK_HAND_WARN = 0.7;        // telegraph per hand (tightened for reaction pressure)
const HK_STRIKE_GAP = 0.5;       // gap between sequential hands (time to reposition)
const HK_HAND_LENGTH = 1200;     // spans the 960x540 view through the pivot (the camera knob)
const HK_HAND_WIDTH = 52;        // +player radius ~ an 84px danger band (wider = harder)
const HK_HAND_KNOCKBACK = 0;     // pure dodge for the first pass
// Full lines THROUGH the pivot, applied IN ORDER; the HP phase decides how many
// are used. Cross first (most readable), then the diagonals + off-axis tilts so
// later phases fan out into a denser sweep.
const HK_HAND_ANGLES = [
  Math.PI / 2,    // vertical
  0,              // horizontal
  Math.PI / 4,    // diagonal
  -Math.PI / 4,   // diagonal (the asterisk)
  Math.PI / 8,    // off-axis tilt
  -Math.PI / 8,   // off-axis tilt
];

// Alarm Rune Burst (circle HazardZones scattered across a field on the witch).
const HK_RUNE_WARN = 0.9;        // "tick.. tick.. burst" (tightened; a hair looser than hands —
                                 // a scattered field takes longer to READ than a single line)
const HK_RUNE_RADIUS = 60;       // +player radius ~ a 76px mark
const HK_RUNE_FIELD = 170;       // runes scatter within this radius of the witch (covers her
                                 // spot, so standing still is risky); larger = easier to thread
const HK_RUNE_STAGGER = 0.12;    // gap between rune spawns (avoids a same-frame double-tap)
const HK_RECOVER = 1.0;          // stays vulnerable + static this long after a set detonates
                                 // (widened so the cat still gets clean hits after the guard hand)
const HK_TIGHTEN = 0.85;         // < 30% HP: shorten warns + gaps for late pressure
// Punish-window "guard hand": while it's vulnerable + static for you to hit, it
// sweeps ONE hand through its OWN position so you must dodge WITHOUT giving up
// the punish (the offense/defense dilemma). Only below this HP fraction, so the
// pressure ramps in as it weakens — phase 1 stays a clean teach. Set to 1.0 to
// see it from the very first set when testing.
const HK_GUARD_HAND_HP = 0.6;

// Idle (loops) + Attack (one-shot cast). Single front-facing strip each; the
// drawn-clock fallback covers a missing file. 6 frames each, sliced at draw time.
const HK_ANIMS = { idle: 6, attack: 6 };
const HK_FPS = { idle: 6, attack: 10 };
loadImage("hourkeeper_idle_s", "assets/sprites/enemies/hourkeeper_idle_s.png");
loadImage("hourkeeper_attack_s", "assets/sprites/enemies/hourkeeper_attack_s.png");
loadImage("clock_rune", "assets/sprites/enemies/clock_rune.png"); // alarm-rune mark (code fallback if absent)

export class Hourkeeper {
  constructor(x, y, tier = 1) {
    this.x = x;
    this.y = y;
    this.radius = HK_RADIUS;
    this.tier = tier;

    this.maxHealth = Math.round(BOSS_HEALTH * tier * HK_HP_MULT);
    this.health = this.maxHealth;
    this.damage = HK_DMG_BASE + (tier - 1) * HK_DMG_PER_TIER; // hands + runes
    this.dead = false;
    this.hitFlash = 0;
    this.isBoss = true;
    this.name = "The Hourkeeper";

    // Rhythm gating.
    this.untargetable = true;    // familiar skips this while it's gone
    this.vulnerable = false;     // takeDamage no-ops unless true
    this.noContactDamage = true; // body never chips the witch (game.js contact guard)

    // Visuals.
    this.alpha = 0;              // body opacity (fades for vanish/reappear/blink)
    this.facing = "s";
    this.animState = "idle";
    this.animFrame = 0;
    this.animTimer = 0;
    this.spriteScale = 1.0;      // tune to native art (body radius 30)
    this.bodyTick = Math.random() * Math.PI * 2; // drives the drawn clock hands
    this.blinkFx = [];           // poof rings (visual only)

    // State machine: appear -> vanish -> sweep -> reappear -> (alarm -> blink)xN -> ...
    this.state = "appear";
    this.phaseTimer = HK_APPEAR_TIME;
    this._appeared = false;      // place near the witch on the first frame
    this._tighten = 1;           // phase timing multiplier (1, or HK_TIGHTEN when low)

    // Sweep bookkeeping.
    this.pivotX = x;
    this.pivotY = y;
    this.sweepAngles = [];       // hand angles queued for this sweep
    this.sweepGapTimer = 0;
    this.sweepTailTimer = 0;     // waits out the last hand's warn + blast

    // Alarm bookkeeping.
    this.setsLeft = 0;           // alarm sets remaining this cycle
    this.runeQueue = 0;          // runes left to drop in the current set
    this.runeStaggerTimer = 0;
    this.recoverTimer = 0;       // vulnerable tail after a set's last rune drops
    this.guardHandPending = false; // a punish-window hand queued for this set (phases 2-3)
    this.guardHandTimer = 0;       // fires the guard hand shortly AFTER the runes burst

    this._worldW = PLAYFIELD.worldW;
    this._worldH = PLAYFIELD.worldH;
  }

  // HP-fraction phase: fewer hands/runes/sets up top, more (and tighter) as it
  // weakens. Re-evaluated when each sweep/alarm begins, so it ramps responsively.
  hkPhase() {
    const f = this.health / this.maxHealth;
    if (f >= 0.60) return { hands: 3, runes: 4, sets: 1, tighten: 1 };
    if (f >= 0.30) return { hands: 4, runes: 5, sets: 2, tighten: 1 };
    return { hands: 5, runes: 6, sets: 2, tighten: HK_TIGHTEN };
  }

  // Teleport to a point `dist` from the witch (random angle), clamped to the
  // floor, with a poof at both the old and new spots. Keeps it on-screen + in
  // range so the sweep pivot is always something the player just saw.
  repositionNear(player, dist) {
    const ang = Math.random() * Math.PI * 2;
    const pos = clampToPlayfield(
      player.x + Math.cos(ang) * dist,
      player.y + Math.sin(ang) * dist,
      this.radius
    );
    this.blinkFx.push({ x: this.x, y: this.y, t: HK_FX_LIFE });
    this.x = pos.x;
    this.y = pos.y;
    this.blinkFx.push({ x: this.x, y: this.y, t: HK_FX_LIFE });
  }

  // Driven by the generic enemy loop as update(dt, player, enemyBolts, hazards);
  // it ignores enemyBolts and pushes its attacks into `hazards`.
  update(dt, player, enemyBolts, hazards) {
    this._worldW = PLAYFIELD.worldW;
    this._worldH = PLAYFIELD.worldH;
    if (this.hitFlash > 0) this.hitFlash -= dt;
    this.bodyTick += dt;

    // Age poof rings.
    for (const f of this.blinkFx) f.t -= dt;
    this.blinkFx = this.blinkFx.filter((f) => f.t > 0);

    this.phaseTimer -= dt;

    switch (this.state) {
      case "appear":
        if (!this._appeared) { this.repositionNear(player, HK_RANGE); this._appeared = true; }
        this.alpha = Math.min(1, this.alpha + dt / HK_APPEAR_TIME);
        this.animState = "idle";
        if (this.phaseTimer <= 0) this.beginVanish();
        break;

      case "vanish":
        this.alpha = Math.max(0, this.alpha - dt / HK_VANISH_TIME);
        if (this.phaseTimer <= 0) this.beginSweep();
        break;

      case "sweep":
        this.alpha = 0; // invisible + untargetable while the hands sweep
        if (this.sweepAngles.length > 0) {
          this.sweepGapTimer -= dt;
          if (this.sweepGapTimer <= 0) {
            this.spawnHand(this.sweepAngles.shift(), hazards);
            this.sweepGapTimer = HK_STRIKE_GAP * this._tighten;
            // Once the last hand is out, wait its warn + blast before reappearing.
            if (this.sweepAngles.length === 0) {
              this.sweepTailTimer = HK_HAND_WARN * this._tighten + HAZARD_BLAST_TIME + 0.1;
            }
          }
        } else {
          this.sweepTailTimer -= dt;
          if (this.sweepTailTimer <= 0) this.beginReappear(player);
        }
        break;

      case "reappear":
        this.alpha = Math.min(1, this.alpha + dt / HK_REAPPEAR_TIME);
        this.animState = "idle";
        if (this.phaseTimer <= 0) this.beginAlarm(player, hazards);
        break;

      case "alarm":
        this.alpha = 1; // present, vulnerable, static while casting
        if (this.runeQueue > 0) {
          this.runeStaggerTimer -= dt;
          if (this.runeStaggerTimer <= 0) {
            this.spawnRune(player, hazards);
            this.runeQueue -= 1;
            this.runeStaggerTimer = HK_RUNE_STAGGER;
            // Stay vulnerable through the last rune's warn + blast + a recover tail.
            if (this.runeQueue === 0) {
              this.recoverTimer = HK_RUNE_WARN * this._tighten + HAZARD_BLAST_TIME + HK_RECOVER;
              // Phases 2-3: queue a punish-window hand, fired shortly AFTER the
              // runes burst so it's a rhythm (dodge runes -> dodge the guard hand
              // while you keep punishing), not a simultaneous wall.
              if (this.health / this.maxHealth < HK_GUARD_HAND_HP) {
                this.guardHandPending = true;
                this.guardHandTimer = HK_RUNE_WARN * this._tighten + 0.2;
              }
            }
          }
        } else {
          if (this.guardHandPending) {
            this.guardHandTimer -= dt;
            if (this.guardHandTimer <= 0) {
              this.spawnGuardHand(hazards);
              this.guardHandPending = false;
            }
          }
          this.recoverTimer -= dt;
          if (this.recoverTimer <= 0) this.beginBlink(player);
        }
        break;

      case "blink":
        this.alpha = 0.3; // brief dim flicker during the teleport
        if (this.phaseTimer <= 0) {
          if (this.setsLeft > 0) this.beginAlarm(player, hazards);
          else this.beginVanish();
        }
        break;
    }

    this.advanceAnim(dt);
  }

  beginVanish() {
    this.state = "vanish";
    this.phaseTimer = HK_VANISH_TIME;
    this.untargetable = true;
    this.vulnerable = false;
  }

  beginSweep() {
    this.state = "sweep";
    this.untargetable = true;
    this.vulnerable = false;
    // Lock the pivot at the boss's last-seen spot (the player just saw it here).
    this.pivotX = this.x;
    this.pivotY = this.y;
    const ph = this.hkPhase();
    this._tighten = ph.tighten;
    this.sweepAngles = HK_HAND_ANGLES.slice(0, ph.hands);
    this.sweepGapTimer = 0; // first hand drops immediately
    this.sweepTailTimer = 0;
  }

  spawnHand(angle, hazards) {
    if (!hazards) return;
    // radius 0 (unused for rect); length/width/angle define the bar. sfx fires
    // on the strike (graceful: silent until hourkeeper_sweep is registered).
    hazards.push(new HazardZone(this.pivotX, this.pivotY, 0, HK_HAND_WARN * this._tighten, this.damage, {
      shape: "rect",
      angle,
      length: HK_HAND_LENGTH,
      width: HK_HAND_WIDTH,
      knockback: HK_HAND_KNOCKBACK,
      ox: this.pivotX,
      oy: this.pivotY,
      skin: "clock",
      sfx: "hourkeeper_sweep",
    }));
  }

  // Punish-window hand: a full clock hand THROUGH the boss's own position (not
  // the locked sweep pivot), fired while it's vulnerable + static for the cat.
  // You must step off the line while staying close enough to keep punishing —
  // the offense/defense dilemma. Random orientation (0..PI covers every line),
  // same 0.7s tell as the sweep, so it's never a surprise hit.
  spawnGuardHand(hazards) {
    if (!hazards) return;
    const angle = Math.random() * Math.PI;
    hazards.push(new HazardZone(this.x, this.y, 0, HK_HAND_WARN * this._tighten, this.damage, {
      shape: "rect",
      angle,
      length: HK_HAND_LENGTH,
      width: HK_HAND_WIDTH,
      knockback: HK_HAND_KNOCKBACK,
      ox: this.x,
      oy: this.y,
      skin: "clock",
      sfx: "hourkeeper_sweep",
    }));
  }

  beginReappear(player) {
    this.state = "reappear";
    this.phaseTimer = HK_REAPPEAR_TIME;
    this.untargetable = true;
    this.vulnerable = false;
    this.repositionNear(player, HK_RANGE);
    this.setsLeft = this.hkPhase().sets; // how many alarm sets this cycle
  }

  beginAlarm(player, hazards) {
    this.state = "alarm";
    this.untargetable = false; // the punish window opens
    this.vulnerable = true;
    const ph = this.hkPhase();
    this._tighten = ph.tighten;
    this.runeQueue = ph.runes;
    this.runeStaggerTimer = 0; // first rune drops immediately
    this.recoverTimer = 0;
    this.guardHandPending = false; // re-armed when this set's last rune lands
    this.setsLeft -= 1;        // this set consumes one
    this.startAttackAnim();    // one-shot cast pose
    playSfx("hourkeeper_alarm"); // graceful: silent until registered
  }

  spawnRune(player, hazards) {
    if (!hazards) return;
    // Scatter runes across a field centred on the witch's CURRENT spot (uniform
    // over the disc, so it covers her position too — standing still is risky and
    // she must read the field + move to a gap). More runes (HP phase) = denser.
    const a = Math.random() * Math.PI * 2;
    const dist = Math.sqrt(Math.random()) * HK_RUNE_FIELD; // uniform disc
    const pos = clampToPlayfield(
      player.x + Math.cos(a) * dist,
      player.y + Math.sin(a) * dist,
      HK_RUNE_RADIUS
    );
    hazards.push(new HazardZone(pos.x, pos.y, HK_RUNE_RADIUS, HK_RUNE_WARN * this._tighten, this.damage, {
      shape: "circle",
      skin: "clock",
      sfx: null,
    }));
  }

  beginBlink(player) {
    this.state = "blink";
    this.phaseTimer = HK_BLINK_TIME;
    this.untargetable = true; // brief immunity during the teleport poof
    this.vulnerable = false;
    this.repositionNear(player, HK_RANGE);
  }

  advanceAnim(dt) {
    const frames = HK_ANIMS[this.animState];
    const dur = 1 / HK_FPS[this.animState];
    this.animTimer += dt;
    while (this.animTimer >= dur) {
      this.animTimer -= dur;
      if (this.animState === "attack") {
        if (this.animFrame < frames - 1) this.animFrame += 1;
        else { this.animState = "idle"; this.animFrame = 0; } // one-shot -> idle
      } else {
        this.animFrame = (this.animFrame + 1) % frames; // idle loops
      }
    }
  }

  startAttackAnim() {
    this.animState = "attack";
    this.animFrame = 0;
    this.animTimer = 0;
  }

  takeDamage(amount) {
    if (!this.vulnerable) return; // immune unless in the alarm window
    this.health -= amount;
    this.hitFlash = 0.08;
    if (this.health <= 0) this.dead = true;
  }

  // The shared boss-summon call (boss.consumeSummon()) is made unguarded by
  // game.js — this no-op keeps the Hourkeeper (which never summons) safe.
  consumeSummon() {
    return false;
  }

  draw(ctx) {
    // Poof rings at each blink/vanish/reappear end (brass-tinted).
    for (const f of this.blinkFx) {
      const p = 1 - f.t / HK_FX_LIFE;
      const r = 6 + p * (this.radius + 12);
      ctx.save();
      ctx.globalAlpha = (1 - p) * 0.7;
      ctx.strokeStyle = "#f1c359";
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(f.x, f.y, r, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
    }

    if (this.alpha <= 0.02) return; // fully vanished — body not drawn

    const flash = this.hitFlash > 0;
    const key = `hourkeeper_${this.animState}_s`;
    const img = getImage(key);

    ctx.save();
    ctx.globalAlpha = this.alpha;
    if (img && img.width > 0) {
      const frames = HK_ANIMS[this.animState];
      const fw = img.width / frames;
      const fh = img.height;
      const dw = fw * this.spriteScale, dh = fh * this.spriteScale;
      const sx = Math.floor(this.animFrame) * fw;
      ctx.drawImage(img, sx, 0, fw, fh, this.x - dw / 2, this.y - dh / 2, dw, dh);
      if (flash) {
        ctx.globalAlpha = this.alpha * 0.55;
        ctx.globalCompositeOperation = "lighter";
        ctx.drawImage(img, sx, 0, fw, fh, this.x - dw / 2, this.y - dh / 2, dw, dh);
      }
    } else {
      this.drawClockFallback(ctx, flash);
    }
    ctx.restore();
  }

  // Code-drawn clock face: a brass-rimmed dial with hour ticks + two turning
  // hands. Glows while vulnerable so the punish window reads even without art.
  drawClockFallback(ctx, flash) {
    const R = this.radius;
    if (this.vulnerable) { ctx.save(); ctx.shadowColor = "#f1c359"; ctx.shadowBlur = 16; }
    ctx.fillStyle = flash ? "#ffffff" : "#2a2440";
    ctx.beginPath(); ctx.arc(this.x, this.y, R, 0, Math.PI * 2); ctx.fill();
    if (this.vulnerable) ctx.restore();

    ctx.lineWidth = 3;
    ctx.strokeStyle = flash ? "#ffffff" : "#f1c359";
    ctx.beginPath(); ctx.arc(this.x, this.y, R, 0, Math.PI * 2); ctx.stroke();

    ctx.strokeStyle = "rgba(241, 195, 89, 0.8)";
    ctx.lineWidth = 2;
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(this.x + Math.cos(a) * R * 0.78, this.y + Math.sin(a) * R * 0.78);
      ctx.lineTo(this.x + Math.cos(a) * R * 0.92, this.y + Math.sin(a) * R * 0.92);
      ctx.stroke();
    }

    const hourA = this.bodyTick * 0.6, minA = this.bodyTick * 1.8;
    ctx.strokeStyle = flash ? "#ffffff" : "#fff2c8";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(this.x, this.y);
    ctx.lineTo(this.x + Math.cos(hourA) * R * 0.5, this.y + Math.sin(hourA) * R * 0.5);
    ctx.stroke();
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(this.x, this.y);
    ctx.lineTo(this.x + Math.cos(minA) * R * 0.78, this.y + Math.sin(minA) * R * 0.78);
    ctx.stroke();

    ctx.fillStyle = "#f1c359";
    ctx.beginPath(); ctx.arc(this.x, this.y, 3, 0, Math.PI * 2); ctx.fill();
  }
}

// --- Boss selection ----------------------------------------------------------
// DEBUG_FORCE_BOSS: spawn a boss EVERY wave (testing). DEBUG_BOSS_TYPE picks
// which: "elder_wisp", "watching_hand", or "auto" (the normal shuffled-bag
// random rotation — no back-to-back repeats; order varies each run).
const DEBUG_FORCE_BOSS = false;
const DEBUG_BOSS_TYPE = "auto"; // "auto" | "elder_wisp" | "watching_hand" | "hive_warden" | "hourkeeper"

// All boss types in the random rotation. Add a new boss here and it joins the
// shuffled bag automatically (DEBUG_BOSS_TYPE can still force a specific one).
const BOSS_TYPES = ["elder_wisp", "watching_hand", "hive_warden", "hourkeeper"];
// Fixed easiest -> hardest rotation for NORMAL play: the boss at each 10-wave
// block steps through this order and loops (wave 10 = Elder Wisp, 20 = Hive
// Warden, 30 = The Watching Hand, 40 = Hourkeeper, 50 = Elder Wisp again...).
// Cursed Mode will instead use the shuffled bag (drawBossFromBag) for variety.
const BOSS_ORDER = ["elder_wisp", "hive_warden", "watching_hand", "hourkeeper"];

export class WaveManager {
  constructor(maxWaves = 10) {
    this.maxWaves = maxWaves;

    // Tunable timing.
    this.intermissionLength = 2.5; // seconds between waves
    this.spawnInterval = 0.8;      // seconds between spawns within a wave
    this.maxAlive = 12;            // safety cap on enemies on screen at once

    this.reset();
  }

  reset(endless = false, cursed = false) {
    this.endless = endless;        // false = capped tutorial, true = endless/cursed (uncapped)
    this.cursed = cursed;          // Cursed Mode: faster cadence + a base difficulty bump (see makeEnemy)
    this.bossEvery = cursed ? 5 : 10; // boss AND difficulty-tier interval — every 5 waves in Cursed
    this.curseSpeedMult = 1;       // Quickening curse multiplies new enemies' speed (1 = none)
    this.curseSpawnMult = 1;       // Teeming curse multiplies the per-wave enemy budget (1 = none)
    this.curseMaxAliveBonus = 0;   // Teeming curse raises the on-screen cap (0 = none)
    this.wave = 0;                 // becomes 1 when the first wave starts
    this.phase = "intermission";   // "intermission" | "spawning" | "boss"
    this.timer = 2.0;              // short "get ready" before wave 1
    this.toSpawn = 0;              // enemies left to spawn this wave
    this.spawnTimer = 0;
    this.boss = null;              // the current boss, once spawned
    this._bossIndex = 0;           // steps through BOSS_ORDER for the fixed normal-mode rotation (per run)
  }

  // How many full blocks have passed. Block size is bossEvery (10 normal, 5
  // Cursed), so Cursed escalates twice as fast: tier 0 for waves 1-5, 1 for 6-10...
  endlessTier() {
    return Math.max(0, Math.floor((this.wave - 1) / (this.bossEvery || 10)));
  }

  // Effective spawn gap: tightened a little each endless tier (with a floor),
  // plus a gentle per-wave shave after the opening (non-Cursed) so the mid waves
  // don't sag. See POST_OPENING_* for the why.
  spawnGap() {
    let gap = this.spawnInterval - this.endlessTier() * SPAWN_DELAY_PER_TIER;
    // The opening tier used to spawn at a flat spawnInterval for waves 1-10. Shave
    // a touch per wave past POST_OPENING_WAVE so groups arrive quicker; the cap
    // keeps this from endlessly stacking on the per-tier shave in long runs, and
    // MIN_SPAWN_INTERVAL still floors the result. Casual only: Tutorial (!endless)
    // keeps the flat opening gap the whole way, and Cursed keeps its own cadence.
    if (this.endless && !this.cursed && this.wave > POST_OPENING_WAVE) {
      gap -= Math.min(POST_OPENING_SPAWN_MAX, (this.wave - POST_OPENING_WAVE) * POST_OPENING_SPAWN_STEP);
    }
    return Math.max(MIN_SPAWN_INTERVAL, gap);
  }

  // Between-wave break: trimmed once past the opening (Casual only) so the mid-run
  // doesn't sag. Tutorial (!endless) and Cursed both keep the full 2.5s break — the
  // tutorial so new players get the relaxed teaching pace the whole way through.
  // Note: when this is read (end of a cleared wave) this.wave is the wave that just
  // finished, so the first trimmed break is the one entering wave 5.
  nextIntermission() {
    return (this.endless && !this.cursed && this.wave >= POST_OPENING_WAVE)
      ? INTERMISSION_SHORT
      : this.intermissionLength;
  }

  // The wave number to show on the HUD (the upcoming one during a break).
  get displayWave() {
    if (this.phase !== "intermission") return this.wave;
    const next = this.wave + 1;
    return this.endless ? next : Math.min(next, this.maxWaves);
  }

  // True when the wave shown by displayWave will spawn a boss. Mirrors the exact
  // rule in startNextWave() (wave % bossEvery === 0), so the "Boss Incoming" banner
  // stays in lockstep with the real spawn in BOTH modes — every 10th wave normal,
  // every 5th in Cursed — instead of a hardcoded multiple-of-10 that silently
  // missed Cursed boss waves (5, 15, 25…).
  get displayWaveIsBoss() {
    return this.displayWave % (this.bossEvery || 10) === 0;
  }

  // Mutates the `enemies` array. Call every frame while playing.
  // `view` describes the camera/world so spawns happen just off-screen.
  update(dt, enemies, view) {
    // Keep the shared playfield bounds current (used by hop/slam/spawn clamps).
    if (view) { PLAYFIELD.worldW = view.worldW; PLAYFIELD.worldH = view.worldH; }

    if (this.phase === "intermission") {
      this.timer -= dt;
      if (this.timer <= 0) this.startNextWave(enemies, view);
      return;
    }

    if (this.phase === "boss") {
      // The boss + its summons are driven by the boss and game.js.
      // In Endless, once the boss is down we roll straight into the next wave.
      // In Tutorial, game.js shows the Victory screen instead, so we wait.
      if (this.endless && this.boss && this.boss.dead) {
        this.boss = null;
        this.phase = "intermission";
        this.timer = this.nextIntermission();
      }
      return;
    }

    // phase === "spawning"
    if (this.toSpawn > 0) {
      this.spawnTimer -= dt;
      if (this.spawnTimer <= 0 && enemies.length < this.maxAlive + this.curseMaxAliveBonus) {
        enemies.push(this.makeEnemy(view, this.rollEnemyType(enemies)));
        this.toSpawn -= 1;
        this.spawnTimer = this.spawnGap();
      }
    } else if (enemies.length === 0) {
      // Whole wave spawned AND cleared → break before the next wave.
      this.phase = "intermission";
      this.timer = this.nextIntermission();
    }
  }

  startNextWave(enemies, view) {
    this.wave += 1;

    // Boss every bossEvery-th wave (10 normal; 5 in Cursed Mode for more pressure).
    if (DEBUG_FORCE_BOSS || this.wave % (this.bossEvery || 10) === 0) {
      this.phase = "boss";
      // Boss strength rises each block: wave 10 = x1, wave 20 = x2, wave 30 = x3.
      const bossTier = this.endlessTier() + 1;
      this.boss = this.makeBoss(view, bossTier);
      enemies.push(this.boss);
    } else {
      this.phase = "spawning";
      // Teeming curse scales the whole wave budget (1 = unaffected).
      this.toSpawn = Math.round((5 + this.wave * 2 + this.endlessTier() * COUNT_PER_TIER) * this.curseSpawnMult);
      this.spawnTimer = 0; // first enemy comes right away
    }
  }

  makeBoss(view, tier = 1) {
    const pos = spawnOutsideView(view);
    // Which boss: debug override wins; otherwise NORMAL play steps through a fixed
    // easiest -> hardest rotation (BOSS_ORDER), looping. Cursed Mode will instead
    // draw from the shuffled bag below for run-to-run variety.
    let type = DEBUG_BOSS_TYPE;
    // Normal play steps the fixed BOSS_ORDER; Cursed Mode draws from the shuffled
    // bag for run-to-run variety, matching its random curses.
    if (type === "auto") type = this.cursed ? this.drawBossFromBag() : this.nextOrderedBoss();
    return type === "watching_hand" ? new WatchingHand(pos.x, pos.y, tier)
         : type === "hive_warden"   ? new HiveWarden(pos.x, pos.y, tier)
         : type === "hourkeeper"    ? new Hourkeeper(pos.x, pos.y, tier)
         : new Boss(pos.x, pos.y, tier);
  }

  // Fixed-order boss pick for normal play: returns the next type in BOSS_ORDER and
  // advances, looping. The index resets per run (in reset()). Works under
  // DEBUG_FORCE_BOSS too — each forced boss simply takes the next slot in order.
  nextOrderedBoss() {
    const type = BOSS_ORDER[this._bossIndex % BOSS_ORDER.length];
    this._bossIndex += 1;
    return type;
  }

  // Shuffled-bag boss draw — used by CURSED MODE (random bosses). Normal play uses
  // the fixed nextOrderedBoss() rotation above. Refills + shuffles when empty, and
  // avoids an immediate repeat across a bag boundary (e.g. last of one bag == first
  // of the next).
  drawBossFromBag() {
    if (!this._bossBag || this._bossBag.length === 0) {
      this._bossBag = BOSS_TYPES.slice();
      for (let i = this._bossBag.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [this._bossBag[i], this._bossBag[j]] = [this._bossBag[j], this._bossBag[i]];
      }
      // Don't let a fresh bag start with the boss we just fought.
      if (BOSS_TYPES.length > 1 && this._bossBag[0] === this._lastBossType) {
        this._bossBag.push(this._bossBag.shift());
      }
    }
    this._lastBossType = this._bossBag.shift();
    return this._lastBossType;
  }

  // Which type the next spawn slot is: Gutter Geckos join from
  // GECKO_INTRO_WAVE, at GECKO_SPAWN_CHANCE per slot, capped at
  // GECKO_MAX_ALIVE simultaneously. Everything else is a wisp.
  rollEnemyType(enemies) {
    let geckosAlive = 0, magesAlive = 0, goblinsAlive = 0, prongAlive = 0, tinAlive = 0;
    for (const e of enemies) {
      if (e.dead) continue;
      if (e.type === "gutter_gecko") geckosAlive += 1;
      else if (e.type === "bone_mage") magesAlive += 1;
      else if (e.type === "goblin_bonker") goblinsAlive += 1;
      else if (e.type === "pronggeist") prongAlive += 1;
      else if (e.type === "tin_bulwark") tinAlive += 1;
    }
    // Bone Mage rolls first (rarer + capped) so its zoning pressure isn't
    // crowded out by the more common gecko roll.
    if (this.wave >= MAGE_INTRO_WAVE && magesAlive < MAGE_MAX_ALIVE &&
        Math.random() < MAGE_SPAWN_CHANCE) {
      return "bone_mage";
    }
    if (this.wave >= PRONG_INTRO_WAVE && prongAlive < PRONG_MAX_ALIVE &&
        Math.random() < PRONG_SPAWN_CHANCE) {
      return "pronggeist";
    }
    if (this.wave >= TIN_INTRO_WAVE && tinAlive < TIN_MAX_ALIVE &&
        Math.random() < TIN_SPAWN_CHANCE) {
      return "tin_bulwark";
    }
    if (this.wave >= GOBLIN_INTRO_WAVE && goblinsAlive < GOBLIN_MAX_ALIVE &&
        Math.random() < GOBLIN_SPAWN_CHANCE) {
      return "goblin_bonker";
    }
    if (this.wave >= GECKO_INTRO_WAVE && geckosAlive < GECKO_MAX_ALIVE &&
        Math.random() < GECKO_SPAWN_CHANCE) {
      return "gutter_gecko";
    }
    return "wisp";
  }

  makeEnemy(view, type = "wisp") {
    const pos = spawnOutsideView(view);
    const e = new Enemy(pos.x, pos.y, type);
    const tier = this.endlessTier();
    // Wisp baseline scaling (per-wave + per-tier, exactly as before), then the
    // type's multipliers on top — so a gecko is always relative to the wisps
    // it spawns beside.
    const baseSpeed = 75 + this.wave * 4 + tier * ENEMY_SPEED_PER_TIER;
    const baseHealth = 2 + Math.floor(this.wave / 3) + tier * ENEMY_HP_PER_TIER;
    // Cursed Mode is harder from the very first wave (the faster escalation + the
    // stacking curses do the rest).
    const speedMult = this.cursed ? CURSED_SPEED_MULT : 1;
    const hpMult = this.cursed ? CURSED_HP_MULT : 1;
    // Capped so a regular enemy can never fully outrun the fixed-220 witch (see
    // MAX_ENEMY_SPEED) — without this, deep waves + Cursed + Quickening compound
    // past 220 and kiting becomes impossible. Bosses set their own speed elsewhere.
    e.speed = Math.min(MAX_ENEMY_SPEED, baseSpeed * speedMult * e.def.speedMult * (this.curseSpeedMult || 1));
    e.maxHealth = Math.max(1, Math.round(baseHealth * hpMult * e.def.healthMult));
    e.health = e.maxHealth;
    // Offensive pressure: in Cursed, the swarm's CONTACT damage hits harder from the
    // start. Scales each type by its OWN base (a Goblin still dwarfs a wisp), and is
    // the only damage scaling in the game — normal mode keeps flat def damage.
    if (this.cursed) e.damage = Math.max(1, Math.round(e.def.damage * CURSED_DAMAGE_MULT));
    return e;
  }
}