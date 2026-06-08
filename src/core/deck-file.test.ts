import { describe, it, expect } from 'vitest'
import { serializeCards, deckNameFromFilename } from './deck-file'
import { parse } from './parse'

describe('serializeCards', () => {
  it('writes one "front | back" line per card', () => {
    expect(serializeCards([{ front: 'a', back: 'b' }])).toBe('a | b')
    expect(serializeCards([{ front: 'a', back: 'b' }, { front: 'c', back: 'd' }])).toBe('a | b\nc | d')
  })

  it('returns empty string for no cards', () => {
    expect(serializeCards([])).toBe('')
  })

  it('round-trips through parse (content without the separator)', () => {
    const cards = [
      { front: 'What is an eigenvector?', back: 'a vector v where Av = scalar*v' },
      { front: 'rank', back: 'number of independent rows' },
    ]
    const parsed = parse(serializeCards(cards)).cards
    expect(parsed.map((c) => ({ front: c.front, back: c.back }))).toEqual(cards)
  })
})

describe('deckNameFromFilename', () => {
  it('strips path and extension and humanizes separators', () => {
    expect(deckNameFromFilename('linear-algebra.txt')).toBe('Linear Algebra')
    expect(deckNameFromFilename('my_deck.csv')).toBe('My Deck')
  })

  it('handles no extension and nested paths', () => {
    expect(deckNameFromFilename('deck')).toBe('Deck')
    expect(deckNameFromFilename('path/to/Spanish 101.txt')).toBe('Spanish 101')
    expect(deckNameFromFilename('C:\\decks\\bio-notes.txt')).toBe('Bio Notes')
  })

  it('falls back when there is no usable name', () => {
    expect(deckNameFromFilename('.txt')).toBe('Imported deck')
    expect(deckNameFromFilename('')).toBe('Imported deck')
  })

  it('only strips the final extension', () => {
    expect(deckNameFromFilename('a.b.txt')).toBe('A.b')
  })
})
