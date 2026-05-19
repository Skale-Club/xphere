'use client'

// Lightweight pub/sub so any client component can ask the floating
// DialPadPanel to open with a phone number pre-filled (without actually
// placing the call). The panel subscribes once on mount.

import * as React from 'react'

type Listener = (phone: string) => void

const listeners = new Set<Listener>()

export function prefillDialPad(phone: string) {
  listeners.forEach((l) => l(phone))
}

export function useDialPadPrefill(handler: Listener) {
  React.useEffect(() => {
    listeners.add(handler)
    return () => {
      listeners.delete(handler)
    }
  }, [handler])
}
