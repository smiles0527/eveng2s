import type { Deck, DeckMeta, Envelope } from './types'

export interface StorageBridge {
  setLocalStorage(key: string, value: string): Promise<boolean>
  getLocalStorage(key: string): Promise<string>
}

const CURRENT_SCHEMA = 1
const DEFAULT_CHUNK_SIZE = 50_000

// Ordered, append-only: migrations[v-1] upgrades a v→v+1 blob.
const migrations: Array<(d: any) => any> = []

const INDEX_KEY = 'flashcards.index'
const ACTIVE_KEY = 'flashcards.active'
const ONBOARDED_KEY = 'flashcards.onboarded'
const deckPrefix = (id: string) => `flashcards.deck.${id}`
const countKey = (id: string) => `${deckPrefix(id)}._n`
const chunkKey = (id: string, i: number) => `${deckPrefix(id)}.${i}`

function wrap<T>(data: T): string {
  return JSON.stringify({ schemaVersion: CURRENT_SCHEMA, data })
}

// `raw === ''` means a missing key. Tolerates pre-envelope blobs as v1.
function unwrap<T>(raw: string, fallback: T): T {
  if (raw === '') return fallback
  let parsed: any
  try {
    parsed = JSON.parse(raw)
  } catch {
    return fallback
  }
  const isEnvelope = parsed && typeof parsed === 'object' && 'schemaVersion' in parsed
  let v: number = isEnvelope ? parsed.schemaVersion : 1
  let data: any = isEnvelope ? parsed.data : parsed
  while (v < CURRENT_SCHEMA) {
    data = migrations[v - 1](data)
    v++
  }
  return data as T
}

export interface StorageOptions {
  chunkSize?: number
}

export interface Storage {
  listDecks(): Promise<DeckMeta[]>
  createDeck(name: string): Promise<DeckMeta>
  loadDeck(id: string): Promise<Deck | null>
  saveDeck(deck: Deck): Promise<boolean>
  deleteDeck(id: string): Promise<void>
  getActiveDeckId(): Promise<string | null>
  setActiveDeckId(id: string): Promise<void>
  deleteCard(deckId: string, cardId: string): Promise<boolean>
  getOnboarded(): Promise<boolean>
  setOnboarded(): Promise<void>
}

export function createStorage(bridge: StorageBridge, opts: StorageOptions = {}): Storage {
  const chunkSize = opts.chunkSize ?? DEFAULT_CHUNK_SIZE

  // Single-slot write queue: one bridge write in flight at a time.
  let tail: Promise<unknown> = Promise.resolve()
  const serialize = <T>(fn: () => Promise<T>): Promise<T> => {
    const run = tail.then(fn, fn)
    tail = run.catch(() => {})
    return run
  }

  async function listDecks(): Promise<DeckMeta[]> {
    return unwrap<DeckMeta[]>(await bridge.getLocalStorage(INDEX_KEY), [])
  }

  async function writeIndex(metas: DeckMeta[]): Promise<boolean> {
    return bridge.setLocalStorage(INDEX_KEY, wrap(metas))
  }

  async function upsertIndex(meta: DeckMeta): Promise<void> {
    const metas = await listDecks()
    const i = metas.findIndex((m) => m.id === meta.id)
    if (i === -1) metas.push(meta)
    else metas[i] = meta
    await writeIndex(metas)
  }

  async function loadDeck(id: string): Promise<Deck | null> {
    const n = unwrap<number>(await bridge.getLocalStorage(countKey(id)), 0)
    if (!n || n < 1) return null
    let joined = ''
    for (let i = 0; i < n; i++) {
      const chunk = await bridge.getLocalStorage(chunkKey(id, i))
      if (chunk === '') return null // truncated / partial write
      joined += chunk
    }
    const deck = unwrap<Deck | null>(joined, null)
    if (!deck || !Array.isArray(deck.cards)) return null
    return deck
  }

  function saveDeck(deck: Deck): Promise<boolean> {
    return serialize(async () => {
      const body = wrap(deck)
      const n = Math.max(1, Math.ceil(body.length / chunkSize))
      for (let i = 0; i < n; i++) {
        const ok = await bridge.setLocalStorage(
          chunkKey(deck.id, i),
          body.slice(i * chunkSize, (i + 1) * chunkSize),
        )
        if (!ok) return false
      }
      const ok = await bridge.setLocalStorage(countKey(deck.id), wrap(n)) // count last
      if (!ok) return false
      await upsertIndex({ id: deck.id, name: deck.name })
      return true
    })
  }

  async function createDeck(name: string): Promise<DeckMeta> {
    const meta: DeckMeta = { id: crypto.randomUUID(), name }
    await saveDeck({ id: meta.id, name, cards: [] })
    return meta
  }

  async function deleteDeck(id: string): Promise<void> {
    await serialize(async () => {
      await bridge.setLocalStorage(countKey(id), '') // unreachable ⇒ loadDeck null
      const metas = (await listDecks()).filter((m) => m.id !== id)
      await writeIndex(metas)
      if ((await getActiveDeckId()) === id) await bridge.setLocalStorage(ACTIVE_KEY, '')
    })
  }

  async function getActiveDeckId(): Promise<string | null> {
    const id = unwrap<string>(await bridge.getLocalStorage(ACTIVE_KEY), '')
    if (!id) return null
    const known = (await listDecks()).some((m) => m.id === id)
    return known ? id : null
  }

  async function setActiveDeckId(id: string): Promise<void> {
    await bridge.setLocalStorage(ACTIVE_KEY, wrap(id))
  }

  async function getOnboarded(): Promise<boolean> {
    return unwrap<boolean>(await bridge.getLocalStorage(ONBOARDED_KEY), false)
  }

  async function setOnboarded(): Promise<void> {
    await bridge.setLocalStorage(ONBOARDED_KEY, wrap(true))
  }

  async function deleteCard(deckId: string, cardId: string): Promise<boolean> {
    const deck = await loadDeck(deckId)
    if (!deck) return false
    deck.cards = deck.cards.filter((c) => c.id !== cardId)
    return saveDeck(deck)
  }

  return {
    listDecks,
    createDeck,
    loadDeck,
    saveDeck,
    deleteDeck,
    getActiveDeckId,
    setActiveDeckId,
    deleteCard,
    getOnboarded,
    setOnboarded,
  }
}
