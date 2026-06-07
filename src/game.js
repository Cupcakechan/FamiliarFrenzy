/* =========================================================================
   game.js — the state machine + owner of all the game objects.

   States (Phase 1–6 = full MVP):
        title    --ENTER-->            playing
        playing  --(XP bar fills)-->   levelUp   (PAUSES)
        levelUp  --(pick upgrade)-->   playing
        playing  --(health hits 0)-->  gameOver
        playing  --(clear wave 10)-->  victory
        gameOver --R-->                playing
        victory  --R-->                playing

   Phase 6 adds: the WaveManager (escalating waves with a between-wave
   intermission banner) and the VICTORY state when all 10 waves are cleared.

   dt = seconds since last frame.
   ========================================================================= */

import { Input } from "./input.js";
import { Player } from "./player.js";
import { Familiar } from "./familiar.js";
import { Enemy, WaveManager } from "./enemies.js";
import { Pickup, HealthFlask } from "./pickups.js";
import { getOffers } from "./upgrades.js";
import { circlesOverlap } from "./utils.js";
import { drawTitle, drawHUD, drawUpgradeScreen, drawWaveBanner, drawVictory, drawGameOver } from "./ui.js";

const STATE = {
  TITLE: "title",
  PLAYING: "playing",
  LEVEL_UP: "levelUp",
  DYING: "dying",      // brief: play the witch's death animation, then Game Over
  GAME_OVER: "gameOver",
  VICTORY: "victory",
};

const SCORE_PER_PICKUP = 10;
const OFFER_COUNT = 1;
const MAX_WAVES = 10;

// Health flask drops (Feature 1) — both easy to tune.
const FLASK_DROP_CHANCE = 0.12; // 12% chance per enemy killed
const FLASK_HEAL = 25;          // HP restored per flask

export class Game {
  constructor(width, height) {
    this.width = width;
    this.height = height;
    this.bounds = { width, height };

    this.state = STATE.TITLE;

    this.player = new Player(width / 2, height / 2);
    this.familiar = new Familiar(width / 2 - 22, height / 2 - 22);

    this.enemies = [];
    this.waveManager = new WaveManager(MAX_WAVES);
    this.pickups = [];
    this.flasks = [];

    this.score = 0;

    this.xp = 0;
    this.level = 1;
    this.xpToNext = 5;

    this.pendingLevelUps = 0;
    this.offers = [];
  }

  startGame() {
    this.score = 0;
    this.player.reset(this.width / 2, this.height / 2);
    this.familiar.reset(this.width / 2 - 22, this.height / 2 - 22);
    this.enemies = [];
    this.waveManager.reset();
    this.pickups = [];
    this.flasks = [];

    this.xp = 0;
    this.level = 1;
    this.xpToNext = 5;
    this.pendingLevelUps = 0;
    this.offers = [];

    this.state = STATE.PLAYING;
  }

  // --- UPDATE ------------------------------------------------------------
  update(dt) {
    switch (this.state) {
      case STATE.TITLE:
        if (Input.wasPressed("Enter") || Input.wasPressed("NumpadEnter")) {
          this.startGame();
        }
        break;

      case STATE.PLAYING:
        this.updatePlaying(dt);
        break;

      case STATE.LEVEL_UP:
        this.updateLevelUp();
        break;

      case STATE.DYING:
        this.player.updateDying(dt);
        if (this.player.deathDone) this.state = STATE.GAME_OVER;
        break;

      case STATE.GAME_OVER:
      case STATE.VICTORY:
        if (Input.wasPressed("KeyR")) {
          this.startGame();
        }
        break;
    }
  }

  updatePlaying(dt) {
    this.player.update(dt, Input, this.bounds);

    // Waves: spawn this wave's enemies, run intermissions, flag victory.
    this.waveManager.update(dt, this.enemies, this.bounds);

    for (const enemy of this.enemies) {
      enemy.update(dt, this.player);
      if (circlesOverlap(enemy.x, enemy.y, enemy.radius, this.player.x, this.player.y, this.player.radius)) {
        this.player.takeDamage(enemy.damage);
      }
    }

    this.familiar.update(dt, this.player, this.enemies);

    for (const enemy of this.enemies) {
      if (enemy.dead) {
        this.pickups.push(new Pickup(enemy.x, enemy.y));
        if (Math.random() < FLASK_DROP_CHANCE) {
          this.flasks.push(new HealthFlask(enemy.x, enemy.y, FLASK_HEAL));
        }
      }
    }
    this.enemies = this.enemies.filter((e) => !e.dead);

    for (const pickup of this.pickups) {
      pickup.update(dt);
      if (circlesOverlap(pickup.x, pickup.y, pickup.radius + 6, this.player.x, this.player.y, this.player.radius)) {
        pickup.dead = true;
        this.collectPickup(pickup);
      }
    }
    this.pickups = this.pickups.filter((p) => !p.dead);

    // Collect health flasks (heal on walk-over).
    for (const flask of this.flasks) {
      flask.update(dt);
      if (circlesOverlap(flask.x, flask.y, flask.radius + 6, this.player.x, this.player.y, this.player.radius)) {
        flask.dead = true;
        this.player.heal(flask.heal);
      }
    }
    this.flasks = this.flasks.filter((f) => !f.dead);

    // Priority: death, then victory, then a level-up.
    if (this.player.health <= 0) {
      this.player.startDying();
      this.state = STATE.DYING;
      return;
    }
    if (this.waveManager.victory) {
      this.state = STATE.VICTORY;
      return;
    }
    if (this.pendingLevelUps > 0) {
      this.offers = getOffers(OFFER_COUNT);
      this.state = STATE.LEVEL_UP;
    }
  }

  updateLevelUp() {
    let chosen = -1;
    if (Input.wasPressed("Enter") || Input.wasPressed("NumpadEnter")) chosen = 0;
    else if (Input.wasPressed("Digit1") || Input.wasPressed("Numpad1")) chosen = 0;
    else if (Input.wasPressed("Digit2") || Input.wasPressed("Numpad2")) chosen = 1;
    else if (Input.wasPressed("Digit3") || Input.wasPressed("Numpad3")) chosen = 2;

    if (chosen >= 0 && chosen < this.offers.length) {
      this.applyUpgrade(chosen);
    }
  }

  applyUpgrade(index) {
    this.offers[index].apply(this);
    this.pendingLevelUps -= 1;

    if (this.pendingLevelUps > 0) {
      this.offers = getOffers(OFFER_COUNT);
    } else {
      this.offers = [];
      this.state = STATE.PLAYING;
    }
  }

  collectPickup(pickup) {
    this.xp += pickup.value;
    this.score += SCORE_PER_PICKUP;

    while (this.xp >= this.xpToNext) {
      this.xp -= this.xpToNext;
      this.level += 1;
      this.xpToNext += 3;
      this.pendingLevelUps += 1;
    }
  }

  // --- RENDER ------------------------------------------------------------
  render(ctx) {
    ctx.clearRect(0, 0, this.width, this.height);

    switch (this.state) {
      case STATE.TITLE:
        drawTitle(ctx, this.width, this.height);
        break;

      case STATE.PLAYING:
        this.drawWorld(ctx);
        drawHUD(ctx, this.width, this.height, this.hudState());
        // Between-wave banner (player can still move during the breather).
        if (this.waveManager.phase === "intermission") {
          drawWaveBanner(ctx, this.width, this.height, this.waveManager.displayWave, this.waveManager.timer);
        }
        break;

      case STATE.LEVEL_UP:
        this.drawWorld(ctx);
        drawHUD(ctx, this.width, this.height, this.hudState());
        drawUpgradeScreen(ctx, this.width, this.height, this.offers);
        break;

      case STATE.VICTORY:
        this.drawWorld(ctx);
        drawVictory(ctx, this.width, this.height, this.hudState());
        break;

      case STATE.DYING:
        // Frozen world + HUD while the death animation plays (no overlay yet).
        this.drawWorld(ctx);
        drawHUD(ctx, this.width, this.height, this.hudState());
        break;

      case STATE.GAME_OVER:
        this.drawWorld(ctx);
        drawGameOver(ctx, this.width, this.height, this.hudState());
        break;
    }
  }

  drawWorld(ctx) {
    this.drawArena(ctx);
    for (const pickup of this.pickups) pickup.draw(ctx);
    for (const flask of this.flasks) flask.draw(ctx);
    for (const enemy of this.enemies) enemy.draw(ctx);
    this.familiar.draw(ctx);
    this.player.draw(ctx);
  }

  drawArena(ctx) {
    ctx.fillStyle = "#161430";
    ctx.fillRect(0, 0, this.width, this.height);

    ctx.strokeStyle = "rgba(155, 108, 255, 0.08)";
    ctx.lineWidth = 1;
    const step = 48;
    for (let x = step; x < this.width; x += step) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, this.height);
      ctx.stroke();
    }
    for (let y = step; y < this.height; y += step) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(this.width, y);
      ctx.stroke();
    }
  }

  hudState() {
    return {
      health: this.player.health,
      maxHealth: this.player.maxHealth,
      score: this.score,
      wave: this.waveManager.displayWave,
      maxWaves: this.waveManager.maxWaves,
      xp: this.xp,
      xpToNext: this.xpToNext,
      level: this.level,
    };
  }
}
