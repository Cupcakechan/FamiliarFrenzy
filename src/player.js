/* =========================================================================
   player.js — the witch.

   Sprite animation:
     - 8-direction facing (N/S/E/W + NE/NW/SE/SW) from movement; idle when stopped.
     - WALK (loops) while moving, IDLE (loops) when still.
     - DIE (plays ONCE) when health hits 0 — driven by the game's "dying" state.
     - "Hurt" is just the invulnerability flicker (no hurt sprite).
     - Missing/loading sprite → fall back to the purple placeholder circle.

   Sprite files (single-row strips) in assets/sprites/player/, where
   <dir> is one of: n, s, e, w, ne, nw, se, sw (diagonals use the same
   frame counts as the cardinals):
     witch_idle_<dir>.png   (4 frames)
     witch_walk_<dir>.png   (6 frames)
     witch_die_<dir>.png    (8 frames)
   ========================================================================= */

import { clamp } from "./utils.js";
import { loadImage, getImage } from "./assets.js";

const DIRS = ["n", "s", "e", "w", "ne", "nw", "se", "sw"];

// Animation name -> frames in its strip.
const PLAYER_ANIMS = {
  idle: 4,
  walk: 6,
  die: 8,
};

// Frames per second per animation.
const ANIM_FPS = {
  idle: 5,
  walk: 10,
  die: 10, // 8 frames @ 10fps ≈ 0.8s death
};

// Which animations loop. (die plays once and holds on its last frame.)
const LOOPING = { idle: true, walk: true, die: false };

// Knockback (e.g. Goblin Bonker club): a brief impulse decays over this long.
const KNOCK_TIME = 0.22; // seconds

// Register sprites. The default purple set is "witch"; outfit recolors use the
// same strips under a prefixed name (e.g. witch_red_walk_ne.png). Any recolor
// file that's missing simply falls back to the purple frame at draw time, so
// shipping a partial set is safe. Prefixes must match OUTFITS[*].spritePrefix.
const WITCH_SKINS = ["witch", "witch_red", "witch_blue", "witch_gold"];
for (const prefix of WITCH_SKINS) {
  for (const anim of ["idle", "walk", "die"]) {
    for (const d of DIRS) {
      const key = `${prefix}_${anim}_${d}`;
      loadImage(key, `assets/sprites/player/${key}.png`);
    }
  }
}

export class Player {
  constructor(x, y) {
    this.x = x;
    this.y = y;

    this.radius = 16;
    this.speed = 220;
    this.color = "#9b6cff"; // fallback only

    this.maxHealth = 100;
    this.health = 100;
    this.invulnDuration = 1.0;
    this.invulnTimer = 0;

    // Knockback impulse (Goblin Bonker club, etc.): a brief decaying shove the
    // witch can still move against — a push, not a stun.
    this.knockVX = 0;
    this.knockVY = 0;
    this.knockTimer = 0;

    // Sustained push (Tin Bulwark wall): a per-frame directional shove, set while
    // she overlaps an active push-wall and cleared every frame in update(). Kept
    // separate from knockback so neither affects the other.
    this.pushVX = 0;
    this.pushVY = 0;

    // Animation state.
    this.facing = "s";
    this.animState = "idle"; // "idle" | "walk" | "die"
    this.animFrame = 0;
    this.animTimer = 0;
    this.spriteScale = 1;    // bump if the witch looks too small
    this.spritePrefix = "witch"; // equipped-outfit skin; set by game.startGame()
    this.deathDone = false;  // true once the die animation reaches its last frame
  }

  // Normal gameplay update (PLAYING state).
  update(dt, input, bounds) {
    const move = input.getMoveAxis();

    this.x += move.x * this.speed * dt;
    this.y += move.y * this.speed * dt;

    // Knockback shove on top of normal movement. Velocity decays linearly so the
    // total displacement ≈ the requested px, and the witch keeps her own control.
    if (this.knockTimer > 0) {
      const k = this.knockTimer / KNOCK_TIME; // 1 -> 0
      this.x += this.knockVX * k * dt;
      this.y += this.knockVY * k * dt;
      this.knockTimer -= dt;
    }

    // Tin Bulwark wall push: a sustained directional shove, set per-frame by an
    // active push-wall she overlaps (HazardZone in "push" mode). She keeps WASD
    // control on top, the clamp below keeps her on the floor, and it's cleared at
    // the end of the frame so it self-cancels the instant no wall is pushing —
    // which also makes it safe regardless of the wall/player update order.
    this.x += this.pushVX * dt;
    this.y += this.pushVY * dt;

    // Keep the whole circle inside the arena, minus an optional edge inset
    // (the wall-ring thickness) so the witch stays on the floor.
    const m = bounds.inset || 0;
    this.x = clamp(this.x, this.radius + m, bounds.width - this.radius - m);
    this.y = clamp(this.y, this.radius + m, bounds.height - this.radius - m);
    this.pushVX = 0;
    this.pushVY = 0;

    if (this.invulnTimer > 0) this.invulnTimer -= dt;

    this.updateAnimation(dt, move);
  }

  updateAnimation(dt, move) {
    const moving = move.x !== 0 || move.y !== 0;

    if (moving) {
      // Combine vertical + horizontal so diagonals pick ne/nw/se/sw, and a
      // single axis picks the cardinal. (y > 0 is south/down, y < 0 north/up.)
      const vert = move.y > 0 ? "s" : move.y < 0 ? "n" : "";
      const horiz = move.x > 0 ? "e" : move.x < 0 ? "w" : "";
      this.facing = (vert + horiz) || this.facing;
    }

    const newState = moving ? "walk" : "idle";
    if (newState !== this.animState) {
      this.animState = newState;
      this.animFrame = 0;
      this.animTimer = 0;
    }

    this.advanceFrames(dt);
  }

  // --- DEATH (one-shot) ---------------------------------------------------
  startDying() {
    this.animState = "die";
    this.animFrame = 0;
    this.animTimer = 0;
    this.deathDone = false;
  }

  // Called by the game's "dying" state; only advances the death animation.
  updateDying(dt) {
    this.advanceFrames(dt);
    if (this.animFrame >= PLAYER_ANIMS.die - 1) {
      this.deathDone = true; // last frame reached → game can move to Game Over
    }
  }

  // Shared frame stepper. Looping anims wrap; non-looping clamp on last frame.
  advanceFrames(dt) {
    const fps = ANIM_FPS[this.animState];
    const frameCount = PLAYER_ANIMS[this.animState];
    const frameDur = 1 / fps;
    const loops = LOOPING[this.animState];

    this.animTimer += dt;
    while (this.animTimer >= frameDur) {
      this.animTimer -= frameDur;
      if (loops) {
        this.animFrame = (this.animFrame + 1) % frameCount;
      } else if (this.animFrame < frameCount - 1) {
        this.animFrame += 1;
      } else {
        break; // hold on last frame
      }
    }
  }

  takeDamage(amount) {
    if (this.invulnTimer > 0) return false;
    this.health -= amount;
    if (this.health < 0) this.health = 0;
    this.invulnTimer = this.invulnDuration;
    return true;
  }

  // Restore health, never exceeding max.
  heal(amount) {
    this.health = Math.min(this.maxHealth, this.health + amount);
  }

  // Brief decaying shove away from a hit. dirX/dirY need not be normalized;
  // `distance` is roughly the total px pushed. The witch keeps WASD control.
  applyKnockback(dirX, dirY, distance) {
    const len = Math.hypot(dirX, dirY) || 1;
    const speed = (2 * distance) / KNOCK_TIME; // linear decay integrates to `distance`
    this.knockVX = (dirX / len) * speed;
    this.knockVY = (dirY / len) * speed;
    this.knockTimer = KNOCK_TIME;
  }

  // Sustained directional shove (Tin Bulwark wall). Called EVERY frame she
  // overlaps the active wall; `speed` is px/s. The witch keeps her own movement
  // on top and is never pinned (she can walk against it or slip out the sides).
  // Additive so overlapping walls stack; update() zeroes it each frame, so it
  // stops the instant no wall is pushing.
  applyPush(dirX, dirY, speed) {
    const len = Math.hypot(dirX, dirY) || 1;
    this.pushVX += (dirX / len) * speed;
    this.pushVY += (dirY / len) * speed;
  }

  get isInvulnerable() {
    return this.invulnTimer > 0;
  }

  draw(ctx) {
    ctx.save();

    // Flicker while invulnerable — but NOT during the death animation.
    if (this.invulnTimer > 0 && this.animState !== "die") {
      const blinkOn = Math.floor(this.invulnTimer * 10) % 2 === 0;
      ctx.globalAlpha = blinkOn ? 0.35 : 1;
    }

    // Prefer the equipped outfit's skin; if that recolor frame isn't loaded
    // (missing file), fall back to the default purple set, then the circle.
    const prefix = this.spritePrefix || "witch";
    const img = getImage(`${prefix}_${this.animState}_${this.facing}`)
             || getImage(`witch_${this.animState}_${this.facing}`);

    if (img && img.width > 0) {
      const frames = PLAYER_ANIMS[this.animState];
      const fw = img.width / frames;
      const fh = img.height;
      const dw = fw * this.spriteScale;
      const dh = fh * this.spriteScale;
      const sx = Math.floor(this.animFrame) * fw;
      ctx.drawImage(img, sx, 0, fw, fh, this.x - dw / 2, this.y - dh / 2, dw, dh);
    } else {
      // Fallback placeholder.
      ctx.shadowColor = this.color;
      ctx.shadowBlur = 14;
      ctx.fillStyle = this.color;
      ctx.beginPath();
      ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
      ctx.fill();

      ctx.shadowBlur = 0;
      ctx.fillStyle = "#5b3aa6";
      ctx.beginPath();
      ctx.moveTo(this.x, this.y - this.radius - 12);
      ctx.lineTo(this.x - 10, this.y - this.radius + 2);
      ctx.lineTo(this.x + 10, this.y - this.radius + 2);
      ctx.closePath();
      ctx.fill();
    }

    ctx.restore();
  }

  reset(x, y) {
    this.x = x;
    this.y = y;
    this.maxHealth = 100;
    this.health = this.maxHealth;
    this.invulnTimer = 0;
    this.knockVX = 0;
    this.knockVY = 0;
    this.knockTimer = 0;
    this.pushVX = 0;
    this.pushVY = 0;
    this.facing = "s";
    this.animState = "idle";
    this.animFrame = 0;
    this.animTimer = 0;
    this.deathDone = false;
  }
}
