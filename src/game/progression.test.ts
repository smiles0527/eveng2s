import { describe, it, expect } from 'vitest'
import { advance, startDecode, collect, decodeCapacity, syncSlots } from './progression'
import { DECODES } from './decodes'
import { POWER } from './economy'
import type { GameState, Modifiers, Slot } from './types'

const mods = (over: Partial<Modifiers> = {}): Modifiers => ({
  signalMult: 1,
  decodeTimeMult: 1,
  powerCapAdd: 0,
  buildCostMult: 1,
  unlocked: new Set(),
  parallelDecodes: 0,
  ...over,
})

const state = (over: Partial<GameState> = {}): GameState => ({
  signal: 0,
  fragments: 0,
  owned: { antenna: 0, amplifier: 0, decoder: 1, reactor: 0 },
  slots: [{ status: 'idle' }],
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

const D = DECODES[0] // shortest decode (first-contact, ~60s)

describe('advance — signal accrual', () => {
  it('credits rate * elapsed seconds', () => {
    const s = state({ owned: { antenna: 2, amplifier: 0, decoder: 1, reactor: 0 } }) // 2/s
    const r = advance(s, 10_000, mods())
    expect(r.state.signal).toBeCloseTo(20, 5)
    expect(r.state.lastSeenMs).toBe(10_000)
  })
  it('clamps negative elapsed to zero (clock moved back)', () => {
    const s = state({ signal: 5, lastSeenMs: 1000 })
    const r = advance(s, 500, mods())
    expect(r.state.signal).toBe(5)
    expect(r.state.lastSeenMs).toBe(500)
  })
  it('is idempotent for the same now', () => {
    const s = state({ owned: { antenna: 2, amplifier: 0, decoder: 1, reactor: 0 } })
    const once = advance(s, 10_000, mods()).state
    const twice = advance(once, 10_000, mods()).state
    expect(twice.signal).toBeCloseTo(once.signal, 5)
  })
  it('accrual composes across two advances', () => {
    const s = state({ owned: { antenna: 2, amplifier: 0, decoder: 1, reactor: 0 } })
    const stepped = advance(advance(s, 10_000, mods()).state, 30_000, mods()).state
    const direct = advance(s, 30_000, mods()).state
    expect(stepped.signal).toBeCloseTo(direct.signal, 5)
  })
})

describe('advance — decode completion', () => {
  const running = (endMs: number): Slot => ({ status: 'running', def: D.id, startMs: 0, endMs })

  it('completes a finished decode: banks it, yields fragments, counts it', () => {
    const s = state({ slots: [running(D.durationMs)] })
    const r = advance(s, D.durationMs + 1, mods())
    expect(r.state.slots[0].status).toBe('banked')
    expect(r.state.fragments).toBe(D.fragmentYield)
    expect(r.state.decodesCompleted).toBe(1)
    expect(r.events).toHaveLength(1)
    expect(r.events[0]).toMatchObject({ kind: 'decodeCompleted', def: D.id })
  })

  it('does not complete a decode still running', () => {
    const s = state({ slots: [running(D.durationMs)] })
    const r = advance(s, D.durationMs - 1, mods())
    expect(r.state.slots[0].status).toBe('running')
    expect(r.events).toHaveLength(0)
  })

  it('auto-restarts across a long gap, completing N times', () => {
    const s = state({ signal: 100_000, slots: [running(D.durationMs)] })
    const gap = D.durationMs * 3 + 10_000
    const r = advance(s, gap, mods({ unlocked: new Set(['autoRestart']) }))
    expect(r.state.decodesCompleted).toBe(3)
    expect(r.events).toHaveLength(3)
    expect(r.state.slots[0].status).toBe('running') // restarted, still cooking
  })
})

describe('startDecode', () => {
  it('fills an idle slot, deducts signal cost, sets running', () => {
    const s = state({ signal: 10_000, slots: [{ status: 'idle' }] })
    const r = startDecode(s, D.id, 0, mods())
    expect(r.slots[0]).toMatchObject({ status: 'running', def: D.id, endMs: D.durationMs })
    expect(r.signal).toBe(10_000 - D.signalCost)
  })
  it('returns the same state when there is no idle slot', () => {
    const s = state({ signal: 10_000, slots: [{ status: 'running', def: D.id, startMs: 0, endMs: D.durationMs }] })
    expect(startDecode(s, D.id, 0, mods())).toBe(s)
  })
  it('returns the same state when there is no power headroom', () => {
    // owned.decoder 1 but reactor cap consumed by buildings: force headroom < POWER.decoder
    const s = state({ signal: 10_000, owned: { antenna: 5, amplifier: 0, decoder: 1, reactor: 0 }, slots: [{ status: 'idle' }] })
    // cap 5, used 5 (antennas) -> headroom 0 < POWER.decoder
    expect(POWER.decoder).toBeGreaterThan(0)
    expect(startDecode(s, D.id, 0, mods())).toBe(s)
  })
  it('returns the same state for an unknown decode id', () => {
    const s = state({ signal: 10_000 })
    expect(startDecode(s, 'nope', 0, mods())).toBe(s)
  })
})

describe('collect', () => {
  it('frees a banked slot to idle', () => {
    const s = state({ slots: [{ status: 'banked', def: D.id, finishedMs: 100 }] })
    expect(collect(s, 0).slots[0].status).toBe('idle')
  })
  it('is a no-op for a non-banked slot', () => {
    const s = state({ slots: [{ status: 'idle' }] })
    expect(collect(s, 0)).toBe(s)
  })
})

describe('capacity & syncSlots', () => {
  it('capacity = owned decoders + parallel tech', () => {
    const s = state({ owned: { antenna: 0, amplifier: 0, decoder: 2, reactor: 0 } })
    expect(decodeCapacity(s, mods({ parallelDecodes: 1 }))).toBe(3)
  })
  it('pads slots up to capacity with idle', () => {
    const s = state({ owned: { antenna: 0, amplifier: 0, decoder: 3, reactor: 0 }, slots: [{ status: 'idle' }] })
    const r = syncSlots(s, mods())
    expect(r.slots).toHaveLength(3)
    expect(r.slots.every((x) => x.status === 'idle')).toBe(true)
  })
})
