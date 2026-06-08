/**
 * Plain-text deck file format: one card per line, `front | back`. Human-typeable
 * and round-trips through `parse` (which also accepts Tab). `|` is reserved as
 * the separator, so card text should not contain it.
 */
export function serializeCards(cards: Array<{ front: string; back: string }>): string {
  return cards.map((c) => `${c.front} | ${c.back}`).join('\n')
}

/** Derive a human deck name from a file name: strip path + final extension,
 *  turn -/_ into spaces, and capitalize each word. */
export function deckNameFromFilename(filename: string): string {
  const base = filename.split(/[\\/]/).pop() ?? ''
  const noExt = base.replace(/\.[^.]+$/, '')
  const words = noExt
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!words) return 'Imported deck'
  return words
    .split(' ')
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(' ')
}
