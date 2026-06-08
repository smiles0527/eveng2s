/**
 * Quiescence-based input gate. A single physical gesture in the simulator (a
 * trackpad/scroll swipe) can emit a burst of events; without this, the burst
 * cascades (flip → grade → skip). The gate accepts the first event, then rejects
 * everything until input has been quiet for `quietMs` — and each rejected event
 * *extends* the quiet window, so a continuous burst collapses to one action.
 * A deliberate second gesture after a natural pause still passes.
 */
export function createInputGate(quietMs: number) {
  let lockUntil = 0
  return {
    accept(now: number): boolean {
      const locked = now < lockUntil
      lockUntil = now + quietMs
      return !locked
    },
  }
}
