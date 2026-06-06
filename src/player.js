/* =========================================================================
   player.js — the witch.

   Phase 7 (this step): animated sprite with 8-direction WALK + IDLE.
     - Facing is read from movement (8 ways: s, n, e, w, se, ne, nw, sw).
     - Walking plays the "walk" strip; standing still plays "idle".
     - If a sprite isn't loaded yet (or is missing), falls back to the old
       purple-circle placeholder, so the game always runs.

   Frame size is auto-detected per sheet: each PNG is a single ROW of frames,
   so frameWidth = image.width / frameCount and frameHeight = image.height.

   Hurt + Die animations are next — their config is stubbed below (commented).
   ========================================================================= */

import { clamp } from "./utils.js";
import * as Assets from "./assets.js";

const SPRITE_DIRS = ["s", "n", "e", "w", "se", "ne", "nw", "sw"];

// Animation table: frame count + playback speed (fps) + whether it loops.
const PLAYER_ANIMS = {
  idle: { frames: 4, fps: 6,  loop: true },
  walk: { frames: 6, fps: 12, loop: true },
  // hurt: { frames: 7, fps: 14, loop: false }, // next step
  // die:  { frames: 9, fps: 10, loop: false }, // later
};

// On-screen scale for the sprite. 1 = draw at the art's native pixel size.
// Bump to 1.5 / 2 if the witch looks too small (tell me how it looks).
const PLAYER_SPRITE_SCALE = 1;

// Convert a movement vector into one of the 8 compass directions.
function dirFromVector(x, y) {
  const sx = Math.sign(x); // -1, 0, or 1
  const sy = Math.sign(y); // note: +y is DOWN on screen = south
  if (sx === 0 && sy > 0) return "s";
  if (sx > 0 && sy > 0) return "se";
  if (sx > 0 && sy === 0) return "e";
  if (sx > 0 && sy < 0) return "ne";
  if (sx === 0 && sy < 0) return "n";
  if (sx < 0 && sy < 0) return "nw";
  if (sx < 0 && sy === 0) return "w";
  if (sx < 0 && sy > 0) return "sw";
  return "s";
}

export class Player {
  constructor(x, y) {
    this.x = x;
    this.y = y;

    this.radius = 16;        // hitbox (sprite can be drawn larger/smaller)
    this.speed = 220;        // px per second
    this.color = "#9b6cff";  // placeholder purple

    this.maxHealth = 100;
    this.health = 100;
    this.invulnDuration = 1.0;
    this.invulnTimer = 0;

    // Animation.
    this.facing = "s";
    this.animState = "idle";
    this.animTime = 0;

    // Kick off loading every configured strip (idle + walk × 8 dirs).
    for (const state of Object.keys(PLAYER_ANIMS)) {
      for (const dir of SPRITE_DIRS) {
        Assets.loadImage(`player_${state}_${dir}`, `assets/sprites/player/${state}_${dir}.png`);
      }
    }
  }

  update(dt, input, bounds) {
    const move = input.getMoveAxis();

    this.x += move.x * this.speed * dt;
    this.y += move.y * this.speed * dt;
    this.x = clamp(this.x, this.radius, bounds.width - this.radius);
    this.y = clamp(this.y, this.radius, bounds.height - this.radius);

    if (this.invulnTimer > 0) this.invulnTimer -= dt;

    // Animation state + facing.
    const moving = move.x !== 0 || move.y !== 0;
    if (moving) this.facing = dirFromVector(move.x, move.y);

    const newState = moving ? "walk" : "idle";
    if (newState !== this.animState) {
      this.animState = newState;
      this.animTime = 0; // restart the cycle on a state change
    }
    this.animTime += dt;
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

    // Flicker while invulnerable (keeps the i-frame feedback).
    if (this.invulnTimer > 0) {
      const blinkOn = Math.floor(this.invulnTimer * 10) % 2 === 0;
      ctx.globalAlpha = blinkOn ? 0.4 : 1;
    }

    const anim = PLAYER_ANIMS[this.animState];
    const rec = Assets.getImage(`player_${this.animState}_${this.facing}`);

    if (anim && rec && rec.loaded && rec.img.width > 0) {
      // Slice the current frame out of the single-row strip.
      const fw = rec.img.width / anim.frames;
      const fh = rec.img.height;

      let frame = Math.floor(this.animTime * anim.fps);
      frame = anim.loop ? frame % anim.frames : Math.min(frame, anim.frames - 1);

      const dw = fw * PLAYER_SPRITE_SCALE;
      const dh = fh * PLAYER_SPRITE_SCALE;
      ctx.drawImage(rec.img, frame * fw, 0, fw, fh, this.x - dw / 2, this.y - dh / 2, dw, dh);
    } else {
      this.drawPlaceholder(ctx);
    }

    ctx.restore();
  }

  // Old purple-circle witch — shown until/unless the sprite is available.
  drawPlaceholder(ctx) {
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

  reset(x, y) {
    this.x = x;
    this.y = y;
    this.health = this.maxHealth;
    this.invulnTimer = 0;
    this.facing = "s";
    this.animState = "idle";
    this.animTime = 0;
  }
}
