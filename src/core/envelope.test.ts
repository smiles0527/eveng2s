import { describe, it, expect } from 'vitest'
import { wrap, unwrap, chunkWrite, chunkRead, createWriteQueue, type KVBridge } from './envelope'

function mockBridge() {
  const store = new Map<string, string>()
  const bridge: KVBridge = {
    async setLocalStorage(k, v) {
      store.set(k, v)
      return true
    },
    async getLocalStorage(k) {
      return store.get(k) ?? ''
    },
  }
  return { store, bridge }
}

describe('wrap/unwrap', () => {
  it('round-trips data through a versioned envelope', () => {
    const s = wrap({ a: 1 }, 1)
    expect(s).toContain('"schemaVersion":1')
    expect(unwrap(s, 1, [], null)).toEqual({ a: 1 })
  })
  it('returns fallback for missing or corrupt input', () => {
    expect(unwrap('', 1, [], 'fb')).toBe('fb')
    expect(unwrap('{not json', 1, [], 'fb')).toBe('fb')
  })
  it('tolerates a pre-envelope (unversioned) blob as v1', () => {
    expect(unwrap(JSON.stringify({ a: 1 }), 1, [], null)).toEqual({ a: 1 })
  })
  it('runs ordered migrations to the current schema', () => {
    const migrations = [(d: any) => ({ ...d, b: 2 }), (d: any) => ({ ...d, c: 3 })]
    const v1 = wrap({ a: 1 }, 1)
    expect(unwrap(v1, 3, migrations, null)).toEqual({ a: 1, b: 2, c: 3 })
  })
})

describe('chunkWrite/chunkRead', () => {
  it('round-trips a value', async () => {
    const { bridge } = mockBridge()
    await chunkWrite(bridge, 'k', 'hello world')
    expect(await chunkRead(bridge, 'k')).toBe('hello world')
  })
  it('splits across chunks and reassembles exactly', async () => {
    const { store, bridge } = mockBridge()
    const body = 'x'.repeat(40)
    await chunkWrite(bridge, 'k', body, 16)
    const chunks = [...store.keys()].filter((key) => /^k\.\d+$/.test(key))
    expect(chunks.length).toBe(3)
    expect(await chunkRead(bridge, 'k')).toBe(body)
  })
  it('returns "" for a missing key', async () => {
    const { bridge } = mockBridge()
    expect(await chunkRead(bridge, 'nope')).toBe('')
  })
  it('returns null when truncated (a chunk missing before the count)', async () => {
    const { store, bridge } = mockBridge()
    await chunkWrite(bridge, 'k', 'x'.repeat(40), 16) // 3 chunks
    store.set('k.1', '') // simulate a lost middle chunk
    expect(await chunkRead(bridge, 'k')).toBeNull()
  })
})

describe('createWriteQueue', () => {
  it('serializes writes (no overlap)', async () => {
    const serialize = createWriteQueue()
    const order: string[] = []
    const slow = () =>
      serialize(async () => {
        order.push('start-a')
        await new Promise((r) => setTimeout(r, 10))
        order.push('end-a')
      })
    const fast = () =>
      serialize(async () => {
        order.push('start-b')
      })
    await Promise.all([slow(), fast()])
    expect(order).toEqual(['start-a', 'end-a', 'start-b'])
  })
})
