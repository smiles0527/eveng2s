import type { Card, Grade } from './types'

const Q: Record<Grade, number> = { again: 2, good: 4, easy: 5 }

/**
 * Textbook SuperMemo SM-2 (super-memory.com/english/ol/sm2.htm). Pure: `today`
 * is injected (a local-day index). The interval uses the PRE-update ef; the new
 * ef affects the next review only.
 */
export function schedule(card: Card, grade: Grade, today: number): Card {
  const q = Q[grade]
  let { ef, interval, reps } = card
  if (q < 3) {
    reps = 0
    interval = 1
  } else {
    if (reps === 0) interval = 1
    else if (reps === 1) interval = 6
    else interval = Math.round(interval * ef)
    reps += 1
  }
  ef = Math.max(1.3, ef + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02)))
  return { ...card, ef, interval, reps, due: today + interval }
}

export function newCardState() {
  return { ef: 2.5, interval: 0, reps: 0 }
}
