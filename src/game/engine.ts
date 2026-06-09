import type { GameState, Modifiers, Derived, Effect, Objective, StoryBeat, AdvanceEvent } from './types'
import { applyEffects } from './effects'
import { effectsOf } from './tech'
import { OBJECTIVES, CHALLENGES, newlyCompleted } from './objectives'
import { advance, syncSlots } from './progression'
import { signalPerSec, powerCap, powerUsed } from './economy'
import { pendingBeats, type BeatSnapshot } from './beats'

const HOUR_MS = 3_600_000

const ALL_GOALS: Objective[] = [...OBJECTIVES, ...CHALLENGES]

/** Reward effects granted by already-completed objectives/challenges (permanent). */
function rewardEffects(completedIds: string[]): Effect[] {
  const out: Effect[] = []
  for (const id of completedIds) {
    const def = ALL_GOALS.find((g) => g.id === id)
    if (def?.reward.effects) out.push(...def.reward.effects)
  }
  return out
}

/** Current modifiers = owned tech + completed-goal reward effects, folded. */
export function computeMods(s: GameState): Modifiers {
  return applyEffects([
    ...effectsOf(s.ownedTech),
    ...rewardEffects([...s.completedObjectives, ...s.completedChallenges]),
  ])
}

export function derive(s: GameState, mods: Modifiers): Derived {
  return { signalPerSec: signalPerSec(s, mods), powerCap: powerCap(s, mods), powerUsed: powerUsed(s) }
}

function beatSnapshot(s: GameState, d: Derived): BeatSnapshot {
  return { decodesCompleted: s.decodesCompleted, signalRate: d.signalPerSec, ownedTech: s.ownedTech }
}

export function newGame(now: number): GameState {
  return {
    signal: 0,
    fragments: 0,
    // Start with one antenna so signal accrues from the first second — without
    // it, 0 antennas → 0 signal/s → the first antenna (cost 15) is unaffordable
    // forever (cold-start soft-lock).
    owned: { antenna: 1, amplifier: 0, decoder: 1, reactor: 0 },
    slots: [{ status: 'idle' }],
    queue: [],
    decodesCompleted: 0,
    ownedTech: [],
    completedObjectives: [],
    completedChallenges: [],
    seenBeats: [],
    seenIntro: false,
    session: { decodesThisHour: 0, hourStartMs: now },
    lastSeenMs: now,
  }
}

export interface TickResult {
  state: GameState
  events: AdvanceEvent[]
  completed: Objective[] // objectives/challenges newly completed this tick
  beats: StoryBeat[] // beats now pending (caller displays + marks seen)
  mods: Modifiers
}

/**
 * The single authoritative advance: fold mods → size slots → advance time →
 * roll the session decode tally → fire objectives/challenges (credit rewards,
 * re-fold mods) → surface pending beats. Pure: `now` injected.
 */
export function tick(s0: GameState, now: number): TickResult {
  let mods = computeMods(s0)
  let s = syncSlots(s0, mods)
  const adv = advance(s, now, mods)
  s = adv.state

  // rolling-hour decode tally (for the Burst challenge). Only LIVE ticks count —
  // a big offline catch-up shouldn't trivially grant "10 decodes in one hour".
  let session = s.session
  const elapsed = now - s0.lastSeenMs
  if (now - session.hourStartMs >= HOUR_MS) session = { ...session, decodesThisHour: 0, hourStartMs: now }
  if (adv.events.length && elapsed <= 5_000) {
    session = { ...session, decodesThisHour: session.decodesThisHour + adv.events.length }
  }
  s = { ...s, session }

  // objectives + challenges (latching, fire-once)
  const d1 = derive(s, mods)
  const objs = newlyCompleted(OBJECTIVES, s, d1, new Set(s.completedObjectives))
  const chals = newlyCompleted(CHALLENGES, s, d1, new Set(s.completedChallenges))
  const completed = [...objs, ...chals]
  if (completed.length) {
    let fragments = s.fragments
    for (const g of completed) if (g.reward.fragments) fragments += g.reward.fragments
    s = {
      ...s,
      fragments,
      completedObjectives: [...s.completedObjectives, ...objs.map((o) => o.id)],
      completedChallenges: [...s.completedChallenges, ...chals.map((c) => c.id)],
    }
    mods = computeMods(s) // newly-granted effects are active immediately
  }

  // pending story beats (caller renders modal + persists seen)
  const beats = pendingBeats(s.seenBeats, beatSnapshot(s, derive(s, mods)))
  return { state: s, events: adv.events, completed, beats, mods }
}
