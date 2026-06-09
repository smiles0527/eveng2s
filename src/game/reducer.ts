import type { GameState, StoryBeat } from './types'
import { tick, computeMods } from './engine'
import { buy } from './economy'
import { research } from './tech'
import { startDecode, syncSlots } from './progression'
import { BUILDINGS, availableTech, availableDecodes } from './selectors'

export type View = 'status' | 'build' | 'tech' | 'decode' | 'objectives'
export const VIEWS: View[] = ['status', 'build', 'tech', 'decode', 'objectives']

export interface UiState {
  game: GameState
  view: View
  focused: boolean // false: swipes cycle views; true: swipes move the cursor
  cursor: number
  beats: StoryBeat[] // modal queue; beats[0] is shown when non-empty
}

export type UiEvent =
  | { type: 'tick'; now: number }
  | { type: 'navUp' }
  | { type: 'navDown' }
  | { type: 'select' }
  | { type: 'back' }
  | { type: 'lifecycle'; kind: 'foregroundEnter' | 'foregroundExit' | 'systemExit' | 'abnormalExit'; now: number }

export type UiEffect =
  | { type: 'persist' }
  | { type: 'persistNow' }
  | { type: 'exitDialog' }
  | { type: 'rebuild' }
  | { type: 'cleanup' }

export interface ReduceResult {
  state: UiState
  effects: UiEffect[]
}

export function initialUi(game: GameState): UiState {
  return { game, view: 'status', focused: false, cursor: 0, beats: [] }
}

/** Length of the focusable list for a view (0 = nothing to focus/act on). */
export function listLen(view: View, game: GameState): number {
  switch (view) {
    case 'build':
      return BUILDINGS.length
    case 'tech':
      return availableTech(game).length
    case 'decode':
      return availableDecodes(game, computeMods(game)).length
    default:
      return 0 // status / objectives: display-only
  }
}

function applyTick(ui: UiState, now: number): UiState {
  const r = tick(ui.game, now)
  const beats = ui.beats.length === 0 && r.beats.length ? r.beats : ui.beats
  return { ...ui, game: r.state, beats }
}

export function reduce(ui: UiState, ev: UiEvent): ReduceResult {
  // A story beat is modal: it captures input until acknowledged.
  if (ui.beats.length > 0) {
    if (ev.type === 'tick') return { state: applyTick(ui, ev.now), effects: [{ type: 'persist' }] }
    if (ev.type === 'lifecycle') return lifecycle(ui, ev)
    if (ev.type === 'select' || ev.type === 'back') {
      const [shown, ...rest] = ui.beats
      const game = { ...ui.game, seenBeats: [...ui.game.seenBeats, shown.id] }
      return { state: { ...ui, game, beats: rest }, effects: [{ type: 'persist' }, { type: 'rebuild' }] }
    }
    return { state: ui, effects: [] } // swipes ignored under the modal
  }

  switch (ev.type) {
    case 'tick':
      return { state: applyTick(ui, ev.now), effects: [{ type: 'persist' }] }

    case 'navUp':
    case 'navDown': {
      const delta = ev.type === 'navDown' ? 1 : -1
      if (ui.focused) {
        const len = listLen(ui.view, ui.game)
        if (len === 0) return { state: ui, effects: [] }
        return { state: { ...ui, cursor: (ui.cursor + delta + len) % len }, effects: [] }
      }
      const i = VIEWS.indexOf(ui.view)
      const view = VIEWS[(i + delta + VIEWS.length) % VIEWS.length]
      return { state: { ...ui, view, focused: false, cursor: 0 }, effects: [{ type: 'rebuild' }] }
    }

    case 'select': {
      if (!ui.focused) {
        if (listLen(ui.view, ui.game) === 0) return { state: ui, effects: [] }
        return { state: { ...ui, focused: true, cursor: 0 }, effects: [{ type: 'rebuild' }] }
      }
      return performAction(ui)
    }

    case 'back':
      if (ui.focused) return { state: { ...ui, focused: false, cursor: 0 }, effects: [{ type: 'rebuild' }] }
      return { state: ui, effects: [{ type: 'exitDialog' }] }

    case 'lifecycle':
      return lifecycle(ui, ev)
  }
}

function performAction(ui: UiState): ReduceResult {
  const { game, view, cursor } = ui
  const mods = computeMods(game)
  const now = game.lastSeenMs // last ticked wall-clock; decodes start ~now
  let next = game
  if (view === 'build') {
    next = buy(game, BUILDINGS[cursor], mods)
  } else if (view === 'tech') {
    const node = availableTech(game)[cursor]
    if (node) next = research(game, node.id)
  } else if (view === 'decode') {
    const def = availableDecodes(game, mods)[cursor]
    if (def) next = startDecode(game, def.id, now, mods)
  }
  if (next === game) return { state: ui, effects: [] } // action was a no-op (unaffordable, etc.)
  // Keep decode slots sized to capacity after a buy/research (a freshly bought
  // decoder adds a slot) so an immediate decode-start has somewhere to go.
  next = syncSlots(next, computeMods(next))
  const len = listLen(view, next)
  const cursor2 = len === 0 ? 0 : Math.min(cursor, len - 1)
  return { state: { ...ui, game: next, cursor: cursor2 }, effects: [{ type: 'persist' }, { type: 'rebuild' }] }
}

function lifecycle(ui: UiState, ev: Extract<UiEvent, { type: 'lifecycle' }>): ReduceResult {
  switch (ev.kind) {
    case 'foregroundEnter':
      return { state: applyTick(ui, ev.now), effects: [{ type: 'rebuild' }, { type: 'persist' }] }
    case 'foregroundExit':
      return { state: ui, effects: [{ type: 'persistNow' }] }
    case 'systemExit':
    case 'abnormalExit':
      return { state: ui, effects: [{ type: 'cleanup' }, { type: 'persistNow' }] }
  }
}
