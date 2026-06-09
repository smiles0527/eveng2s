import { describe, it, expect } from 'vitest'
import { OBJECTIVES, CHALLENGES, newlyCompleted } from './objectives'
import type { GameState, Derived, Objective } from './types'

// Minimal GameState builder — only the fields predicates read need to be sane.
const state = (over: Partial<GameState> = {}): GameState => ({
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

const derived = (over: Partial<Derived> = {}): Derived => ({
  signalPerSec: 0,
  powerCap: 0,
  powerUsed: 0,
  ...over,
})

const byId = (defs: Objective[], id: string): Objective => {
  const o = defs.find((d) => d.id === id)
  if (!o) throw new Error(`no objective ${id}`)
  return o
}

describe('OBJECTIVES — shape', () => {
  it('has ~5 milestones with unique ids', () => {
    expect(OBJECTIVES.length).toBe(5)
    const ids = OBJECTIVES.map((o) => o.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('every objective has a name, desc and a callable condition', () => {
    for (const o of OBJECTIVES) {
      expect(typeof o.name).toBe('string')
      expect(o.name.length).toBeGreaterThan(0)
      expect(typeof o.desc).toBe('string')
      expect(typeof o.condition).toBe('function')
    }
  })
})

describe('objective: reach 100 signal/s', () => {
  const o = byId(OBJECTIVES, 'o.signal100')

  it('false just below 100/s', () => {
    expect(o.condition(state(), derived({ signalPerSec: 99.9 }))).toBe(false)
  })
  it('true at exactly 100/s', () => {
    expect(o.condition(state(), derived({ signalPerSec: 100 }))).toBe(true)
  })
  it('true above 100/s', () => {
    expect(o.condition(state(), derived({ signalPerSec: 250 }))).toBe(true)
  })
  it('rewards +1 power cap', () => {
    expect(o.reward.effects).toEqual([{ kind: 'powerCapAdd', value: 1 }])
  })
})

describe('objective: own 10 antennas', () => {
  const o = byId(OBJECTIVES, 'o.antennas10')

  it('false at 9 antennas', () => {
    expect(o.condition(state({ owned: { antenna: 9, amplifier: 0, decoder: 0, reactor: 0 } }), derived())).toBe(false)
  })
  it('true at exactly 10 antennas', () => {
    expect(o.condition(state({ owned: { antenna: 10, amplifier: 0, decoder: 0, reactor: 0 } }), derived())).toBe(true)
  })
  it('true above 10 antennas', () => {
    expect(o.condition(state({ owned: { antenna: 12, amplifier: 0, decoder: 0, reactor: 0 } }), derived())).toBe(true)
  })
  it('rewards unlock of the amplifier building', () => {
    expect(o.reward.effects).toEqual([{ kind: 'unlockBuilding', id: 'amplifier' }])
  })
})

describe('objective: first decode', () => {
  const o = byId(OBJECTIVES, 'o.firstDecode')

  it('false with zero decodes', () => {
    expect(o.condition(state({ decodesCompleted: 0 }), derived())).toBe(false)
  })
  it('true at the first completed decode', () => {
    expect(o.condition(state({ decodesCompleted: 1 }), derived())).toBe(true)
  })
  it('true with many decodes', () => {
    expect(o.condition(state({ decodesCompleted: 7 }), derived())).toBe(true)
  })
  it('rewards +5 fragments', () => {
    expect(o.reward.fragments).toBe(5)
  })
})

describe('objective: bank 50 fragments', () => {
  const o = byId(OBJECTIVES, 'o.fragments50')

  it('false at 49 fragments', () => {
    expect(o.condition(state({ fragments: 49 }), derived())).toBe(false)
  })
  it('true at exactly 50 fragments', () => {
    expect(o.condition(state({ fragments: 50 }), derived())).toBe(true)
  })
  it('rewards +10% signal', () => {
    expect(o.reward.effects).toEqual([{ kind: 'signalMult', value: 1.1 }])
  })
})

describe('objective: build a reactor', () => {
  const o = byId(OBJECTIVES, 'o.reactor')

  it('false with no reactor', () => {
    expect(o.condition(state({ owned: { antenna: 0, amplifier: 0, decoder: 0, reactor: 0 } }), derived())).toBe(false)
  })
  it('true with one reactor', () => {
    expect(o.condition(state({ owned: { antenna: 0, amplifier: 0, decoder: 0, reactor: 1 } }), derived())).toBe(true)
  })
  it('reveals the tech tree feature', () => {
    expect(o.reward.effects).toEqual([{ kind: 'unlockFeature', id: 'techTree' }])
  })
})

describe('CHALLENGES — shape', () => {
  it('has ~3 challenges with unique ids', () => {
    expect(CHALLENGES.length).toBe(3)
    const ids = CHALLENGES.map((o) => o.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('challenge ids do not collide with objective ids', () => {
    const all = [...OBJECTIVES, ...CHALLENGES].map((o) => o.id)
    expect(new Set(all).size).toBe(all.length)
  })
})

describe('challenge: corrupted decode at high signal rate', () => {
  const c = byId(CHALLENGES, 'c.overdrive')

  it('false when last decode was corrupted but rate < 500', () => {
    const s = state({ session: { decodesThisHour: 0, hourStartMs: 0, lastDecodeType: 'corrupted' } })
    expect(c.condition(s, derived({ signalPerSec: 499 }))).toBe(false)
  })
  it('false when rate >= 500 but last decode was not corrupted', () => {
    const s = state({ session: { decodesThisHour: 0, hourStartMs: 0, lastDecodeType: 'normal' } })
    expect(c.condition(s, derived({ signalPerSec: 600 }))).toBe(false)
  })
  it('false when no decode type recorded yet', () => {
    expect(c.condition(state(), derived({ signalPerSec: 600 }))).toBe(false)
  })
  it('true when corrupted AND rate >= 500', () => {
    const s = state({ session: { decodesThisHour: 0, hourStartMs: 0, lastDecodeType: 'corrupted' } })
    expect(c.condition(s, derived({ signalPerSec: 500 }))).toBe(true)
  })
  it('rewards a permanent +50% signal', () => {
    expect(c.reward.effects).toEqual([{ kind: 'signalMult', value: 1.5 }])
  })
})

describe('challenge: minimalist (100 fragments at <= 4 power)', () => {
  const c = byId(CHALLENGES, 'c.minimalist')

  it('false at 100 fragments but 5 power used', () => {
    expect(c.condition(state({ fragments: 100 }), derived({ powerUsed: 5 }))).toBe(false)
  })
  it('false at 99 fragments even with low power', () => {
    expect(c.condition(state({ fragments: 99 }), derived({ powerUsed: 4 }))).toBe(false)
  })
  it('true at 100 fragments with exactly 4 power', () => {
    expect(c.condition(state({ fragments: 100 }), derived({ powerUsed: 4 }))).toBe(true)
  })
  it('rewards a permanent -20% build cost', () => {
    expect(c.reward.effects).toEqual([{ kind: 'buildCostMult', value: 0.8 }])
  })
})

describe('challenge: burst (10 decodes in one real hour)', () => {
  const c = byId(CHALLENGES, 'c.burst')

  it('false at 9 decodes this hour', () => {
    expect(c.condition(state({ session: { decodesThisHour: 9, hourStartMs: 0 } }), derived())).toBe(false)
  })
  it('true at exactly 10 decodes this hour', () => {
    expect(c.condition(state({ session: { decodesThisHour: 10, hourStartMs: 0 } }), derived())).toBe(true)
  })
  it('rewards a permanent -20% decode time', () => {
    expect(c.reward.effects).toEqual([{ kind: 'decodeTimeMult', value: 0.8 }])
  })
})

describe('newlyCompleted', () => {
  it('returns only defs whose condition is met', () => {
    const s = state({ decodesCompleted: 1, fragments: 10 }) // firstDecode met, fragments50 not
    const got = newlyCompleted(OBJECTIVES, s, derived(), new Set())
    const ids = got.map((o) => o.id)
    expect(ids).toContain('o.firstDecode')
    expect(ids).not.toContain('o.fragments50')
  })

  it('excludes defs already in the completed set', () => {
    const s = state({ decodesCompleted: 1 })
    const got = newlyCompleted(OBJECTIVES, s, derived(), new Set(['o.firstDecode']))
    expect(got.map((o) => o.id)).not.toContain('o.firstDecode')
  })

  it('is idempotent: re-passing the just-fired id yields none of it', () => {
    const s = state({ decodesCompleted: 1 })
    const first = newlyCompleted(OBJECTIVES, s, derived(), new Set())
    expect(first.map((o) => o.id)).toEqual(['o.firstDecode'])
    // simulate the engine adding fired ids to the completed set, then re-evaluating
    const completed = new Set(first.map((o) => o.id))
    const second = newlyCompleted(OBJECTIVES, s, derived(), completed)
    expect(second).toEqual([])
  })

  it('returns [] when nothing qualifies', () => {
    expect(newlyCompleted(OBJECTIVES, state(), derived(), new Set())).toEqual([])
  })

  it('can return multiple met-and-uncompleted defs at once', () => {
    const s = state({ decodesCompleted: 1, fragments: 50 })
    const got = newlyCompleted(OBJECTIVES, s, derived({ signalPerSec: 100 }), new Set())
    const ids = got.map((o) => o.id)
    expect(ids).toEqual(expect.arrayContaining(['o.signal100', 'o.firstDecode', 'o.fragments50']))
    expect(ids.length).toBe(3)
  })

  it('works on the CHALLENGES list with a session-field predicate', () => {
    const s = state({ session: { decodesThisHour: 10, hourStartMs: 0 } })
    const got = newlyCompleted(CHALLENGES, s, derived(), new Set())
    expect(got.map((o) => o.id)).toEqual(['c.burst'])
  })

  it('does not mutate the completed set or the defs', () => {
    const completed = new Set(['o.firstDecode'])
    const snapshot = new Set(completed)
    const defsSnapshot = OBJECTIVES.slice()
    newlyCompleted(OBJECTIVES, state({ decodesCompleted: 1 }), derived(), completed)
    expect(completed).toEqual(snapshot)
    expect(OBJECTIVES).toEqual(defsSnapshot)
  })
})
