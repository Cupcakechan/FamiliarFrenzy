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
    ranged: null,
  },
  gutter_gecko: {
    spritePrefix: "gecko",
    spriteScale: 0.5, // tune independently once the gecko art is in
    speedMult: 0.6,   // slower than a wisp — it fights from range
    healthMult: 0.75, // squishier — reach is its armor
    damage: 8,        // contact damage if you do touch it
    fallbackOuter: "#5ad1d1",
    fallbackInner: "#1f6b6b",
    ranged: {
      preferredRange: 280,
      slack: 40,
      cooldown: 2.5,
      projSpeed: 220,
      projDamage: 8,
      projLife: 3,
      fireRange: 420,
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

// Per-prefix animation tables.
const ENEMY_ANIMS = {
  wisp:  { anims: WISP_ANIMS, fps: WISP_FPS, looping: WISP_LOOPING },
  gecko: {
    anims:   { idle: 4, walk: 4, attack: 4 },
    fps:     { idle: 5, walk: 8, attack: 10 },
    looping: { idle: true, walk: true, attack: false }, // attack plays once
  },
};

// The gecko's flung ball sprite (60x60 canvas, ~34px swirl ball inside).
// Drawn at GECKO_BALL_SCALE (visual only — the gameplay hitbox stays radius 5)
// and spun in crisp 90-degree steps so the pixel grid never blurs.
loadImage("lizard_projectile", "assets/sprites/projectiles/lizard_projectile.png");
const GECKO_BALL_SCALE = 0.5;

// The fling pose lasts exactly one attack cycle (frames / fps = 4/10 = 0.4s).
const GECKO_ATTACK_POSE_SECONDS = ENEMY_ANIMS.gecko.anims.attack / ENEMY_ANIMS.gecko.fps.attack;

// --- A flung gecko ball ------------------------------------------------------
// Owned by game.js (this.enemyBolts) so shots outlive their shooter. Player
// collision/i-frames are handled in game.js; this is just motion + visuals.
export class EnemyBolt {
  constructor(x, y, targetX, targetY, speed, damage, life) {
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
  }

  update(dt) {
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.spin += dt * 9;
    this.life -= dt;
    if (this.life <= 0) this.dead = true;
  }

  draw(ctx) {
    const img = getImage("lizard_projectile");

    if (img && img.width > 0) {
      // --- Sprite ball: soft sage halo for readability on the dark floor,
      // then the art spun in exact quarter-turn steps (pixel-grid safe). ---
      const dw = img.width * GECKO_BALL_SCALE;
      const dh = img.height * GECKO_BALL_SCALE;
      const haloR = this.radius * 2.4;
      const g = ctx.createRadialGradient(this.x, this.y, 0, this.x, this.y, haloR);
      g.addColorStop(0, "rgba(140, 200, 150, 0.30)");
      g.addColorStop(1, "rgba(140, 200, 150, 0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(this.x, this.y, haloR, 0, Math.PI * 2);
      ctx.fill();

      const quarter = Math.floor(this.spin / (Math.PI / 2)) % 4; // 0..3
      ctx.save();
      ctx.translate(this.x, this.y);
      ctx.rotate(quarter * (Math.PI / 2));
      ctx.drawImage(img, -dw / 2, -dh / 2, dw, dh);
      ctx.restore();
      return;
    }

    // --- Fallback "ball": teal glowing orb with a bright core. ---
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

    this.dead = false;
    this.hitFlash = 0;
    this.wobble = randomRange(0, Math.PI * 2);

    // Ranged (Gutter Gecko) state.
    this.fireTimer = this.def.ranged ? randomRange(0.8, this.def.ranged.cooldown) : 0;
    this.attackPoseTimer = 0; // holds the attack anim briefly after a fling
    this.repositioning = false; // gecko: outside its dead zone → walk vs idle
    this.bondTickTimer = 0;     // Spirit Bond: per-enemy damage-tick cooldown

    // Animation state (visual only). Start frame is randomized so a swarm
    // doesn't pulse in perfect lockstep.
    const animCfg = ENEMY_ANIMS[this.def.spritePrefix];
    this.facing = "s";
    // Resting state differs per model: the ghostly wisp floats; the grounded
    // gecko idles.
    this.restState = this.def.ranged ? "idle" : "float";
    this.animState = this.restState;
    this.animFrame = randomInt(0, animCfg.anims[this.restState] - 1);
    this.animTimer = 0;
    this.spriteScale = this.def.spriteScale; // per-type (native px * this)
  }

  // `enemyBolts` is the game-owned array ranged enemies fling into (melee
  // types ignore it; game.js handles bolt motion/collision after this).
  update(dt, player, enemyBolts) {
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
        this.fireTimer = r.cooldown + randomRange(-0.4, 0.4);
        this.attackPoseTimer = GECKO_ATTACK_POSE_SECONDS;
      }
      if (this.attackPoseTimer > 0) this.attackPoseTimer -= dt;
    } else {
      // --- Melee chaser (wisp): walk straight at the witch (unchanged) ---
      this.x += (dx / len) * this.speed * dt;
      this.y += (dy / len) * this.speed * dt;
    }

    this.wobble += dt * 6;
    if (this.hitFlash > 0) this.hitFlash -= dt;

    // --- Animation (visual only) ---
    // Both types always face the witch (the gecko backs away while facing her,
    // as a flinger should).
    this.facing = dirFromVector(dx, dy);

    // Wisp: ATTACK while touching (reads the same proximity the contact-damage
    // check uses; damage itself is untouched, handled in game.js), FLOAT
    // otherwise. Gecko: ATTACK (one-shot) during the fling pose, WALK while
    // repositioning, IDLE while holding its distance.
    const touching = len <= this.radius + player.radius + WISP_ATTACK_VISUAL_GAP;
    let newState;
    if (this.def.ranged) {
      newState = this.attackPoseTimer > 0 ? "attack" : (this.repositioning ? "walk" : "idle");
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

  takeDamage(amount) {
    this.health -= amount;
    this.hitFlash = 0.1;
    if (this.health <= 0) this.dead = true;
  }

  draw(ctx) {
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

function clampToPlayfield(x, y, radius = 0) {
  const m = WALL_INSET + radius;
  return {
    x: clamp(x, m, PLAYFIELD.worldW - m),
    y: clamp(y, m, PLAYFIELD.worldH - m),
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
    this.spriteScale = 2.0; // tune once art is in (boss radius 30; native px * this)

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

// --- Boss selection ----------------------------------------------------------
// DEBUG_FORCE_BOSS: spawn a boss EVERY wave (testing). DEBUG_BOSS_TYPE picks
// which: "elder_wisp", "watching_hand", or "auto" (the normal alternation —
// Elder Wisp on wave 10/30/..., Watching Hand on wave 20/40/...).
const DEBUG_FORCE_BOSS = true;
const DEBUG_BOSS_TYPE = "watching_hand"; // "auto" | "elder_wisp" | "watching_hand"

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
    // Which boss: debug override wins; otherwise alternate by boss-wave count —
    // Elder Wisp on the 1st/3rd/... boss (wave 10, 30, ...), Watching Hand on
    // the 2nd/4th/... (wave 20, 40, ...). bossOrdinal = how many bosses deep.
    let type = DEBUG_BOSS_TYPE;
    if (type === "auto") {
      const bossOrdinal = Math.max(1, Math.round(this.wave / 10)); // 1 at wave 10, 2 at 20...
      type = bossOrdinal % 2 === 0 ? "watching_hand" : "elder_wisp";
    }
    return type === "watching_hand"
      ? new WatchingHand(pos.x, pos.y, tier)
      : new Boss(pos.x, pos.y, tier);
  }

  // Which type the next spawn slot is: Gutter Geckos join from
  // GECKO_INTRO_WAVE, at GECKO_SPAWN_CHANCE per slot, capped at
  // GECKO_MAX_ALIVE simultaneously. Everything else is a wisp.
  rollEnemyType(enemies) {
    if (this.wave < GECKO_INTRO_WAVE) return "wisp";
    let geckosAlive = 0;
    for (const e of enemies) {
      if (!e.dead && e.type === "gutter_gecko") geckosAlive += 1;
    }
    if (geckosAlive >= GECKO_MAX_ALIVE) return "wisp";
    return Math.random() < GECKO_SPAWN_CHANCE ? "gutter_gecko" : "wisp";
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
