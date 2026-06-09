import { describe, it, expect } from 'vitest'
import { createGameStore } from './save'
import { wrap } from '../core/envelope'
import type { GameState } from './types'

function makeMockBridge() {
  const store = new Map<string, string>()
  return {
    store,
    bridge: {
      async setLocalStorage(key: string, value: string) {
        store.set(key, value)
        return true
      },
      async getLocalStorage(key: string) {
        return store.get(key) ?? ''
      },
    },
  }
}

// A representative GameState touching every field in types.ts.
const sampleState = (over: Partial<GameState> = {}): GameState => ({
  signal: 1234.5,
  fragments: 42,
  owned: { antenna: 3, amplifier: 1, decoder: 2, reactor: 0 },
  slots: [
    { status: 'idle' },
    { status: 'running', def: 'morse', startMs: 1000, endMs: 5000 },
    { status: 'banked', def: 'cipher', finishedMs: 4200 },
  ],
  queue: ['morse', 'cipher'],
  decodesCompleted: 7,
  ownedTech: ['t.throughput.1', 't.efficiency.1'],
  completedObjectives: ['obj.first', 'obj.second'],
  completedChallenges: ['chal.a'],
  seenBeats: ['beat.0', 'beat.1', 'beat.2'],
  seenIntro: true,
  session: { decodesThisHour: 4, hourStartMs: 900, lastDecodeType: 'morse' },
  lastSeenMs: 6000,
  ...over,
})

describe('save — round trip', () => {
  it('saves and loads a state deep-equal', async () => {
    const { bridge } = makeMockBridge()
    const store = createGameStore(bridge)
    const state = sampleState()
    expect(await store.save(state)).toBe(true)
    expect(await store.load()).toEqual(state)
  })
})

describe('save — chunking', () => {
  it('splits a large state across multiple chunk keys and reassembles exactly', async () => {
    const { store, bridge } = makeMockBridge()
    const gs = createGameStore(bridge, { chunkSize: 64 })
    const big = sampleState({
      seenBeats: Array.from({ length: 200 }, (_, i) => `beat-${i}-xxxxxxxxxx`),
      ownedTech: Array.from({ length: 200 }, (_, i) => `tech-${i}-yyyyyyyyyy`),
    })
    expect(await gs.save(big)).toBe(true)
    const chunkKeys = [...store.keys()].filter((k) => /^lostsignal\.save\.\d+$/.test(k))
    expect(chunkKeys.length).toBeGreaterThan(1)
    expect(await gs.load()).toEqual(big)
  })
})

describe('save — missing', () => {
  it('returns null when the bridge is empty (fresh game)', async () => {
    const { bridge } = makeMockBridge()
    expect(await createGameStore(bridge).load()).toBeNull()
  })
})

describe('save — truncated', () => {
  it('returns null when a middle chunk is blanked', async () => {
    const { store, bridge } = makeMockBridge()
    const gs = createGameStore(bridge, { chunkSize: 64 })
    const big = sampleState({
      seenBeats: Array.from({ length: 200 }, (_, i) => `beat-${i}-xxxxxxxxxx`),
    })
    await gs.save(big)
    const chunkKeys = [...store.keys()]
      .filter((k) => /^lostsignal\.save\.\d+$/.test(k))
      .sort()
    expect(chunkKeys.length).toBeGreaterThan(2)
    const middle = chunkKeys[Math.floor(chunkKeys.length / 2)]
    store.set(middle, '') // blank a middle chunk ⇒ chunkRead sees truncation
    expect(await gs.load()).toBeNull()
  })
})

describe('save — migration', () => {
  it('migrates a pre-envelope blob and re-writes it with the current schema on save', async () => {
    const { store, bridge } = makeMockBridge()
    const gs = createGameStore(bridge, { chunkSize: 50_000 })

    // Legacy v1 shape lacked completedChallenges AND seenIntro; the migration
    // chain (v1->v2->v3) defaults both. Raw JSON (no envelope) is treated as v1.
    const { completedChallenges: _c, seenIntro: _i, ...legacy } = sampleState()
    store.set('lostsignal.save.0', JSON.stringify(legacy))
    store.set('lostsignal.save._n', '1')

    const migrated = sampleState({ completedChallenges: [], seenIntro: false })
    const loaded = await gs.load()
    expect(loaded).toEqual(migrated)

    // A later save re-writes with the current envelope schemaVersion.
    expect(await gs.save(loaded!)).toBe(true)
    expect(store.get('lostsignal.save.0')).toContain('"schemaVersion":3')
  })

  it('migrates a v2 save by defaulting seenIntro to false', async () => {
    const { store, bridge } = makeMockBridge()
    const gs = createGameStore(bridge)
    const { seenIntro: _i, ...v2data } = sampleState()
    store.set('lostsignal.save.0', JSON.stringify({ schemaVersion: 2, data: v2data }))
    store.set('lostsignal.save._n', '1')
    const loaded = await gs.load()
    expect(loaded?.seenIntro).toBe(false)
  })
})

describe('save — corrupt shape', () => {
  it('returns null (no throw) when a stored blob is missing slots/owned', async () => {
    const { store, bridge } = makeMockBridge()
    const gs = createGameStore(bridge)
    // Valid envelope, but data is not a GameState (missing owned + slots).
    store.set('lostsignal.save.0', wrap({ signal: 5, fragments: 1 }, 2))
    store.set('lostsignal.save._n', wrap(1, 1))
    expect(await gs.load()).toBeNull()
  })

  it('returns null when signal is non-numeric', async () => {
    const { store, bridge } = makeMockBridge()
    const gs = createGameStore(bridge)
    const bad = { ...sampleState(), signal: 'nope' }
    store.set('lostsignal.save.0', wrap(bad, 2))
    store.set('lostsignal.save._n', wrap(1, 1))
    expect(await gs.load()).toBeNull()
  })
})
