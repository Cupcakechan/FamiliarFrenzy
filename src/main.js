/* =========================================================================
   main.js — the entry point. This is the ONLY file index.html loads;
   it imports everything else.

   Its whole job:
     1. Grab the canvas + 2D drawing context.
     2. Turn OFF image smoothing (so pixel art stays crisp later).
     3. Create the Game.
     4. Run the game loop forever using requestAnimationFrame.

   The loop computes "dt" (delta time in seconds) so that movement speed is
   the same whether the player's monitor runs at 60Hz, 120Hz, etc.
   ========================================================================= */

import { Game } from "./game.js";
import { Input } from "./input.js";

const canvas = document.getElementById("game-canvas");
const ctx = canvas.getContext("2d");

// Crisp pixels (matters once we add sprites — no blurry scaling).
ctx.imageSmoothingEnabled = false;

// Internal resolution is fixed by the <canvas width/height> attributes.
const game = new Game(canvas.width, canvas.height);

let lastTime = performance.now();

function loop(now) {
  // Delta time in seconds. Clamp it so a long pause (e.g. switching tabs)
  // can't make objects teleport across the screen in one giant step.
  let dt = (now - lastTime) / 1000;
  if (dt > 0.05) dt = 0.05; // cap at ~20fps worth of time
  lastTime = now;

  game.update(dt);
  game.render(ctx);

  // Clear one-shot key presses AFTER the frame has used them.
  Input.endFrame();

  requestAnimationFrame(loop);
}

requestAnimationFrame(loop);
