'use client'

/**
 * useInboxResize | owns the draggable width of the left inbox column.
 *
 * Extracted from ChatLayout to keep the orchestrator lean. Pure UI concern:
 *   - Clamps the width between INBOX_MIN_WIDTH and a viewport-derived max so the
 *     chat column never collapses below CHAT_MIN_WIDTH (accounting for the info
 *     panel when it is open on lg/xl breakpoints).
 *   - Re-clamps on window resize.
 *   - Exposes pointer-drag and keyboard (Arrow) handlers for the resize grip.
 */

import { useCallback, useEffect, useState } from 'react'

export const INBOX_MIN_WIDTH = 260
export const INBOX_DEFAULT_WIDTH = 300
export const INBOX_MAX_WIDTH = 420
export const CHAT_MIN_WIDTH = 420

function clampInboxWidth(width: number, maxWidth: number) {
  return Math.min(Math.max(width, INBOX_MIN_WIDTH), maxWidth)
}

export interface UseInboxResizeResult {
  inboxWidth: number
  handleInboxResizeStart: (event: React.PointerEvent<HTMLButtonElement>) => void
  handleInboxResizeKeyDown: (event: React.KeyboardEvent<HTMLButtonElement>) => void
}

export function useInboxResize(infoOpen: boolean): UseInboxResizeResult {
  const [inboxWidth, setInboxWidth] = useState(INBOX_DEFAULT_WIDTH)

  const getInboxMaxWidth = useCallback(() => {
    if (typeof window === 'undefined') return INBOX_MAX_WIDTH

    const infoPanelWidth =
      infoOpen && window.innerWidth >= 1024
        ? window.innerWidth >= 1280
          ? 340
          : 300
        : 0
    const available = window.innerWidth - infoPanelWidth - CHAT_MIN_WIDTH

    return Math.max(INBOX_MIN_WIDTH, Math.min(INBOX_MAX_WIDTH, available))
  }, [infoOpen])

  useEffect(() => {
    const handleResize = () => {
      setInboxWidth((width) => clampInboxWidth(width, getInboxMaxWidth()))
    }

    handleResize()
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [getInboxMaxWidth])

  const handleInboxResizeStart = useCallback(
    (event: React.PointerEvent<HTMLButtonElement>) => {
      event.preventDefault()

      const startX = event.clientX
      const startWidth = inboxWidth
      const maxWidth = getInboxMaxWidth()
      const previousCursor = document.body.style.cursor
      const previousUserSelect = document.body.style.userSelect

      document.body.style.cursor = 'col-resize'
      document.body.style.userSelect = 'none'

      const handleMove = (moveEvent: PointerEvent) => {
        const nextWidth = startWidth + moveEvent.clientX - startX
        setInboxWidth(clampInboxWidth(nextWidth, maxWidth))
      }

      const handleUp = () => {
        document.body.style.cursor = previousCursor
        document.body.style.userSelect = previousUserSelect
        window.removeEventListener('pointermove', handleMove)
        window.removeEventListener('pointerup', handleUp)
      }

      window.addEventListener('pointermove', handleMove)
      window.addEventListener('pointerup', handleUp)
    },
    [getInboxMaxWidth, inboxWidth],
  )

  const handleInboxResizeKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLButtonElement>) => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return

      event.preventDefault()
      const delta = event.key === 'ArrowLeft' ? -16 : 16
      setInboxWidth((width) => clampInboxWidth(width + delta, getInboxMaxWidth()))
    },
    [getInboxMaxWidth],
  )

  return { inboxWidth, handleInboxResizeStart, handleInboxResizeKeyDown }
}
