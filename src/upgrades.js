/* =========================================================================
   upgrades.js — the data-driven upgrade pool.

   Each upgrade: { id, name, description, tag, maxLevel, apply(game) }.
   - tag: "attack" | "speed" | "survival" | "frenzy" | "utility"
          (informational for now — future balancing / evolution logic).
   - apply(game): mutates the familiar/player/game. Level tracking lives on the
          Game (game.upgradeLevels = { id: n }), so these stay pure data and
          reset cleanly each run.

   getOffers() filters out maxed upgrades and picks a random DISTINCT subset,
   so the level-up screen always offers a varied choice with no other changes.
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

// Attach the player's current level to an offer copy (for the card display).
function withLevel(up, levels) {
  if (up.maxLevel === undefined) return { ...up }; // fallback: no level line
  return { ...up, level: levels[up.id] || 0 };
}

// Return up to `count` DISTINCT, non-maxed upgrades (randomly chosen) to offer
// on a level-up. `levels` is the Game's { id: currentLevel } map. If everything
// is maxed, returns a single Spirit Recovery fallback card.
export function getOffers(count = 1, levels = {}) {
  const available = UPGRADES.filter((u) => (levels[u.id] || 0) < u.maxLevel);

  if (available.length === 0) {
    return [withLevel(SPIRIT_RECOVERY, levels)];
  }

  // Random distinct pick from what's still available (may be fewer than count).
  const pool = available.slice();
  const offers = [];
  while (offers.length < count && pool.length > 0) {
    const i = Math.floor(Math.random() * pool.length);
    offers.push(withLevel(pool.splice(i, 1)[0], levels));
  }
  return offers;
}
