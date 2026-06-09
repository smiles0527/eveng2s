import type { DecodeDef, DecodeId } from './types'

// Lost Signal — the time-gated decode catalogue. Pure data: no clocks, no
// bridge, no DOM. Durations are wall-clock base values (scaled at start by
// mods.decodeTimeMult); the engine reads these, this module only describes them.
//
// The arc is paced by escalating real durations (design doc, "Duration tuning"):
// 1 min → 15 min → 1 hr → 6 hr → 12 hr → 24 hr. signalCost and fragmentYield
// climb alongside, so later gates cost more to start and pay out more.
//
// `beatId` is intentionally omitted in v1 — story beats fire on counts/rate/tech,
// not per-decode. `corrupted` only *identifies* a decode as corrupted (the
// d.corrupt tech gates it in-game); the flag carries no behaviour here.

// Duration constants (ms), one per act of the arc.
const ONE_MIN = 60_000
const FIFTEEN_MIN = 900_000
const ONE_HOUR = 3_600_000
const SIX_HOURS = 21_600_000
const TWELVE_HOURS = 43_200_000
const ONE_DAY = 86_400_000

export const DECODES: DecodeDef[] = [
  {
    // Prologue — teach the loop, instant payoff.
    id: 'first-contact',
    name: 'First Contact',
    durationMs: ONE_MIN,
    signalCost: 0,
    fragmentYield: 1,
  },
  {
    // Act I — session-length wait.
    id: 'triangulate',
    name: 'Triangulate Source',
    durationMs: FIFTEEN_MIN,
    signalCost: 25,
    fragmentYield: 5,
  },
  {
    // Act I→II — first "set it and leave".
    id: 'decrypt-header',
    name: 'Decrypt Header',
    durationMs: ONE_HOUR,
    signalCost: 120,
    fragmentYield: 20,
  },
  {
    // Act II — a workday away, banked on return.
    id: 'reassemble-log',
    name: 'Reassemble Log',
    durationMs: SIX_HOURS,
    signalCost: 600,
    fragmentYield: 120,
  },
  {
    // Act II→III — overnight; "wake up to progress". Garbled until d.corrupt.
    id: 'decode-broadcast',
    name: 'Decode Broadcast',
    durationMs: TWELVE_HOURS,
    signalCost: 1_500,
    fragmentYield: 300,
    corrupted: true,
  },
  {
    // Act III — daily ritual; the finale over a week+.
    id: 'signal-lock',
    name: 'Full Signal Lock',
    durationMs: ONE_DAY,
    signalCost: 4_000,
    fragmentYield: 800,
  },
]

export function decodeById(id: DecodeId): DecodeDef | undefined {
  return DECODES.find((d) => d.id === id)
}
