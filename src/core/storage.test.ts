import { describe, it, expect } from 'vitest'
import { createStorage } from './storage'
import type { Card, Deck } from './types'

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

const sampleCard = (over: Partial<Card> = {}): Card => ({
  id: 'card-1',
  front: 'f',
  back: 'b',
  ef: 2.5,
  interval: 0,
  reps: 0,
  due: 100,
  ...over,
})

describe('storage — round trip', () => {
  it('saves and loads a deck deep-equal', async () => {
    const { bridge } = makeMockBridge()
    const s = createStorage(bridge)
    const deck: Deck = { id: 'd1', name: 'My Deck', cards: [sampleCard()] }
    await s.saveDeck(deck)
    expect(await s.loadDeck('d1')).toEqual(deck)
  })
})

describe('storage — chunking', () => {
  it('splits large decks across chunks and reassembles exactly', async () => {
    const { store, bridge } = makeMockBridge()
    const s = createStorage(bridge, { chunkSize: 16 })
    const cards = Array.from({ length: 5 }, (_, i) => sampleCard({ id: `c${i}`, front: `front ${i}` }))
    const deck: Deck = { id: 'd1', name: 'Big', cards }
    await s.saveDeck(deck)
    const chunkKeys = [...store.keys()].filter((k) => /^flashcards\.deck\.d1\.\d+$/.test(k))
    expect(chunkKeys.length).toBeGreaterThan(1)
    expect(await s.loadDeck('d1')).toEqual(deck)
  })

  it('ignores orphan chunks beyond the count key', async () => {
    const { store, bridge } = makeMockBridge()
    const s = createStorage(bridge, { chunkSize: 16 })
    const deck: Deck = { id: 'd1', name: 'Big', cards: [sampleCard()] }
    await s.saveDeck(deck)
    store.set('flashcards.deck.d1.999', 'garbage') // orphan past _n
    expect(await s.loadDeck('d1')).toEqual(deck)
  })
})

describe('storage — missing keys', () => {
  it('returns null for an unknown deck', async () => {
    const { bridge } = makeMockBridge()
    expect(await createStorage(bridge).loadDeck('nope')).toBeNull()
  })
  it('returns [] when there is no index', async () => {
    const { bridge } = makeMockBridge()
    expect(await createStorage(bridge).listDecks()).toEqual([])
  })
  it('returns null active deck when none set', async () => {
    const { bridge } = makeMockBridge()
    expect(await createStorage(bridge).getActiveDeckId()).toBeNull()
  })
})

describe('storage — schema envelope / pre-envelope tolerance', () => {
  it('reads a pre-envelope (unversioned) blob and re-wraps it on save', async () => {
    const { store, bridge } = makeMockBridge()
    const s = createStorage(bridge)
    const deck: Deck = { id: 'd1', name: 'Old', cards: [sampleCard()] }
    // Simulate legacy data: raw JSON, no envelope, raw count.
    store.set('flashcards.deck.d1.0', JSON.stringify(deck))
    store.set('flashcards.deck.d1._n', '1')

    const loaded = await s.loadDeck('d1')
    expect(loaded).toEqual(deck)

    await s.saveDeck(loaded!)
    expect(store.get('flashcards.deck.d1.0')).toContain('"schemaVersion":1')
  })
})

describe('storage — deck index', () => {
  it('createDeck appends to the index; deleteDeck removes it', async () => {
    const { bridge } = makeMockBridge()
    const s = createStorage(bridge)
    const a = await s.createDeck('A')
    const b = await s.createDeck('B')
    expect((await s.listDecks()).map((m) => m.name).sort()).toEqual(['A', 'B'])
    await s.deleteDeck(a.id)
    expect(await s.listDecks()).toEqual([{ id: b.id, name: 'B' }])
  })
})

describe('storage — active deck', () => {
  it('round-trips the active id and clears it when its deck is deleted', async () => {
    const { bridge } = makeMockBridge()
    const s = createStorage(bridge)
    const a = await s.createDeck('A')
    await s.setActiveDeckId(a.id)
    expect(await s.getActiveDeckId()).toBe(a.id)
    await s.deleteDeck(a.id)
    expect(await s.getActiveDeckId()).toBeNull()
  })
})

describe('storage — onboarded flag', () => {
  it('is false until set, then true', async () => {
    const { bridge } = makeMockBridge()
    const s = createStorage(bridge)
    expect(await s.getOnboarded()).toBe(false)
    await s.setOnboarded()
    expect(await s.getOnboarded()).toBe(true)
  })
})

describe('storage — deleteCard', () => {
  it('removes the named card and leaves others intact', async () => {
    const { bridge } = makeMockBridge()
    const s = createStorage(bridge)
    const deck: Deck = {
      id: 'd1',
      name: 'D',
      cards: [sampleCard({ id: 'keep' }), sampleCard({ id: 'drop' })],
    }
    await s.saveDeck(deck)
    await s.deleteCard('d1', 'drop')
    const loaded = await s.loadDeck('d1')
    expect(loaded!.cards.map((c) => c.id)).toEqual(['keep'])
  })

  it('is a no-op for an unknown card id', async () => {
    const { bridge } = makeMockBridge()
    const s = createStorage(bridge)
    const deck: Deck = { id: 'd1', name: 'D', cards: [sampleCard({ id: 'keep' })] }
    await s.saveDeck(deck)
    await s.deleteCard('d1', 'ghost')
    expect((await s.loadDeck('d1'))!.cards).toHaveLength(1)
  })
})
