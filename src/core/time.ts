const DAY_MS = 86_400_000

/**
 * Day number anchored to the user's LOCAL midnight. We read the local calendar
 * fields and re-encode them at UTC midnight, so the divisor is always a whole
 * UTC day — DST-safe (a real local day can be 23 or 25 hours, so dividing a
 * local timestamp would drift).
 */
export function localDayIndex(d: Date): number {
  return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / DAY_MS)
}

export const todayLocal = (): number => localDayIndex(new Date())
