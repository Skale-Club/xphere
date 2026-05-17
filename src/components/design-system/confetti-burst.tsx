'use client'

import * as React from 'react'
import dynamic from 'next/dynamic'

// react-confetti pulls in window APIs — load only on client.
const Confetti = dynamic(() => import('react-confetti'), { ssr: false })

interface ConfettiBurstProps {
  /** When true, fires a 3s confetti burst then auto-clears. */
  active: boolean
  /** Called when the burst finishes. */
  onComplete?: () => void
  /** Colors to use. Defaults to the accent palette. */
  colors?: string[]
  /** Duration in ms (default 3000). */
  duration?: number
}

/**
 * One-shot confetti celebration. Mount it near the root of a page; toggle
 * `active` to fire. Uses accent palette colors by default for on-brand vibes.
 */
export function ConfettiBurst({
  active,
  onComplete,
  colors = ['#6366F1', '#818CF8', '#A5B4FC', '#22C55E', '#F59E0B', '#EC4899'],
  duration = 3000,
}: ConfettiBurstProps) {
  const [dims, setDims] = React.useState<{ w: number; h: number }>({ w: 0, h: 0 })
  const [recycle, setRecycle] = React.useState(false)

  React.useEffect(() => {
    if (typeof window === 'undefined') return
    const onResize = () => setDims({ w: window.innerWidth, h: window.innerHeight })
    onResize()
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  React.useEffect(() => {
    if (!active) return
    // Respect reduced motion — skip the celebration but still notify.
    if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      onComplete?.()
      return
    }
    setRecycle(true)
    const stopRecycle = window.setTimeout(() => setRecycle(false), Math.max(500, duration - 1500))
    const done = window.setTimeout(() => {
      onComplete?.()
    }, duration)
    return () => {
      window.clearTimeout(stopRecycle)
      window.clearTimeout(done)
    }
  }, [active, duration, onComplete])

  if (!active || dims.w === 0) return null

  return (
    <div className="pointer-events-none fixed inset-0 z-[9999]">
      <Confetti
        width={dims.w}
        height={dims.h}
        recycle={recycle}
        numberOfPieces={recycle ? 220 : 0}
        gravity={0.25}
        initialVelocityY={12}
        colors={colors}
        tweenDuration={4000}
      />
    </div>
  )
}
