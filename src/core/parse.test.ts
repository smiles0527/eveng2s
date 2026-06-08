import { describe, it, expect } from 'vitest'
import { parse } from './parse'

describe('parse — separators', () => {
  it('splits on a pipe', () => {
    const { cards, skipped } = parse('a | b')
    expect(cards).toHaveLength(1)
    expect(cards[0]).toMatchObject({ front: 'a', back: 'b' })
    expect(skipped).toBe(0)
  })

  it('splits on a tab', () => {
    const { cards } = parse('a\tb')
    expect(cards[0]).toMatchObject({ front: 'a', back: 'b' })
  })

  it('splits each line by its own separator (mixed)', () => {
    const { cards } = parse('a|b\nc\td')
    expect(cards).toHaveLength(2)
    expect(cards[1]).toMatchObject({ front: 'c', back: 'd' })
  })

  it('uses the earliest separator when both appear', () => {
    expect(parse('a\tb|c').cards[0]).toMatchObject({ front: 'a', back: 'b|c' })
    expect(parse('a|b\tc').cards[0]).toMatchObject({ front: 'a', back: 'b\tc' })
  })

  it('splits on the first separator only', () => {
    expect(parse('a | b | c').cards[0]).toMatchObject({ front: 'a', back: 'b | c' })
  })
})

describe('parse — trimming & whitespace', () => {
  it('trims front and back', () => {
    expect(parse('  a  |  b  ').cards[0]).toMatchObject({ front: 'a', back: 'b' })
  })

  it('skips blank/whitespace-only lines without counting them', () => {
    const { cards, skipped } = parse('a|b\n\n   \nc|d')
    expect(cards).toHaveLength(2)
    expect(skipped).toBe(0)
  })

  it('handles CRLF and strips the trailing carriage return', () => {
    const { cards } = parse('a|b\r\nc|d')
    expect(cards).toHaveLength(2)
    expect(cards[0]).toMatchObject({ front: 'a', back: 'b' })
  })

  it('returns empty for empty input', () => {
    expect(parse('')).toEqual({ cards: [], skipped: 0 })
  })
})

describe('parse — malformed lines counted as skipped', () => {
  it('counts a line with no separator', () => {
    const { cards, skipped } = parse('abc')
    expect(cards).toHaveLength(0)
    expect(skipped).toBe(1)
  })

  it('counts a line with empty front', () => {
    expect(parse('| b').skipped).toBe(1)
  })

  it('counts a line with empty back', () => {
    expect(parse('a |').skipped).toBe(1)
  })
})

describe('parse — card initialization', () => {
  it('gives new cards fresh SM-2 state, a numeric due, and a non-empty id', () => {
    const c = parse('a|b').cards[0]
    expect(c).toMatchObject({ ef: 2.5, interval: 0, reps: 0 })
    expect(typeof c.due).toBe('number')
    expect(c.id.length).toBeGreaterThan(0)
  })

  it('gives each card a distinct id', () => {
    const { cards } = parse('a|b\nc|d')
    expect(cards[0].id).not.toBe(cards[1].id)
  })
})
