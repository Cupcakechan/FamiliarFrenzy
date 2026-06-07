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

import { randomInt, randomRange, clamp } from "./utils.js";

export class Enemy {
  constructor(x, y) {
    this.x = x;
    this.y = y;
    this.radius = 13;

    this.speed = 75;
    this.maxHealth = 2;
    this.health = 2;
    this.damage = 8;

    this.dead = false;
    this.hitFlash = 0;
    this.wobble = randomRange(0, Math.PI * 2);
  }

  update(dt, player) {
    const dx = player.x - this.x;
    const dy = player.y - this.y;
    const len = Math.hypot(dx, dy) || 1;
    this.x += (dx / len) * this.speed * dt;
    this.y += (dy / len) * this.speed * dt;

    this.wobble += dt * 6;
    if (this.hitFlash > 0) this.hitFlash -= dt;
  }

  takeDamage(amount) {
    this.health -= amount;
    this.hitFlash = 0.1;
    if (this.health <= 0) this.dead = true;
  }

  draw(ctx) {
    ctx.save();
    const flash = this.hitFlash > 0;
    const r = this.radius + Math.sin(this.wobble) * 1.5;

    ctx.shadowColor = "#e2536b";
    ctx.shadowBlur = 14;
    ctx.fillStyle = flash ? "#ffffff" : "#e2536b";
    ctx.beginPath();
    ctx.arc(this.x, this.y, r, 0, Math.PI * 2);
    ctx.fill();

    ctx.shadowBlur = 0;
    ctx.fillStyle = flash ? "#ffd0d8" : "#7d1f2e";
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

export class WaveManager {
  constructor(maxWaves = 10) {
    this.maxWaves = maxWaves;

    // Tunable timing.
    this.intermissionLength = 2.5; // seconds between waves
    this.spawnInterval = 0.8;      // seconds between spawns within a wave
    this.maxAlive = 12;            // safety cap on enemies on screen at once

    this.reset();
  }

  reset() {
    this.wave = 0;                 // becomes 1 when the first wave starts
    this.phase = "intermission";   // "intermission" | "spawning"
    this.timer = 2.0;              // short "get ready" before wave 1
    this.toSpawn = 0;              // enemies left to spawn this wave
    this.spawnTimer = 0;
    this.victory = false;
  }

  // The wave number to show on the HUD (the upcoming one during a break).
  get displayWave() {
    if (this.victory) return this.maxWaves;
    return this.phase === "intermission" ? Math.min(this.wave + 1, this.maxWaves) : this.wave;
  }

  // Mutates the `enemies` array. Call every frame while playing.
  // `view` describes the camera/world so spawns happen just off-screen.
  update(dt, enemies, view) {
    if (this.victory) return;

    if (this.phase === "intermission") {
      this.timer -= dt;
      if (this.timer <= 0) this.startNextWave();
      return;
    }

    // phase === "spawning"
    if (this.toSpawn > 0) {
      this.spawnTimer -= dt;
      if (this.spawnTimer <= 0 && enemies.length < this.maxAlive) {
        enemies.push(this.makeWisp(view));
        this.toSpawn -= 1;
        this.spawnTimer = this.spawnInterval;
      }
    } else if (enemies.length === 0) {
      // Whole wave spawned AND cleared.
      if (this.wave >= this.maxWaves) {
        this.victory = true;
      } else {
        this.phase = "intermission";
        this.timer = this.intermissionLength;
      }
    }
  }

  startNextWave() {
    this.wave += 1;
    this.phase = "spawning";
    this.toSpawn = 5 + this.wave * 2; // W1=7 ... W10=25
    this.spawnTimer = 0;              // first enemy comes right away
  }

  makeWisp(view) {
    const pos = spawnOutsideView(view);
    const e = new Enemy(pos.x, pos.y);
    // Difficulty scaling per wave.
    e.speed = 75 + this.wave * 4;
    e.maxHealth = 2 + Math.floor(this.wave / 3);
    e.health = e.maxHealth;
    return e;
  }
}
