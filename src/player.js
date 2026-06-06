/* =========================================================================
   player.js — the witch (placeholder shape for now: a purple circle).

   Phase 1 responsibilities:
     - Move with WASD / Arrow Keys
     - Stay inside the arena
     - Hold a health value (no damage yet — enemies come in Phase 3)

   Later phases will add: taking damage, invulnerability flash, sprite, etc.
   The hooks (health, invulnTimer, radius) are already here so we don't have
   to rewrite this file later.
   ========================================================================= */

import { clamp } from "./utils.js";

export class Player {
  constructor(x, y) {
    // Position is the CENTER of the player.
    this.x = x;
    this.y = y;

    this.radius = 16;          // used for drawing now, collisions later
    this.speed = 220;          // pixels per SECOND (frame-rate independent)
    this.color = "#9b6cff";    // placeholder purple

    // Health system (display only in Phase 1).
    this.maxHealth = 100;
    this.health = 100;
    this.invulnTimer = 0;      // seconds of i-frames remaining (used in Phase 3)
  }

  // dt = delta time in seconds. bounds = { width, height } of the arena.
  update(dt, input, bounds) {
    const move = input.getMoveAxis();

    this.x += move.x * this.speed * dt;
    this.y += move.y * this.speed * dt;

    // Keep the whole circle inside the arena.
    this.x = clamp(this.x, this.radius, bounds.width - this.radius);
    this.y = clamp(this.y, this.radius, bounds.height - this.radius);

    // Count down i-frames (no effect yet, ready for Phase 3).
    if (this.invulnTimer > 0) this.invulnTimer -= dt;
  }

  draw(ctx) {
    // Placeholder body: a glowing purple circle with a small "hat" notch on top
    // so it reads as a character and you can tell which way is "up".
    ctx.save();

    // Soft glow.
    ctx.shadowColor = this.color;
    ctx.shadowBlur = 14;

    ctx.fillStyle = this.color;
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
    ctx.fill();

    // Little hat triangle (purely cosmetic placeholder).
    ctx.shadowBlur = 0;
    ctx.fillStyle = "#5b3aa6";
    ctx.beginPath();
    ctx.moveTo(this.x, this.y - this.radius - 12);
    ctx.lineTo(this.x - 10, this.y - this.radius + 2);
    ctx.lineTo(this.x + 10, this.y - this.radius + 2);
    ctx.closePath();
    ctx.fill();

    ctx.restore();
  }

  // Reset everything for a fresh game (called from Game on restart).
  reset(x, y) {
    this.x = x;
    this.y = y;
    this.health = this.maxHealth;
    this.invulnTimer = 0;
  }
}
