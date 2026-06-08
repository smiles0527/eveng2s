import type { Card } from './types'

// Codepoints the firmware LVGL font is believed to render. Source: community
// even-g2-notes (github.com/nickustinov/even-g2-notes, docs/display.md) —
// informative, not official. Conservative: when in doubt, a glyph is OUT until
// confirmed on the simulator. False positives are cheap (add to the list);
// false negatives (a glyph that silently vanishes) are the failure we refuse.

// Latin-1 Supplement gaps the font is missing.
const LATIN1_GAPS = new Set([0x00a8, 0x00af, 0x00b4, 0x00b5, 0x00b8]) // ¨ ¯ ´ µ ¸

// Curated non-Latin symbols (the only safe ones); also what the UI is built from.
const CURATED = new Set(
  [
    // arrows
    '←', '↑', '→', '↓', '↔', '⇒',
    // box drawing
    '│', '─', '╭', '╮', '╯', '╰',
    // block elements
    '█', '▇', '▆', '▅', '▄', '▃', '▂', '▁', '▒',
    // geometric shapes
    '●', '○', '■', '□', '★', '☆', '▲', '△', '▶', '▷', '▼', '▽', '◀', '◁',
    // card suits
    '♠', '♣', '♥', '♦',
    // misc
    '™', '†', '※', '∞',
  ].map((c) => c.codePointAt(0)!),
)

export function isSupported(cp: number): boolean {
  if (cp === 0x0a) return true // newline (used for layout)
  if (cp >= 0x20 && cp <= 0x7e) return true // printable ASCII + space
  if (cp >= 0x00a0 && cp <= 0x00ff) return !LATIN1_GAPS.has(cp) // Latin-1 minus gaps
  if (cp >= 0xff01 && cp <= 0xff5e) return true // fullwidth forms
  if (cp === 0x3000) return true // ideographic space
  return CURATED.has(cp)
}

export interface UnsupportedChar {
  char: string
  cp: number
  index: number
}

/** Every unsupported character, in order. Iterates by codepoint so emoji and
 *  other astral chars count as one offender, not two lone surrogates. */
export function findUnsupported(text: string): UnsupportedChar[] {
  const out: UnsupportedChar[] = []
  let index = 0
  for (const ch of text) {
    const cp = ch.codePointAt(0)!
    if (!isSupported(cp)) out.push({ char: ch, cp, index })
    index += ch.length
  }
  return out
}

export interface CardValidation {
  ok: boolean
  front: UnsupportedChar[]
  back: UnsupportedChar[]
}

export function validateCard(card: Pick<Card, 'front' | 'back'>): CardValidation {
  const front = findUnsupported(card.front)
  const back = findUnsupported(card.back)
  return { ok: front.length === 0 && back.length === 0, front, back }
}

// Conservative, opt-in substitutions. Anything not here is left as-is (and
// stays flagged by findUnsupported).
const TRANSLITERATE: Record<string, string> = {
  '“': '"', '”': '"', '″': '"', // “ ” ″
  '‘': "'", '’': "'", '′': "'", // ‘ ’ ′
  '—': '-', '–': '-', '−': '-', // — – −
  '…': '...', // …
  ' ': ' ', // nbsp
  'µ': 'u', // µ (a known font gap)
  'λ': 'lambda', 'π': 'pi', 'Δ': 'delta',
  'α': 'alpha', 'β': 'beta', 'θ': 'theta',
  'μ': 'mu', 'Σ': 'Sigma', 'Ω': 'Omega',
}

export function transliterate(text: string): string {
  let out = ''
  for (const ch of text) out += TRANSLITERATE[ch] ?? ch
  return out
}
