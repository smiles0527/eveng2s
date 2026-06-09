// Lost Signal — shared type contract. Every game module builds against this.

export type Building = 'antenna' | 'amplifier' | 'decoder' | 'reactor'
export type TechId = string
export type DecodeId = string

/** One decoder's slot. `running`/`banked` carry absolute epoch-ms timestamps. */
export type Slot =
  | { status: 'idle' }
  | { status: 'running'; def: DecodeId; startMs: number; endMs: number }
  | { status: 'banked'; def: DecodeId; finishedMs: number }

/** The whole persisted game state. Sets are stored as arrays (JSON-friendly). */
export interface GameState {
  signal: number
  fragments: number
  owned: Record<Building, number>
  slots: Slot[]
  queue: DecodeId[]
  decodesCompleted: number
  ownedTech: TechId[]
  completedObjectives: string[]
  completedChallenges: string[]
  seenBeats: string[]
  session: { decodesThisHour: number; hourStartMs: number; lastDecodeType?: string }
  lastSeenMs: number
}

/** Effects produced by tech nodes / objective rewards / (v2) events. */
export type Effect =
  | { kind: 'signalMult'; value: number }
  | { kind: 'decodeTimeMult'; value: number } // <1 = faster
  | { kind: 'powerCapAdd'; value: number }
  | { kind: 'buildCostMult'; value: number } // <1 = cheaper
  | { kind: 'unlockBuilding'; id: Building }
  | { kind: 'unlockDecode'; id: DecodeId }
  | { kind: 'unlockFeature'; id: string } // 'autoRestart' | 'techTree' | ...
  | { kind: 'parallelDecodeAdd'; value: number }
  | { kind: 'unlockTech'; id: TechId }

/** Folded, order-independent result of applying a set of Effects. */
export interface Modifiers {
  signalMult: number
  decodeTimeMult: number
  powerCapAdd: number
  buildCostMult: number
  unlocked: Set<string> // runtime only; not persisted
  parallelDecodes: number
}

export interface TechNode {
  id: TechId
  name: string
  branch: 'throughput' | 'efficiency' | 'decryption'
  cost: { fragments: number; signal?: number }
  prereqs: TechId[]
  effects: Effect[]
  desc: string
}

export interface DecodeDef {
  id: DecodeId
  name: string
  durationMs: number // base; scaled by Modifiers.decodeTimeMult at start
  signalCost: number
  fragmentYield: number
  beatId?: string
  autoRestart?: boolean
  corrupted?: boolean
}

/** Cheap derived snapshot some predicates read (computed, never stored). */
export interface Derived {
  signalPerSec: number
  powerCap: number
  powerUsed: number
}

export interface Objective {
  id: string
  name: string
  condition: (s: GameState, d: Derived) => boolean
  reward: { effects?: Effect[]; fragments?: number }
  desc: string
}

export type BeatTrigger =
  | { kind: 'decodesCompleted'; n: number }
  | { kind: 'signalRate'; value: number }
  | { kind: 'tech'; nodeId: TechId }

export interface StoryBeat {
  id: string
  index: number
  trigger: BeatTrigger
  title?: string
  body: string
}

/** An event surfaced by the engine when advancing time. */
export interface AdvanceEvent {
  kind: 'decodeCompleted'
  def: DecodeId
  atMs: number
  beatId?: string
}
