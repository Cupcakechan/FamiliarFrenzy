/* =========================================================================
   upgrades.js — the data-driven upgrade pool.

   Each upgrade is a small object:
     { id, name, description, apply(game) }
   `apply` receives the Game instance and changes something (e.g. the cat's
   damage). The level-up screen offers upgrades from this list.

   Phase 5: just one upgrade (Sharper Claws). To add more later (Quick Claws,
   Twin Familiar, Lucky Paws, ...), simply add entries here and ask the screen
   for more than one offer — getOffers(3) — and number-key selection kicks in.
   ========================================================================= */

export const UPGRADES = [
  {
    id: "sharper_claws",
    name: "Sharper Claws",
    description: "Familiar damage +1",
    apply(game) {
      game.familiar.damage += 1;
    },
  },
  // Future ideas (do NOT add until their phase):
  // { id: "quick_claws", name: "Quick Claws", description: "Attack cooldown -15%",
  //   apply(game) { game.familiar.attackCooldown *= 0.85; } },
  // { id: "lucky_paws", ... }
];

// Return up to `count` DISTINCT upgrades to offer on a level-up screen.
// With one upgrade in the pool this just returns [Sharper Claws].
export function getOffers(count = 1) {
  if (UPGRADES.length <= count) return UPGRADES.slice();

  // Random distinct pick (used once the pool grows past `count`).
  const pool = UPGRADES.slice();
  const offers = [];
  while (offers.length < count && pool.length > 0) {
    const i = Math.floor(Math.random() * pool.length);
    offers.push(pool.splice(i, 1)[0]);
  }
  return offers;
}
