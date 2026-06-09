// Generic versioned + chunked persistence helpers over a string KV bridge.
// Extracted so new code (the game's save) shares the pattern proven in
// storage.ts without modifying the shipped flashcards storage module.

export interface KVBridge {
  setLocalStorage(key: string, value: string): Promise<boolean>
  getLocalStorage(key: string): Promise<string>
}

export interface Envelope<T> {
  schemaVersion: number
  data: T
}

/** Wrap data in a versioned envelope JSON string. */
export function wrap<T>(data: T, schemaVersion: number): string {
  return JSON.stringify({ schemaVersion, data })
}

/**
 * Parse a stored blob, running ordered migrations to `currentSchema`.
 * `migrations[v-1]` upgrades a v→v+1 blob. Tolerates pre-envelope (unversioned)
 * blobs as v1, and returns `fallback` for missing ("") / corrupt input.
 */
export function unwrap<T>(
  raw: string,
  currentSchema: number,
  migrations: Array<(d: unknown) => unknown>,
  fallback: T,
): T {
  if (raw === '') return fallback
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return fallback
  }
  const isEnvelope =
    typeof parsed === 'object' && parsed !== null && 'schemaVersion' in parsed
  let v: number = isEnvelope ? (parsed as Envelope<unknown>).schemaVersion : 1
  let data: unknown = isEnvelope ? (parsed as Envelope<unknown>).data : parsed
  while (v < currentSchema) {
    data = migrations[v - 1](data)
    v++
  }
  return data as T
}

const DEFAULT_CHUNK_SIZE = 50_000

/**
 * Write `body` across `<prefix>.<i>` keys, then the count at `<prefix>._n`
 * LAST, so a half-write is never read as complete. Returns false on any failed
 * write. Caller serializes/debounces.
 */
export async function chunkWrite(
  bridge: KVBridge,
  prefix: string,
  body: string,
  chunkSize = DEFAULT_CHUNK_SIZE,
): Promise<boolean> {
  const n = Math.max(1, Math.ceil(body.length / chunkSize))
  for (let i = 0; i < n; i++) {
    const ok = await bridge.setLocalStorage(`${prefix}.${i}`, body.slice(i * chunkSize, (i + 1) * chunkSize))
    if (!ok) return false
  }
  return bridge.setLocalStorage(`${prefix}._n`, wrap(n, 1))
}

/**
 * Read `<prefix>` back. Returns "" if absent. Returns null if truncated (a
 * chunk reads "" before the count) — caller treats null as corrupt.
 */
export async function chunkRead(bridge: KVBridge, prefix: string): Promise<string | null> {
  const n = unwrap<number>(await bridge.getLocalStorage(`${prefix}._n`), 1, [], 0)
  if (!n || n < 1) return ''
  let joined = ''
  for (let i = 0; i < n; i++) {
    const part = await bridge.getLocalStorage(`${prefix}.${i}`)
    if (part === '') return null // truncated / partial write
    joined += part
  }
  return joined
}

/** Single-slot write queue: at most one write in flight; callers collapse to latest. */
export function createWriteQueue() {
  let tail: Promise<unknown> = Promise.resolve()
  return function serialize<T>(fn: () => Promise<T>): Promise<T> {
    const run = tail.then(fn, fn)
    tail = run.catch(() => {})
    return run
  }
}
