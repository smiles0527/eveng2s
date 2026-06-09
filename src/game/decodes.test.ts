import { describe, it, expect } from 'vitest'
import { DECODES, decodeById } from './decodes'

describe('DECODES catalogue', () => {
  it('has unique ids', () => {
    const ids = DECODES.map((d) => d.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('durations strictly increase across the arc', () => {
    for (let i = 1; i < DECODES.length; i++) {
      expect(DECODES[i].durationMs).toBeGreaterThan(DECODES[i - 1].durationMs)
    }
  })

  it('has non-negative signalCost and positive fragmentYield for every decode', () => {
    for (const d of DECODES) {
      expect(d.signalCost).toBeGreaterThanOrEqual(0)
      expect(d.fragmentYield).toBeGreaterThan(0)
    }
  })

  it('has at least one corrupted decode', () => {
    expect(DECODES.some((d) => d.corrupted === true)).toBe(true)
  })
})

describe('decodeById', () => {
  it('finds a known id', () => {
    const d = decodeById('first-contact')
    expect(d).toBeDefined()
    expect(d?.id).toBe('first-contact')
  })

  it('returns undefined for an unknown id', () => {
    expect(decodeById('no-such-decode')).toBeUndefined()
  })
})
