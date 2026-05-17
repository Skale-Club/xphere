'use client'

import * as React from 'react'

interface AnimatedNumberProps {
  /** Target value to animate to. */
  value: number
  /** Animation duration in ms (default 800). */
  duration?: number
  /** Decimal places to render. */
  decimals?: number
  /** Optional prefix (e.g. "$"). */
  prefix?: string
  /** Optional suffix (e.g. "%"). */
  suffix?: string
  /** Use locale formatting (default true). */
  locale?: boolean
  /** className applied to the span. */
  className?: string
}

/**
 * Counts up from 0 to `value` over `duration` ms on mount.
 * Uses a cubic ease-out for that satisfying "settle" at the end.
 * Respects prefers-reduced-motion.
 */
export function AnimatedNumber({
  value,
  duration = 800,
  decimals = 0,
  prefix = '',
  suffix = '',
  locale = true,
  className,
}: AnimatedNumberProps) {
  const [display, setDisplay] = React.useState(0)
  const rafRef = React.useRef<number | null>(null)
  const startedRef = React.useRef(false)

  React.useEffect(() => {
    // Respect reduced motion
    if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      setDisplay(value)
      return
    }
    if (startedRef.current) {
      // value changed after mount — snap
      setDisplay(value)
      return
    }
    startedRef.current = true

    const start = performance.now()
    const from = 0
    const to = value
    const ease = (t: number) => 1 - Math.pow(1 - t, 3) // easeOutCubic

    const tick = (now: number) => {
      const elapsed = now - start
      const t = Math.min(1, elapsed / duration)
      const next = from + (to - from) * ease(t)
      setDisplay(next)
      if (t < 1) {
        rafRef.current = requestAnimationFrame(tick)
      } else {
        setDisplay(to)
      }
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const formatted = React.useMemo(() => {
    const v = decimals > 0 ? Number(display.toFixed(decimals)) : Math.round(display)
    return locale ? v.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals }) : v.toFixed(decimals)
  }, [display, decimals, locale])

  return (
    <span className={className}>
      {prefix}
      {formatted}
      {suffix}
    </span>
  )
}
