/* =========================================================================
   pickups.js — things enemies drop that the witch collects.

   Pickup (currency mote): grants XP. Uses a small looping idle sprite, with
   a gold-circle fallback.

   HealthFlask (Feature 1): a rarer drop that restores HP. Uses a SIMPLE green
   placeholder shape for now (no sprite — art is paused). Carries its heal
   amount so the game stays the single source of tuning.
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
    this.radius = 7;
    this.value = 1;
    this.dead = false;

    this.bob = randomRange(0, Math.PI * 2);
    this.spriteScale = 0.5;
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

// --- Health Flask (Feature 1) --------------------------------------------
// Placeholder: a green orb with a white "+" cross. Easy to swap for a sprite
// later when art resumes.
export class HealthFlask {
  constructor(x, y, heal) {
    this.x = x;
    this.y = y;
    this.radius = 9;
    this.heal = heal;     // HP restored on pickup
    this.dead = false;
    this.bob = randomRange(0, Math.PI * 2);
  }

  update(dt) {
    this.bob += dt * 4;
  }

  draw(ctx) {
    const yOff = Math.sin(this.bob) * 2;
    const cy = this.y + yOff;
    ctx.save();

    ctx.shadowColor = "#5ad17a";
    ctx.shadowBlur = 12;
    ctx.fillStyle = "#5ad17a";
    ctx.beginPath();
    ctx.arc(this.x, cy, this.radius, 0, Math.PI * 2);
    ctx.fill();

    // White health "+" cross.
    ctx.shadowBlur = 0;
    ctx.fillStyle = "#ffffff";
    const arm = 6;  // length from center
    const thick = 2; // half-thickness
    ctx.fillRect(this.x - thick, cy - arm, thick * 2, arm * 2); // vertical
    ctx.fillRect(this.x - arm, cy - thick, arm * 2, thick * 2); // horizontal

    ctx.restore();
  }
}
