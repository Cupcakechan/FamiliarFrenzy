/* =========================================================================
   upgrades.js — the data-driven upgrade pool.

   Each upgrade: { id, name, description, apply(game) }.
   apply() receives the Game and mutates the familiar/player.

   To add more later: add an entry here. When the pool grows past OFFER_COUNT,
   getOffers() automatically picks a random distinct subset, so the level-up
   screen starts offering a varied choice with no other changes.
   ========================================================================= */

export const UPGRADES = [
  {
    id: "sharper_spirit_claws",
    name: "Sharper Spirit Claws",
    description: "Familiar damage +1",
    apply(game) {
      game.familiar.damage += 1;
    },
  },
  {
    id: "restless_wisp",
    name: "Restless Wisp",
    description: "Attack cooldown -15%",
    apply(game) {
      // Multiply down, but never below a floor so it can't reach zero.
      game.familiar.attackCooldown = Math.max(0.4, game.familiar.attackCooldown * 0.85);
    },
  },
  {
    id: "spirit_heart",
    name: "Spirit Heart",
    description: "Max health +20",
    apply(game) {
      game.player.maxHealth += 20;
      game.player.heal(20); // also heal so it feels immediate
    },
  },
];

// Return up to `count` DISTINCT upgrades to offer on a level-up screen.
export function getOffers(count = 1) {
  if (UPGRADES.length <= count) {
    // Fewer (or equal) upgrades than slots → offer them all.
    return UPGRADES.slice();
  }

  // Random distinct pick (kicks in once the pool grows past `count`).
  const pool = UPGRADES.slice();
  const offers = [];
  while (offers.length < count && pool.length > 0) {
    const i = Math.floor(Math.random() * pool.length);
    offers.push(pool.splice(i, 1)[0]);
  }
  return offers;
}
