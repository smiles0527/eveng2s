import { describe, it, expect } from 'vitest'
import { dots, renderReview, renderDone, renderWelcome } from './render'
import { findUnsupported } from '../core/glyphs'
import { initialState, type ReviewState } from './reducer'
import type { Card } from '../core/types'

const card = (over: Partial<Card> = {}): Card => ({
  id: 'c',
  front: 'Q?',
  back: 'A!',
  ef: 2.5,
  interval: 0,
  reps: 0,
  due: 0,
  ...over,
})

const reviewState = (over: Partial<ReviewState> = {}): ReviewState => ({
  ...initialState,
  phase: 'front',
  queue: [card()],
  total: 5,
  reviewed: 0,
  ...over,
})

describe('dots', () => {
  it('renders filled/open progress dots', () => {
    expect(dots(3, 5)).toBe('●●●○○')
  })
  it('caps at 10 slots', () => {
    expect(dots(12, 12)).toBe('●●●●●●●●●●')
  })
})

describe('renderReview', () => {
  it('front: header has deck + counter, body has the front, footer has flip hint', () => {
    const z = renderReview(reviewState({ phase: 'front', queue: [card({ front: 'capital of Peru' })] }), 'Geo')
    expect(z.header).toContain('Geo')
    expect(z.header).toContain('card 1 / 5')
    expect(z.body).toContain('capital of Peru')
    expect(z.footer).toContain('swipe to flip')
    expect(z.footer).toContain('○') // progress dots present
  })

  it('back: footer shows the grade hints and body shows the back', () => {
    const z = renderReview(reviewState({ phase: 'back', queue: [card({ back: 'Lima' })] }), 'Geo')
    expect(z.body).toContain('Lima')
    expect(z.footer).toContain('again')
    expect(z.footer).toContain('good')
    expect(z.footer).toContain('easy')
  })
})

describe('renderDone', () => {
  it('summarizes a finished session', () => {
    const z = renderDone(reviewState({ phase: 'done', reviewed: 5, tally: { again: 1, good: 3, easy: 1 } }))
    expect(z.body).toContain('Reviewed 5')
    expect(z.footer).toContain('exit')
  })
  it('shows caught-up when nothing was due', () => {
    const z = renderDone(reviewState({ phase: 'done', total: 0, queue: [], nextDueInDays: 3 }))
    expect(z.body).toContain('caught up')
  })
})

describe('renderWelcome', () => {
  it('shows the title, controls, and a start prompt', () => {
    const w = renderWelcome()
    expect(w).toContain('Flashcards')
    expect(w).toContain('begin')
    expect(w.toLowerCase()).toContain('easy')
  })
})

describe('all rendered output is glyph-safe', () => {
  it('uses only firmware-supported characters', () => {
    const front = renderReview(reviewState({ phase: 'front' }), 'Demo')
    const back = renderReview(reviewState({ phase: 'back' }), 'Demo')
    const done = renderDone(reviewState({ phase: 'done', reviewed: 5, tally: { again: 1, good: 3, easy: 1 } }))
    const strings = [
      ...Object.values(front),
      ...Object.values(back),
      ...Object.values(done),
      renderWelcome(),
      dots(3, 5),
    ]
    for (const s of strings) expect(findUnsupported(s)).toEqual([])
  })
})
