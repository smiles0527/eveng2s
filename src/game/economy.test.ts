import { describe, it, expect } from 'vitest'
import {
  BASE,
  RATE,
  POWER,
  ANTENNA_BASE_RATE,
  AMP_BONUS,
  REACTOR_BASE_CAP,
  REACTOR_CAP_PER,
  signalPerSec,
  powerCap,
  powerUsed,
  powerHeadroom,
  costOf,
  canAfford,
  buy,
} from './economy'
import type { GameState, Modifiers, Building, Slot } from './types'

const mods = (over: Partial<Modifiers> = {}): Modifiers => ({
  signalMult: 1,
  decodeTimeMult: 1,
  powerCapAdd: 0,
  buildCostMult: 1,
  unlocked: new Set<string>(),
  parallelDecodes: 1,
  ...over,
})

const makeState = (over: Partial<GameState> = {}): GameState => ({
  signal: 0,
  fragments: 0,
  owned: { antenna: 0, amplifier: 0, decoder: 0, reactor: 0 },
  slots: [],
  queue: [],
  decodesCompleted: 0,
  ownedTech: [],
  completedObjectives: [],
  completedChallenges: [],
  seenBeats: [],
  session: { decodesThisHour: 0, hourStartMs: 0 },
  lastSeenMs: 0,
  ...over,
})

const running: Slot = { status: 'running', def: 'd', startMs: 0, endMs: 1000 }
const banked: Slot = { status: 'banked', def: 'd', finishedMs: 0 }

describe('signalPerSec', () => {
  it('is 0 with no antennas regardless of amplifiers', () => {
    expect(signalPerSec(makeState({ owned: { antenna: 0, amplifier: 3, decoder: 0, reactor: 0 } }), mods())).toBe(0)
  })

  it('antennas alone scale linearly by ANTENNA_BASE_RATE', () => {
    expect(signalPerSec(makeState({ owned: { antenna: 4, amplifier: 0, decoder: 0, reactor: 0 } }), mods())).toBeCloseTo(4 * ANTENNA_BASE_RATE, 9)
  })

  it('amplifiers compound multiplicatively at (1+AMP_BONUS)^amplifiers', () => {
    const s = makeState({ owned: { antenna: 2, amplifier: 3, decoder: 0, reactor: 0 } })
    expect(signalPerSec(s, mods())).toBeCloseTo(2 * ANTENNA_BASE_RATE * (1 + AMP_BONUS) ** 3, 9)
  })

  it('applies mods.signalMult', () => {
    const s = makeState({ owned: { antenna: 2, amplifier: 1, decoder: 0, reactor: 0 } })
    expect(signalPerSec(s, mods({ signalMult: 2 }))).toBeCloseTo(2 * ANTENNA_BASE_RATE * (1 + AMP_BONUS) * 2, 9)
  })
})

describe('powerCap', () => {
  it('is REACTOR_BASE_CAP with no reactors and no mods', () => {
    expect(powerCap(makeState(), mods())).toBe(REACTOR_BASE_CAP)
  })

  it('adds REACTOR_CAP_PER per reactor', () => {
    const s = makeState({ owned: { antenna: 0, amplifier: 0, decoder: 0, reactor: 3 } })
    expect(powerCap(s, mods())).toBe(REACTOR_BASE_CAP + 3 * REACTOR_CAP_PER)
  })

  it('adds mods.powerCapAdd', () => {
    const s = makeState({ owned: { antenna: 0, amplifier: 0, decoder: 0, reactor: 1 } })
    expect(powerCap(s, mods({ powerCapAdd: 7 }))).toBe(REACTOR_BASE_CAP + REACTOR_CAP_PER + 7)
  })
})

describe('powerUsed', () => {
  it('is 0 for an empty state', () => {
    expect(powerUsed(makeState())).toBe(0)
  })

  it('sums antenna and amplifier draw, ignoring owned decoders/reactors when idle', () => {
    const s = makeState({ owned: { antenna: 2, amplifier: 3, decoder: 4, reactor: 5 } })
    expect(powerUsed(s)).toBe(2 * POWER.antenna + 3 * POWER.amplifier)
  })

  it('counts only running decode slots (not idle or banked) at POWER.decoder each', () => {
    const s = makeState({
      owned: { antenna: 1, amplifier: 0, decoder: 3, reactor: 0 },
      slots: [running, { status: 'idle' }, running, banked],
    })
    expect(powerUsed(s)).toBe(1 * POWER.antenna + 2 * POWER.decoder)
  })
})

describe('powerHeadroom', () => {
  it('is powerCap - powerUsed', () => {
    const s = makeState({
      owned: { antenna: 2, amplifier: 1, decoder: 0, reactor: 1 },
      slots: [running],
    })
    expect(powerHeadroom(s, mods())).toBe(powerCap(s, mods()) - powerUsed(s))
  })

  it('can go negative when over-subscribed', () => {
    const s = makeState({ owned: { antenna: 10, amplifier: 0, decoder: 0, reactor: 0 } })
    expect(powerHeadroom(s, mods())).toBe(REACTOR_BASE_CAP - 10 * POWER.antenna)
  })
})

describe('costOf', () => {
  it('first unit (owned 0) costs exactly BASE', () => {
    for (const b of ['antenna', 'amplifier', 'decoder', 'reactor'] as Building[]) {
      expect(costOf(b, 0, mods())).toBe(BASE[b])
    }
  })

  it('second unit (owned 1) costs round(BASE*RATE)', () => {
    expect(costOf('antenna', 1, mods())).toBe(Math.round(BASE.antenna * RATE.antenna))
    expect(costOf('reactor', 1, mods())).toBe(Math.round(BASE.reactor * RATE.reactor))
  })

  it('the n-th unit grows geometrically as round(BASE*RATE^n)', () => {
    expect(costOf('antenna', 5, mods())).toBe(Math.round(BASE.antenna * RATE.antenna ** 5))
    expect(costOf('amplifier', 4, mods())).toBe(Math.round(BASE.amplifier * RATE.amplifier ** 4))
  })

  it('reactor curve matches the spec example 500, 750, 1125', () => {
    expect(costOf('reactor', 0, mods())).toBe(500)
    expect(costOf('reactor', 1, mods())).toBe(750)
    expect(costOf('reactor', 2, mods())).toBe(1125)
  })

  it('applies mods.buildCostMult and rounds', () => {
    expect(costOf('antenna', 0, mods({ buildCostMult: 0.5 }))).toBe(Math.round(BASE.antenna * 0.5))
    expect(costOf('amplifier', 3, mods({ buildCostMult: 0.9 }))).toBe(Math.round(BASE.amplifier * RATE.amplifier ** 3 * 0.9))
  })
})

describe('canAfford', () => {
  it('true when signal covers cost and headroom covers power draw', () => {
    const s = makeState({ signal: 1000, owned: { antenna: 0, amplifier: 0, decoder: 0, reactor: 0 } })
    expect(canAfford(s, 'antenna', mods())).toBe(true)
  })

  it('rejects when signal is below cost even with ample headroom', () => {
    const s = makeState({ signal: BASE.antenna - 1, owned: { antenna: 0, amplifier: 0, decoder: 0, reactor: 0 } })
    expect(canAfford(s, 'antenna', mods())).toBe(false)
  })

  it('rejects when there is no power headroom even with ample signal', () => {
    // cap = 5, antennas fill it exactly (5 * POWER.antenna = 5), so an amplifier
    // (draw 2) has no headroom despite plenty of signal.
    const s = makeState({ signal: 1e9, owned: { antenna: REACTOR_BASE_CAP, amplifier: 0, decoder: 0, reactor: 0 } })
    expect(powerHeadroom(s, mods())).toBe(0)
    expect(canAfford(s, 'amplifier', mods())).toBe(false)
  })

  it('reactor is never power-blocked (POWER 0) given enough signal', () => {
    // Fully over-subscribed: headroom is negative, but a reactor draws 0 power.
    const s = makeState({ signal: 1e9, owned: { antenna: 100, amplifier: 0, decoder: 0, reactor: 0 } })
    expect(powerHeadroom(s, mods())).toBeLessThan(0)
    expect(POWER.reactor).toBe(0)
    expect(canAfford(s, 'reactor', mods())).toBe(true)
  })

  it('rejects a reactor when signal is insufficient', () => {
    const s = makeState({ signal: BASE.reactor - 1 })
    expect(canAfford(s, 'reactor', mods())).toBe(false)
  })
})

describe('buy', () => {
  it('returns the SAME reference when unaffordable', () => {
    const s = makeState({ signal: 0 })
    expect(buy(s, 'antenna', mods())).toBe(s)
  })

  it('deducts exactly costOf and increments owned when affordable', () => {
    const s = makeState({ signal: 1000, owned: { antenna: 2, amplifier: 0, decoder: 0, reactor: 0 } })
    const cost = costOf('antenna', 2, mods())
    const r = buy(s, 'antenna', mods())
    expect(r).not.toBe(s)
    expect(r.signal).toBe(1000 - cost)
    expect(r.owned.antenna).toBe(3)
  })

  it('does not mutate the input state', () => {
    const s = makeState({ signal: 1000, owned: { antenna: 1, amplifier: 0, decoder: 0, reactor: 0 } })
    const snapshot = JSON.parse(JSON.stringify({ signal: s.signal, owned: s.owned }))
    buy(s, 'antenna', mods())
    expect(s.signal).toBe(snapshot.signal)
    expect(s.owned).toEqual(snapshot.owned)
  })

  it('leaves other building counts untouched', () => {
    // reactor:1 lifts the cap to 10 so the amplifier (draw 2) has headroom.
    const s = makeState({ signal: 1000, owned: { antenna: 1, amplifier: 2, decoder: 3, reactor: 1 } })
    const r = buy(s, 'amplifier', mods())
    expect(r.owned).toEqual({ antenna: 1, amplifier: 3, decoder: 3, reactor: 1 })
  })

  it('applies buildCostMult to the deducted amount', () => {
    const s = makeState({ signal: 1000, owned: { antenna: 0, amplifier: 0, decoder: 0, reactor: 0 } })
    const r = buy(s, 'antenna', mods({ buildCostMult: 0.5 }))
    expect(r.signal).toBe(1000 - Math.round(BASE.antenna * 0.5))
  })
})
