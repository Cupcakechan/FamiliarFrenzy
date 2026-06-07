/* =========================================================================
   pickups.js — the currency "mote" dropped when an enemy dies.

   Phase 4: holds an XP value, sits on the ground until collected.
   Phase 7: a small looping idle sprite (4 frames, single direction).
            Falls back to the gold placeholder circle if the sprite is
            missing or still loading. Each mote starts on a random frame so a
            field of them doesn't animate in lockstep.

   Sprite file (single-row strip) in assets/sprites/pickups/:
     mote_idle.png   (4 frames)
   ========================================================================= */

import { randomRange, randomInt } from "./utils.js";
import { loadImage, getImage } from "./assets.js";

const MOTE_FRAMES = 4;
const MOTE_FPS = 6;

loadImage("mote_idle", "assets/sprites/pickups/mote_idle.png");

export class Pickup {
  constructor(x, y) {
    this.x = x;
    this.y = y;
    this.radius = 7;     // collection hitbox (kept small; +grace added in game.js)
    this.value = 1;      // XP granted on collect
    this.dead = false;

    this.bob = randomRange(0, Math.PI * 2);  // gentle float, desynced per mote
    this.spriteScale = 1;                    // lower if the mote looks too big
    this.animFrame = randomInt(0, MOTE_FRAMES - 1);
    this.animTimer = 0;
  }

  update(dt) {
    this.bob += dt * 4;

    const frameDur = 1 / MOTE_FPS;
    this.animTimer += dt;
    while (this.animTimer >= frameDur) {
      this.animTimer -= frameDur;
      this.animFrame = (this.animFrame + 1) % MOTE_FRAMES;
    }
  }

  draw(ctx) {
    const yOff = Math.sin(this.bob) * 2;
    const img = getImage("mote_idle");

    if (img && img.width > 0) {
      const fw = img.width / MOTE_FRAMES;
      const fh = img.height;
      const dw = fw * this.spriteScale;
      const dh = fh * this.spriteScale;
      const sx = Math.floor(this.animFrame) * fw;
      ctx.drawImage(img, sx, 0, fw, fh, this.x - dw / 2, this.y + yOff - dh / 2, dw, dh);
    } else {
      // Fallback gold mote.
      ctx.save();
      ctx.shadowColor = "#f4d58d";
      ctx.shadowBlur = 12;
      ctx.fillStyle = "#f4d58d";
      ctx.beginPath();
      ctx.arc(this.x, this.y + yOff, this.radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = "#fff6dd";
      ctx.beginPath();
      ctx.arc(this.x, this.y + yOff, this.radius * 0.45, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }
}
