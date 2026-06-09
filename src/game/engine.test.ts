import { describe, it, expect } from 'vitest'
import { tick, newGame, computeMods, derive } from './engine'
import type { GameState } from './types'

describe('newGame', () => {
  it('starts with one decoder + idle slot, lastSeenMs = now', () => {
    const g = newGame(1000)
    expect(g.owned.decoder).toBe(1)
    expect(g.slots).toEqual([{ status: 'idle' }])
    expect(g.lastSeenMs).toBe(1000)
  })
})

describe('tick — accrual', () => {
  it('credits signal over elapsed time', () => {
    const g: GameState = { ...newGame(0), owned: { antenna: 2, amplifier: 0, decoder: 1, reactor: 0 } }
    const r = tick(g, 10_000)
    expect(r.state.signal).toBeCloseTo(20, 5)
  })
})

describe('tick — objectives, rewards, beats', () => {
  it('fires the first-decode objective (credits fragments) and surfaces the first beat', () => {
    const g: GameState = { ...newGame(0), decodesCompleted: 1 }
    const r = tick(g, 0) // no time passes
    expect(r.completed.length).toBeGreaterThanOrEqual(1)
    expect(r.state.fragments).toBe(5) // o.firstDecode reward
    expect(r.beats.some((b) => b.id === 'first-contact')).toBe(true)
    expect(r.state.completedObjectives.length).toBeGreaterThanOrEqual(1)
  })

  it('is idempotent: a second tick re-completes nothing', () => {
    const g: GameState = { ...newGame(0), decodesCompleted: 1 }
    const once = tick(g, 0).state
    const r2 = tick(once, 0)
    expect(r2.completed).toHaveLength(0)
    expect(r2.state.fragments).toBe(once.fragments)
  })

  it('an objective reward effect becomes active in mods (10 antennas → unlock amplifier)', () => {
    const g: GameState = { ...newGame(0), owned: { antenna: 10, amplifier: 0, decoder: 1, reactor: 0 } }
    const r = tick(g, 0)
    expect(r.mods.unlocked.has('amplifier')).toBe(true)
  })
})

describe('computeMods / derive', () => {
  it('derive reports signalPerSec/powerCap/powerUsed', () => {
    const g: GameState = { ...newGame(0), owned: { antenna: 3, amplifier: 0, decoder: 1, reactor: 0 } }
    const d = derive(g, computeMods(g))
    expect(d.signalPerSec).toBeCloseTo(3, 5)
    expect(d.powerCap).toBe(5)
  })
})
