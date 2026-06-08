# Familiar Frenzy

A top-down survival arena game for **AI Browser Game Jam 3**.
Theme: **Familiar**.

A young witch tries to survive waves of cursed creatures. She never aims or
shoots — her ghost cat **familiar** is the true attacker, auto-firing at the
nearest enemy. The player focuses on movement, dodging, collecting EXP motes,
leveling up, choosing upgrades, and shaping the familiar into a stronger spirit
companion.

Built with **plain HTML, CSS, JavaScript, and HTML5 Canvas**. No frameworks,
no build tools, no npm.

---

## Run it locally

ES modules require the page to be **served over http** (double-clicking
`index.html` shows a blank screen due to browser security rules).

Recommended: open the project folder in **VS Code** and use the **Live Server**
extension ("Go Live" in the status bar). Any static HTTP server works too — the
only requirement is that the page loads over `http://`, not `file://`.

Then open the served URL (Live Server defaults to `http://127.0.0.1:5500`).

---

## Controls

| Action | Keys |
| --- | --- |
| Move | WASD / Arrow Keys |
| Confirm / Select | Enter / Space |
| Pick an upgrade | Enter (first card) or 1 / 2 / 3 |
| Familiar Frenzy | Space (when the Frenzy meter is full) |
| Pause / Resume | Esc / P |
| Back (in menus) | Esc / Backspace |
| Restart run | R (after Game Over or Victory) |

> The familiar attacks automatically — there is no fire button. Frenzy makes it
> fire much faster for a few seconds; save it for swarms or the boss.

---

## Game flow

```txt
Main Menu ─┬─ Play ── Mode Select ─┬─ Tutorial Run (10 waves → Wave 10 boss → Victory)
           │                       └─ Endless Mode (boss every 10 waves, scales up)
           ├─ How to Play
           ├─ High Scores   (placeholder)
           └─ Settings      (placeholder)

Victory ─┬─ Continue to Endless Frenzy (same run carries into Wave 11)
         ├─ Replay Tutorial
         └─ Main Menu
```

Pausing (Esc / P) freezes gameplay and shows a run-info panel (mode, wave,
level, score, health, frenzy, upgrades taken, evolution).

---

## Current status

The game is playable end-to-end in both modes.

**Implemented**

- Main menu, mode select, How to Play, and pause menu (with quit confirmation)
- Tutorial Run: escalating waves, intermission banners, Wave 10 **Elder Wisp**
  boss (wobble-follow, telegraphed dash, periodic summons, boss HP bar)
- Endless Mode: recurring bosses every 10 waves, per-tier difficulty scaling,
  Tutorial → Endless carryover at Wave 11, localStorage best wave/score
- Ghost cat familiar: follow + auto-fire bolts, bolt piercing, **Phantom Pounce**
  evolution (auto-unlock)
- EXP motes (with glow), health flasks, the **Familiar Frenzy** meter
- Level-up upgrade picker with per-upgrade caps (Lv. x/y) and a Spirit Recovery
  fallback when everything is maxed; expanded upgrade pool
- Tutorial Complete victory screen with run summary; mode-aware Game Over
- Large scrolling world with a player-following camera (Vampire-Survivors style)
- Tiled dungeon arena with seeded floor props and a wall-ring border the player
  collides against
- Graceful asset fallback: missing sprites draw placeholder shapes instead of
  crashing

**Pending / placeholder**

- Enemy and boss sprites (currently drawn shapes)
- Health-flask sprite (drawn shape)
- High Scores menu screen
- Settings menu screen
- Audio system (`src/audio.js` is an intentional empty stub)

---

## Build / upload to itch.io

This game ships as static files. To publish:

1. Zip the **contents** of the project folder (so `index.html` is at the top
   level of the zip — not inside a nested folder).
2. On itch.io, create the project and set **Kind of project: HTML**.
3. Upload the zip and tick **"This file will be played in the browser"**.
4. Set the viewport to roughly **960 x 540** (the canvas internal resolution;
   CSS scales how big it looks).

---

## Project structure

```txt
familiar-frenzy/
  index.html        # loads style.css + src/main.js
  style.css         # frames/centers the canvas (theme lives here)
  src/
    main.js         # entry point + game loop (delta time)
    game.js         # state machine, world/camera, arena rendering, run logic
    input.js        # keyboard input (held + one-shot presses)
    player.js       # the witch: 8-dir sprites, movement, i-frames, death anim
    familiar.js     # ghost cat: follow + auto-fire bolts, piercing, evolution
    enemies.js      # Cursed Wisp, Elder Wisp boss, WaveManager
    pickups.js      # EXP motes (glow) + health flasks
    upgrades.js     # data-driven upgrade pool + offer logic
    ui.js           # menus, HUD, upgrade / victory / pause / game-over screens
    assets.js       # image loader with graceful fallback
    utils.js        # shared math helpers
    audio.js        # placeholder (sfx / music — not wired yet)
  assets/
    sprites/        # player / familiar / enemies / pickups / ui
    tiles/          # Main_Dungeon.png, floor_props.png
    backgrounds/
    sfx/
    music/
  README.md
  CREDITS.md
  AI_USAGE.md
  .gitignore
```
