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

// --- Boss: Elder Wisp (Wave 10) ------------------------------------------
// Tunable constants (Endless can later pass a higher `tier` for tougher bosses).
const BOSS_HEALTH = 50;
const BOSS_DAMAGE = 20;
const BOSS_SPEED = 60;           // slightly slower than normal wisps (75)
const BOSS_DASH_COOLDOWN = 5;    // seconds between dashes
const BOSS_DASH_TELEGRAPH = 0.6; // wind-up warning before the dash
const BOSS_DASH_DURATION = 0.35; // length of the dash burst
const BOSS_DASH_SPEED = 440;     // dash velocity
const BOSS_SUMMON_COOLDOWN = 9;  // seconds between summons
const BOSS_WOBBLE_DRIFT = 55;    // px/s side-to-side amplitude

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

    this.summonTimer = BOSS_SUMMON_COOLDOWN;
    this.summonReady = false;    // game.js reads this to spawn adds
  }

  update(dt, player) {
    this.wobble += dt * 3;
    if (this.hitFlash > 0) this.hitFlash -= dt;

    // Summon timer always ticks.
    this.summonTimer -= dt;
    if (this.summonTimer <= 0) {
      this.summonReady = true;
      this.summonTimer = BOSS_SUMMON_COOLDOWN;
    }

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

    // Telegraph warning line in the dash direction.
    if (this.phase === "telegraph") {
      const L = 150;
      const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 70);
      ctx.globalAlpha = 0.45 + 0.45 * pulse;
      ctx.strokeStyle = "#ffd27a";
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(this.x, this.y);
      ctx.lineTo(this.x + this.aimX * L, this.y + this.aimY * L);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

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
    this.phase = "intermission";   // "intermission" | "spawning" | "boss"
    this.timer = 2.0;              // short "get ready" before wave 1
    this.toSpawn = 0;              // enemies left to spawn this wave
    this.spawnTimer = 0;
    this.boss = null;              // the Wave 10 boss, once spawned
  }

  // The wave number to show on the HUD (the upcoming one during a break).
  get displayWave() {
    return this.phase === "intermission" ? Math.min(this.wave + 1, this.maxWaves) : this.wave;
  }

  // Mutates the `enemies` array. Call every frame while playing.
  // `view` describes the camera/world so spawns happen just off-screen.
  update(dt, enemies, view) {
    if (this.phase === "intermission") {
      this.timer -= dt;
      if (this.timer <= 0) this.startNextWave(enemies, view);
      return;
    }

    if (this.phase === "boss") {
      // Boss + its summons are driven by the boss and game.js; victory is
      // decided when the boss dies, so there's nothing to spawn here.
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
      // Whole wave spawned AND cleared → break before the next wave.
      this.phase = "intermission";
      this.timer = this.intermissionLength;
    }
  }

  startNextWave(enemies, view) {
    this.wave += 1;
    // Boss wave. (For Endless later: use `this.wave % 10 === 0` instead.)
    if (this.wave >= this.maxWaves) {
      this.phase = "boss";
      this.boss = this.makeBoss(view);
      enemies.push(this.boss);
    } else {
      this.phase = "spawning";
      this.toSpawn = 5 + this.wave * 2; // W1=7 ... W9=23
      this.spawnTimer = 0;              // first enemy comes right away
    }
  }

  makeBoss(view, tier = 1) {
    const pos = spawnOutsideView(view);
    return new Boss(pos.x, pos.y, tier);
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
