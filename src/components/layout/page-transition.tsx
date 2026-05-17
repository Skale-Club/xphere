'use client'

import * as React from 'react'
import { usePathname } from 'next/navigation'
import { AnimatePresence, motion } from 'framer-motion'

interface Props {
  children: React.ReactNode
}

/**
 * Subtle fade + slide between routes. Skips on small viewports to preserve
 * performance on mobile, and respects prefers-reduced-motion.
 */
export function PageTransition({ children }: Props) {
  const pathname = usePathname()
  const [enabled, setEnabled] = React.useState(false)

  React.useEffect(() => {
    if (typeof window === 'undefined') return
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    const small = window.matchMedia?.('(max-width: 640px)').matches
    setEnabled(!reduce && !small)
  }, [])

  if (!enabled) return <>{children}</>

  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={pathname}
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -4 }}
        transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
        className="will-change-transform"
      >
        {children}
      </motion.div>
    </AnimatePresence>
  )
}
