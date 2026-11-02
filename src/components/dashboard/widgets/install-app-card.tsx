'use client'

import { useEffect, useState } from 'react'
import { Download, X, Smartphone, Monitor } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { usePwaInstall } from '@/components/pwa/pwa-install-context'
import { hasManualSteps } from '@/components/pwa/pwa-install-steps'

const DISMISSED_KEY = 'xphere_install_card_dismissed'

/**
 * Install-prompt card rendered below the quick-action chips in HeroSection.
 * Reads the install state from PwaInstallContext (which captures
 * `beforeinstallprompt` once, at layout mount). The button fires the native
 * prompt where the browser offers one, and otherwise opens the dialog with
 * the manual steps for this OS + browser (iPhone, Samsung Internet, …).
 *
 * Returns null when: already installed, dismissed by user, nothing to offer
 * (e.g. Firefox desktop), or before mount.
 */
export function InstallAppCard() {
  const { isStandalone, platform, canInstall, promptInstall, openDialog } = usePwaInstall()
  const [dismissed, setDismissed] = useState(true)
  const [pending, setPending] = useState(false)

  useEffect(() => {
    try {
      setDismissed(localStorage.getItem(DISMISSED_KEY) === '1')
    } catch {
      setDismissed(false)
    }
  }, [])

  function dismiss() {
    try {
      localStorage.setItem(DISMISSED_KEY, '1')
    } catch {
      /* localStorage unavailable (private mode, blocked) */
    }
    setDismissed(true)
  }

  async function handleInstall() {
    if (!canInstall) {
      openDialog()
      return
    }
    setPending(true)
    try {
      const outcome = await promptInstall()
      if (outcome === 'unavailable') openDialog()
    } finally {
      setPending(false)
    }
  }

  if (dismissed || isStandalone || !platform) return null
  if (!canInstall && !hasManualSteps(platform)) return null

  const isMobile = platform.os !== 'desktop'
  const Icon = isMobile ? Smartphone : Monitor

  return (
    <div className="relative flex w-full items-center gap-3 rounded-[10px] border border-accent/30 bg-accent/[0.08] p-3 pr-9 md:max-w-[420px]">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[9px] bg-accent/15 text-accent">
        <Icon className="h-5 w-5" />
      </div>

      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-semibold text-text-primary">
          {isMobile ? 'Get the Xphere app' : 'Install Xphere on your desktop'}
        </p>
        <p className="text-[12px] leading-snug text-text-secondary">
          {platform.os === 'ios'
            ? 'Home-screen access and push notifications'
            : 'Instant launch and push notifications'}
        </p>
      </div>

      <Button size="sm" onClick={handleInstall} loading={pending} className="shrink-0 gap-1.5 px-3.5">
        <Download />
        Install
      </Button>

      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss"
        className="absolute right-1 top-1 rounded-[6px] p-1.5 text-text-tertiary transition-colors hover:bg-bg-secondary hover:text-text-primary"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}
