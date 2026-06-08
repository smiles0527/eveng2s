import type { Grade } from '../core/types'

export interface ImuSample {
  x: number
  y: number
  z: number
}

export interface GestureConfig {
  windowMs: number
  nodAxis: 'x' | 'y' | 'z' // ASSUMPTION: pitch — validate on hardware
  shakeAxis: 'x' | 'y' | 'z' // ASSUMPTION: yaw — validate on hardware
  nodThreshold: number
  shakeThreshold: number
  shakeMinReversals: number
  refractoryMs: number
}

// Conservative defaults: bias toward false-negatives (a missed nod just means
// the user taps; a phantom grade is worse). Tune on the simulator/hardware.
export const DEFAULT_GESTURE_CONFIG: GestureConfig = {
  windowMs: 400,
  nodAxis: 'y',
  shakeAxis: 'x',
  nodThreshold: 0.6,
  shakeThreshold: 0.5,
  shakeMinReversals: 2,
  refractoryMs: 600,
}

// How fast the baseline tracks slow changes (gravity / posture). Small enough
// that a quick nod/shake shows up as deviation, not absorbed into the baseline.
const BASELINE_ALPHA = 0.1

/**
 * Additive nod/shake detector over the IMU stream. `feed` returns a grade when a
 * gesture is recognized, else null. Touch remains the source of truth — this only
 * ever surfaces the same grades.
 *
 * Gravity-robust: it works on each sample's DEVIATION from a slowly-tracked
 * baseline (an EMA that follows gravity/posture), not the raw value. At rest the
 * deviation is ~0, so a resting orientation — where one axis reads ~1g — can
 * never fire. Only actual motion (a deviation spike) registers.
 *
 * NOTE: thresholds are conservative placeholders; the axis→pitch/yaw mapping and
 * magnitudes still need validation on real hardware. The at-rest false-fire
 * (which auto-skipped cards) is fixed regardless of calibration.
 */
export function createGestureDetector(cfg: GestureConfig = DEFAULT_GESTURE_CONFIG) {
  let baseline: ImuSample | null = null
  let window: Array<{ t: number; nod: number; shake: number }> = []
  let lockedUntil = 0

  function feed(sample: ImuSample, t: number): Grade | null {
    if (!baseline) {
      baseline = { ...sample } // first sample establishes the baseline; no deviation yet
      return null
    }
    const devNod = sample[cfg.nodAxis] - baseline[cfg.nodAxis]
    const devShake = sample[cfg.shakeAxis] - baseline[cfg.shakeAxis]
    baseline = {
      x: baseline.x + BASELINE_ALPHA * (sample.x - baseline.x),
      y: baseline.y + BASELINE_ALPHA * (sample.y - baseline.y),
      z: baseline.z + BASELINE_ALPHA * (sample.z - baseline.z),
    }

    if (t < lockedUntil) return null
    window.push({ t, nod: devNod, shake: devShake })
    window = window.filter((w) => t - w.t <= cfg.windowMs)

    // Shake first: it's the larger motion and can also trip the nod axis.
    let reversals = 0
    let lastSign = 0
    for (const w of window) {
      if (Math.abs(w.shake) < cfg.shakeThreshold) continue
      const sign = Math.sign(w.shake)
      if (sign !== 0 && lastSign !== 0 && sign !== lastSign) reversals++
      if (sign !== 0) lastSign = sign
    }
    if (reversals >= cfg.shakeMinReversals) return fire('again')

    if (window.some((w) => Math.abs(w.nod) >= cfg.nodThreshold)) return fire('good')
    return null

    function fire(grade: Grade): Grade {
      lockedUntil = t + cfg.refractoryMs
      window = []
      return grade
    }
  }

  return { feed }
}
