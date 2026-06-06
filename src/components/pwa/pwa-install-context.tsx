'use client'

/**
 * PwaInstallContext — captures the browser's `beforeinstallprompt` event
 * (Chrome / Edge / Android) and surfaces it through React. The provider has
 * to mount as early as possible because the event fires once on first
 * page-load and is lost if not captured.
 *
 * iOS Safari does NOT support `beforeinstallprompt`. For iOS we detect the
 * user-agent and surface "Add to Home Screen" instructions instead.
 *
 * Standalone mode (the app is already installed and launched from the home
 * screen) is detected via `display-mode: standalone` (all modern browsers)
 * or `navigator.standalone` (legacy iOS Safari).
 */

import * as React from 'react'

interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[]
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
  prompt: () => Promise<void>
}

const FIRST_SEEN_KEY = 'xphere.pwa.first_seen_at'
const DISMISSED_KEY = 'xphere.pwa.dismissed_at'

interface ContextValue {
  /** App is already installed and running standalone. */
  isStandalone: boolean
  /** User is on iOS Safari (no programmatic install — manual A2HS). */
  isIos: boolean
  /** A beforeinstallprompt event was captured and is ready to fire. */
  canInstall: boolean
  /** Whether the dialog is currently open. */
  open: boolean
  /** Force the dialog open (used by Settings card and the push banner). */
  openDialog: () => void
  /** Close the dialog (without dismissing — does not start the cooldown). */
  closeDialog: () => void
  /** Trigger the native install prompt (Android/desktop only). */
  promptInstall: () => Promise<'accepted' | 'dismissed' | 'unavailable'>
  /** User chose "Maybe later" / "Got it" — close + start 30-day cooldown. */
  markDismissed: () => void
}

const noop = () => {}
const Ctx = React.createContext<ContextValue>({
  isStandalone: false,
  isIos: false,
  canInstall: false,
  open: false,
  openDialog: noop,
  closeDialog: noop,
  promptInstall: async () => 'unavailable',
  markDismissed: noop,
})

export function usePwaInstall() {
  return React.useContext(Ctx)
}

export function PwaInstallProvider({ children }: { children: React.ReactNode }) {
  const [isStandalone, setIsStandalone] = React.useState(false)
  const [isIos, setIsIos] = React.useState(false)
  const [canInstall, setCanInstall] = React.useState(false)
  const [open, setOpen] = React.useState(false)
  const promptEventRef = React.useRef<BeforeInstallPromptEvent | null>(null)

  // One-time platform detection + first-seen stamp
  React.useEffect(() => {
    if (typeof window === 'undefined') return

    const standalone =
      window.matchMedia?.('(display-mode: standalone)').matches ||
      // Legacy iOS Safari
      (window.navigator as Navigator & { standalone?: boolean }).standalone === true
    setIsStandalone(Boolean(standalone))

    const ua = window.navigator.userAgent
    const ios =
      /iPad|iPhone|iPod/.test(ua) && !(window as unknown as { MSStream?: unknown }).MSStream
    setIsIos(ios)

    // Stamp the first-seen-at timestamp so we don't bother brand-new users
    try {
      if (!window.localStorage.getItem(FIRST_SEEN_KEY)) {
        window.localStorage.setItem(FIRST_SEEN_KEY, String(Date.now()))
      }
    } catch {
      /* localStorage unavailable (private mode, blocked) */
    }
  }, [])

  // Listen for the install prompt — must run as early as possible
  React.useEffect(() => {
    function handler(e: Event) {
      e.preventDefault()
      promptEventRef.current = e as BeforeInstallPromptEvent
      setCanInstall(true)
    }
    function appInstalled() {
      promptEventRef.current = null
      setCanInstall(false)
      setIsStandalone(true)
      setOpen(false)
    }
    window.addEventListener('beforeinstallprompt', handler)
    window.addEventListener('appinstalled', appInstalled)
    return () => {
      window.removeEventListener('beforeinstallprompt', handler)
      window.removeEventListener('appinstalled', appInstalled)
    }
  }, [])

  // Auto-open intentionally disabled — install prompt is available on
  // Settings → Install without interrupting the user mid-session.

  const openDialog = React.useCallback(() => setOpen(true), [])
  const closeDialog = React.useCallback(() => setOpen(false), [])

  const promptInstall = React.useCallback(async (): Promise<
    'accepted' | 'dismissed' | 'unavailable'
  > => {
    const evt = promptEventRef.current
    if (!evt) return 'unavailable'
    try {
      await evt.prompt()
      const choice = await evt.userChoice
      promptEventRef.current = null
      setCanInstall(false)
      if (choice.outcome === 'accepted') {
        setOpen(false)
        return 'accepted'
      }
      return 'dismissed'
    } catch {
      return 'unavailable'
    }
  }, [])

  const markDismissed = React.useCallback(() => {
    try {
      window.localStorage.setItem(DISMISSED_KEY, String(Date.now()))
    } catch {
      /* ignore */
    }
    setOpen(false)
  }, [])

  const value = React.useMemo<ContextValue>(
    () => ({
      isStandalone,
      isIos,
      canInstall,
      open,
      openDialog,
      closeDialog,
      promptInstall,
      markDismissed,
    }),
    [
      isStandalone,
      isIos,
      canInstall,
      open,
      openDialog,
      closeDialog,
      promptInstall,
      markDismissed,
    ],
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}
