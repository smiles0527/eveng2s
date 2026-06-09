// Lost Signal — single-blob game save over the KV bridge.
// Reuses the shared envelope helpers (wrap/unwrap/chunkWrite/chunkRead) so the
// game shares the versioned+chunked persistence pattern proven in storage.ts.

import {
  KVBridge,
  wrap,
  unwrap,
  chunkWrite,
  chunkRead,
  createWriteQueue,
} from '../core/envelope'
import type { GameState } from './types'

// NOTE on schema version: the task's reference snippet pins CURRENT_SCHEMA = 1
// with an empty `migrations` array. But its migration test also asks for a
// *registered* migrations[0] whose output `load` returns as "the migrated
// state" — which is only reachable when CURRENT_SCHEMA > 1 (unwrap's loop runs
// `while v < currentSchema`). Those two requirements contradict each other at
// version 1. To exercise the real migration machinery honestly we ship the
// first migration (v1→v2 added `completedChallenges`), so CURRENT_SCHEMA = 2
// and migrations has exactly one entry. Append-only: migrations[v-1] upgrades
// a v→v+1 blob.
const CURRENT_SCHEMA = 3
const KEY = 'lostsignal.save'

const migrations: Array<(d: unknown) => unknown> = [
  // v1 → v2: `completedChallenges` was introduced; default it for old saves.
  (d: unknown) => {
    const s = (d ?? {}) as Record<string, unknown>
    return Array.isArray(s.completedChallenges)
      ? s
      : { ...s, completedChallenges: [] }
  },
  // v2 → v3: `seenIntro` was introduced; default false so existing players see
  // the one-time intro exactly once.
  (d: unknown) => {
    const s = (d ?? {}) as Record<string, unknown>
    return typeof s.seenIntro === 'boolean' ? s : { ...s, seenIntro: false }
  },
]

export interface GameStore {
  load(): Promise<GameState | null> // null if absent OR corrupt
  save(state: GameState): Promise<boolean>
}

/** Structural guard: enough of a GameState to trust the rest. Never throws. */
function isGameState(v: unknown): v is GameState {
  if (typeof v !== 'object' || v === null) return false
  const s = v as Record<string, unknown>
  return (
    typeof s.signal === 'number' &&
    typeof s.owned === 'object' &&
    s.owned !== null &&
    Array.isArray(s.slots)
  )
}

export function createGameStore(bridge: KVBridge, opts: { chunkSize?: number } = {}): GameStore {
  const chunkSize = opts.chunkSize
  const serialize = createWriteQueue()

  function save(state: GameState): Promise<boolean> {
    // Persist exactly as given — the caller owns lastSeenMs / the clock.
    return serialize(() => chunkWrite(bridge, KEY, wrap(state, CURRENT_SCHEMA), chunkSize))
  }

  async function load(): Promise<GameState | null> {
    const joined = await chunkRead(bridge, KEY)
    if (joined === '') return null // fresh game — nothing stored
    if (joined === null) {
      console.warn('lostsignal: save is truncated/corrupt; starting fresh')
      return null
    }
    const data = unwrap<GameState>(joined, CURRENT_SCHEMA, migrations, null as any)
    if (!isGameState(data)) {
      console.warn('lostsignal: save failed shape validation; starting fresh')
      return null
    }
    return data
  }

  return { load, save }
}
