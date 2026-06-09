import { describe, it, expect } from 'vitest'
import { reduce, initialUi, VIEWS } from './reducer'
import { newGame } from './engine'
import type { GameState } from './types'

const ui = (over: Partial<GameState> = {}) => initialUi({ ...newGame(0), ...over })

describe('navigation (browsing)', () => {
  it('swipe cycles views and wraps', () => {
    const r = reduce(ui(), { type: 'navDown' })
    expect(r.state.view).toBe('build')
    expect(r.effects).toContainEqual({ type: 'rebuild' })
    expect(reduce(ui(), { type: 'navUp' }).state.view).toBe('objectives') // wrap
  })
  it('select on a list view focuses it; status select is a no-op', () => {
    expect(reduce({ ...ui(), view: 'build' }, { type: 'select' }).state.focused).toBe(true)
    const s = reduce(ui(), { type: 'select' })
    expect(s.state.focused).toBe(false)
  })
})

describe('navigation (focused)', () => {
  it('swipe moves the cursor with wrap', () => {
    const focused = { ...ui(), view: 'build' as const, focused: true, cursor: 0 }
    expect(reduce(focused, { type: 'navDown' }).state.cursor).toBe(1)
    expect(reduce(focused, { type: 'navUp' }).state.cursor).toBe(3) // wrap (4 buildings)
  })
  it('back un-focuses; back while browsing requests exit', () => {
    const focused = { ...ui(), view: 'build' as const, focused: true, cursor: 2 }
    expect(reduce(focused, { type: 'back' }).state.focused).toBe(false)
    expect(reduce(ui(), { type: 'back' }).effects).toContainEqual({ type: 'exitDialog' })
  })
})

describe('actions', () => {
  it('select while focused on build buys the cursored building', () => {
    // newGame starts with 1 antenna; the 2nd costs round(15 * 1.15) = 17.
    const g = { ...ui({ signal: 100 }), view: 'build' as const, focused: true, cursor: 0 }
    const r = reduce(g, { type: 'select' })
    expect(r.state.game.owned.antenna).toBe(2)
    expect(r.state.game.signal).toBe(83)
    expect(r.effects).toContainEqual({ type: 'persist' })
  })
  it('an unaffordable buy is a no-op (no effects)', () => {
    const g = { ...ui({ signal: 0 }), view: 'build' as const, focused: true, cursor: 0 }
    const r = reduce(g, { type: 'select' })
    expect(r.state.game.owned.antenna).toBe(1) // unchanged (started with 1)
    expect(r.effects).toEqual([])
  })
})

describe('story beats are modal', () => {
  it('a pending beat captures input; select acknowledges and marks it seen', () => {
    const g = ui({ decodesCompleted: 1 }) // first-contact beat trigger
    const ticked = reduce(g, { type: 'tick', now: 0 })
    expect(ticked.state.beats.length).toBeGreaterThanOrEqual(1)
    const beatId = ticked.state.beats[0].id
    // swipes ignored under the modal
    expect(reduce(ticked.state, { type: 'navDown' }).state).toEqual(ticked.state)
    // select pops + marks seen
    const ack = reduce(ticked.state, { type: 'select' })
    expect(ack.state.game.seenBeats).toContain(beatId)
    expect(ack.state.beats.length).toBe(ticked.state.beats.length - 1)
  })
})

describe('tick + lifecycle', () => {
  it('tick advances the simulation and persists', () => {
    const g = { ...ui(), game: { ...newGame(0), owned: { antenna: 2, amplifier: 0, decoder: 1, reactor: 0 } } }
    const r = reduce(g, { type: 'tick', now: 10_000 })
    expect(r.state.game.signal).toBeCloseTo(20, 5)
    expect(r.effects).toContainEqual({ type: 'persist' })
  })
  it('foregroundExit persists now; systemExit cleans up', () => {
    expect(reduce(ui(), { type: 'lifecycle', kind: 'foregroundExit', now: 0 }).effects).toContainEqual({ type: 'persistNow' })
    expect(reduce(ui(), { type: 'lifecycle', kind: 'systemExit', now: 0 }).effects).toContainEqual({ type: 'cleanup' })
  })
})

describe('VIEWS', () => {
  it('has the five views in order', () => {
    expect(VIEWS).toEqual(['status', 'build', 'tech', 'decode', 'objectives'])
  })
})
