import { describe, it, expect } from 'vitest'
import { createInputGate } from './input-gate'

describe('input gate (quiescence debounce)', () => {
  it('accepts the first event', () => {
    const g = createInputGate(250)
    expect(g.accept(0)).toBe(true)
  })

  it('collapses a burst to a single action', () => {
    const g = createInputGate(250)
    expect(g.accept(0)).toBe(true) // first of burst
    expect(g.accept(40)).toBe(false) // momentum events...
    expect(g.accept(80)).toBe(false)
    expect(g.accept(120)).toBe(false)
  })

  it('keeps rejecting while the burst keeps the lock extended', () => {
    const g = createInputGate(250)
    g.accept(0)
    g.accept(200) // extends lock to 450
    expect(g.accept(400)).toBe(false) // still < 450 because the burst extended it
  })

  it('accepts again after a quiet gap', () => {
    const g = createInputGate(250)
    g.accept(0)
    g.accept(100) // extends to 350
    expect(g.accept(700)).toBe(true) // 700 > 350, quiet elapsed
  })
})
