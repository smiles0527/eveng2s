import { describe, it, expect } from 'vitest'
import { schedule, newCardState } from './scheduler'
import type { Card } from './types'

const card = (over: Partial<Card> = {}): Card => ({
  id: 'c1',
  front: 'f',
  back: 'b',
  ef: 2.5,
  interval: 0,
  reps: 0,
  due: 0,
  ...over,
})

describe('newCardState', () => {
  it('starts at ef 2.5, interval 0, reps 0', () => {
    expect(newCardState()).toEqual({ ef: 2.5, interval: 0, reps: 0 })
  })
})

describe('schedule — again (q=2)', () => {
  it('resets reps to 0 and interval to 1', () => {
    const r = schedule(card({ interval: 20, reps: 5 }), 'again', 100)
    expect(r.reps).toBe(0)
    expect(r.interval).toBe(1)
  })

  it('still lowers ef (by 0.32)', () => {
    const r = schedule(card({ ef: 2.5 }), 'again', 100)
    expect(r.ef).toBeCloseTo(2.18, 5)
  })

  it('floors ef at 1.3 under repeated again', () => {
    const r = schedule(card({ ef: 1.5 }), 'again', 0)
    expect(r.ef).toBe(1.3)
  })
})

describe('schedule — good (q=4) interval progression', () => {
  it('first good → interval 1', () => {
    expect(schedule(card(), 'good', 0).interval).toBe(1)
  })
  it('second good → interval 6', () => {
    expect(schedule(card({ reps: 1, interval: 1 }), 'good', 0).interval).toBe(6)
  })
  it('third good → round(interval * ef)', () => {
    expect(schedule(card({ reps: 2, interval: 6, ef: 2.5 }), 'good', 0).interval).toBe(15)
  })
  it('leaves ef unchanged (q=4 delta is 0)', () => {
    expect(schedule(card({ ef: 2.5 }), 'good', 0).ef).toBeCloseTo(2.5, 5)
  })
  it('three goods from fresh chain to interval 1 → 6 → 15', () => {
    let c = card()
    c = schedule(c, 'good', 0)
    c = schedule(c, 'good', 0)
    c = schedule(c, 'good', 0)
    expect(c.interval).toBe(15)
  })
})

describe('schedule — easy (q=5)', () => {
  it('raises ef above 2.5', () => {
    expect(schedule(card({ ef: 2.5 }), 'easy', 0).ef).toBeCloseTo(2.6, 5)
  })
  it('computes this interval with the PRE-update ef, not the new one', () => {
    // reps 2 → interval = round(10 * ef). easy pushes ef 2.5→2.6, but THIS
    // interval must use 2.5: round(10*2.5)=25, not round(10*2.6)=26.
    const r = schedule(card({ reps: 2, interval: 10, ef: 2.5 }), 'easy', 0)
    expect(r.interval).toBe(25)
    expect(r.ef).toBeCloseTo(2.6, 5)
  })
})

describe('schedule — due date', () => {
  it('sets due = today + interval', () => {
    const r = schedule(card({ reps: 2, interval: 6, ef: 2.5 }), 'good', 100)
    expect(r.due).toBe(115)
  })
})

describe('schedule — purity', () => {
  it('does not mutate the input card', () => {
    const c = card({ interval: 6, reps: 2 })
    const snapshot = { ...c }
    schedule(c, 'good', 50)
    expect(c).toEqual(snapshot)
  })
})
