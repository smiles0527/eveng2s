// Lost Signal — the numeric spine. Pure, time-free: every function takes state
// (+ folded `mods`) and returns a number or a NEW GameState. No clock, no I/O.
// All tunables are exported `const` lookup tables, so retuning is a one-file edit
// and tests assert behavior (first unit = BASE, `buy` deducts exactly `costOf`,
// reactor never power-blocked), not magic numbers.

import type { Building, GameState, Modifiers } from './types'

/** Base cost of the first (0-indexed) unit of each building, in signal. */
export const BASE: Record<Building, number> = {
  antenna: 15,
  amplifier: 100,
  decoder: 200,
  reactor: 500,
}

/** Geometric cost growth per already-owned unit. */
export const RATE: Record<Building, number> = {
  antenna: 1.15,
  amplifier: 1.3,
  decoder: 1.25,
  reactor: 1.5,
}

/** Power (capacity) each building occupies while online. Reactor draws 0 — it
 *  only raises the cap, so it is never power-blocked. Decoder draw applies only
 *  while a decode is actually running (see `powerUsed`). */
export const POWER: Record<Building, number> = {
  antenna: 1,
  amplifier: 2,
  decoder: 3,
  reactor: 0,
}

export const ANTENNA_BASE_RATE = 1.0
export const AMP_BONUS = 0.25
export const REACTOR_BASE_CAP = 5
export const REACTOR_CAP_PER = 5

/** Signal/sec: antennas are the base, amplifiers compound multiplicatively. */
export function signalPerSec(s: GameState, mods: Modifiers): number {
  return (
    s.owned.antenna *
    ANTENNA_BASE_RATE *
    (1 + AMP_BONUS) ** s.owned.amplifier *
    mods.signalMult
  )
}

/** The simultaneity budget: a small base, raised by reactors and tech. */
export function powerCap(s: GameState, mods: Modifiers): number {
  return REACTOR_BASE_CAP + s.owned.reactor * REACTOR_CAP_PER + mods.powerCapAdd
}

/** Occupancy, not drain. v1: owned == online for antennas/amplifiers; decoders
 *  occupy power only for each slot currently `running`. */
export function powerUsed(s: GameState): number {
  const runningDecodes = s.slots.filter((x) => x.status === 'running').length
  return (
    s.owned.antenna * POWER.antenna +
    s.owned.amplifier * POWER.amplifier +
    runningDecodes * POWER.decoder
  )
}

/** Slack in the budget. A buy / decode-start must keep this >= 0. */
export function powerHeadroom(s: GameState, mods: Modifiers): number {
  return powerCap(s, mods) - powerUsed(s)
}

/** The n-th unit (0-indexed `owned`) costs round(BASE · RATE^owned · costMult);
 *  the first costs exactly BASE (RATE^0 = 1, default mult = 1). */
export function costOf(b: Building, owned: number, mods: Modifiers): number {
  return Math.round(BASE[b] * RATE[b] ** owned * mods.buildCostMult)
}

/** Power a building draws simply by being OWNED. Antennas/amplifiers draw
 *  continuously; a decoder draws only while a decode is running (0 at purchase);
 *  a reactor draws nothing. So only antennas/amplifiers are power-gated to buy. */
export function ownedDraw(b: Building): number {
  return b === 'antenna' || b === 'amplifier' ? POWER[b] : 0
}

/** Affordable iff signal covers the cost AND owning it keeps headroom >= 0.
 *  Decoders/reactors have zero owned-draw, so they're never power-blocked
 *  (a decoder's running draw is checked later, when a decode is started). */
export function canAfford(s: GameState, b: Building, mods: Modifiers): boolean {
  if (s.signal < costOf(b, s.owned[b], mods)) return false
  const draw = ownedDraw(b)
  return draw === 0 || powerHeadroom(s, mods) >= draw // zero-draw is never power-blocked
}

/** Pure purchase: returns the SAME reference if unaffordable (cheap `===`
 *  test); otherwise a NEW state with signal -= cost and owned[b] += 1. */
export function buy(s: GameState, b: Building, mods: Modifiers): GameState {
  if (!canAfford(s, b, mods)) return s
  const cost = costOf(b, s.owned[b], mods)
  return {
    ...s,
    signal: s.signal - cost,
    owned: { ...s.owned, [b]: s.owned[b] + 1 },
  }
}
