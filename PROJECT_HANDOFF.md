# Familiar Frenzy — Project Handoff

Last updated: **2026-06-12** — rewritten from the verified current repo state.
Covers all post-launch work through the unshipped **1.2.0** bundle.

---

## 1. Purpose of This Document

Living source of truth for continuing **Familiar Frenzy**, Daniel's browser-based
top-down survival arena game, originally built for **AI Browser Game Jam 3** and
now in post-launch update development (~1 week of update runway as of this write).
Read fully before suggesting or changing anything. Update it at the end of any
session that completes work.

---

## 2. Ground Rules for Working With Daniel

* Tech stack: **plain HTML / CSS / JS + HTML5 Canvas, ES modules. No frameworks,
  no npm, no TypeScript, no build tools.** Runs locally via VS Code **Live
  Server**. **Python is NOT available** — never suggest Python commands.
* Repo access in the Claude project context is **review-only** and may reflect the
  last push, not the working copy. The `assets/` folder may be excluded from sync.
  **When exact file contents matter, ask Daniel to upload the current files** first.
* Deliver **entire updated files** via the file tool (no diffs/snippets as the main
  delivery), built from Daniel's current uploaded versions.
* Every changed JS file must pass `node --check`. Confirm in the delivery.
* **Never clobber Daniel's local tuning.** Known tuned values to preserve:
  * `enemies.js`: Elder Wisp boss `spriteScale = 2.0`; `DEBUG_FORCE_BOSS = false`
  * `audio.js`: `POOL_COUNT = 9` (NEVER lower — §8); `DEFAULT_SFX_VOLUME = 50`
  * `familiar.js`: `RUNE_COUNT 14`, `RUNE_SCALE 0.5`, `spriteScale 0.55`
  * `ui.js`: `TITLE_OFFSET_X` (optical centering of the title banner)
* Daniel often applies small one-line tweaks himself between turns (text, single
  constants, banner gate). **Sync those into the working copy before building on a
  file**, and ask if unsure whether he's edited it since the last delivery.
* Options/plan before non-trivial coding; wait for the go-ahead. Single-value
  tweaks are often best handed back as "change line N to X."
* After completed work provide, in order: files changed; what changed; test steps;
  known risks; `node --check` confirmation; a ready-to-paste **DEVLOG.md** entry
  (player-facing, see §11); a ready-to-paste **AI_USAGE.md** row; the git
  checkpoint block (NO `cd` lines). **Daniel tests first and decides when to
  commit — never commit for him.**

```bash
git add .
git commit -m "Describe completed tested feature"
git push
```

---

## 3. Game Summary & Current Feature Set

Player controls a young witch (move/dodge/collect only); her ghost cat
**familiar** auto-attacks. EXP motes → level-ups → upgrades; boss every 10 waves.
Tutorial mode ends after Wave 10 (Victory, can carry into Endless); Endless runs
until death with per-tier scaling and a top-10 leaderboard.

Implemented and tested:

* **Menus/screens:** Main Menu (background + title-banner art), Mode Select
  (background art, text title), How to Play, Grimoire, Settings (music + SFX
  sliders), High Scores (with arcade initials), Pause, Confirm-Quit, Victory,
  Game Over.
* **World/combat:** 2400x1344 world, player-following camera, tiled dungeon arena
  + wall collision; wave system; Elder Wisp boss (sprite-driven dash + staggered
  summons, HP bar y=84); boss kill grants a free upgrade.
* **Player:** 8-dir idle/walk/die sprites, i-frames, death animation.
* **Familiar:** 8-dir idle/attack sprites, ghost imprints, rune projectile pool,
  pierce, projectile SFX.
* **Enemies (data-driven `ENEMY_TYPES`):**
  * **Wisp** — melee chaser, 8-dir float/attack sprites.
  * **Gutter Gecko** (NEW) — ranged skirmisher; holds ~280px, strafes, retreats,
    flings dodgeable projectiles. Three-anim model (idle/walk/attack one-shot),
    8 directions; **art still placeholder (teal blob + teal ball)** — 24 strips
    pending. Intro wave 5, 25% spawn chance, max 3 alive.
* **Pickups:** EXP motes (glow), health flasks (heal 15), rare Spirit Magnet
  (vacuum). Innate 40px magnet range for everyone.
* **Upgrades (data-driven):** capped pool + 32x32 icons + Grimoire; Spirit
  Recovery fallback. **Two evolutions:** Phantom Pounce (Claws 5 + Ghost Pounce 3)
  and **Spirit Bond** (NEW — Spirit Heart 3 + Spirit Focus 3).
* **Spirit Imbued** mode (internals still `frenzy*`) with the Spirit Link ribbon;
  **ready cues:** pulsing gold spark over the witch + breathing gold bar fill +
  the flashing prompt under the HUD cluster.
* **HUD:** top-edge XP strip; HP + Spirit bars (263x24 frames) stacked top-left;
  Score + Lv top-right; familiar tutorial dialogue bar (bottom-center).
* **Audio:** dual-deck music (§8) + data-driven SFX registry (§8).
* Asset-fallback safety everywhere: missing art/sound → placeholder/silence,
  never a crash.

---

## 4. Architecture / File Map

```txt
familiar-frenzy/
  index.html   style.css
  package_itch.bat            # packaging + butler auto-publish (§10) — not shipped
  ITCH_RELEASE_CHECKLIST.md   # release steps (§10) — not shipped in the zip
  DEVLOG.md                   # player-facing release notes (§11) — not shipped
  src/
    main.js      # entry, canvas, dt loop, font preload, initAudio
    game.js      # state machine, world/camera, drops/collection, high scores,
                 #   tutorial script + hints, Spirit Bond damage, SFX triggers,
                 #   music-context sync, screen wiring
    input.js     # keyboard (held + one-frame presses)
    player.js    # witch
    familiar.js  # ghost cat + bolts + Spirit Link
    enemies.js   # ENEMY_TYPES table, Enemy (wisp + gecko), EnemyBolt, Boss,
                 #   WaveManager; DEBUG_FORCE_BOSS + gecko composition consts here
    pickups.js   # motes, flasks, Spirit Magnet
    upgrades.js  # UPGRADES + EVOLUTIONS (Phantom Pounce, Spirit Bond) + Grimoire
    ui.js        # all screens/HUD; drawSkinnedBar, drawFamiliarHint, wrapText,
                 #   drawNameEntry, two-row Settings, title-card tunables
    assets.js    # loadImage/getImage with graceful fallback
    utils.js     # math helpers; dirFromVector; pointSegmentDistance (Spirit Bond)
    audio.js     # dual-deck music + SFX registry (§8)
  assets/
    fonts/ tiles/ music/ sfx/
    backgrounds/background_main.png   # 960x540, menu + mode-select backdrop
    sprites/
      player/ familiar/ pickups/ projectiles/ upgrades/
      enemies/   # wisp_*, elder_wisp_*, gecko_* (gecko art PENDING)
      ui/
        menu_button.png (175x37)  upgrade_card.png (240x180)
        health_bar.png (263x24)   spirit_bar.png (263x24)
        title_main.png            # title banner, drawn 1:1 centered at y=100
        (xp_bar.png deleted — XP is now a code-drawn top strip)
  README.md  CREDITS.md  AI_USAGE.md  PROJECT_HANDOFF.md  .gitignore
  builds/      # packaging output (gitignored)
```

HUD bar template: gold pixel border + transparent well inset 3px (x) / 4px (y);
code draws dark backing -> fill -> frame on top; helper reads native size.
Menu art: `drawMenu(..., art = { bg, title })`; title scaled by integer
`TITLE_SCALE`, nudged by `TITLE_OFFSET_X`.

---

## 5. Sprite Conventions

Frame width always computed at runtime (`img.width / frameCount`); diagonals use
vertical-first names (`ne`, `sw`).

* **Player:** 8 dirs — idle 4 / walk 6 / die 8. `witch_<anim>_<dir>.png`.
* **Familiar:** 8 dirs — idle 4 (loops, doubles as float) / attack 6 (one-shot).
  `familiar_<anim>_<dir>.png`, `spriteScale 0.55`.
* **Wisp:** 8 dirs — float 4 / attack 4 (both loop). `wisp_<anim>_<dir>.png`.
* **Elder Wisp boss:** 8 dirs — float 4 / charge 2 (state-driven). `spriteScale 2`.
* **Gutter Gecko (PENDING ART):** 8 dirs, single-row 4-frame strips —
  `gecko_idle_<dir>.png` (loops), `gecko_walk_<dir>.png` (loops),
  `gecko_attack_<dir>.png` (ONE-SHOT, throw on frame 2-3).
  24 files in `assets/sprites/enemies/`. Per-type `spriteScale` in `ENEMY_TYPES`
  (currently 0.8); the attack-pose window is derived as frames/fps (0.4s).
* **Upgrade icons:** `assets/sprites/upgrades/<id>.png` (32x32) — incl. pending
  `phantom_pounce.png`, `spirit_bond.png`.

Pixel-art rules: INTEGER scales only; author on a true uniform grid (watch
PixelLab wobble); trim margins consistently; match new creatures' frame size to
the wisp strips for shared scale.

---

## 6. Post-Launch Work Log (newest first)

```txt
1.2.0 BUNDLE (UNSHIPPED — all committed locally, held for one combined release):
  - Gutter Gecko ranged enemy (data-driven ENEMY_TYPES, EnemyBolt owned by
    game.js, wave-5 intro, three-anim model wired for pending art)
  - Ambient chitter changed from per-frame coin-flip to a 6-14s scheduler
  - SFX registry (playSfx) + 5 sounds (level_up, heal, magnet, wisp, hint) +
    master SFX volume with persisted Settings slider (two-row Settings)
  - Spirit Imbued visibility: gold spark over the witch + breathing gold bar
  - Spirit Bond evolution (Spirit Heart 3 + Spirit Focus 3; link cuts crossers
    during Spirit Imbued) + pointSegmentDistance util
  - Balance audit: FRENZY_MOTES 25->30, innate 40px magnet, xpToNext +3->+4
  - wrapText helper: two-line full-size upgrade-card descriptions;
    Spirit Bond description shortened
  - DEFAULT_SFX_VOLUME set to 50

1.1.0 (SHIPPED): familiar tutorial hints + scripted intro (waves held until
  first move, 5s shadowed free-walk spotlight, wave-1 motes-only, wave-2
  guaranteed flask), title-banner re-export, minor polish.

1.0.0 (SHIPPED): jam submission.
```

---

## 7. Upgrade System

Data-driven in `upgrades.js`. Upgrades: Sharper Spirit Claws (5), Restless Wisp
(5), Spirit Heart (3), Magnet Charm (4), Ghost Pounce (3), Spirit Focus (3, id
`frenzy_focus`), Lucky Paws (3, rare-drop-only). Evolutions:
* **Phantom Pounce** — requires Claws 5 + Ghost Pounce 3; +2 pierce, +2 damage.
* **Spirit Bond** — requires Spirit Heart 3 + Spirit Focus 3; during Spirit
  Imbued the witch<->familiar link damages enemies crossing it (half the
  familiar's damage, min 1, per 0.5s per enemy; gold/thicker link visual).
Spirit Recovery is the all-maxed fallback (not in Grimoire). New upgrade -> add to
`UPGRADES` with `maxedStat` (+ `evolutionNotes` if it feeds an evolution); offers,
Grimoire, and icon pick it up automatically. Do not rename internal `frenzy*` ids.

Balance notes (post-audit): offensive chain (Claws/Restless/Pounce/Phantom) is
well-tuned and unchanged. Spirit Focus is intentionally strong (it now also gates
Spirit Bond); FRENZY_MOTES was nudged 25->30 rather than nerfing Focus.

---

## 8. Audio System (read before touching)

**Music** — `audio.js` uses **two persistent decks + a generation counter**.
Transitions swap the active deck; `pause()` never interrupts a pending `play()`
(waits for the promise, skips if reactivated); only `NotAllowedError` arms
retry-on-gesture (AbortError/load hiccups are logged and ignored — **do not
"fix" by treating them as autoplay blocks; that was the original silence bug**).
Invariants: `POOL_COUNT = 9`; shared normal pool for menus+gameplay; boss track
interrupts and returns; 240s loop-then-rotate; volume persisted (`ff_musicVolume`).

**SFX** — data-driven `SFX_DEFS` registry; `playSfx(name)` with per-sound voice
pools + throttle, scaled by a master SFX volume (0-100, default 50, persisted
`ff_sfxVolume`). Sounds: projectile (.wav), level_up/heal/magnet/wisp/hint (.mp3,
art-supplied; missing = silent). `playFamiliarProjectileSfx()` kept as a wrapper
so familiar.js needs no changes. Triggers (all in game.js): level-up screen open,
flask grab, magnet vacuum, hint appear (per sentence), ambient wisp/gecko/boss
chitter (scheduled, §3).

---

## 9. State Machine

```txt
MAIN_MENU, MODE_SELECT, HOW_TO_PLAY, GRIMOIRE,
ENDLESS_PLACEHOLDER, HIGHSCORES_PLACEHOLDER, SETTINGS_PLACEHOLDER,
PLAYING, PAUSED, CONFIRM_QUIT, LEVEL_UP, DYING, NAME_ENTRY, GAME_OVER, VICTORY
```

Flow: `DYING -> (endless + qualifies top-10) -> NAME_ENTRY -> GAME_OVER`, else
straight to `GAME_OVER`. High scores: `{name, score, wave, date}` in
`ff_highscores` (top 10, score-desc/wave-desc); bests in
`ff_bestEndlessWave/Score`. Quitting Endless via Pause records nothing
(intentional).

Legacy names (cleanup candidates): `HIGHSCORES_PLACEHOLDER` /
`SETTINGS_PLACEHOLDER` are functional screens with misleading names;
`ENDLESS_PLACEHOLDER` is dead (never entered; `drawPlaceholder()` is its only
consumer) — both safe to remove together.

---

## 10. Release / Publishing Workflow

* **Debug flag: `DEBUG_FORCE_BOSS = false` — verified in enemies.js 2026-06-12.**
  Re-verify from code before every package; never trust this doc alone.
* **Package + publish (one step):** `package_itch.bat` (root). Validates, stages
  runtime files to `builds\package\`, zips with `index.html` at the ZIP root
  (self-verified), then **auto-publishes via butler** to
  `mrcanela/familiar-frenzy:html` (slug is a variable at the top of the script).
  Optional version: `package_itch.bat 1.2.0`. Backup zip:
  `builds\familiar-frenzy-itch.zip`. Degrades to zip-only if butler is missing.
* ZIP includes index.html, style.css, src/, assets/, README.md, CREDITS.md,
  AI_USAGE.md. Excludes .git, dev docs, the bat, builds/.
* Checklist: `ITCH_RELEASE_CHECKLIST.md`. One-time itch setup after first push:
  Kind=HTML, tick the `html` channel "played in browser", viewport 960x540.
* itch is case-sensitive — asset filenames on disk must exactly match code paths.

---

## 11. DEVLOG.md (player-facing)

Maintain `DEVLOG.md` (newest first); every significant pass gets a ready-to-paste
entry that doubles as an itch devlog post. **The 1.2.0 entry is written and
pending** (Geckos, Sounds & Spirit — see DEVLOG.md), held until Daniel ships the
bundle.

---

## 12. Current Backlog / Next Steps

```txt
HIGH (blocks the 1.2.0 ship being "complete"):
  - Gutter Gecko art: 24 strips (idle/walk/attack x 8 dirs, 4f each). Code is
    wired and waiting; tune gecko spriteScale once art is in.

WHEN READY:
  - Ship 1.2.0: package_itch.bat 1.2.0 + post the pending DEVLOG entry.
  - Optional SFX art: spirit_ready chime (a one-row SFX_DEFS add) if Daniel
    wants the audio cue for Spirit Imbued ready in addition to the visuals.
  - Evolution icons: phantom_pounce.png, spirit_bond.png (32x32).
  - README.md refresh (status sections stale: audio "stub", High Scores
    "placeholder", enemy sprites "pending" — all now done/changed).
  - Legacy state cleanup + ENDLESS_PLACEHOLDER removal.

BALANCE WATCH (only if Daniel reports it):
  - Gecko composition (25% / max 3) — tune if wave 7+ feels like a shooting
    gallery. Spirit Bond tick (half dmg / 0.5s) — watch for trivializing crowds.
```

Guardrails: one feature at a time; no large new systems, online leaderboards,
external libraries, or build tooling; data-driven tables over subclasses for new
content (ENEMY_TYPES / UPGRADES patterns).

---

## 13. First Response Required from Next Claude

1. Confirm this handoff was read.
2. Briefly summarize current state (note the 1.2.0 bundle is built but unshipped).
3. Verify `DEBUG_FORCE_BOSS` from `enemies.js` (don't trust this doc) and report.
4. Note any stale-looking handoff items.
5. Offer a short option list and ask what Daniel wants to do.

Do not start coding immediately.
