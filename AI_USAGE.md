# AI Usage

This is an AI-focused jam, so this file tracks how AI tools were used.

## AI tools used
- **Claude** — code generation, project structure, debugging, planning.
- _(Add others as used: ChatGPT, art tools, audio tools, etc.)_

## What Claude helped code
- Phase 1 skeleton: project folder structure, `index.html`, `style.css`,
  game loop (`main.js`), state machine (`game.js`), input (`input.js`),
  player placeholder + movement (`player.js`), UI screens/HUD (`ui.js`),
  shared helpers (`utils.js`).

## What ChatGPT helped plan / review
- _(Fill in if used.)_

## AI art / audio tools used
- _(Fill in if used — tool name, what it generated, any prompts worth noting.)_

## Decisions made by me (Daniel)
- Engine choice: plain HTML/CSS/JS + Canvas (not Unity) for easy itch.io upload.
- Core fantasy: witch survives; the cat familiar is the real attacker.
- MVP scope: 10 waves, single starter upgrade (Sharper Claws).
- _(Add more design decisions as the project grows.)_

## Major AI-assisted features
- _Phase 2 cat familiar — follow behavior and automatic bolt attacks (Claude)_
---

### Log

| Date | Phase | What was done | AI tool |
| --- | --- | --- | --- |
| 2026-06-06  | Phase 1 | Project setup + playable skeleton | Claude |
| 2026-06-06 | Phase 2 | Cat familiar: follows witch + auto-fires bolts | Claude |
| 2026-06-06 | Phase 3 | Cursed Wisp enemies, spawner, player damage/i-frames, bolt kills | Claude |
| 2026-06-06 | Phase 4 | Currency mote drops, collection, XP bar + level-up trigger | Claude |
| 2026-06-06 | Phase 5 | Level-up pause + upgrade screen, Sharper Claws upgrade | Claude |
| 2026-06-06 | Phase 6 | Wave system, difficulty scaling, victory at wave 10 (MVP complete) | Claude |
| 2026-06-06 | Phase 7 | Witch sprite integration: 8-dir walk + idle, asset loader with fallback | Claude |
| 2026-06-06 | Phase 7 | Player sprite system: 4-dir walk/idle animation + asset loader with fallback | Claude |
| 2026-06-06 | Phase 7 | Player death animation + dying state (one-shot anim before Game Over) | Claude |
| 2026-06-06 | Phase 7 | Cat familiar sprites: looping idle + one-shot attack animation | Claude |
| 2026-06-06 | Phase 7 | Currency mote sprite (looping idle animation) | Claude |
| 2026-06-07 | Gameplay | Health flask drops: chance-based heal pickup (tunable) | Claude |
| 2026-06-07 | Gameplay | Three upgrade choices (Sharper Spirit Claws, Restless Wisp, Spirit Heart) | Claude |
| 2026-06-07 | Gameplay | Familiar Frenzy meter (Space burst, faster attacks + glow) + drop scatter | Claude |
| 2026-06-07 | Gameplay | Larger world + follow camera (Vampire-Survivors style); fixes off-screen drops | Claude |
| 2026-06-07 | Menu/Flow | Main menu + mode select + Coming Soon placeholders (keyboard nav) | Claude |