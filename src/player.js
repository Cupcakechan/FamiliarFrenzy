/* =========================================================================
   player.js — the witch.

   Phase 7 (this step): 4-direction sprite animation.
     - Facing (N/S/E/W) is derived from movement; when you stop, the witch
       keeps facing the last way and plays the IDLE animation.
     - WALK animation plays while moving.
     - Frames are sliced from single-row strips; frame size is read from the
       image itself, so any art size just works.
     - If a sprite isn't loaded yet (or is missing), we fall back to the old
       purple placeholder circle — the game never breaks.

   Hurt + Die animations come in the next steps; their frame counts are listed
   below already so adding them is a one-line change.

   Sprite files expected (single-row strips), in assets/sprites/player/:
     witch_idle_n.png  witch_idle_s.png  witch_idle_e.png  witch_idle_w.png   (4 frames)
     witch_walk_n.png  witch_walk_s.png  witch_walk_e.png  witch_walk_w.png   (6 frames)
   ========================================================================= */

import { clamp } from "./utils.js";
import { loadImage, getImage } from "./assets.js";

const DIRS = ["n", "s", "e", "w"];

// Animation name -> number of frames in its strip.
// (hurt/die are listed for later; we only animate idle + walk for now.)
const PLAYER_ANIMS = {
  idle: 4,
  walk: 6,
  // hurt: 7,  // next step
  // die: 9,   // next step
};

// Frames-per-second for each animation.
const ANIM_FPS = {
  idle: 5,
  walk: 10,
};

// Register the sprites we use now. (Add hurt/die here when we implement them.)
for (const anim of ["idle", "walk"]) {
  for (const d of DIRS) {
    const key = `witch_${anim}_${d}`;
    loadImage(key, `assets/sprites/player/${key}.png`);
  }
}

export class Player {
  constructor(x, y) {
    this.x = x;
    this.y = y;

    this.radius = 16;          // hitbox (collisions) — kept separate from sprite size
    this.speed = 220;          // pixels per second
    this.color = "#9b6cff";    // placeholder color (fallback only)

    this.maxHealth = 100;
    this.health = 100;
    this.invulnDuration = 1.0;
    this.invulnTimer = 0;

    // --- Animation state ---
    this.facing = "s";         // start facing the camera
    this.animState = "idle";   // "idle" | "walk"
    this.animFrame = 0;
    this.animTimer = 0;
    this.spriteScale = 1;      // bump this (e.g. 1.5) if you want the witch bigger
  }

  update(dt, input, bounds) {
    const move = input.getMoveAxis();

    this.x += move.x * this.speed * dt;
    this.y += move.y * this.speed * dt;
    this.x = clamp(this.x, this.radius, bounds.width - this.radius);
    this.y = clamp(this.y, this.radius, bounds.height - this.radius);

    if (this.invulnTimer > 0) this.invulnTimer -= dt;

    this.updateAnimation(dt, move);
  }

  updateAnimation(dt, move) {
    const moving = move.x !== 0 || move.y !== 0;

    // Pick facing from movement (horizontal wins ties); keep last when idle.
    if (moving) {
      if (Math.abs(move.x) > Math.abs(move.y)) {
        this.facing = move.x > 0 ? "e" : "w";
      } else {
        this.facing = move.y > 0 ? "s" : "n"; // canvas y+ is downward
      }
    }

    const newState = moving ? "walk" : "idle";
    if (newState !== this.animState) {
      this.animState = newState;
      this.animFrame = 0;
      this.animTimer = 0;
    }

    // Advance the frame on a timer.
    const fps = ANIM_FPS[this.animState];
    const frameCount = PLAYER_ANIMS[this.animState];
    const frameDur = 1 / fps;
    this.animTimer += dt;
    while (this.animTimer >= frameDur) {
      this.animTimer -= frameDur;
      this.animFrame = (this.animFrame + 1) % frameCount;
    }
  }

  takeDamage(amount) {
    if (this.invulnTimer > 0) return false;
    this.health -= amount;
    if (this.health < 0) this.health = 0;
    this.invulnTimer = this.invulnDuration;
    return true;
  }

  get isInvulnerable() {
    return this.invulnTimer > 0;
  }

  draw(ctx) {
    ctx.save();

    // Flicker while invulnerable so i-frames are visible (sprite or fallback).
    if (this.invulnTimer > 0) {
      const blinkOn = Math.floor(this.invulnTimer * 10) % 2 === 0;
      ctx.globalAlpha = blinkOn ? 0.35 : 1;
    }

    const key = `witch_${this.animState}_${this.facing}`;
    const img = getImage(key);

    if (img && img.width > 0) {
      // Slice the current frame out of the single-row strip.
      const frames = PLAYER_ANIMS[this.animState];
      const fw = img.width / frames;
      const fh = img.height;
      const dw = fw * this.spriteScale;
      const dh = fh * this.spriteScale;
      const sx = Math.floor(this.animFrame) * fw;
      ctx.drawImage(img, sx, 0, fw, fh, this.x - dw / 2, this.y - dh / 2, dw, dh);
    } else {
      // --- Fallback placeholder (until sprites are in place) ---
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
    this.health = this.maxHealth;
    this.invulnTimer = 0;
    this.facing = "s";
    this.animState = "idle";
    this.animFrame = 0;
    this.animTimer = 0;
  }
}
