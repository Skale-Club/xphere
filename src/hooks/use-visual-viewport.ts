'use client'

import { useEffect, useState } from 'react'

/**
 * SEED-040 | Visual viewport tracking for mobile keyboard handling.
 *
 * Returns the offset (in px) of the visual viewport bottom relative to the
 * layout viewport bottom. When the iOS keyboard is open this is positive
 * (keyboard height); when closed it's 0. Useful to push a fixed composer
 * above the keyboard.
 *
 * Safe to call on any platform — returns 0 when `window.visualViewport`
 * isn't supported (older Android, SSR, etc.).
 */
export function useVisualViewport(): number {
  const [offset, setOffset] = useState(0)

  useEffect(() => {
    if (typeof window === 'undefined') return
    const vv = window.visualViewport
    if (!vv) return

    const update = () => {
      const o = window.innerHeight - vv.height - vv.offsetTop
      setOffset(Math.max(0, o))
    }

    update()
    vv.addEventListener('resize', update)
    vv.addEventListener('scroll', update)
    return () => {
      vv.removeEventListener('resize', update)
      vv.removeEventListener('scroll', update)
    }
  }, [])

  return offset
}
