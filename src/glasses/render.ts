import type { ReviewState } from './reducer'
import { centerBlock, centerLine, justify } from './layout'

const PAD = 4
const MAX_DOTS = 10

// Container geometry (must match review.ts). Three stacked zones filling 576×288.
export const ZONES = {
  header: { x: 0, y: 0, w: 576, h: 40 },
  body: { x: 0, y: 40, w: 576, h: 208 },
  footer: { x: 0, y: 248, w: 576, h: 40 },
} as const
export const SCREEN = { w: 576, h: 288 }

const innerW = (w: number) => w - 2 * PAD
const innerH = (h: number) => h - 2 * PAD

const BAR_W = innerW(ZONES.header.w)
const BODY_W = innerW(ZONES.body.w)
const BODY_H = innerH(ZONES.body.h)
const SCREEN_W = innerW(SCREEN.w)
const SCREEN_H = innerH(SCREEN.h)

export interface ReviewZones {
  header: string
  body: string
  footer: string
}

/** `●●●○○` — progress, capped at 10 slots. */
export function dots(reviewed: number, total: number): string {
  const slots = Math.min(total, MAX_DOTS)
  const filled = total === 0 ? 0 : Math.round((reviewed / total) * slots)
  return '●'.repeat(filled) + '○'.repeat(slots - filled)
}

export function renderReview(state: ReviewState, deckName: string): ReviewZones {
  const card = state.queue[0]
  const back = state.phase === 'back'
  const text = back ? card.back : card.front
  return {
    header: justify(deckName, `card ${state.reviewed + 1} / ${state.total}`, BAR_W),
    body: centerBlock(text, BODY_W, BODY_H),
    footer: justify(
      dots(state.reviewed, state.total),
      back ? '↓ again  ● good  ↑ easy' : 'swipe to flip',
      BAR_W,
    ),
  }
}

export function renderDone(state: ReviewState): ReviewZones {
  const summary =
    state.total > 0
      ? `Reviewed ${state.reviewed}\nagain ${state.tally.again} · good ${state.tally.good} · easy ${state.tally.easy}`
      : caughtUp(state.nextDueInDays)
  return {
    header: '',
    body: centerBlock(summary, BODY_W, BODY_H),
    footer: centerLine('●● exit', BAR_W),
  }
}

function caughtUp(nextDueInDays: number | null): string {
  if (nextDueInDays === null) return 'All caught up!\nno cards due'
  const unit = nextDueInDays === 1 ? 'day' : 'days'
  return `All caught up!\nnext due in ${nextDueInDays} ${unit}`
}

export function renderWelcome(): string {
  const lines = [
    'Flashcards',
    '',
    'press = flip, then good',
    '↑ easy    ↓ again',
    '●● = exit',
    '',
    'press to begin',
  ].join('\n')
  return centerBlock(lines, SCREEN_W, SCREEN_H)
}
