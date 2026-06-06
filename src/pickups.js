/* =========================================================================
   pickups.js — the currency "mote" dropped when an enemy dies.

   Phase 4 responsibilities:
     - Hold a small XP value.
     - Sit on the ground with a gentle bob until the witch walks over it.

   Collection + XP/level logic lives in game.js (it owns the player and the
   score/XP). This file is just the mote itself.

   Placeholder art: a glowing gold circle. Sprite swap is Phase 7 and only
   touches draw(). A future "Magnet Charm" upgrade can add pull-toward-player
   behavior; base collection is simple walk-over.
   ========================================================================= */

import { randomRange } from "./utils.js";

export class Pickup {
  constructor(x, y) {
    this.x = x;
    this.y = y;
    this.radius = 7;
    this.value = 1;     // XP granted on collect
    this.dead = false;  // set true once collected
    this.bob = randomRange(0, Math.PI * 2); // random start so motes don't bob in sync
  }

  update(dt) {
    this.bob += dt * 4; // gentle floating motion
  }

  draw(ctx) {
    const yOff = Math.sin(this.bob) * 2;
    ctx.save();

    ctx.shadowColor = "#f4d58d";
    ctx.shadowBlur = 12;
    ctx.fillStyle = "#f4d58d";
    ctx.beginPath();
    ctx.arc(this.x, this.y + yOff, this.radius, 0, Math.PI * 2);
    ctx.fill();

    // Bright core sparkle.
    ctx.shadowBlur = 0;
    ctx.fillStyle = "#fff6dd";
    ctx.beginPath();
    ctx.arc(this.x, this.y + yOff, this.radius * 0.45, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }
}
