'use client'

/**
 * SavedFlash — small green "Saved" pill that fades in/out next to an
 * inline-editable field after a successful write. Consumers control
 * timing by incrementing `flashKey` (any number that changes on each
 * save). The component renders for ~1.5s then disappears on its own.
 *
 * Used inside the info-panel fields (Phone, Email, Company) right next
 * to the value, between the text and the action icon.
 */

import * as React from 'react'
import { Check } from 'lucide-react'

interface SavedFlashProps {
  /**
   * Any number that changes when a save lands. Pass `Date.now()` from the
   * onSave success branch, or an incrementing counter. The flash shows
   * each time this value increases. Pass 0/undefined to keep it hidden.
   */
  flashKey: number
  /** Visibility window in ms. */
  durationMs?: number
}

export function SavedFlash({ flashKey, durationMs = 1500 }: SavedFlashProps) {
  const [visible, setVisible] = React.useState(false)

  React.useEffect(() => {
    if (!flashKey) return
    setVisible(true)
    const handle = window.setTimeout(() => setVisible(false), durationMs)
    return () => window.clearTimeout(handle)
  }, [flashKey, durationMs])

  if (!visible) return null

  return (
    <span
      role="status"
      aria-live="polite"
      className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-medium text-emerald-300 shrink-0"
    >
      <Check className="h-2.5 w-2.5" />
      Saved
    </span>
  )
}
