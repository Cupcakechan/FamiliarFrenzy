/* =========================================================================
   game.js — the state machine + owner of all the game objects.

   States (Phase 1 + Phase 2):
        title  --ENTER-->  playing
        playing  --(debug K)-->  gameOver
        gameOver  --R-->  playing (fresh game)

   Phase 2 adds: the cat Familiar, and TEMPORARY practice dummies so the cat
   has something to shoot at (there are no real enemies until Phase 3).

   Unity analogy: this class is like a GameManager. update() ≈ Update(),
   render() ≈ your draw pass. dt = seconds since last frame.
   ========================================================================= */

import { Input } from "./input.js";
import { Player } from "./player.js";
import { Familiar } from "./familiar.js";
import { drawTitle, drawHUD, drawGameOver } from "./ui.js";

const STATE = {
  TITLE: "title",
  PLAYING: "playing",
  GAME_OVER: "gameOver",
  // LEVEL_UP: "levelUp",   // Phase 5
  // VICTORY: "victory",    // Phase 6
};

export class Game {
  constructor(width, height) {
    this.width = width;
    this.height = height;
    this.bounds = { width, height };

    this.state = STATE.TITLE;

    this.player = new Player(width / 2, height / 2);
    this.familiar = new Familiar(width / 2 - 22, height / 2 - 22);

    // --- TEMPORARY PHASE 2 SCAFFOLDING ---------------------------------
    // Stationary "practice dummies" so we can watch the cat target + fire.
    // These are NOT enemies. REMOVE this whole concept in Phase 3 and pass
    // the real enemy list to familiar.update() instead.
    this.dummies = [];

    this.score = 0;
    this.wave = 1; // placeholder; real wave logic is Phase 6
  }

  // Build a fresh set of practice dummies. (Temporary — Phase 2 only.)
  spawnDummies() {
    this.dummies = [
      { x: 720, y: 170, radius: 16, dead: false, hitFlash: 0 },
      { x: 260, y: 380, radius: 16, dead: false, hitFlash: 0 },
    ];
  }

  // Start (or restart) a fresh playthrough.
  startGame() {
    this.score = 0;
    this.wave = 1;
    this.player.reset(this.width / 2, this.height / 2);
    this.familiar.reset(this.width / 2 - 22, this.height / 2 - 22);
    this.spawnDummies(); // TEMP Phase 2
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

        // Cat follows the witch and fires at the nearest dummy in range.
        // (Phase 3: pass real enemies here instead of this.dummies.)
        this.familiar.update(dt, this.player, this.dummies);

        // Tick down each dummy's hit-flash timer. (TEMP Phase 2)
        for (const d of this.dummies) {
          if (d.hitFlash > 0) d.hitFlash -= dt;
        }

        // --- TEMPORARY PHASE 1 DEBUG ---
        // No enemies deal damage yet, so press K to simulate death and test
        // the Game Over flow. REMOVE once Phase 3 adds real damage.
        if (Input.wasPressed("KeyK")) {
          this.player.health = 0;
        }

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
        this.drawDummies(ctx);     // TEMP Phase 2 (draw under characters)
        this.familiar.draw(ctx);   // bolts + cat
        this.player.draw(ctx);
        drawHUD(ctx, this.width, this.height, this.hudState());
        break;

      case STATE.GAME_OVER:
        this.drawArena(ctx);
        this.drawDummies(ctx);
        this.familiar.draw(ctx);
        this.player.draw(ctx);
        drawGameOver(ctx, this.width, this.height, this.hudState());
        break;
    }
  }

  // --- TEMPORARY PHASE 2: draw the practice dummies. Delete in Phase 3. --
  drawDummies(ctx) {
    for (const d of this.dummies) {
      if (d.dead) continue;
      ctx.save();

      // Flash brighter briefly when a bolt connects.
      const hit = d.hitFlash > 0;
      ctx.fillStyle = hit ? "#ffd27a" : "#6b6480";
      ctx.beginPath();
      ctx.arc(d.x, d.y, d.radius, 0, Math.PI * 2);
      ctx.fill();

      // Thin ring so it clearly reads as a "target dummy".
      ctx.strokeStyle = "rgba(244,213,141,0.6)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(d.x, d.y, d.radius + 4, 0, Math.PI * 2);
      ctx.stroke();

      ctx.restore();
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
