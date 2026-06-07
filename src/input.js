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
  },
};
