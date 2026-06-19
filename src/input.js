/* =========================================================================
   input.js — keyboard input.

   Unity analogy:
     - Input.isDown("KeyW")   ≈ Input.GetKey(...)        (held down this frame)
     - Input.wasPressed("Enter") ≈ Input.GetKeyDown(...) (pressed THIS frame only)

   We use event.code (e.g. "KeyW", "ArrowUp", "Enter", "Space", "KeyR"),
   which is keyboard-layout independent.
   ========================================================================= */

const heldKeys = new Set();      // keys currently held down
const pressedThisFrame = new Set(); // keys that went down since last endFrame()

window.addEventListener("keydown", (e) => {
  // Only count it as a fresh "press" on the first down event, not on auto-repeat.
  if (!heldKeys.has(e.code)) {
    pressedThisFrame.add(e.code);
  }
  heldKeys.add(e.code);

  // Stop arrow keys / space from scrolling the page while playing.
  if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space", "Backspace"].includes(e.code)) {
    e.preventDefault();
  }
});

window.addEventListener("keyup", (e) => {
  heldKeys.delete(e.code);
});

// If the window loses focus, drop all held keys so the player doesn't "stick".
window.addEventListener("blur", () => {
  heldKeys.clear();
  pressedThisFrame.clear();
  mouseHeld = false;
});

/* -------------------------------------------------------------------------
   Mouse — ADDITIVE. Keyboard stays the primary input everywhere; the mouse
   only ever drives the same menu selection/confirm the keys already do.

   We track the pointer in the canvas's INTERNAL 960x540 space and a one-shot
   left-click (cleared each frame, like wasPressed). The canvas is CSS-scaled,
   so client pixels are mapped through its live bounding rect — this keeps
   hit-testing correct at any display size (small-screen scaling, fullscreen).
   ------------------------------------------------------------------------- */
const mouseCanvas = document.getElementById("game-canvas");
let mouseX = 0;
let mouseY = 0;
let movedThisFrame = false;   // pointer moved since the last endFrame()
let clickedThisFrame = false; // left button went down since the last endFrame()
let mouseHeld = false;        // left button currently down (persists until mouseup)
let wheelAccum = 0;           // wheel delta accumulated since the last endFrame()

function toCanvasCoords(clientX, clientY) {
  if (!mouseCanvas) return { x: 0, y: 0 };
  const rect = mouseCanvas.getBoundingClientRect();
  // Guard a zero-size rect (e.g. display:none) so we never divide by zero.
  const sx = rect.width ? mouseCanvas.width / rect.width : 1;
  const sy = rect.height ? mouseCanvas.height / rect.height : 1;
  return { x: (clientX - rect.left) * sx, y: (clientY - rect.top) * sy };
}

if (mouseCanvas) {
  mouseCanvas.addEventListener("mousemove", (e) => {
    const p = toCanvasCoords(e.clientX, e.clientY);
    mouseX = p.x;
    mouseY = p.y;
    movedThisFrame = true;
  });
  mouseCanvas.addEventListener("mousedown", (e) => {
    if (e.button !== 0) return; // left button only
    const p = toCanvasCoords(e.clientX, e.clientY);
    mouseX = p.x;
    mouseY = p.y;
    clickedThisFrame = true;
    mouseHeld = true;
  });
  // Wheel — accumulated per frame for the scrollable list panels. preventDefault
  // (needs passive:false) so the page itself doesn't scroll under the cursor.
  mouseCanvas.addEventListener("wheel", (e) => {
    wheelAccum += e.deltaY;
    e.preventDefault();
  }, { passive: false });
}

// Release is tracked on the window so a drag (slider / scrollbar) still ends even
// if the button comes up off the canvas.
window.addEventListener("mouseup", (e) => {
  if (e.button === 0) mouseHeld = false;
});

export const Input = {
  // Is this key being held right now?
  isDown(code) {
    return heldKeys.has(code);
  },

  // Was this key pressed during THIS frame? (good for menus / one-shot actions)
  wasPressed(code) {
    return pressedThisFrame.has(code);
  },

  // Pointer position in the canvas's internal 960x540 space.
  mouseX() { return mouseX; },
  mouseY() { return mouseY; },
  // True only on the frame the pointer moved — lets hover follow the cursor
  // WITHOUT overriding keyboard navigation when the mouse is sitting still.
  mouseMoved() { return movedThisFrame; },
  // True only on the frame a left-click went down (cleared in endFrame()).
  mouseClicked() { return clickedThisFrame; },
  // Is the left button currently held? (persists across frames — for drags)
  mouseHeld() { return mouseHeld; },
  // Wheel delta accumulated this frame (+down / -up); 0 if none. For scroll panels.
  wheelDelta() { return wheelAccum; },

  // Returns a movement direction {x, y} from WASD + Arrow Keys.
  // Diagonals are normalized so you don't move faster diagonally.
  getMoveAxis() {
    let x = 0;
    let y = 0;
    if (this.isDown("KeyA") || this.isDown("ArrowLeft"))  x -= 1;
    if (this.isDown("KeyD") || this.isDown("ArrowRight")) x += 1;
    if (this.isDown("KeyW") || this.isDown("ArrowUp"))    y -= 1;
    if (this.isDown("KeyS") || this.isDown("ArrowDown"))  y += 1;

    if (x !== 0 && y !== 0) {
      const inv = 1 / Math.sqrt(2);
      x *= inv;
      y *= inv;
    }
    return { x, y };
  },

  // Called once at the very end of each frame to clear one-shot presses.
  endFrame() {
    pressedThisFrame.clear();
    movedThisFrame = false;
    clickedThisFrame = false;
    wheelAccum = 0;
  },
};
