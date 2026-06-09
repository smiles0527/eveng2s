// Lost Signal — the shared effect fold. Tech nodes, objective/challenge rewards,
// and (v2) timed events all emit `Effect[]`; `applyEffects` collapses them into a
// single `Modifiers` snapshot that every economy/decode function reads.
//
// The fold is order-independent by construction: multiplicative channels combine
// by PRODUCT, additive channels by SUM, and unlocks by set UNION. All three are
// commutative + associative, so acquisition order can never change the result.
// Pure: no clock, no bridge, no DOM.

import type { Effect, Modifiers } from './types'

/** A fresh neutral (identity) accumulator. Each call returns its own Set so
 *  folds never alias shared state. */
export function neutral(): Modifiers {
  return {
    signalMult: 1,
    decodeTimeMult: 1,
    powerCapAdd: 0,
    buildCostMult: 1,
    unlocked: new Set<string>(),
    parallelDecodes: 0,
  }
}

/** Convenience identity value. Treat as read-only — do not mutate. Anything that
 *  needs a mutable base should call `neutral()` (or `applyEffects([])`). */
export const NEUTRAL_MODIFIERS: Modifiers = neutral()

/**
 * Order-independent fold of a set of effects into one `Modifiers`.
 *
 * - `signalMult`, `decodeTimeMult`, `buildCostMult` stack multiplicatively.
 * - `powerCapAdd`, `parallelDecodeAdd` stack additively (the latter into
 *   `parallelDecodes`).
 * - `unlockBuilding` / `unlockDecode` / `unlockFeature` / `unlockTech` add their
 *   `id` to the `unlocked` set.
 *
 * Pure: builds and returns a brand-new accumulator; never mutates inputs or
 * `NEUTRAL_MODIFIERS`.
 */
export function applyEffects(effects: Effect[]): Modifiers {
  const m = neutral()
  for (const e of effects) {
    switch (e.kind) {
      case 'signalMult':
        m.signalMult *= e.value
        break
      case 'decodeTimeMult':
        m.decodeTimeMult *= e.value
        break
      case 'buildCostMult':
        m.buildCostMult *= e.value
        break
      case 'powerCapAdd':
        m.powerCapAdd += e.value
        break
      case 'parallelDecodeAdd':
        m.parallelDecodes += e.value
        break
      case 'unlockBuilding':
      case 'unlockDecode':
      case 'unlockFeature':
      case 'unlockTech':
        m.unlocked.add(e.id)
        break
    }
  }
  return m
}
