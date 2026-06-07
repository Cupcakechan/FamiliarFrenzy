/* =========================================================================
   upgrades.js — the data-driven upgrade pool.

   Each upgrade: { id, name, description, maxLevel, apply(game) }.
   apply() receives the Game and mutates the familiar/player.

   Level tracking lives on the Game (game.upgradeLevels = { id: n }), NOT here,
   so these definitions stay pure and levels reset cleanly with each new run.

   To add more later: add an entry here with its own maxLevel. getOffers()
   automatically filters out maxed upgrades and picks a random distinct subset,
   so the level-up screen keeps working with no other changes.
   ========================================================================= */

export const UPGRADES = [
  {
    id: "sharper_spirit_claws",
    name: "Sharper Spirit Claws",
    description: "Familiar damage +1",
    maxLevel: 5,
    apply(game) {
      game.familiar.damage += 1;
    },
  },
  {
    id: "restless_wisp",
    name: "Restless Wisp",
    description: "Attack cooldown -15%",
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
    maxLevel: 3,
    apply(game) {
      game.player.maxHealth += 20;
      game.player.heal(20); // also heal so it feels immediate
    },
  },
];

// Fallback reward shown only when EVERY upgrade is maxed. It has no level/cap,
// so it can be offered any number of times.
export const SPIRIT_RECOVERY = {
  id: "spirit_recovery",
  name: "Spirit Recovery",
  description: "Restore 25 health",
  apply(game) {
    game.player.heal(25);
  },
};

// Attach the player's current level to an offer copy (for the card display).
// Definitions stay untouched; we return a shallow copy.
function withLevel(up, levels) {
  if (up.maxLevel === undefined) return { ...up }; // fallback: no level line
  return { ...up, level: levels[up.id] || 0 };
}

// Return up to `count` DISTINCT, non-maxed upgrades to offer on a level-up.
// `levels` is the Game's { id: currentLevel } map. If everything is maxed,
// returns a single Spirit Recovery fallback card.
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
