/* =========================================================================
   game.js — the state machine + owner of all the game objects.

   States (Phase 1–3):
        title  --ENTER-->  playing
        playing  --(health hits 0)-->  gameOver
        gameOver  --R-->  playing (fresh game)

   Phase 3 adds: real enemies (Cursed Wisps) via a trickle Spawner, contact
   damage to the witch, the cat's bolts killing enemies, score per kill, and
   a real Game Over driven by the HP bar. The Phase 2 practice dummies and the
   Phase 1 debug "K" key are now GONE.

   Unity analogy: this class is like a GameManager. update() ≈ Update(),
   render() ≈ draw pass. dt = seconds since last frame.
   ========================================================================= */

import { Input } from "./input.js";
import { Player } from "./player.js";
import { Familiar } from "./familiar.js";
import { Enemy, Spawner } from "./enemies.js";
import { circlesOverlap } from "./utils.js";
import { drawTitle, drawHUD, drawGameOver } from "./ui.js";

const STATE = {
  TITLE: "title",
  PLAYING: "playing",
  GAME_OVER: "gameOver",
  // LEVEL_UP: "levelUp",   // Phase 5
  // VICTORY: "victory",    // Phase 6
};

// TEMPORARY Phase 3 feedback: points per kill. Phase 4 ties score/XP to the
// currency pickups enemies drop, so this will move there.
const SCORE_PER_KILL = 10;

export class Game {
  constructor(width, height) {
    this.width = width;
    this.height = height;
    this.bounds = { width, height };

    this.state = STATE.TITLE;

    this.player = new Player(width / 2, height / 2);
    this.familiar = new Familiar(width / 2 - 22, height / 2 - 22);

    this.enemies = [];
    this.spawner = new Spawner(1.5, 8); // every 1.5s, up to 8 alive

    this.score = 0;
    this.wave = 1; // placeholder; real wave logic is Phase 6
  }

  // Start (or restart) a fresh playthrough.
  startGame() {
    this.score = 0;
    this.wave = 1;
    this.player.reset(this.width / 2, this.height / 2);
    this.familiar.reset(this.width / 2 - 22, this.height / 2 - 22);
    this.enemies = [];
    this.spawner.reset();
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

        // Spawn new wisps over time (trickle, capped).
        this.spawner.update(dt, this.enemies, this.bounds);

        // Move enemies toward the witch + contact damage.
        for (const enemy of this.enemies) {
          enemy.update(dt, this.player);
          if (circlesOverlap(enemy.x, enemy.y, enemy.radius, this.player.x, this.player.y, this.player.radius)) {
            this.player.takeDamage(enemy.damage); // ignored if i-frames active
          }
        }

        // Cat follows the witch and fires at the nearest enemy (bolts deal damage).
        this.familiar.update(dt, this.player, this.enemies);

        // Award score for any enemy that died this frame, then clear the dead.
        for (const enemy of this.enemies) {
          if (enemy.dead) this.score += SCORE_PER_KILL;
        }
        this.enemies = this.enemies.filter((e) => !e.dead);

        // Real Game Over.
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

  // --- RENDER ------------------------------------------------------------
  render(ctx) {
    ctx.clearRect(0, 0, this.width, this.height);

    switch (this.state) {
      case STATE.TITLE:
        drawTitle(ctx, this.width, this.height);
        break;

      case STATE.PLAYING:
        this.drawArena(ctx);
        for (const enemy of this.enemies) enemy.draw(ctx);
        this.familiar.draw(ctx); // bolts + cat
        this.player.draw(ctx);
        drawHUD(ctx, this.width, this.height, this.hudState());
        break;

      case STATE.GAME_OVER:
        this.drawArena(ctx);
        for (const enemy of this.enemies) enemy.draw(ctx);
        this.familiar.draw(ctx);
        this.player.draw(ctx);
        drawGameOver(ctx, this.width, this.height, this.hudState());
        break;
    }
  }

  // A subtle top-down arena floor with a grid so movement is readable.
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
    };
  }
}
