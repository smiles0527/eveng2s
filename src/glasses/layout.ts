import { getTextWidth } from '@evenrealities/pretext'

export const LINE_HEIGHT = 27

const spaceW = () => getTextWidth(' ') || 1

/** Greedy word-wrap by measured pixel width. */
export function wrapLines(text: string, innerW: number): string[] {
  const lines: string[] = []
  let cur = ''
  for (const word of text.split(' ')) {
    const candidate = cur ? `${cur} ${word}` : word
    if (cur === '' || getTextWidth(candidate) <= innerW) {
      cur = candidate
    } else {
      lines.push(cur)
      cur = word
    }
  }
  if (cur) lines.push(cur)
  return lines.length ? lines : ['']
}

/** Pad a single line with leading spaces to horizontally center it. */
export function centerLine(text: string, innerW: number): string {
  const w = getTextWidth(text)
  if (w >= innerW) return text
  const pad = Math.max(0, Math.round((innerW - w) / 2 / spaceW()))
  return ' '.repeat(pad) + text
}

/** Left text + right text pushed to opposite edges of innerW. Uses floor (never
 *  overshoots the width) and keeps a one-space margin so the firmware can't wrap
 *  the trailing token onto a second line. */
export function justify(left: string, right: string, innerW: number): string {
  const gap = innerW - getTextWidth(left) - getTextWidth(right)
  if (gap <= spaceW()) return `${left} ${right}`
  const spaces = Math.max(1, Math.floor(gap / spaceW()) - 1)
  return left + ' '.repeat(spaces) + right
}

/** Wrap + horizontally center each line, then vertically center the block. */
export function centerBlock(text: string, innerW: number, innerH: number): string {
  const lines = text.split('\n').flatMap((l) => wrapLines(l, innerW))
  const centered = lines.map((l) => centerLine(l, innerW))
  const maxLines = Math.max(1, Math.floor(innerH / LINE_HEIGHT))
  const padTop = Math.max(0, Math.floor((maxLines - centered.length) / 2))
  return '\n'.repeat(padTop) + centered.join('\n')
}
