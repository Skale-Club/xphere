'use client'

import { useEffect, useRef, useState } from 'react'
import { Download, Share, X, Smartphone, Monitor } from 'lucide-react'

const DISMISSED_KEY = 'xphere_install_card_dismissed'

type Platform = 'ios' | 'android' | 'desktop' | null

function detectPlatform(): Platform {
  if (typeof window === 'undefined') return null
  const ua = navigator.userAgent
  if (/iphone|ipad|ipod/i.test(ua)) return 'ios'
  if (/android/i.test(ua)) return 'android'
  return 'desktop'
}

function isStandalone(): boolean {
  if (typeof window === 'undefined') return false
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    ('standalone' in navigator && (navigator as { standalone?: boolean }).standalone === true)
  )
}

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

/**
 * Mini install-prompt card rendered below the quick-action chips in HeroSection.
 * Returns null when: already installed, dismissed by user, or SSR.
 */
export function InstallAppCard() {
  const [platform, setPlatform] = useState<Platform>(null)
  const [visible, setVisible] = useState(false)
  const deferredPromptRef = useRef<BeforeInstallPromptEvent | null>(null)

  useEffect(() => {
    if (isStandalone()) return
    if (localStorage.getItem(DISMISSED_KEY) === '1') return

    const p = detectPlatform()
    setPlatform(p)
    setVisible(true)

    const handler = (e: Event) => {
      e.preventDefault()
      deferredPromptRef.current = e as BeforeInstallPromptEvent
    }
    window.addEventListener('beforeinstallprompt', handler)

    const onInstalled = () => setVisible(false)
    window.addEventListener('appinstalled', onInstalled)

    return () => {
      window.removeEventListener('beforeinstallprompt', handler)
      window.removeEventListener('appinstalled', onInstalled)
    }
  }, [])

  function dismiss() {
    localStorage.setItem(DISMISSED_KEY, '1')
    setVisible(false)
  }

  async function handleInstall() {
    const prompt = deferredPromptRef.current
    if (prompt) {
      await prompt.prompt()
      const { outcome } = await prompt.userChoice
      if (outcome === 'accepted') setVisible(false)
      deferredPromptRef.current = null
    } else {
      window.location.href = '/settings/install'
    }
  }

  if (!visible || !platform) return null

  const isMobile = platform === 'ios' || platform === 'android'

  return (
    <div className="flex w-full items-center gap-3 rounded-[8px] border border-border-subtle bg-bg-tertiary/40 px-3 py-2.5">
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[6px] border border-border-subtle bg-bg-secondary">
        {isMobile ? (
          <Smartphone className="h-3.5 w-3.5 text-accent" />
        ) : (
          <Monitor className="h-3.5 w-3.5 text-accent" />
        )}
      </div>

      <div className="min-w-0 flex-1">
        <p className="text-[12px] font-medium text-text-secondary">
          {isMobile ? 'Add to home screen' : 'Install on your desktop'}
        </p>
        <p className="truncate text-[11px] text-text-tertiary">
          {platform === 'ios' && (
            <>
              Tap <Share className="inline h-3 w-3 align-[-2px]" /> in Safari →{' '}
              <span className="text-text-secondary">Add to Home Screen</span>
            </>
          )}
          {platform === 'android' && 'Quick access from your home screen'}
          {platform === 'desktop' && 'Instant launch, no browser needed'}
        </p>
      </div>

      {(platform === 'android' || platform === 'desktop') && (
        <button
          type="button"
          onClick={handleInstall}
          className="shrink-0 inline-flex items-center gap-1 rounded-[5px] border border-border bg-bg-secondary px-2 py-1 text-[11px] font-medium text-text-secondary transition-all hover:border-border-strong hover:text-text-primary"
        >
          <Download className="h-3 w-3 text-accent" />
          {platform === 'desktop' ? 'Install' : 'Add'}
        </button>
      )}

      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss"
        className="shrink-0 rounded-[4px] p-0.5 text-text-tertiary transition-colors hover:bg-bg-secondary hover:text-text-primary"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}
