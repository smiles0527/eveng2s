import { describe, it, expect } from 'vitest'
import { getTextWidth } from '@evenrealities/pretext'
import { wrapLines, centerLine, justify, centerBlock } from './layout'

describe('wrapLines', () => {
  it('wraps so each line fits the width', () => {
    const innerW = 120
    const lines = wrapLines('the quick brown fox jumps over the lazy dog', innerW)
    expect(lines.length).toBeGreaterThan(1)
    for (const l of lines) expect(getTextWidth(l)).toBeLessThanOrEqual(innerW)
  })
  it('keeps short text on one line', () => {
    expect(wrapLines('hi', 500)).toEqual(['hi'])
  })
})

describe('centerLine', () => {
  it('adds leading spaces and no trailing space', () => {
    const out = centerLine('hi', 200)
    expect(out.startsWith(' ')).toBe(true)
    expect(out.endsWith(' ')).toBe(false)
    expect(out.trim()).toBe('hi')
  })
  it('roughly centers (leading pad ≈ remaining/2)', () => {
    const innerW = 200
    const out = centerLine('hi', innerW)
    const lead = out.length - out.trimStart().length
    const expected = Math.round((innerW - getTextWidth('hi')) / 2 / getTextWidth(' '))
    expect(lead).toBe(expected)
  })
  it('returns text unchanged when wider than width', () => {
    expect(centerLine('hello', 10)).toBe('hello')
  })
})

describe('justify', () => {
  it('puts left at start, right at end, gap between', () => {
    const out = justify('Demo', 'card 3 / 12', 560)
    expect(out.startsWith('Demo')).toBe(true)
    expect(out.endsWith('card 3 / 12')).toBe(true)
    expect(out).toContain('  ')
  })
})

describe('centerBlock', () => {
  it('vertically pads short text within the height', () => {
    const out = centerBlock('hi', 560, 200)
    expect(out.startsWith('\n')).toBe(true)
    expect(out.trim()).toBe('hi')
  })
  it('wraps and centers multi-line content within width', () => {
    const innerW = 120
    const out = centerBlock('the quick brown fox jumps over the lazy dog', innerW, 300)
    for (const line of out.split('\n')) {
      if (line.trim() === '') continue
      expect(getTextWidth(line)).toBeLessThanOrEqual(innerW)
    }
  })
})
