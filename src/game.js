/* =========================================================================
   game.js — the heart of Phase 1: a simple STATE MACHINE.

   States (only the Phase 1 ones are wired up):
        title  --ENTER-->  playing
        playing  --(debug K)-->  gameOver
        gameOver  --R-->  playing (fresh game)

   Future states (levelUp, victory) will slot into the same switch later.

   Unity analogy: this class is like a GameManager. update() is your Update(),
   render() is roughly your render pass. We pass in dt so movement is smooth
   regardless of frame rate.
   ========================================================================= */

import { Input } from "./input.js";
import { Player } from "./player.js";
import { drawTitle, drawHUD, drawGameOver } from "./ui.js";

// Use plain string constants for states — easy to read in the switch below.
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

    // Player starts in the center of the arena.
    this.player = new Player(width / 2, height / 2);

    this.score = 0;
    this.wave = 1; // placeholder; real wave logic is Phase 6
  }

  // Start (or restart) a fresh playthrough.
  startGame() {
    this.score = 0;
    this.wave = 1;
    this.player.reset(this.width / 2, this.height / 2);
    this.state = STATE.PLAYING;
  }

  // --- UPDATE: runs every frame. dt = seconds since last frame. ----------
  update(dt) {
    switch (this.state) {
      case STATE.TITLE:
        if (Input.wasPressed("Enter") || Input.wasPressed("NumpadEnter")) {
          this.startGame();
        }
        break;

      case STATE.PLAYING:
        this.player.update(dt, Input, this.bounds);

        // --- TEMPORARY PHASE 1 DEBUG ---
        // There are no enemies yet, so press K to simulate death and test
        // the Game Over flow. REMOVE this line once Phase 3 adds real damage.
        if (Input.wasPressed("KeyK")) {
          this.player.health = 0;
        }

        // Death check (will be driven by enemy damage in Phase 3).
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

  // --- RENDER: draw the current state. -----------------------------------
  render(ctx) {
    // Clear the whole canvas each frame.
    ctx.clearRect(0, 0, this.width, this.height);

    switch (this.state) {
      case STATE.TITLE:
        drawTitle(ctx, this.width, this.height);
        break;

      case STATE.PLAYING:
        this.drawArena(ctx);
        this.player.draw(ctx);
        drawHUD(ctx, this.width, this.height, this.hudState());
        break;

      case STATE.GAME_OVER:
        // Draw the frozen arena underneath, then the overlay on top.
        this.drawArena(ctx);
        this.player.draw(ctx);
        drawGameOver(ctx, this.width, this.height, this.hudState());
        break;
    }
  }

  // A simple top-down arena floor with a subtle grid so movement is readable.
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

  // Small bundle of values the HUD/screens need to display.
  hudState() {
    return {
      health: this.player.health,
      maxHealth: this.player.maxHealth,
      score: this.score,
      wave: this.wave,
    };
  }
}
