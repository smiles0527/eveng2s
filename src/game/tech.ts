// Lost Signal — tech tree. A pure, data-driven DAG of upgrades.
//
// Three branches with distinct identities (design doc "Tech tree"):
//   throughput  — raw signal multipliers + the Dish building
//   efficiency  — power cap, cheaper builds, auto-restart
//   decryption  — decode speed, parallelism, corrupted-fragment decoding
//
// Costs are in fragments (primary) plus an optional signal cost on deeper /
// convergence nodes. Effects draw from the shared Effect union in ./types, so
// the engine can fold tech, objective rewards, and (v2) events with one model.
//
// Everything here is pure: predicates read state, research() returns a fresh
// state (or the SAME reference when nothing can change), and validateTree() is
// a load-time dev assert that fails loud on a malformed graph.

import type { Effect, GameState, TechId, TechNode } from './types'

export const TECH: TechNode[] = [
  // ── Throughput ────────────────────────────────────────────────────────────
  {
    id: 't.gain1',
    name: 'Signal Gain I',
    branch: 'throughput',
    cost: { fragments: 15 },
    prereqs: [],
    effects: [{ kind: 'signalMult', value: 1.25 }],
    desc: '+25% signal. Tune the front-end; pull more out of the same noise.',
  },
  {
    id: 't.gain2',
    name: 'Signal Gain II',
    branch: 'throughput',
    cost: { fragments: 60 },
    prereqs: ['t.gain1'],
    effects: [{ kind: 'signalMult', value: 1.4 }],
    desc: '+40% signal. A second stage on top of the first.',
  },
  {
    id: 't.array',
    name: 'Phased Array',
    branch: 'throughput',
    cost: { fragments: 120, signal: 200 },
    prereqs: ['t.gain1'],
    effects: [{ kind: 'signalMult', value: 1.6 }],
    desc: 'Phase the antennas into one dish: +60% signal/s.',
  },

  // ── Efficiency ─────────────────────────────────────────────────────────────
  {
    id: 'e.reactor1',
    name: 'Reactor Tap',
    branch: 'efficiency',
    cost: { fragments: 20 },
    prereqs: [],
    effects: [{ kind: 'powerCapAdd', value: 2 }],
    desc: '+2 power cap. Headroom to run more hardware at once.',
  },
  {
    id: 'e.frugal',
    name: 'Frugal Fabrication',
    branch: 'efficiency',
    cost: { fragments: 70 },
    prereqs: ['e.reactor1'],
    effects: [{ kind: 'buildCostMult', value: 0.85 }],
    desc: '-15% build cost. Reclaim and reuse; nothing wasted out here.',
  },
  {
    id: 'e.auto',
    name: 'Auto-Restart',
    branch: 'efficiency',
    cost: { fragments: 110, signal: 150 },
    prereqs: ['e.reactor1'],
    effects: [{ kind: 'unlockFeature', id: 'autoRestart' }],
    desc: 'Decoders re-queue themselves the instant a slot frees. Hands off.',
  },

  // ── Decryption ─────────────────────────────────────────────────────────────
  {
    id: 'd.fast1',
    name: 'Fast Decode I',
    branch: 'decryption',
    cost: { fragments: 25 },
    prereqs: [],
    effects: [{ kind: 'decodeTimeMult', value: 0.8 }],
    desc: '-20% decode time. Tighter correlation windows.',
  },
  {
    // Canonical decryption timing node. Story beat "how-far" (THE DELAY) fires
    // on research of this id — do NOT rename without updating the beat trigger.
    id: 'd.phaselock',
    name: 'Phase Lock',
    branch: 'decryption',
    cost: { fragments: 90 },
    prereqs: ['d.fast1'],
    effects: [{ kind: 'decodeTimeMult', value: 0.85 }],
    desc: 'Lock onto the carrier phase. Decodes settle faster — and the timing '
      + 'it resolves says the source is impossibly far away.',
  },
  {
    id: 'd.parallel',
    name: 'Parallel Decode',
    branch: 'decryption',
    cost: { fragments: 100, signal: 120 },
    prereqs: ['d.fast1'],
    effects: [{ kind: 'parallelDecodeAdd', value: 1 }],
    desc: '+1 decode slot. Work two fragments at once.',
  },
  {
    id: 'd.corrupt',
    name: 'Error Correction',
    branch: 'decryption',
    cost: { fragments: 100, signal: 120 },
    prereqs: ['d.fast1'],
    effects: [{ kind: 'unlockDecode', id: 'corrupted' }],
    desc: 'Unlock corrupted-fragment decoding — risky, but the densest data.',
  },
  {
    // Convergence node: requires both deep decryption branches.
    id: 'd.fast2',
    name: 'Fast Decode II',
    branch: 'decryption',
    cost: { fragments: 260, signal: 300 },
    prereqs: ['d.parallel', 'd.corrupt'],
    effects: [
      { kind: 'decodeTimeMult', value: 0.6 },
      { kind: 'parallelDecodeAdd', value: 1 },
    ],
    desc: '-40% decode time and +1 slot. The decryption endgame.',
  },
]

/** Index for O(1) id lookup; built once from the static TECH table. */
const BY_ID: ReadonlyMap<TechId, TechNode> = new Map(TECH.map((n) => [n.id, n]))

export function techById(id: TechId): TechNode | undefined {
  return BY_ID.get(id)
}

/** True iff every prereq of `node` is present in `ownedTech`. */
export function isUnlockable(node: TechNode, ownedTech: TechId[]): boolean {
  return node.prereqs.every((p) => ownedTech.includes(p))
}

/**
 * True iff `node` can be researched right now: prereqs met, fragments (and any
 * signal cost) affordable, and not already owned.
 */
export function canResearch(s: GameState, node: TechNode): boolean {
  if (s.ownedTech.includes(node.id)) return false
  if (!isUnlockable(node, s.ownedTech)) return false
  if (s.fragments < node.cost.fragments) return false
  if (node.cost.signal !== undefined && s.signal < node.cost.signal) return false
  return true
}

/**
 * Research a node. Pure: returns the SAME reference when it can't be researched
 * (unknown id, unaffordable, prereq missing, already owned); otherwise a new
 * state with the cost deducted and the id appended to ownedTech.
 */
export function research(s: GameState, id: TechId): GameState {
  const node = BY_ID.get(id)
  if (!node || !canResearch(s, node)) return s
  return {
    ...s,
    fragments: s.fragments - node.cost.fragments,
    signal: s.signal - (node.cost.signal ?? 0),
    ownedTech: [...s.ownedTech, id],
  }
}

/** Flat list of effects contributed by every owned (and known) node. */
export function effectsOf(ownedTech: TechId[]): Effect[] {
  const out: Effect[] = []
  for (const id of ownedTech) {
    const node = BY_ID.get(id)
    if (node) out.push(...node.effects)
  }
  return out
}

/**
 * Dev assert run at load time: ids unique, every prereq resolves to a real
 * node, and the prereq graph is acyclic. Throws (fails loud) on any violation,
 * mirroring how the flashcards app rejects bad container config.
 */
export function validateTree(): void {
  const ids = new Set<TechId>()
  for (const n of TECH) {
    if (ids.has(n.id)) throw new Error(`tech: duplicate id "${n.id}"`)
    ids.add(n.id)
  }
  for (const n of TECH)
    for (const p of n.prereqs)
      if (!ids.has(p))
        throw new Error(`tech: node "${n.id}" has dangling prereq "${p}"`)

  // DFS 3-colouring: WHITE unseen, GRAY on the active stack, BLACK finished.
  const WHITE = 0, GRAY = 1, BLACK = 2
  const color = new Map<TechId, number>()
  const visit = (id: TechId): void => {
    color.set(id, GRAY)
    for (const p of BY_ID.get(id)!.prereqs) {
      const c = color.get(p) ?? WHITE
      if (c === GRAY) throw new Error(`tech: cycle detected through "${p}"`)
      if (c === WHITE) visit(p)
    }
    color.set(id, BLACK)
  }
  for (const n of TECH) if ((color.get(n.id) ?? WHITE) === WHITE) visit(n.id)
}

// Fail loud at import time in dev, exactly as the design doc prescribes.
validateTree()
