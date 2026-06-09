// Lost Signal — objectives & challenges. Pure, data-driven, fire-once + latching.
//
// Same evaluator shape as the design's progression section: each entry is an
// Objective whose `condition` is a PURE predicate over (GameState, Derived).
// Objectives (milestones) pace the opening and teach mechanics; challenges are
// optional, constrained goals whose `unlockTech` rewards *widen the tech tree*
// rather than hand out a flat bonus. Both are evaluated every advance/action and
// made idempotent by `newlyCompleted`'s completed-set check, so a double tick or
// reload-then-tick can't double-grant.

import type { Objective, GameState, Derived } from './types'

/** Milestones, in onboarding order — `nextObjective` surfaces the first
 *  incomplete one as the "Next:" prompt, so this order is the new-player path. */
export const OBJECTIVES: Objective[] = [
  {
    id: 'o.firstDecode',
    name: 'Signal Decoded',
    condition: (s, _d) => s.decodesCompleted >= 1,
    reward: { fragments: 5 },
    desc: 'Complete your first decode. Reward: +5 fragments.',
    goal: 'Start your first decode',
  },
  {
    id: 'o.antennas10',
    name: 'Antenna Field',
    condition: (s, _d) => s.owned.antenna >= 10,
    reward: { effects: [{ kind: 'unlockBuilding', id: 'amplifier' }] },
    desc: 'Own 10 antennas. Reward: unlock the amplifier.',
    goal: 'Build 10 antennas',
  },
  {
    id: 'o.signal100',
    name: 'First Watt',
    condition: (_s, d) => d.signalPerSec >= 100,
    reward: { effects: [{ kind: 'powerCapAdd', value: 1 }] },
    desc: 'Reach 100 signal/s. Reward: +1 power cap.',
    goal: 'Reach 100 signal/s',
  },
  {
    id: 'o.fragments50',
    name: 'Fragment Cache',
    condition: (s, _d) => s.fragments >= 50,
    reward: { effects: [{ kind: 'signalMult', value: 1.1 }] },
    desc: 'Bank 50 fragments. Reward: +10% signal.',
    goal: 'Bank 50 fragments',
  },
  {
    id: 'o.reactor',
    name: 'Power Online',
    condition: (s, _d) => s.owned.reactor >= 1,
    reward: { effects: [{ kind: 'unlockFeature', id: 'techTree' }] },
    desc: 'Build a reactor. Reward: reveal the tech tree.',
    goal: 'Build a reactor',
  },
]

/** Optional, constrained goals; each grants a unique permanent bonus (a direct
 *  effect) you can obtain no other way. */
export const CHALLENGES: Objective[] = [
  {
    id: 'c.overdrive',
    name: 'Overdrive',
    condition: (s, d) => s.session.lastDecodeType === 'corrupted' && d.signalPerSec >= 500,
    reward: { effects: [{ kind: 'signalMult', value: 1.5 }] },
    desc: 'Decode a corrupted fragment while at 500+ signal/s. Reward: +50% signal/s.',
  },
  {
    id: 'c.minimalist',
    name: 'Minimalist',
    condition: (s, d) => s.fragments >= 100 && d.powerUsed <= 4,
    reward: { effects: [{ kind: 'buildCostMult', value: 0.8 }] },
    desc: 'Bank 100 fragments while using 4 or less power. Reward: -20% build cost.',
  },
  {
    id: 'c.burst',
    name: 'Burst',
    condition: (s, _d) => s.session.decodesThisHour >= 10,
    reward: { effects: [{ kind: 'decodeTimeMult', value: 0.8 }] },
    desc: 'Complete 10 decodes in one real hour. Reward: -20% decode time.',
  },
]

/**
 * The defs whose condition holds for (s, d) AND whose id is not yet in
 * `completed`. Pure: reads only its arguments, mutates nothing. The engine adds
 * the returned ids to its persisted completed set, which latches each one — the
 * set check is what makes a double tick or reload-then-tick non-duplicating.
 */
export function newlyCompleted(
  defs: Objective[],
  s: GameState,
  d: Derived,
  completed: ReadonlySet<string>,
): Objective[] {
  return defs.filter((def) => !completed.has(def.id) && def.condition(s, d))
}
