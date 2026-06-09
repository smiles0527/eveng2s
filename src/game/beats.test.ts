import { describe, it, expect } from 'vitest'
import { findUnsupported } from '../core/glyphs'
import { BEATS, triggerMet, pendingBeats, type BeatSnapshot } from './beats'
import type { BeatTrigger } from './types'

const snap = (over: Partial<BeatSnapshot> = {}): BeatSnapshot => ({
  decodesCompleted: 0,
  signalRate: 0,
  ownedTech: [],
  ...over,
})

describe('BEATS — glyph safety', () => {
  it('every body is glyph-clean (ASCII / firmware-safe)', () => {
    for (const b of BEATS) {
      expect(findUnsupported(b.body)).toEqual([])
    }
  })
  it('every title is glyph-clean', () => {
    for (const b of BEATS) {
      expect(findUnsupported(b.title ?? '')).toEqual([])
    }
  })
})

describe('BEATS — structure', () => {
  it('has exactly 8 beats', () => {
    expect(BEATS).toHaveLength(8)
  })
  it('index is unique and gap-free 0..7', () => {
    expect(BEATS.map((b) => b.index)).toEqual([0, 1, 2, 3, 4, 5, 6, 7])
  })
  it('ids are the spec ids in order', () => {
    expect(BEATS.map((b) => b.id)).toEqual([
      'first-contact',
      'the-loop',
      'a-voice',
      'her-name',
      'how-far',
      'not-a-call',
      'the-coords',
      'still-here',
    ])
  })
  it('ids are unique', () => {
    expect(new Set(BEATS.map((b) => b.id)).size).toBe(BEATS.length)
  })
  it('every body is <= 200 chars', () => {
    for (const b of BEATS) {
      expect(b.body.length).toBeLessThanOrEqual(200)
    }
  })
  it('beat 4 (how-far) gates on decode count', () => {
    expect(BEATS[4].id).toBe('how-far')
    expect(BEATS[4].trigger).toEqual({ kind: 'decodesCompleted', n: 11 })
  })
  it('carries monotonic decode-count thresholds in order', () => {
    expect(BEATS.map((b) => b.trigger)).toEqual([
      { kind: 'decodesCompleted', n: 1 },
      { kind: 'decodesCompleted', n: 3 },
      { kind: 'decodesCompleted', n: 5 },
      { kind: 'decodesCompleted', n: 8 },
      { kind: 'decodesCompleted', n: 11 },
      { kind: 'decodesCompleted', n: 15 },
      { kind: 'decodesCompleted', n: 20 },
      { kind: 'decodesCompleted', n: 25 },
    ])
  })
  it('thresholds strictly increase so the linear gate never stalls', () => {
    const ns = BEATS.map((b) => (b.trigger.kind === 'decodesCompleted' ? b.trigger.n : NaN))
    for (let i = 1; i < ns.length; i++) expect(ns[i]).toBeGreaterThan(ns[i - 1])
  })
})

describe('triggerMet — decodesCompleted', () => {
  const t: BeatTrigger = { kind: 'decodesCompleted', n: 3 }
  it('false below threshold', () => {
    expect(triggerMet(t, snap({ decodesCompleted: 2 }))).toBe(false)
  })
  it('true at threshold (>=)', () => {
    expect(triggerMet(t, snap({ decodesCompleted: 3 }))).toBe(true)
  })
  it('true above threshold', () => {
    expect(triggerMet(t, snap({ decodesCompleted: 9 }))).toBe(true)
  })
})

describe('triggerMet — signalRate', () => {
  const t: BeatTrigger = { kind: 'signalRate', value: 50 }
  it('false below threshold', () => {
    expect(triggerMet(t, snap({ signalRate: 49.9 }))).toBe(false)
  })
  it('true at threshold (>=)', () => {
    expect(triggerMet(t, snap({ signalRate: 50 }))).toBe(true)
  })
  it('true above threshold', () => {
    expect(triggerMet(t, snap({ signalRate: 300 }))).toBe(true)
  })
})

describe('triggerMet — tech', () => {
  const t: BeatTrigger = { kind: 'tech', nodeId: 'd.phaselock' }
  it('false when the node is not owned', () => {
    expect(triggerMet(t, snap({ ownedTech: ['d.other'] }))).toBe(false)
  })
  it('true when the node is owned', () => {
    expect(triggerMet(t, snap({ ownedTech: ['d.other', 'd.phaselock'] }))).toBe(true)
  })
})

describe('pendingBeats', () => {
  it('is empty when nothing is met', () => {
    expect(pendingBeats([], snap())).toEqual([])
  })

  it('returns the first beat once its trigger is met', () => {
    const r = pendingBeats([], snap({ decodesCompleted: 1 }))
    expect(r.map((b) => b.id)).toEqual(['first-contact'])
  })

  it('breaks at the first unmet trigger (does not skip ahead)', () => {
    // decodes=4 meets beats 0 (1) and 1 (3); beat 2 (5) is unmet and gates the scan.
    const r = pendingBeats([], snap({ decodesCompleted: 4 }))
    expect(r.map((b) => b.id)).toEqual(['first-contact', 'the-loop'])
  })

  it('queues multiple in order when several thresholds cross at once', () => {
    const r = pendingBeats([], snap({ decodesCompleted: 8 }))
    expect(r.map((b) => b.id)).toEqual(['first-contact', 'the-loop', 'a-voice', 'her-name'])
  })

  it('respects seen — skips an already-seen leading beat but keeps gating linear', () => {
    const r = pendingBeats(['first-contact'], snap({ decodesCompleted: 3 }))
    expect(r.map((b) => b.id)).toEqual(['the-loop'])
  })

  it('breaks on an unseen unmet beat even when a later beat would be met', () => {
    // first-contact seen; the-loop (>=3) is unmet at decodesCompleted=1, so the
    // scan stops there even though nothing later could be reached anyway.
    const r = pendingBeats(['first-contact'], snap({ decodesCompleted: 1 }))
    expect(r).toEqual([])
  })

  it('returns nothing once every reachable beat is seen', () => {
    const seen = ['first-contact', 'the-loop']
    const r = pendingBeats(seen, snap({ decodesCompleted: 3, signalRate: 0 }))
    expect(r).toEqual([])
  })

  it('advances through the arc as decode count climbs', () => {
    const r = pendingBeats([], snap({ decodesCompleted: 11 }))
    expect(r.map((b) => b.id)).toEqual(['first-contact', 'the-loop', 'a-voice', 'her-name', 'how-far'])
  })

  it('surfaces every beat once all thresholds are crossed', () => {
    const r = pendingBeats([], snap({ decodesCompleted: 25 }))
    expect(r).toHaveLength(BEATS.length)
  })

  it('does not mutate the seen array it is given', () => {
    const seen: string[] = []
    pendingBeats(seen, snap({ decodesCompleted: 1 }))
    expect(seen).toEqual([])
  })
})
