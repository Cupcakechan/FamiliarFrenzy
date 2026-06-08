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
| 2026-06-07 | Gameplay | Wave 10 Elder Wisp boss: wobble-follow, telegraphed dash, periodic summons, boss HP bar, victory on defeat | Claude |
| 2026-06-07 | Gameplay | Upgrade levels & caps: per-upgrade maxLevel, Lv. x/y card indicators, maxed upgrades drop from pool, Spirit Recovery fallback when all maxed | Claude |
| 2026-06-07 | Menu/UI | How to Play screen: new main-menu entry + howToPlay state, single-screen controls & mechanics instructions | Claude |
| 2026-06-07 | Gameplay/UI | Tutorial Complete victory screen with run summary + 3 navigable options; Wave 10 boss-incoming warning banner; added enemies/upgrades/time run counters | Claude |
| 2026-06-07 | Gameplay | Endless Mode v1: tutorial/endless gameMode, boss every 10 waves, per-tier difficulty scaling, Tutorial->Endless continue at Wave 11 with build carryover, endless Game Over + localStorage best wave/score | Claude |
| 2026-06-07 | Gameplay | Expanded upgrade pool (Magnet Charm, Ghost Pounce/pierce, Frenzy Focus, Lucky Paws) with tags; bolt piercing system; first familiar evolution Phantom Pounce (auto-unlock, one-shot, banner) | Claude |
| 2026-06-07 | UI/Systems | Pause menu (Esc/P) with frozen gameplay, run-info panel (mode/wave/level/score/health/frenzy/upgrades/evolution), Settings-from-pause with return target, Main Menu confirm | Claude |
| 2026-06-07 | Art/Sprites | Player witch expanded to 8-direction facing (added NE/NW/SE/SW) reusing idle/walk/die frame counts; auto-registers 24 strips with placeholder fallback | Claude |
| 2026-06-07 | Art/Tiles | Tiled arena floor + stone wall border from 32px 4x4 dungeon tileset (culled drawImage, 2x2 floor variation, integer-camera anti-seam); world height aligned to 1344 | Claude |
| 2026-06-07 | Gameplay | Wall-ring collision inset — player clamps to floor interior; drops and boss summons kept off the wall border | Claude |
| 2026-06-07 | Art/Tiles | Floor prop layer: normalized 131px prop sheet to clean 128 grid; seeded per-tile prop pass over the arena floor (22% variants + rare rune-circle seals), interior-only, no flicker | Claude |
| 2026-06-07 | Art/FX | EXP mote glow polish: pulsing gold radial-gradient halo + gentle breathing scale (cheap, swarm-safe, sprite path only) | Claude |
| 2026-06-07 | Docs | README rewritten to current build (full feature list, Live Server run steps, accurate controls + game-flow, updated file tree) | Claude |