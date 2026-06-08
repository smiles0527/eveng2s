import { describe, it, expect } from 'vitest'
import { isSupported, findUnsupported, validateCard, transliterate } from './glyphs'

const cp = (ch: string) => ch.codePointAt(0)!

describe('isSupported', () => {
  it('accepts printable ASCII, space, and newline', () => {
    expect(isSupported(cp('A'))).toBe(true)
    expect(isSupported(cp(' '))).toBe(true)
    expect(isSupported(cp('\n'))).toBe(true)
  })
  it('accepts accented Latin-1', () => {
    expect(isSupported(cp('é'))).toBe(true)
  })
  it('rejects the known Latin-1 font gaps', () => {
    expect(isSupported(cp('µ'))).toBe(false)
    expect(isSupported(cp('¨'))).toBe(false)
  })
  it('accepts curated symbols used by the UI', () => {
    expect(isSupported(cp('●'))).toBe(true)
    expect(isSupported(cp('○'))).toBe(true)
    expect(isSupported(cp('↑'))).toBe(true)
    expect(isSupported(cp('─'))).toBe(true)
    expect(isSupported(cp('█'))).toBe(true)
  })
  it('rejects confirmed-absent characters', () => {
    expect(isSupported(cp('λ'))).toBe(false)
    expect(isSupported(cp('—'))).toBe(false)
    expect(isSupported(cp('…'))).toBe(false)
    expect(isSupported(cp('“'))).toBe(false)
    expect(isSupported(cp('中'))).toBe(false)
    expect(isSupported(cp('😀'))).toBe(false)
  })
  it('accepts the fullwidth subset and ideographic space', () => {
    expect(isSupported(cp('Ａ'))).toBe(true)
    expect(isSupported(cp('　'))).toBe(true)
  })
})

describe('findUnsupported', () => {
  it('returns [] for clean text (newlines allowed)', () => {
    expect(findUnsupported('hello\nworld')).toEqual([])
  })
  it('reports each offender with char, codepoint, and index', () => {
    const r = findUnsupported('λ-calc')
    expect(r).toHaveLength(1)
    expect(r[0]).toEqual({ char: 'λ', cp: 0x3bb, index: 0 })
  })
  it('reports multiple offenders in order with correct indices', () => {
    const r = findUnsupported('a—b…')
    expect(r.map((u) => u.char)).toEqual(['—', '…'])
    expect(r[0].index).toBe(1)
    expect(r[1].index).toBe(3)
  })
  it('treats an emoji (surrogate pair) as a single offender', () => {
    const r = findUnsupported('😀')
    expect(r).toHaveLength(1)
    expect(r[0].char).toBe('😀')
    expect(r[0].cp).toBe(0x1f600)
  })
})

describe('validateCard', () => {
  it('is ok when both sides are clean', () => {
    expect(validateCard({ front: 'ok', back: 'fine' })).toEqual({ ok: true, front: [], back: [] })
  })
  it('flags the offending side', () => {
    const v = validateCard({ front: 'λ', back: 'ok' })
    expect(v.ok).toBe(false)
    expect(v.front).toHaveLength(1)
    expect(v.back).toEqual([])
  })
})

describe('transliterate', () => {
  it('replaces smart quotes, dashes, and ellipsis', () => {
    expect(transliterate('“hi” — wait…')).toBe('"hi" - wait...')
  })
  it('spells out mapped Greek and fixes the µ gap', () => {
    expect(transliterate('λ µ')).toBe('lambda u')
  })
  it('leaves unmapped characters unchanged', () => {
    expect(transliterate('中 😀')).toBe('中 😀')
  })
})
