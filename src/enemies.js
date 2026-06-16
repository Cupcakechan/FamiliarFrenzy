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
const MAGE_BLINK_COOLDOWN = 1.5; // min seconds between "you crowded me" blinks
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
    this.sfx = opts.sfx || "mage_blast";
    // Circle look: "curse" = Bone Mage cursed ground (rune/violet), "stomp" =
    // Goblin shockwave (green/amber, no rune). Rect ignores this.
    this.skin = opts.skin || "curse";
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
        // Detonate: damage once if the witch is inside right now. A LANDED hit
        // (one that beat her i-frames) also knocks her back from the origin.
        if (!this.hasHit && player && !player.dead && this.hits(player)) {
          const landed = player.takeDamage(this.damage);
          if (landed && this.knockback > 0 && typeof player.applyKnockback === "function") {
            const kx = player.x - this.ox, ky = player.y - this.oy;
            const len = Math.hypot(kx, ky) || 1;
            player.applyKnockback(kx / len, ky / len, this.knockback);
          }
        }
        this.hasHit = true;
        this.phase = "blast";
        this.timer = HAZARD_BLAST_TIME;
        playSfx(this.sfx); // missing file = silent (registry is graceful)
      }
    } else if (this.timer <= 0) {
      this.dead = true;
    }
  }

  draw(ctx) {
    if (this.shape === "rect") { this.drawRect(ctx); return; }
    this.drawCircle(ctx);
  }

  // Goblin swing: a rotated danger rectangle whose fill sweeps from the goblin
  // out to the tip as the swing loads, then a bright impact flash.
  drawRect(ctx) {
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

  // Bone Mage cursed ground: warning ring/rune that fills, then an impact flash.
  drawCircle(ctx) {
    if (this.skin === "stomp") { this.drawStomp(ctx); return; }
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

    // Animation state (visual only). Start frame is randomized so a swarm
    // doesn't pulse in perfect lockstep.
    const animCfg = ENEMY_ANIMS[this.def.spritePrefix];
    this.facing = "s";
    // Resting state differs per model: the ghostly wisp floats; the grounded
    // gecko and the Bone Mage idle; the Goblin has no rest pose (it's always
    // advancing or mid-swing), so its "rest" is the walk loop.
    this.restState = this.def.bruiser ? "walk" : (this.def.ranged || this.def.caster) ? "idle" : "float";
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
    } else {
      // --- Melee chaser (wisp): walk straight at the witch (unchanged) ---
      this.x += (dx / len) * this.speed * dt;
      this.y += (dy / len) * this.speed * dt;
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

    // --- Animation (visual only) ---
    // Both types always face the witch (the gecko backs away while facing her,
    // as a flinger should).
    // --- Facing + animation (visual only) ---
    // The Goblin (bruiser) drives its OWN facing + frame in updateBruiser (it
    // LOCKS them through the wind-up/swing), so it opts out of the generic path.
    if (!this.def.bruiser) {
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
    // Emergency reposition: the witch crowded it (gated so it can't spam-blink).
    if (len < c.blinkRange && this.blinkCooldown <= 0) this.blink(player, c);

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

  // Phase-step: vanish (poof at the old spot) and reappear a fixed distance
  // away, biased AWAY from the witch and clamped to the floor.
  blink(player, c) {
    const away = Math.atan2(this.y - player.y, this.x - player.x);
    const ang = away + randomRange(-0.8, 0.8);
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
const MIN_SPAWN_INTERVAL = 0.35;   // ...but never faster than this

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

// --- Boss selection ----------------------------------------------------------
// DEBUG_FORCE_BOSS: spawn a boss EVERY wave (testing). DEBUG_BOSS_TYPE picks
// which: "elder_wisp", "watching_hand", or "auto" (the normal shuffled-bag
// random rotation — no back-to-back repeats; order varies each run).
const DEBUG_FORCE_BOSS = false;
const DEBUG_BOSS_TYPE = "auto"; // "auto" | "elder_wisp" | "watching_hand" | "hive_warden"

// All boss types in the random rotation. Add a new boss here and it joins the
// shuffled bag automatically (DEBUG_BOSS_TYPE can still force a specific one).
const BOSS_TYPES = ["elder_wisp", "watching_hand", "hive_warden"];

export class WaveManager {
  constructor(maxWaves = 10) {
    this.maxWaves = maxWaves;

    // Tunable timing.
    this.intermissionLength = 2.5; // seconds between waves
    this.spawnInterval = 0.8;      // seconds between spawns within a wave
    this.maxAlive = 12;            // safety cap on enemies on screen at once

    this.reset();
  }

  reset(endless = false) {
    this.endless = endless;        // false = capped tutorial, true = endless
    this.wave = 0;                 // becomes 1 when the first wave starts
    this.phase = "intermission";   // "intermission" | "spawning" | "boss"
    this.timer = 2.0;              // short "get ready" before wave 1
    this.toSpawn = 0;              // enemies left to spawn this wave
    this.spawnTimer = 0;
    this.boss = null;              // the current boss, once spawned
  }

  // How many full 10-wave blocks have passed (0 for waves 1-10, 1 for 11-20...).
  endlessTier() {
    return Math.max(0, Math.floor((this.wave - 1) / 10));
  }

  // Effective spawn gap, tightened a little each endless tier (with a floor).
  spawnGap() {
    return Math.max(MIN_SPAWN_INTERVAL, this.spawnInterval - this.endlessTier() * SPAWN_DELAY_PER_TIER);
  }

  // The wave number to show on the HUD (the upcoming one during a break).
  get displayWave() {
    if (this.phase !== "intermission") return this.wave;
    const next = this.wave + 1;
    return this.endless ? next : Math.min(next, this.maxWaves);
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
        this.timer = this.intermissionLength;
      }
      return;
    }

    // phase === "spawning"
    if (this.toSpawn > 0) {
      this.spawnTimer -= dt;
      if (this.spawnTimer <= 0 && enemies.length < this.maxAlive) {
        enemies.push(this.makeEnemy(view, this.rollEnemyType(enemies)));
        this.toSpawn -= 1;
        this.spawnTimer = this.spawnGap();
      }
    } else if (enemies.length === 0) {
      // Whole wave spawned AND cleared → break before the next wave.
      this.phase = "intermission";
      this.timer = this.intermissionLength;
    }
  }

  startNextWave(enemies, view) {
    this.wave += 1;

    // Boss every 10th wave (Tutorial: wave 10; Endless: 10, 20, 30, ...).
    if (DEBUG_FORCE_BOSS || this.wave % 10 === 0) {
      this.phase = "boss";
      // Boss strength rises each block: wave 10 = x1, wave 20 = x2, wave 30 = x3.
      const bossTier = this.endlessTier() + 1;
      this.boss = this.makeBoss(view, bossTier);
      enemies.push(this.boss);
    } else {
      this.phase = "spawning";
      this.toSpawn = 5 + this.wave * 2 + this.endlessTier() * COUNT_PER_TIER;
      this.spawnTimer = 0; // first enemy comes right away
    }
  }

  makeBoss(view, tier = 1) {
    const pos = spawnOutsideView(view);
    // Which boss: debug override wins; otherwise draw from a shuffled "bag" of
    // all boss types. The bag cycles through every type in random order and
    // reshuffles when empty, so you never face the same boss twice in a row and
    // the ORDER varies run to run (true random can repeat or starve a type).
    let type = DEBUG_BOSS_TYPE;
    if (type === "auto") type = this.drawBossFromBag();
    return type === "watching_hand" ? new WatchingHand(pos.x, pos.y, tier)
         : type === "hive_warden"   ? new HiveWarden(pos.x, pos.y, tier)
         : new Boss(pos.x, pos.y, tier);
  }

  // Shuffled-bag boss draw. Refills + shuffles when empty. Avoids an immediate
  // repeat across a bag boundary (e.g. last of one bag == first of the next).
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
    let geckosAlive = 0, magesAlive = 0, goblinsAlive = 0;
    for (const e of enemies) {
      if (e.dead) continue;
      if (e.type === "gutter_gecko") geckosAlive += 1;
      else if (e.type === "bone_mage") magesAlive += 1;
      else if (e.type === "goblin_bonker") goblinsAlive += 1;
    }
    // Bone Mage rolls first (rarer + capped) so its zoning pressure isn't
    // crowded out by the more common gecko roll.
    if (this.wave >= MAGE_INTRO_WAVE && magesAlive < MAGE_MAX_ALIVE &&
        Math.random() < MAGE_SPAWN_CHANCE) {
      return "bone_mage";
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
    e.speed = baseSpeed * e.def.speedMult;
    e.maxHealth = Math.max(1, Math.round(baseHealth * e.def.healthMult));
    e.health = e.maxHealth;
    return e;
  }
}
