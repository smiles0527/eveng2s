import type { Card, Grade } from '../core/types'
import { schedule } from '../core/scheduler'

export type Phase = 'loading' | 'welcome' | 'front' | 'back' | 'done'

export interface ReviewState {
  phase: Phase
  queue: Card[] // current card is queue[0]
  total: number // due cards at session start
  reviewed: number
  tally: { again: number; good: number; easy: number }
  nextDueInDays: number | null // for the caught-up screen (total === 0)
}

export type ReviewEvent =
  | { type: 'loaded'; due: Card[]; nextDueInDays: number | null; showWelcome?: boolean }
  | { type: 'dismissWelcome' }
  | { type: 'flip' }
  | { type: 'grade'; grade: Grade }
  | { type: 'exit' }
  | { type: 'lifecycle'; kind: 'foregroundEnter' | 'foregroundExit' | 'systemExit' | 'abnormalExit' }

export type Effect =
  | { type: 'persist'; card: Card }
  | { type: 'markOnboarded' }
  | { type: 'exitDialog' }
  | { type: 'cleanup' }

export interface ReduceResult {
  state: ReviewState
  effects: Effect[]
}

export const initialState: ReviewState = {
  phase: 'loading',
  queue: [],
  total: 0,
  reviewed: 0,
  tally: { again: 0, good: 0, easy: 0 },
  nextDueInDays: null,
}

export function reduce(state: ReviewState, event: ReviewEvent, today: number): ReduceResult {
  switch (event.type) {
    case 'loaded': {
      const base: ReviewState = {
        ...initialState,
        queue: event.due,
        total: event.due.length,
        nextDueInDays: event.nextDueInDays,
      }
      const afterWelcome: Phase = event.due.length > 0 ? 'front' : 'done'
      return {
        state: { ...base, phase: event.showWelcome ? 'welcome' : afterWelcome },
        effects: [],
      }
    }

    case 'dismissWelcome':
      return state.phase === 'welcome'
        ? {
            state: { ...state, phase: state.queue.length > 0 ? 'front' : 'done' },
            effects: [{ type: 'markOnboarded' }],
          }
        : { state, effects: [] }

    case 'flip':
      return state.phase === 'front'
        ? { state: { ...state, phase: 'back' }, effects: [] }
        : { state, effects: [] }

    case 'grade': {
      if (state.phase !== 'back') return { state, effects: [] }
      const current = state.queue[0]
      const scheduled = schedule(current, event.grade, today)
      const rest = state.queue.slice(1)
      const next: ReviewState = {
        ...state,
        queue: rest,
        reviewed: state.reviewed + 1,
        tally: { ...state.tally, [event.grade]: state.tally[event.grade] + 1 },
        phase: rest.length === 0 ? 'done' : 'front',
      }
      return { state: next, effects: [{ type: 'persist', card: scheduled }] }
    }

    case 'exit':
      return { state, effects: [{ type: 'exitDialog' }] }

    case 'lifecycle':
      return event.kind === 'systemExit' || event.kind === 'abnormalExit'
        ? { state, effects: [{ type: 'cleanup' }] }
        : { state, effects: [] }
  }
}
