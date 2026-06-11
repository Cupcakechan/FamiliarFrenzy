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
| 2026-06-08 | Art/FX | EXP mote glow polish: pulsing gold radial-gradient halo + gentle breathing scale (cheap, swarm-safe, sprite path only) | Claude |
| 2026-06-08 | Docs | README rewritten to current build (full feature list, Live Server run steps, accurate controls + game-flow, updated file tree) | Claude |
| 2026-06-08 | Art/Sprites | Familiar expanded to 8-direction facing (added NE/NW/SE/SW) with 8-way angle-based dirFromVector; idle frame count set to 4 (idle doubles as ghost drift) | Claude |
| 2026-06-08 | UI/Polish | Hide mouse cursor over the canvas (keyboard-only game; cursor was overlapping the player) | Claude |
| 2026-06-08 | Art/Sprites | Reduced familiar sprite scale (1 → 0.65) so the ghost cat reads as a companion rather than dwarfing the witch | Claude |
| 2026-06-08 | Menu/UI | Mode-select cleanup: removed "capped 10-wave run" and "Endless: coming soon" footer text, leaving only the controls hint | Claude |
| 2026-06-08 | Art/FX | Ghost trail for familiar: per-frame snapshot buffer (pos/facing/frame), faded afterimages drawn behind the cat via shared drawCat helper; visual-only, bounded, fallback-safe | Claude |
| 2026-06-08 | Art/FX | Ghost imprints for familiar: distance-spaced afterimages (drop per IMPRINT_GAP px travelled) that fade over a short lifetime; visual-only, bounded, fallback-safe | Claude |
| 2026-06-08 | Art/FX | Frenzy Spirit Link: visual-only wavy #F2A540 ribbon between witch and familiar during Frenzy, end-tapered animated wave, edge fade-in/out, brightens on cat attack; drawn below all actors | Claude |
| 2026-06-08 | Art/Sprites | Health flask sprite support via existing loadImage/getImage pattern (flask_idle.png), strip-capable (FLASK_FRAMES default 1), green-orb fallback preserved; collection unchanged | Claude |
| 2026-06-08 | UI/Fonts | Replaced Cinzel with self-hosted "Darkrunes Arcanum" TTF (@font-face in style.css, canvas text() default in ui.js, removed Google Fonts link, document.fonts.load nudge in main.js to avoid serif flash) | Claude |
| 2026-06-08 | UI/Fonts | Body font switched to Neatpixels Standard (Darkrunes kept for titles); added proportional auto-shrink (maxWidth) to the text() helper so titles always fit the canvas instead of clipping | Claude |
| 2026-06-08 | Art/FX | Familiar projectiles use a random rune sprite pool (rune_01..0N via existing loader); each bolt picks one rune at spawn and keeps it, orb fallback when missing/loading; hitbox/behaviour unchanged | Claude |
| 2026-06-09 | Audio | Background music system (audio.js): shared random pool for menu+gameplay, dedicated looped boss track for Wave 10 / Endless bosses, autoplay-safe gesture unlock, clean hard switches; functional Settings screen with music volume slider persisted to localStorage | Claude |
| 2026-06-09 | Audio | Crossfade between music tracks (audio.js): outgoing track fades down while incoming fades up over FADE_MS via rAF, replacing the hard switch; volume slider stays live mid-fade | Claude |
| 2026-06-09 | UI/Fix | Pause menu: removed game-title line that overlapped "PAUSED" in the title font; single clean PAUSED header | Claude |
| 2026-06-09 | Gameplay | Boss kill grants a free upgrade choice (queues a level-up on boss death) | Claude |
| 2026-06-09 | Fix | Boss-incoming banner now only shows before multiples of 10 (was firing every wave after wave 10) | Claude |
| 2026-06-09 | Gameplay/UI | Phantom Pounce evolution is now a choosable one-time upgrade: enters the level-up pool with a guaranteed slot once requirements are met (was auto-unlocked), shows an "EVOLUTION" card tag, applies only when picked | Claude |
| 2026-06-09 | Gameplay | Rare "Spirit Magnet" pickup: 0.8% normal / 20% boss drop, glowing #F2A540 placeholder (sprite-ready), collecting it vacuums all dropped motes + flasks to the player for ~1.5s via a shared applyVacuum helper reusing existing collection | Claude |
| 2026-06-09 | Audio / UX | Added familiar projectile SFX (audio.js voice pool + throttle, autoplay-gated; hooked to fire event in familiar.js) and renamed player-facing "Frenzy" to "Spirit Imbued" / "Spirit Focus" across ui.js, upgrades.js, README (internals unchanged) | Claude |
| 2026-06-09 | Art/Sprites | Animated Wisp enemy: 8-direction Float (loop) + Attack (visual, on player contact) sprite system on the Enemy class with per-direction blob fallback and hit-flash; promoted dirFromVector to utils.js (shared by familiar + enemies); boss + all gameplay unchanged | Claude |
| 2026-06-09 | UI/Polish | How to Play screen trimmed to Controls only (removed the How to Survive section) and re-centered the remaining block | Claude |
| 2026-06-09 | UI/Systems | Upgrade Grimoire: read-only glossary from Main Menu + Pause (accordion expand/collapse, shows current run levels from Pause); data-driven via getGrimoireEntries() reading maxDescription/evolutionNotes added to the existing upgrades; new GRIMOIRE state + return-target, menu entries re-indexed | Claude |
| 2026-06-09 | UI/Polish | Grimoire reworked into Upgrades/Evolutions two-level accordion (effect / maxed-out stat line / conditional evolution note; evolutions show effect only; Spirit Recovery removed from glossary, gameplay reward intact); Pause menu relaid out — stats top-aligned with Upgrades column, options moved to bottom-center | Claude |
| 2026-06-09 | UI/Polish | Grimoire: folded maxed value inline into the Effect line ("(MAXED +5)") and removed the separate Maxed Out row; renamed the screen + menu entries from "Upgrade Grimoire" to "Grimoire" | Claude |
| 2026-06-09 | Gameplay/UI | Phantom Pounce now requires Ghost Pounce maxed (Lv.2+ → Lv.3) so both prerequisite notes read consistently "Required for Phantom Pounce (must be maxed)" | Claude |
| 2026-06-09 | UI/Systems | Endless High Scores: top-10 localStorage leaderboard (ff_highscores, score-desc + wave tie-break) saved once per Endless death; real High Scores screen replacing the placeholder, with empty state + corrupt-data fail-safe; Tutorial runs excluded; best wave/score keys preserved. Level-up polish: smaller title (48->38) and cards (280x188->240x150) | Claude |
| 2026-06-10 | UI | Level-up card spacing fix: lifted upgrade description (y+118->y+114) and pushed the Press prompt down (y+ch-20->y+ch-14) so they no longer overlap | Claude |
| 2026-06-10 | Art Integration | Spirit Magnet sprite render path: draw spirit_magnet.png with the existing pulsing gold halo + hover preserved behind it, placeholder kept as fallback; no mechanics changed | Claude |
| 2026-06-10 | Gameplay | Lucky Paws reworked to a pure rare-drop upgrade: removed bonus-XP-mote roll, added LUCK_MAGNET_STEP so luck raises Spirit Magnet odds (flask scaling kept) | Claude |
| 2026-06-10 | Game Feel | Non-overlapping drop placement (findDropSpot): co-dropped pickups spread out instead of stacking | Claude |
| 2026-06-10 | UI | HP bar label readability: added optional outline to text() helper, HP label now cream + dark outline so it stays legible over the emptied bar track | Claude |
| 2026-06-10 | Art Integration | Elder Wisp boss sprite integration: 8-dir Float (4f loop) + state-driven Charge (frame 0 wind-up / frame 1 dash) wired into the existing boss phases, placeholder kept as per-direction fallback; dash telegraph line recolored to #D475ED (width 5->4) | Claude |
| 2026-06-10 | Audio | Normal music rotation: loop the selected normal track and only rotate to a new random track after NORMAL_TRACK_MIN_PLAY_SECONDS (240s) via a timer + existing crossfade; removed the on-ended per-minute reshuffle; boss music override + clean resume preserved | Claude |
| 2026-06-10 | UI | Removed always-on HUD wave label (kept wave-start pop-up + pause display) so the Elder Wisp boss bar name isn't crowded | Claude |
| 2026-06-10 | Game Feel | Boss sprite drawn on whole-pixel coordinates for crisp 116x116 art; added DEBUG_FORCE_BOSS flag for testing the boss without reaching wave 10 | Claude |
| 2026-06-10 | Game Feel | Boss dash telegraph changed to scrolling chevrons spanning the real reach; dash reach increased (speed 440->720, duration 0.35->0.40, ~154px -> ~288px) so distance is no longer a safe zone | Claude |
| 2026-06-10 | Game Feel | Boss tuning: slower dash charge with longer telegraph (speed 720->640, telegraph 0.6->0.85, duration ->0.45, reach kept ~288px); summons less frequent (cooldown 9->13 +jitter) and staggered one-at-a-time instead of a burst of 3 | Claude |
| 2026-06-10 | UI | Menu button container sprite wired into drawMenu (175x37, drawn 1:1) with selected-item gold glow; menu font reduced 28->20 with dark outline for contrast on the purple fill; code-drawn box kept as fallback | Claude |
| 2026-06-10 | UI | Main menu layout: vertically centered the button block by item count, increased row spacing (50->54), and pinned footer hints to the bottom center | Claude |
| 2026-06-10 | UI | Wired upgrade card container sprite (240x150, drawn 1:1) and health bar frame sprite (263x16) with colored fill drawn inside the well and HP label resized to fit; both keep code-drawn fallbacks | Claude |
| 2026-06-10 | UI | Wired upgrade card (240x150) and health bar frame (263x16) sprites with code-drawn fallbacks; fixed fillColor redeclaration that black-screened boot | Claude |