// SEED-040 | tiny haptic feedback helper. Safe to call on any platform —
// no-op when `navigator.vibrate` isn't supported (desktop, iOS Safari without
// the Web Vibration API, SSR, etc.).
//
// Usage:
//   haptic()       → 10ms tap (default for taps, sends, toggles)
//   haptic(20)     → slightly stronger pulse
//   haptic([10, 30, 10]) → custom pattern
export function haptic(pattern: number | number[] = 10): void {
  if (typeof navigator === 'undefined') return
  if (typeof navigator.vibrate !== 'function') return
  try {
    navigator.vibrate(pattern)
  } catch {
    // Some browsers throw if vibration is blocked by user/site policy.
  }
}
