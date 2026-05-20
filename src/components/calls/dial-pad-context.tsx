'use client'

// Lightweight pub/sub so any client component can ask the floating
// DialPadPanel to open or pre-fill a number. The panel subscribes once on mount.

import * as React from 'react'

type Listener = (phone: string) => void
type ToggleListener = () => void

const prefillListeners = new Set<Listener>()
const toggleListeners = new Set<ToggleListener>()

export function prefillDialPad(phone: string) {
  prefillListeners.forEach((l) => l(phone))
}

export function toggleDialPad() {
  toggleListeners.forEach((l) => l())
}

export function useDialPadPrefill(handler: Listener) {
  React.useEffect(() => {
    prefillListeners.add(handler)
    return () => {
      prefillListeners.delete(handler)
    }
  }, [handler])
}

export function useDialPadToggle(handler: ToggleListener) {
  React.useEffect(() => {
    toggleListeners.add(handler)
    return () => {
      toggleListeners.delete(handler)
    }
  }, [handler])
}
