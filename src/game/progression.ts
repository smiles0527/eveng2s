import type { GameState, Modifiers, Slot, AdvanceEvent } from './types'
import { signalPerSec, powerHeadroom, POWER } from './economy'
import { decodeById } from './decodes'

const MAX_STEPS = 100_000

/** Max concurrent decodes = owned decoders + parallelism from tech. */
export function decodeCapacity(s: GameState, mods: Modifiers): number {
  return s.owned.decoder + mods.parallelDecodes
}

/** Pad the slots array up to capacity with idle slots (capacity only grows in v1). */
export function syncSlots(s: GameState, mods: Modifiers): GameState {
  const cap = decodeCapacity(s, mods)
  if (s.slots.length >= cap) return s
  const slots = s.slots.slice()
  while (slots.length < cap) slots.push({ status: 'idle' })
  return { ...s, slots }
}

export interface AdvanceResult {
  state: GameState
  events: AdvanceEvent[]
}

/**
 * Advance the simulation to wall-clock `now`: credit signal for elapsed real
 * time, then complete every decode whose endMs has passed (looping so an
 * auto-restarting decode completes as many times as the gap allows). Pure: `now`
 * is injected. Used identically for offline catch-up and the live tick.
 */
export function advance(s: GameState, now: number, mods: Modifiers): AdvanceResult {
  const events: AdvanceEvent[] = []
  const elapsed = Math.max(0, now - s.lastSeenMs)

  let signal = s.signal + (elapsed / 1000) * signalPerSec(s, mods)
  let fragments = s.fragments
  let decodesCompleted = s.decodesCompleted
  let lastDecodeType = s.session.lastDecodeType
  const slots: Slot[] = s.slots.map((x) => ({ ...x }))
  const autoRestart = mods.unlocked.has('autoRestart')

  let guard = 0
  for (;;) {
    let idx = -1
    let earliest = Infinity
    for (let i = 0; i < slots.length; i++) {
      const sl = slots[i]
      if (sl.status === 'running' && sl.endMs <= now && sl.endMs < earliest) {
        earliest = sl.endMs
        idx = i
      }
    }
    if (idx === -1 || guard++ >= MAX_STEPS) break

    const run = slots[idx] as Extract<Slot, { status: 'running' }>
    const def = decodeById(run.def)
    if (!def) {
      slots[idx] = { status: 'idle' } // unknown def (content removed) — drop it
      continue
    }
    fragments += def.fragmentYield
    decodesCompleted += 1
    lastDecodeType = def.corrupted ? 'corrupted' : 'normal'
    events.push({ kind: 'decodeCompleted', def: def.id, atMs: run.endMs, beatId: def.beatId })

    const dur = Math.max(1, Math.round(def.durationMs * mods.decodeTimeMult))
    if (autoRestart && signal >= def.signalCost) {
      signal -= def.signalCost
      slots[idx] = { status: 'running', def: def.id, startMs: run.endMs, endMs: run.endMs + dur }
    } else {
      slots[idx] = { status: 'banked', def: def.id, finishedMs: run.endMs }
    }
  }

  return {
    state: {
      ...s,
      signal,
      fragments,
      decodesCompleted,
      slots,
      session: { ...s.session, lastDecodeType },
      lastSeenMs: now,
    },
    events,
  }
}

/** Start `defId` in the first idle slot. Pure; returns the same state if there's
 *  no free slot, not enough signal, no power headroom, or an unknown def. */
export function startDecode(s: GameState, defId: string, now: number, mods: Modifiers): GameState {
  const def = decodeById(defId)
  if (!def) return s
  const idx = s.slots.findIndex((x) => x.status === 'idle')
  if (idx === -1) return s
  if (s.signal < def.signalCost) return s
  if (powerHeadroom(s, mods) < POWER.decoder) return s

  const dur = Math.max(1, Math.round(def.durationMs * mods.decodeTimeMult))
  const slots = s.slots.slice()
  slots[idx] = { status: 'running', def: defId, startMs: now, endMs: now + dur }
  return { ...s, signal: s.signal - def.signalCost, slots }
}

/** Clear a banked slot back to idle (frees it for the next decode). */
export function collect(s: GameState, slotIndex: number): GameState {
  const sl = s.slots[slotIndex]
  if (!sl || sl.status !== 'banked') return s
  const slots = s.slots.slice()
  slots[slotIndex] = { status: 'idle' }
  return { ...s, slots }
}
