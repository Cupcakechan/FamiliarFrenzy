/* =========================================================================
   curses.js — Cursed Mode's curse registry + helpers.

   A "curse" is a data-driven modifier that activates as you descend in Cursed
   Mode: each boss kill adds one new random curse, and they stack. Every entry
   declares its display info (name, blurb) and its EFFECT FIELDS, which the
   relevant systems read off the currently-active set. So adding a curse is a
   registry entry plus the one place that reads its field — the HUD, pause
   menu, and archive (later passes) all auto-flow from this table with no extra
   wiring.

   Icons (added with the HUD in a later pass): assets/sprites/curses/<id>.png,
   authored at 64x64 and rendered at integer scales (32 on the HUD, 64 in the
   archive) so the pixel art stays crisp.
   ========================================================================= */

// The registry. `id` is the stable key (and the icon basename later). Effect
// fields are read by whichever system the curse touches:
//   vision  -> the dark veil's spotlight radius (game.js renderer)
// Pass 2+ will add more: noFlasks, enemySpeedMult, groundHazard, extraDamage...
export const CURSES = {
  darkness: {
    id: "darkness",
    name: "Darkness",
    blurb: "The arena drowns in gloom — only a ring of light follows you.",
    vision: 230, // spotlight radius around the witch (drives the persistent veil)
  },
  withering: {
    id: "withering",
    name: "Withering",
    blurb: "Health flasks no longer fall — what you have is all you have.",
    noFlasks: true, // read by the flask-drop roll (game.js)
  },
  cursed_ground: {
    id: "cursed_ground",
    name: "Cursed Ground",
    blurb: "Cursed patches keep blooming underfoot. Don't stand still.",
    groundHazard: true, // read by the ambient hazard spawner (game.js)
  },
  quickening: {
    id: "quickening",
    name: "Quickening",
    blurb: "Every lesser horror moves with unnatural speed.",
    enemySpeedMult: 1.25, // applied to regular enemies' speed (bosses keep their tuned patterns)
  },
};

// Curses eligible to be rolled, in rough easiest->nastiest order. Pass 2+ extends
// this as new CURSES entries land.
export const CURSE_POOL = ["darkness", "withering", "cursed_ground", "quickening"];

// Pick a random curse id that isn't active yet, or null once every pool curse is
// on (so the escalation gracefully stops adding when exhausted).
export function rollNextCurse(activeIds) {
  const available = CURSE_POOL.filter((id) => !activeIds.includes(id));
  if (available.length === 0) return null;
  return available[Math.floor(Math.random() * available.length)];
}

// The value of `field` from the first active curse that defines it, else
// `fallback`. A single-source lookup covers everything Pass 1 needs (Darkness's
// vision); richer combiners (OR flags, product multipliers) arrive with the
// curses that need them in Pass 2.
export function curseValue(activeIds, field, fallback = null) {
  for (const id of activeIds) {
    const c = CURSES[id];
    if (c && c[field] !== undefined) return c[field];
  }
  return fallback;
}
