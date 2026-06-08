import { describe, it, expect } from 'vitest'
import { localDayIndex, todayLocal } from './time'

describe('localDayIndex', () => {
  it('maps different times on the same local day to the same index', () => {
    const morning = new Date(2026, 5, 8, 0, 0, 0)
    const night = new Date(2026, 5, 8, 23, 59, 59)
    expect(localDayIndex(morning)).toBe(localDayIndex(night))
  })

  it('maps consecutive local days to consecutive integers', () => {
    const d8 = new Date(2026, 5, 8)
    const d9 = new Date(2026, 5, 9)
    expect(localDayIndex(d9)).toBe(localDayIndex(d8) + 1)
  })

  it('stays consecutive across a spring DST date (no skip/repeat)', () => {
    const before = new Date(2026, 2, 8) // typical US spring-forward date
    const after = new Date(2026, 2, 9)
    expect(localDayIndex(after)).toBe(localDayIndex(before) + 1)
  })

  it('stays consecutive across a year boundary', () => {
    const dec31 = new Date(2026, 11, 31)
    const jan1 = new Date(2027, 0, 1)
    expect(localDayIndex(jan1)).toBe(localDayIndex(dec31) + 1)
  })

  it('returns an integer', () => {
    expect(Number.isInteger(localDayIndex(new Date(2026, 5, 8)))).toBe(true)
  })
})

describe('todayLocal', () => {
  it('equals the local-day index of now', () => {
    expect(todayLocal()).toBe(localDayIndex(new Date()))
  })
})
