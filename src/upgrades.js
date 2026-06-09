/* =========================================================================
   upgrades.js — the data-driven upgrade pool.

   Each upgrade: { id, name, description, tag, maxLevel, apply(game) }.
   - tag: "attack" | "speed" | "survival" | "frenzy" | "utility" | "evolution"
          (informational for now — future balancing / evolution logic).
   - apply(game): mutates the familiar/player/game. Level tracking lives on the
          Game (game.upgradeLevels = { id: n }), so these stay pure data and
          reset cleanly each run.

   getOffers() filters out maxed upgrades and picks a random DISTINCT subset,
   so the level-up screen always offers a varied choice. EVOLUTIONS are special:
   they only enter the pool once their requirements are met, get a guaranteed
   slot so the player always sees them, and vanish once chosen.
   ========================================================================= */

// Per-level tuning for the new upgrades (kept here next to their definitions).
const MAGNET_RANGE_STEP = 55; // +px attraction radius per Magnet Charm level

export const UPGRADES = [
  {
    id: "sharper_spirit_claws",
    name: "Sharper Spirit Claws",
    description: "Familiar damage +1",
    tag: "attack",
    maxLevel: 5,
    apply(game) {
      game.familiar.damage += 1;
    },
  },
  {
    id: "restless_wisp",
    name: "Restless Wisp",
    description: "Attack cooldown -15%",
    tag: "speed",
    maxLevel: 5,
    apply(game) {
      // Multiply down, but never below a floor so it can't reach zero.
      game.familiar.attackCooldown = Math.max(0.4, game.familiar.attackCooldown * 0.85);
    },
  },
  {
    id: "spirit_heart",
    name: "Spirit Heart",
    description: "Max health +20",
    tag: "survival",
    maxLevel: 3,
    apply(game) {
      game.player.maxHealth += 20;
      game.player.heal(20); // also heal so it feels immediate
    },
  },
  {
    id: "magnet_charm",
    name: "Magnet Charm",
    description: "Pulls pickups from farther",
    tag: "utility",
    maxLevel: 4,
    apply(game) {
      game.magnetRange += MAGNET_RANGE_STEP;
    },
  },
  {
    id: "ghost_pounce",
    name: "Ghost Pounce",
    description: "Attacks pierce +1 enemy",
    tag: "attack",
    maxLevel: 3,
    apply(game) {
      game.familiar.pierce += 1;
    },
  },
  {
    id: "frenzy_focus",
    name: "Frenzy Focus",
    description: "Frenzy meter charges faster",
    tag: "frenzy",
    maxLevel: 3,
    apply(game) {
      game.frenzyPerMote += 1;
    },
  },
  {
    id: "lucky_paws",
    name: "Lucky Paws",
    description: "Better enemy drop chances",
    tag: "utility",
    maxLevel: 3,
    apply(game) {
      game.luckLevel += 1;
    },
  },
];

// Fallback reward shown only when EVERY upgrade is maxed. No level/cap, so it
// can be offered repeatedly.
export const SPIRIT_RECOVERY = {
  id: "spirit_recovery",
  name: "Spirit Recovery",
  description: "Restore 25 health",
  tag: "survival",
  apply(game) {
    game.player.heal(25);
  },
};

// Conditional, one-time familiar evolutions. Unlike the levelled UPGRADES,
// these only enter the offer pool once `requires()` is satisfied, and they
// vanish once taken (maxLevel 1). The player must CHOOSE them — they are no
// longer auto-applied — so they get a chance to read what they unlock.
export const EVOLUTIONS = [
  {
    id: "phantom_pounce",
    name: "Phantom Pounce",
    description: "Bolts pierce +2 enemies and deal +2 damage.",
    tag: "evolution",
    maxLevel: 1,
    // Unlocks once Sharper Spirit Claws is maxed AND Ghost Pounce is Lv. 2+.
    requires(levels) {
      return (levels.sharper_spirit_claws || 0) >= 5 && (levels.ghost_pounce || 0) >= 2;
    },
    apply(game) {
      game.familiar.pierce += 2;
      game.familiar.damage += 2;
      game.familiar.evolved = true;
      game.phantomPounceUnlocked = true;
      game.evoBannerText = "Evolution Unlocked: Phantom Pounce";
      game.evoBannerTimer = 4; // seconds the banner stays on screen
    },
  },
];

// Attach the player's current level to an offer copy (for the card display).
function withLevel(up, levels) {
  if (up.maxLevel === undefined) return { ...up }; // fallback: no level line
  return { ...up, level: levels[up.id] || 0 };
}

// Return up to `count` offers for a level-up. `levels` is the Game's
// { id: currentLevel } map.
//
// Order of preference:
//   1. Any available EVOLUTION (requirements met, not yet taken) gets a
//      guaranteed slot so the player always sees and can read it.
//   2. Remaining slots fill with random, distinct, non-maxed UPGRADES.
//   3. If nothing is available at all, a single Spirit Recovery fallback.
export function getOffers(count = 1, levels = {}) {
  const regular = UPGRADES.filter((u) => (levels[u.id] || 0) < u.maxLevel);
  const evos = EVOLUTIONS.filter(
    (e) => (levels[e.id] || 0) < e.maxLevel && e.requires(levels)
  );

  if (regular.length === 0 && evos.length === 0) {
    return [withLevel(SPIRIT_RECOVERY, levels)];
  }

  const offers = [];

  // Guaranteed evolution slot(s) first.
  for (const evo of evos) {
    if (offers.length >= count) break;
    offers.push(withLevel(evo, levels));
  }

  // Fill the rest with random, distinct regular upgrades.
  const pool = regular.slice();
  while (offers.length < count && pool.length > 0) {
    const i = Math.floor(Math.random() * pool.length);
    offers.push(withLevel(pool.splice(i, 1)[0], levels));
  }

  return offers;
}
