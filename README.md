# Familiar Frenzy

A top-down survival arena game for **AI Browser Game Jam 3**.

A young witch tries to survive waves of cursed creatures. Her black cat
familiar is the true source of attack — the player dodges, collects magic
currency, levels up, and improves the familiar.

Built with **plain HTML, CSS, JavaScript, and HTML5 Canvas**. No frameworks,
no build tools, no npm.

---

## Run it locally

ES modules require the page to be **served over http** (double-clicking
`index.html` will show a blank screen due to browser security rules).

From inside the `familiar-frenzy/` folder, run **one** of these:

```bash
# Python 3 (most common)
python -m http.server 8000

# or Node, if you have it
npx serve .
```

Then open: **http://localhost:8000**

---

## Controls

| Action | Key |
| --- | --- |
| Move | WASD / Arrow Keys |
| Start | Enter |
| Restart (after Game Over) | R |
| *(Phase 1 debug)* simulate death | K |

> The **K** key is a temporary testing shortcut for Phase 1 and will be
> removed once enemies deal real damage in Phase 3.

---

## Current status

- **Phase 1 — Skeleton** ✅ canvas, game loop, input, title / playing /
  game-over states, placeholder player movement, health value, score display.

Upcoming: familiar (Phase 2), enemies + damage (Phase 3), drops + XP
(Phase 4), upgrade screen (Phase 5), waves + victory (Phase 6), polish
(Phase 7).

---

## Build / upload to itch.io

This game ships as static files. To publish:

1. Zip the **contents** of `familiar-frenzy/` (so `index.html` is at the
   top level of the zip — not inside a nested folder).
2. On itch.io, create the project, set **Kind of project: HTML**.
3. Upload the zip and tick **"This file will be played in the browser"**.
4. Set the viewport to **960 x 540** (matches the canvas).

---

## Project structure

```txt
familiar-frenzy/
  index.html        # loads style.css + src/main.js
  style.css         # frames/centers the canvas (theme lives here)
  src/
    main.js         # entry point + game loop (delta time)
    game.js         # state machine (title / playing / gameOver)
    input.js        # keyboard input
    player.js       # the witch (placeholder shape)
    ui.js           # title screen, HUD, game-over screen
    utils.js        # shared math helpers
    familiar.js     # Phase 2 (stub)
    enemies.js      # Phase 3 (stub)
    pickups.js      # Phase 4 (stub)
    upgrades.js     # Phase 5 (stub)
    assets.js       # Phase 7 (stub)
    audio.js        # Phase 7 (stub)
  assets/           # sprites / backgrounds / sfx / music (empty for now)
  README.md
  CREDITS.md
  AI_USAGE.md
  .gitignore
```
