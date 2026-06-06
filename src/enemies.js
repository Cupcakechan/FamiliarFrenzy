/* =========================================================================
   enemies.js — the Cursed Wisp enemy + a simple trickle Spawner.

   Phase 3 responsibilities:
     - Enemy: spawn off-screen, drift toward the witch, hurt her on contact,
       take damage from the cat's bolts, and die.
     - Spawner: every `interval` seconds, if fewer than `maxAlive` are out,
       add one wisp at a random screen edge.

   Phase 6 will reuse this Spawner and just ramp `interval` / `maxAlive` (and
   enemy stats) per wave — no rewrite needed.

   Placeholder art: a glowing red circle. Swap for a sprite in Phase 7; the
   shape draw lives entirely in draw() so that change is isolated.
   ========================================================================= */

import { randomInt, randomRange } from "./utils.js";

export class Enemy {
  constructor(x, y) {
    this.x = x;
    this.y = y;
    this.radius = 13;

    // --- Tunable Phase 3 numbers ---
    this.speed = 75;     // px/sec — slower than the witch (220) so you can kite
    this.maxHealth = 2;  // bolts do familiar.damage (1) each → ~2 hits to kill
    this.health = 2;
    this.damage = 8;     // contact damage dealt to the player

    this.dead = false;
    this.hitFlash = 0;   // brief flash when struck by a bolt
    this.wobble = randomRange(0, Math.PI * 2); // floaty bob, purely cosmetic
  }

  // dt = seconds. player = the witch to chase.
  update(dt, player) {
    const dx = player.x - this.x;
    const dy = player.y - this.y;
    const len = Math.hypot(dx, dy) || 1; // unit direction toward player
    this.x += (dx / len) * this.speed * dt;
    this.y += (dy / len) * this.speed * dt;

    this.wobble += dt * 6;
    if (this.hitFlash > 0) this.hitFlash -= dt;
  }

  // Called by the familiar's bolts.
  takeDamage(amount) {
    this.health -= amount;
    this.hitFlash = 0.1;
    if (this.health <= 0) this.dead = true;
  }

  draw(ctx) {
    ctx.save();
    const flash = this.hitFlash > 0;
    const r = this.radius + Math.sin(this.wobble) * 1.5; // gentle bob

    // Outer glow body.
    ctx.shadowColor = "#e2536b";
    ctx.shadowBlur = 14;
    ctx.fillStyle = flash ? "#ffffff" : "#e2536b";
    ctx.beginPath();
    ctx.arc(this.x, this.y, r, 0, Math.PI * 2);
    ctx.fill();

    // Darker core so it reads as a "cursed" wisp.
    ctx.shadowBlur = 0;
    ctx.fillStyle = flash ? "#ffd0d8" : "#7d1f2e";
    ctx.beginPath();
    ctx.arc(this.x, this.y, r * 0.5, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }
}

export class Spawner {
  constructor(interval = 1.5, maxAlive = 8) {
    this.interval = interval; // seconds between spawns
    this.maxAlive = maxAlive; // cap on enemies on screen at once
    this.timer = 0;
  }

  reset() {
    this.timer = 0;
  }

  // Pushes new enemies into the provided `enemies` array.
  update(dt, enemies, bounds) {
    this.timer -= dt;
    if (this.timer <= 0 && enemies.length < this.maxAlive) {
      enemies.push(this.makeWisp(bounds));
      this.timer = this.interval;
    }
  }

  // Spawn just OUTSIDE a random edge so wisps drift inward.
  makeWisp(bounds) {
    const edge = randomInt(0, 3); // 0 top, 1 right, 2 bottom, 3 left
    const m = 24;                 // how far off-screen to start
    let x, y;
    if (edge === 0)      { x = randomRange(0, bounds.width);  y = -m; }
    else if (edge === 1) { x = bounds.width + m;              y = randomRange(0, bounds.height); }
    else if (edge === 2) { x = randomRange(0, bounds.width);  y = bounds.height + m; }
    else                 { x = -m;                            y = randomRange(0, bounds.height); }
    return new Enemy(x, y);
  }
}
