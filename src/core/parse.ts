import type { Card } from './types'
import { newCardState } from './scheduler'
import { todayLocal } from './time'

export interface ParseResult {
  cards: Card[]
  skipped: number
}

/** Index of the first `|` or first Tab, whichever comes earlier; -1 if neither. */
function separatorIndex(line: string): number {
  const pipe = line.indexOf('|')
  const tab = line.indexOf('\t')
  if (pipe === -1) return tab
  if (tab === -1) return pipe
  return Math.min(pipe, tab)
}

/**
 * Parse a bulk-paste block: one card per line, `front | back` (or Tab). Blank
 * lines are ignored; lines without a separator or with an empty side are
 * counted as `skipped`.
 */
export function parse(input: string): ParseResult {
  const cards: Card[] = []
  let skipped = 0
  const today = todayLocal()

  for (const raw of input.split(/\r?\n/)) {
    if (raw.trim() === '') continue
    const sep = separatorIndex(raw)
    if (sep === -1) {
      skipped++
      continue
    }
    const front = raw.slice(0, sep).trim()
    const back = raw.slice(sep + 1).trim()
    if (front === '' || back === '') {
      skipped++
      continue
    }
    cards.push({ id: crypto.randomUUID(), front, back, due: today, ...newCardState() })
  }

  return { cards, skipped }
}
