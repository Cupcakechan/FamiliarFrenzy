/* =========================================================================
   game.js — the state machine + owner of all the game objects.

   States (Phase 1–4):
        title  --ENTER-->  playing
        playing  --(health hits 0)-->  gameOver
        gameOver  --R-->  playing (fresh game)

   Phase 4 adds: enemies drop currency MOTES on death, the witch collects them
   by walking over them, collecting grants XP + score, and filling the XP bar
   LEVELS YOU UP (with a "LEVEL UP!" flash). The actual upgrade CHOICE screen
   is Phase 5 — for now leveling just bumps the level and flashes.

   dt = seconds since last frame.
   ========================================================================= */

import { Input } from "./input.js";
import { Player } from "./player.js";
import { Familiar } from "./familiar.js";
import { Enemy, Spawner } from "./enemies.js";
import { Pickup } from "./pickups.js";
import { circlesOverlap } from "./utils.js";
import { drawTitle, drawHUD, drawGameOver, drawLevelUpFlash } from "./ui.js";

const STATE = {
  TITLE: "title",
  PLAYING: "playing",
  GAME_OVER: "gameOver",
  // LEVEL_UP: "levelUp",   // Phase 5
  // VICTORY: "victory",    // Phase 6
};

const SCORE_PER_PICKUP = 10;       // score gained per mote collected
const LEVEL_UP_FLASH_DURATION = 1.2; // seconds the "LEVEL UP!" text shows

export class Game {
  constructor(width, height) {
    this.width = width;
    this.height = height;
    this.bounds = { width, height };

    this.state = STATE.TITLE;

    this.player = new Player(width / 2, height / 2);
    this.familiar = new Familiar(width / 2 - 22, height / 2 - 22);

    this.enemies = [];
    this.spawner = new Spawner(1.5, 8);
    this.pickups = [];

    this.score = 0;
    this.wave = 1; // placeholder; real wave logic is Phase 6

    // XP / leveling.
    this.xp = 0;
    this.level = 1;
    this.xpToNext = 5;        // level 1 threshold (then +3 per level)
    this.levelUpFlash = 0;    // countdown timer for the flash text
  }

  startGame() {
    this.score = 0;
    this.wave = 1;
    this.player.reset(this.width / 2, this.height / 2);
    this.familiar.reset(this.width / 2 - 22, this.height / 2 - 22);
    this.enemies = [];
    this.spawner.reset();
    this.pickups = [];

    this.xp = 0;
    this.level = 1;
    this.xpToNext = 5;
    this.levelUpFlash = 0;

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
        this.player.update(dt, Input, this.bounds);

        this.spawner.update(dt, this.enemies, this.bounds);

        // Enemies chase + contact damage.
        for (const enemy of this.enemies) {
          enemy.update(dt, this.player);
          if (circlesOverlap(enemy.x, enemy.y, enemy.radius, this.player.x, this.player.y, this.player.radius)) {
            this.player.takeDamage(enemy.damage);
          }
        }

        // Cat fires; bolts damage enemies.
        this.familiar.update(dt, this.player, this.enemies);

        // Dead enemies DROP a mote, then are removed.
        for (const enemy of this.enemies) {
          if (enemy.dead) this.pickups.push(new Pickup(enemy.x, enemy.y));
        }
        this.enemies = this.enemies.filter((e) => !e.dead);

        // Update + collect pickups.
        for (const pickup of this.pickups) {
          pickup.update(dt);
          // A little collection grace (+6) so walking near grabs it.
          if (circlesOverlap(pickup.x, pickup.y, pickup.radius + 6, this.player.x, this.player.y, this.player.radius)) {
            pickup.dead = true;
            this.collectPickup(pickup);
          }
        }
        this.pickups = this.pickups.filter((p) => !p.dead);

        if (this.levelUpFlash > 0) this.levelUpFlash -= dt;

        if (this.player.health <= 0) {
          this.state = STATE.GAME_OVER;
        }
        break;

      case STATE.GAME_OVER:
        if (Input.wasPressed("KeyR")) {
          this.startGame();
        }
        break;
    }
  }

  // Grant XP + score, and handle leveling up.
  collectPickup(pickup) {
    this.xp += pickup.value;
    this.score += SCORE_PER_PICKUP;

    // `while` in case a single collect crosses a threshold (and for future
    // bigger pickups). Excess XP carries into the next level.
    while (this.xp >= this.xpToNext) {
      this.xp -= this.xpToNext;
      this.level += 1;
      this.xpToNext += 3;
      this.levelUpFlash = LEVEL_UP_FLASH_DURATION;
      // PHASE 5 HOOK: instead of just flashing, this is where we'll switch to
      // a LEVEL_UP state, pause the game, and show the upgrade card.
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
        this.drawArena(ctx);
        for (const pickup of this.pickups) pickup.draw(ctx);
        for (const enemy of this.enemies) enemy.draw(ctx);
        this.familiar.draw(ctx);
        this.player.draw(ctx);
        drawHUD(ctx, this.width, this.height, this.hudState());
        if (this.levelUpFlash > 0) {
          drawLevelUpFlash(ctx, this.width, this.height, this.levelUpFlash, LEVEL_UP_FLASH_DURATION);
        }
        break;

      case STATE.GAME_OVER:
        this.drawArena(ctx);
        for (const pickup of this.pickups) pickup.draw(ctx);
        for (const enemy of this.enemies) enemy.draw(ctx);
        this.familiar.draw(ctx);
        this.player.draw(ctx);
        drawGameOver(ctx, this.width, this.height, this.hudState());
        break;
    }
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
      wave: this.wave,
      xp: this.xp,
      xpToNext: this.xpToNext,
      level: this.level,
    };
  }
}
