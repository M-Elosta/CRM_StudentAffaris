'use strict';

/**
 * Seeded pseudo-random numbers for the demo seed. The same seed always gives
 * the same sequence, so two runs with the same anchor date produce identical
 * data. Math.random() is never used.
 */

/** mulberry32: a small, fast 32-bit generator. Returns floats in [0, 1). */
function mulberry32(seed) {
  let state = seed >>> 0;
  return function next() {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function createRandom(seed) {
  const next = mulberry32(seed);

  const rng = {
    next,

    /** Integer in [min, max], both inclusive. */
    int(min, max) {
      return min + Math.floor(next() * (max - min + 1));
    },

    chance(probability) {
      return next() < probability;
    },

    pick(list) {
      return list[Math.floor(next() * list.length)];
    },

    /** Pick one item; weightOf(item) returns a non-negative weight. Returns null when all weights are 0. */
    weighted(list, weightOf) {
      const weights = list.map((item) => Math.max(0, weightOf(item)));
      const total = weights.reduce((sum, w) => sum + w, 0);
      if (total <= 0) return null;
      let target = next() * total;
      for (let i = 0; i < list.length; i += 1) {
        target -= weights[i];
        if (target < 0 && weights[i] > 0) return list[i];
      }
      for (let i = list.length - 1; i >= 0; i -= 1) {
        if (weights[i] > 0) return list[i];
      }
      return null;
    },

    /** Pick from [[value, weight], ...]. */
    weightedValue(pairs) {
      return rng.weighted(pairs, (pair) => pair[1])[0];
    },

    shuffle(list) {
      const copy = list.slice();
      for (let i = copy.length - 1; i > 0; i -= 1) {
        const j = Math.floor(next() * (i + 1));
        [copy[i], copy[j]] = [copy[j], copy[i]];
      }
      return copy;
    },

    /** n distinct items, in random order. */
    sample(list, n) {
      return rng.shuffle(list).slice(0, Math.min(n, list.length));
    },

    /** n distinct items chosen by weight, without replacement. */
    weightedSample(list, n, weightOf) {
      const pool = list.slice();
      const chosen = [];
      while (chosen.length < n && pool.length) {
        const item = rng.weighted(pool, weightOf);
        if (item === null) break;
        chosen.push(item);
        pool.splice(pool.indexOf(item), 1);
      }
      return chosen;
    },
  };

  return rng;
}

module.exports = { createRandom };
