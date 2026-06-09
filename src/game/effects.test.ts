import { describe, it, expect } from 'vitest'
import { applyEffects, NEUTRAL_MODIFIERS, neutral } from './effects'
import type { Effect, Modifiers } from './types'

// Compare two Modifiers including Set contents (toEqual handles Set equality).
const sameMods = (a: Modifiers, b: Modifiers) => {
  expect(a).toEqual(b)
}

describe('applyEffects — neutral base', () => {
  it('empty array folds to the neutral identity', () => {
    expect(applyEffects([])).toEqual({
      signalMult: 1,
      decodeTimeMult: 1,
      powerCapAdd: 0,
      buildCostMult: 1,
      unlocked: new Set<string>(),
      parallelDecodes: 0,
    })
  })

  it('NEUTRAL_MODIFIERS exposes the same identity', () => {
    expect(NEUTRAL_MODIFIERS).toEqual({
      signalMult: 1,
      decodeTimeMult: 1,
      powerCapAdd: 0,
      buildCostMult: 1,
      unlocked: new Set<string>(),
      parallelDecodes: 0,
    })
  })

  it('neutral() factory equals applyEffects([])', () => {
    expect(neutral()).toEqual(applyEffects([]))
  })
})

describe('applyEffects — multiplicative stacking (product)', () => {
  it('two signalMult fold to their product', () => {
    const r = applyEffects([
      { kind: 'signalMult', value: 1.25 },
      { kind: 'signalMult', value: 1.4 },
    ])
    expect(r.signalMult).toBeCloseTo(1.75, 10) // 1.25 * 1.4
  })

  it('two decodeTimeMult fold to their product (faster compounds)', () => {
    const r = applyEffects([
      { kind: 'decodeTimeMult', value: 0.8 },
      { kind: 'decodeTimeMult', value: 0.6 },
    ])
    expect(r.decodeTimeMult).toBeCloseTo(0.48, 10) // 0.8 * 0.6
  })

  it('two buildCostMult fold to their product (cheaper compounds)', () => {
    const r = applyEffects([
      { kind: 'buildCostMult', value: 0.85 },
      { kind: 'buildCostMult', value: 0.9 },
    ])
    expect(r.buildCostMult).toBeCloseTo(0.765, 10) // 0.85 * 0.9
  })

  it('a single mult passes through unchanged', () => {
    expect(applyEffects([{ kind: 'signalMult', value: 2 }]).signalMult).toBe(2)
  })
})

describe('applyEffects — additive stacking (sum)', () => {
  it('powerCapAdd sums', () => {
    const r = applyEffects([
      { kind: 'powerCapAdd', value: 5 },
      { kind: 'powerCapAdd', value: 2 },
    ])
    expect(r.powerCapAdd).toBe(7)
  })

  it('parallelDecodeAdd sums into parallelDecodes', () => {
    const r = applyEffects([
      { kind: 'parallelDecodeAdd', value: 1 },
      { kind: 'parallelDecodeAdd', value: 1 },
    ])
    expect(r.parallelDecodes).toBe(2)
  })

  it('a single add passes through unchanged', () => {
    expect(applyEffects([{ kind: 'powerCapAdd', value: 3 }]).powerCapAdd).toBe(3)
  })
})

describe('applyEffects — unlocks land in the set', () => {
  it('unlockBuilding adds its id', () => {
    expect(applyEffects([{ kind: 'unlockBuilding', id: 'amplifier' }]).unlocked.has('amplifier')).toBe(true)
  })

  it('unlockDecode adds its id', () => {
    expect(applyEffects([{ kind: 'unlockDecode', id: 'orbital-relay' }]).unlocked.has('orbital-relay')).toBe(true)
  })

  it('unlockFeature adds its id', () => {
    expect(applyEffects([{ kind: 'unlockFeature', id: 'autoRestart' }]).unlocked.has('autoRestart')).toBe(true)
  })

  it('unlockTech adds its id', () => {
    expect(applyEffects([{ kind: 'unlockTech', id: 't.overdrive' }]).unlocked.has('t.overdrive')).toBe(true)
  })

  it('all four unlock kinds coexist in one set', () => {
    const r = applyEffects([
      { kind: 'unlockBuilding', id: 'reactor' },
      { kind: 'unlockDecode', id: 'decrypt-header' },
      { kind: 'unlockFeature', id: 'techTree' },
      { kind: 'unlockTech', id: 'd.phaselock' },
    ])
    expect(r.unlocked).toEqual(new Set(['reactor', 'decrypt-header', 'techTree', 'd.phaselock']))
  })

  it('duplicate unlock ids collapse (Set semantics)', () => {
    const r = applyEffects([
      { kind: 'unlockFeature', id: 'autoRestart' },
      { kind: 'unlockFeature', id: 'autoRestart' },
    ])
    expect(r.unlocked).toEqual(new Set(['autoRestart']))
  })
})

describe('applyEffects — order independence', () => {
  const effects: Effect[] = [
    { kind: 'signalMult', value: 1.25 },
    { kind: 'decodeTimeMult', value: 0.8 },
    { kind: 'powerCapAdd', value: 5 },
    { kind: 'buildCostMult', value: 0.85 },
    { kind: 'unlockBuilding', id: 'amplifier' },
    { kind: 'unlockTech', id: 'd.phaselock' },
    { kind: 'parallelDecodeAdd', value: 1 },
    { kind: 'signalMult', value: 1.4 },
    { kind: 'powerCapAdd', value: 2 },
    { kind: 'parallelDecodeAdd', value: 1 },
  ]

  // A deterministic reversal plus a couple of hand-rolled shuffles: each must
  // fold to the identical Modifiers.
  const reversed = [...effects].reverse()
  const shuffleA: Effect[] = [
    effects[4], effects[1], effects[8], effects[0], effects[9],
    effects[3], effects[6], effects[2], effects[5], effects[7],
  ]
  const shuffleB: Effect[] = [
    effects[9], effects[3], effects[0], effects[7], effects[2],
    effects[5], effects[1], effects[8], effects[4], effects[6],
  ]

  it('reversed order yields identical Modifiers', () => {
    sameMods(applyEffects(reversed), applyEffects(effects))
  })

  it('arbitrary shuffle A yields identical Modifiers', () => {
    sameMods(applyEffects(shuffleA), applyEffects(effects))
  })

  it('arbitrary shuffle B yields identical Modifiers', () => {
    sameMods(applyEffects(shuffleB), applyEffects(effects))
  })

  it('every permutation-by-rotation agrees with the canonical fold', () => {
    const base = applyEffects(effects)
    for (let i = 0; i < effects.length; i++) {
      const rotated = [...effects.slice(i), ...effects.slice(0, i)]
      sameMods(applyEffects(rotated), base)
    }
  })
})

describe('applyEffects — mixed realistic list', () => {
  it('folds a realistic tech + objective payload correctly', () => {
    // t.gain1 (+25%), t.gain2 (+40%), d.fast1 (-20% time), e.frugal (-15% cost),
    // e.reactor1 (+2 cap), an objective reward (+1 cap), d.parallel (+1 slot),
    // e.auto (unlock autoRestart), t.array (unlock Dish building).
    const r = applyEffects([
      { kind: 'signalMult', value: 1.25 },
      { kind: 'signalMult', value: 1.4 },
      { kind: 'decodeTimeMult', value: 0.8 },
      { kind: 'buildCostMult', value: 0.85 },
      { kind: 'powerCapAdd', value: 2 },
      { kind: 'powerCapAdd', value: 1 },
      { kind: 'parallelDecodeAdd', value: 1 },
      { kind: 'unlockFeature', id: 'autoRestart' },
      { kind: 'unlockBuilding', id: 'amplifier' },
    ])
    expect(r.signalMult).toBeCloseTo(1.75, 10)
    expect(r.decodeTimeMult).toBeCloseTo(0.8, 10)
    expect(r.buildCostMult).toBeCloseTo(0.85, 10)
    expect(r.powerCapAdd).toBe(3)
    expect(r.parallelDecodes).toBe(1)
    expect(r.unlocked).toEqual(new Set(['autoRestart', 'amplifier']))
  })
})

describe('applyEffects — purity / isolation', () => {
  it('does not mutate the input effects array', () => {
    const effects: Effect[] = [
      { kind: 'signalMult', value: 2 },
      { kind: 'powerCapAdd', value: 5 },
    ]
    const snapshot = JSON.parse(JSON.stringify(effects))
    applyEffects(effects)
    expect(effects).toEqual(snapshot)
  })

  it('does not leak state between calls (fresh Set each time)', () => {
    const a = applyEffects([{ kind: 'unlockFeature', id: 'x' }])
    const b = applyEffects([{ kind: 'unlockFeature', id: 'y' }])
    expect(a.unlocked).toEqual(new Set(['x']))
    expect(b.unlocked).toEqual(new Set(['y']))
  })

  it('does not mutate NEUTRAL_MODIFIERS when folding', () => {
    applyEffects([
      { kind: 'signalMult', value: 9 },
      { kind: 'powerCapAdd', value: 9 },
      { kind: 'unlockFeature', id: 'z' },
    ])
    expect(NEUTRAL_MODIFIERS).toEqual({
      signalMult: 1,
      decodeTimeMult: 1,
      powerCapAdd: 0,
      buildCostMult: 1,
      unlocked: new Set<string>(),
      parallelDecodes: 0,
    })
  })
})
