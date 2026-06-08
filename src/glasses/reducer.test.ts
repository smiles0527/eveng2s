import { describe, it, expect } from 'vitest'
import { reduce, initialState } from './reducer'
import type { Card } from '../core/types'

const card = (id: string): Card => ({
  id,
  front: `${id}-f`,
  back: `${id}-b`,
  ef: 2.5,
  interval: 0,
  reps: 0,
  due: 0,
})

const TODAY = 100

describe('loaded', () => {
  it('enters front with a queue when cards are due', () => {
    const { state } = reduce(initialState, { type: 'loaded', due: [card('a'), card('b')], nextDueInDays: null }, TODAY)
    expect(state.phase).toBe('front')
    expect(state.queue).toHaveLength(2)
    expect(state.total).toBe(2)
    expect(state.reviewed).toBe(0)
  })

  it('enters done with nextDueInDays when nothing is due', () => {
    const { state } = reduce(initialState, { type: 'loaded', due: [], nextDueInDays: 5 }, TODAY)
    expect(state.phase).toBe('done')
    expect(state.total).toBe(0)
    expect(state.nextDueInDays).toBe(5)
  })
})

describe('flip', () => {
  it('moves front → back', () => {
    const front = reduce(initialState, { type: 'loaded', due: [card('a')], nextDueInDays: null }, TODAY).state
    expect(reduce(front, { type: 'flip' }, TODAY).state.phase).toBe('back')
  })
  it('is ignored when not on the front', () => {
    const back = { ...initialState, phase: 'back' as const }
    expect(reduce(back, { type: 'flip' }, TODAY).state).toEqual(back)
  })
})

describe('grade', () => {
  const back = (cards: Card[]) => ({
    phase: 'back' as const,
    queue: cards,
    total: cards.length,
    reviewed: 0,
    tally: { again: 0, good: 0, easy: 0 },
    nextDueInDays: null,
  })

  it('advances to the next card, counts the grade, and persists the scheduled card', () => {
    const { state, effects } = reduce(back([card('a'), card('b')]), { type: 'grade', grade: 'good' }, TODAY)
    expect(state.phase).toBe('front')
    expect(state.queue.map((c) => c.id)).toEqual(['b'])
    expect(state.reviewed).toBe(1)
    expect(state.tally.good).toBe(1)
    expect(effects).toHaveLength(1)
    expect(effects[0]).toMatchObject({ type: 'persist' })
    if (effects[0].type === 'persist') {
      expect(effects[0].card.id).toBe('a')
      expect(effects[0].card.due).toBe(TODAY + 1) // fresh card, good → interval 1
    }
  })

  it('finishes to done after the last card, preserving total', () => {
    const { state } = reduce(back([card('a')]), { type: 'grade', grade: 'again' }, TODAY)
    expect(state.phase).toBe('done')
    expect(state.total).toBe(1)
    expect(state.reviewed).toBe(1)
    expect(state.tally.again).toBe(1)
  })

  it('is ignored on the front', () => {
    const front = { ...initialState, phase: 'front' as const, queue: [card('a')], total: 1 }
    const { state, effects } = reduce(front, { type: 'grade', grade: 'good' }, TODAY)
    expect(state).toEqual(front)
    expect(effects).toEqual([])
  })
})

describe('welcome (first run)', () => {
  it('loaded with showWelcome enters the welcome phase, keeping the queue', () => {
    const { state } = reduce(
      initialState,
      { type: 'loaded', due: [card('a')], nextDueInDays: null, showWelcome: true },
      TODAY,
    )
    expect(state.phase).toBe('welcome')
    expect(state.queue).toHaveLength(1)
    expect(state.total).toBe(1)
  })

  it('dismissWelcome with a queue goes to front and marks onboarded', () => {
    const welcome = reduce(
      initialState,
      { type: 'loaded', due: [card('a')], nextDueInDays: null, showWelcome: true },
      TODAY,
    ).state
    const { state, effects } = reduce(welcome, { type: 'dismissWelcome' }, TODAY)
    expect(state.phase).toBe('front')
    expect(effects).toEqual([{ type: 'markOnboarded' }])
  })

  it('dismissWelcome with no due cards goes to done', () => {
    const welcome = reduce(
      initialState,
      { type: 'loaded', due: [], nextDueInDays: 4, showWelcome: true },
      TODAY,
    ).state
    expect(welcome.phase).toBe('welcome')
    const { state } = reduce(welcome, { type: 'dismissWelcome' }, TODAY)
    expect(state.phase).toBe('done')
  })

  it('dismissWelcome is ignored when not on the welcome screen', () => {
    const { state, effects } = reduce(initialState, { type: 'dismissWelcome' }, TODAY)
    expect(state).toEqual(initialState)
    expect(effects).toEqual([])
  })
})

describe('exit & lifecycle', () => {
  it('exit emits an exitDialog effect without changing state', () => {
    const { state, effects } = reduce(initialState, { type: 'exit' }, TODAY)
    expect(state).toEqual(initialState)
    expect(effects).toEqual([{ type: 'exitDialog' }])
  })
  it('system/abnormal exit emit cleanup', () => {
    expect(reduce(initialState, { type: 'lifecycle', kind: 'systemExit' }, TODAY).effects).toEqual([{ type: 'cleanup' }])
    expect(reduce(initialState, { type: 'lifecycle', kind: 'abnormalExit' }, TODAY).effects).toEqual([{ type: 'cleanup' }])
  })
  it('foreground enter/exit emit no effects', () => {
    expect(reduce(initialState, { type: 'lifecycle', kind: 'foregroundEnter' }, TODAY).effects).toEqual([])
  })
})
