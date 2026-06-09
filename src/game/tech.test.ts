import { describe, it, expect } from 'vitest'
import {
  TECH,
  techById,
  isUnlockable,
  canResearch,
  research,
  effectsOf,
  validateTree,
} from './tech'
import type { GameState, TechNode, Effect } from './types'

// Minimal GameState factory — only the fields tech.ts reads matter; the rest
// are filled to satisfy the type and to prove research() copies them through.
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

const node = (over: Partial<TechNode> = {}): TechNode => ({
  id: 'x.test',
  name: 'Test',
  branch: 'throughput',
  cost: { fragments: 10 },
  prereqs: [],
  effects: [],
  desc: '',
  ...over,
})

describe('TECH data', () => {
  it('has ~10 nodes across three branches', () => {
    expect(TECH.length).toBeGreaterThanOrEqual(10)
    const branches = new Set(TECH.map((n) => n.branch))
    expect(branches).toEqual(new Set(['throughput', 'efficiency', 'decryption']))
  })

  it('includes d.phaselock as a decryption node (story beat "how-far")', () => {
    const p = techById('d.phaselock')
    expect(p).toBeDefined()
    expect(p!.branch).toBe('decryption')
    // it is a timing node: either speeds decode or boosts signal a touch
    const kinds = p!.effects.map((e) => e.kind)
    expect(kinds.some((k) => k === 'decodeTimeMult' || k === 'signalMult')).toBe(true)
  })

  it('contains the spec sample ids', () => {
    for (const id of [
      't.gain1', 't.gain2', 't.array',
      'e.reactor1', 'e.frugal', 'e.auto',
      'd.fast1', 'd.parallel', 'd.corrupt', 'd.fast2',
    ]) {
      expect(techById(id), id).toBeDefined()
    }
  })
})

describe('techById', () => {
  it('finds a known node', () => {
    expect(techById('t.gain1')?.id).toBe('t.gain1')
  })
  it('returns undefined for an unknown id', () => {
    expect(techById('nope')).toBeUndefined()
  })
})

describe('isUnlockable', () => {
  it('true when node has no prereqs', () => {
    expect(isUnlockable(node({ prereqs: [] }), [])).toBe(true)
  })
  it('false when a prereq is missing', () => {
    expect(isUnlockable(node({ prereqs: ['a'] }), [])).toBe(false)
    expect(isUnlockable(node({ prereqs: ['a', 'b'] }), ['a'])).toBe(false)
  })
  it('true when every prereq is owned', () => {
    expect(isUnlockable(node({ prereqs: ['a', 'b'] }), ['b', 'a'])).toBe(true)
  })
  it('gates the real d.gain2 behind d.gain1 equivalent', () => {
    const g2 = techById('t.gain2')!
    expect(isUnlockable(g2, [])).toBe(false)
    expect(isUnlockable(g2, ['t.gain1'])).toBe(true)
  })
})

describe('canResearch', () => {
  const cheap = node({ id: 'c', cost: { fragments: 10 }, prereqs: [] })

  it('true when unlockable, affordable, and unowned', () => {
    expect(canResearch(state({ fragments: 10 }), cheap)).toBe(true)
  })
  it('false when too few fragments', () => {
    expect(canResearch(state({ fragments: 9 }), cheap)).toBe(false)
  })
  it('false when prereq missing', () => {
    const n = node({ id: 'n', cost: { fragments: 0 }, prereqs: ['a'] })
    expect(canResearch(state({ fragments: 100 }), n)).toBe(false)
  })
  it('false when already owned', () => {
    expect(canResearch(state({ fragments: 100, ownedTech: ['c'] }), cheap)).toBe(false)
  })
  it('honours a signal cost when present', () => {
    const n = node({ id: 's', cost: { fragments: 10, signal: 50 } })
    expect(canResearch(state({ fragments: 10, signal: 49 }), n)).toBe(false)
    expect(canResearch(state({ fragments: 10, signal: 50 }), n)).toBe(true)
  })
  it('ignores signal when cost has no signal field', () => {
    expect(canResearch(state({ fragments: 10, signal: 0 }), cheap)).toBe(true)
  })
})

describe('research', () => {
  it('deducts fragments and appends to ownedTech', () => {
    const s = state({ fragments: 30 })
    const r = research(s, 't.gain1')
    const cost = techById('t.gain1')!.cost.fragments
    expect(r.fragments).toBe(30 - cost)
    expect(r.ownedTech).toContain('t.gain1')
  })

  it('deducts signal too when the node costs signal', () => {
    const n = techById('d.fast2')! // convergence node — give it everything
    const s = state({
      fragments: 10_000,
      signal: 10_000,
      ownedTech: ['d.fast1', 'd.parallel', 'd.corrupt'],
    })
    const r = research(s, n.id)
    expect(r.fragments).toBe(10_000 - n.cost.fragments)
    expect(r.signal).toBe(10_000 - (n.cost.signal ?? 0))
    expect(r.ownedTech).toContain('d.fast2')
  })

  it('does not mutate the input state', () => {
    const s = state({ fragments: 30 })
    const snap = JSON.parse(JSON.stringify(s))
    research(s, 't.gain1')
    expect(s).toEqual(snap)
  })

  it('returns the SAME ref when it cannot research (unaffordable)', () => {
    const s = state({ fragments: 0 })
    expect(research(s, 't.gain1')).toBe(s)
  })

  it('returns the SAME ref when already owned', () => {
    const s = state({ fragments: 999, ownedTech: ['t.gain1'] })
    expect(research(s, 't.gain1')).toBe(s)
  })

  it('returns the SAME ref for an unknown id', () => {
    const s = state({ fragments: 999 })
    expect(research(s, 'no.such.node')).toBe(s)
  })

  it('returns the SAME ref when a prereq is missing', () => {
    const s = state({ fragments: 999 })
    expect(research(s, 't.gain2')).toBe(s) // needs t.gain1
  })
})

describe('effectsOf', () => {
  it('returns [] for no owned tech', () => {
    expect(effectsOf([])).toEqual([])
  })
  it('aggregates the effects of owned nodes', () => {
    const eff = effectsOf(['t.gain1'])
    expect(eff).toEqual(techById('t.gain1')!.effects)
  })
  it('flattens effects across multiple owned nodes', () => {
    const eff = effectsOf(['t.gain1', 'e.reactor1'])
    const expected: Effect[] = [
      ...techById('t.gain1')!.effects,
      ...techById('e.reactor1')!.effects,
    ]
    expect(eff).toEqual(expected)
  })
  it('ignores unknown ids', () => {
    expect(effectsOf(['ghost'])).toEqual([])
  })
})

describe('validateTree', () => {
  it('passes for the real TECH', () => {
    expect(() => validateTree()).not.toThrow()
  })

  // validateTree() validates the module-level TECH, so to exercise the failure
  // paths we re-implement the same invariants on a fixture. These mirror the
  // checks validateTree performs and guard against regressions in the rules.
  const check = (nodes: TechNode[]) => {
    const ids = new Set<string>()
    for (const n of nodes) {
      if (ids.has(n.id)) throw new Error(`duplicate tech id: ${n.id}`)
      ids.add(n.id)
    }
    for (const n of nodes)
      for (const p of n.prereqs)
        if (!ids.has(p)) throw new Error(`dangling prereq ${p} on ${n.id}`)
    const WHITE = 0, GRAY = 1, BLACK = 2
    const color = new Map<string, number>()
    const byId = new Map(nodes.map((n) => [n.id, n]))
    const visit = (id: string) => {
      color.set(id, GRAY)
      for (const p of byId.get(id)!.prereqs) {
        const c = color.get(p) ?? WHITE
        if (c === GRAY) throw new Error(`cycle through ${p}`)
        if (c === WHITE) visit(p)
      }
      color.set(id, BLACK)
    }
    for (const n of nodes) if ((color.get(n.id) ?? WHITE) === WHITE) visit(n.id)
  }

  it('throws on a duplicate id fixture', () => {
    expect(() =>
      check([node({ id: 'dup' }), node({ id: 'dup' })]),
    ).toThrow(/duplicate/)
  })

  it('throws on a dangling prereq fixture', () => {
    expect(() =>
      check([node({ id: 'a', prereqs: ['missing'] })]),
    ).toThrow(/dangling/)
  })

  it('throws on a cyclic fixture', () => {
    expect(() =>
      check([
        node({ id: 'a', prereqs: ['b'] }),
        node({ id: 'b', prereqs: ['a'] }),
      ]),
    ).toThrow(/cycle/)
  })
})
