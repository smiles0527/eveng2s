import { describe, it, expect } from 'vitest'
import { createGestureDetector, DEFAULT_GESTURE_CONFIG } from './imu'

describe('gesture detector (gravity-robust)', () => {
  it('never fires on constant gravity (resting orientation)', () => {
    const d = createGestureDetector()
    let fired: string | null = null
    // ~1g resting on the nod axis, streamed continuously — must NOT auto-grade.
    for (let t = 0; t <= 3000; t += 100) fired = fired ?? d.feed({ x: 0, y: 1.0, z: 0 }, t)
    expect(fired).toBe(null)
  })

  it('ignores the first sample while it establishes a baseline', () => {
    const d = createGestureDetector()
    expect(d.feed({ x: 0, y: 1.0, z: 0 }, 0)).toBe(null)
  })

  it('detects a nod as "good" (transient deviation from baseline)', () => {
    const d = createGestureDetector()
    d.feed({ x: 0, y: 1.0, z: 0 }, 0) // baseline ≈ gravity
    d.feed({ x: 0, y: 1.0, z: 0 }, 100) // settle
    expect(d.feed({ x: 0, y: 1.8, z: 0 }, 200)).toBe('good') // +0.8 deviation
  })

  it('detects a shake as "again" (yaw reversals around baseline)', () => {
    const d = createGestureDetector()
    d.feed({ x: 0, y: 0, z: 0 }, 0) // baseline
    d.feed({ x: 0.6, y: 0, z: 0 }, 50)
    d.feed({ x: -0.6, y: 0, z: 0 }, 100)
    expect(d.feed({ x: 0.6, y: 0, z: 0 }, 150)).toBe('again')
  })

  it('respects the refractory period after firing', () => {
    const d = createGestureDetector()
    d.feed({ x: 0, y: 0, z: 0 }, 0)
    expect(d.feed({ x: 0, y: 0.8, z: 0 }, 100)).toBe('good')
    expect(d.feed({ x: 0, y: 0.8, z: 0 }, 200)).toBe(null) // within refractoryMs
    expect(d.feed({ x: 0, y: 0.8, z: 0 }, 100 + DEFAULT_GESTURE_CONFIG.refractoryMs + 50)).toBe('good')
  })

  it('ignores sub-threshold motion', () => {
    const d = createGestureDetector()
    d.feed({ x: 0, y: 0, z: 0 }, 0)
    expect(d.feed({ x: 0.2, y: 0.3, z: 0 }, 100)).toBe(null)
  })
})
