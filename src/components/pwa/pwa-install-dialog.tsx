'use client'

/**
 * PwaInstallDialog — adaptive install prompt rendered globally in the
 * dashboard layout. Native install button where the browser offers one
 * (Chromium on Android/desktop); otherwise step-by-step manual instructions
 * for the user's OS and browser (every iOS browser, Samsung Internet, …).
 *
 * Visibility is fully controlled by PwaInstallContext: this component
 * doesn't decide when to show, it only renders.
 */

import * as React from 'react'
import Image from 'next/image'
import { Download, Bell, Zap, Wifi, Check } from 'lucide-react'

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import type { InstallPlatform } from '@/lib/pwa/platform'
import { usePwaInstall } from './pwa-install-context'
import { ManualInstallSteps, hasManualSteps } from './pwa-install-steps'

export function PwaInstallDialog() {
  const { isStandalone, platform, canInstall, open, closeDialog, promptInstall, markDismissed } =
    usePwaInstall()

  // Nothing to offer? Don't render at all.
  if (isStandalone) return null
  if (!canInstall && !hasManualSteps(platform)) return null

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) closeDialog()
      }}
    >
      <DialogContent className="sm:max-w-md">
        {canInstall ? (
          <NativeInstall onInstall={promptInstall} onDismiss={markDismissed} />
        ) : (
          hasManualSteps(platform) && (
            <ManualInstall platform={platform} onDismiss={markDismissed} />
          )
        )}
      </DialogContent>
    </Dialog>
  )
}

function AppHeader({ title, description }: { title: string; description: string }) {
  return (
    <DialogHeader>
      <div className="flex items-start gap-3">
        <Image
          src="/xphere-icon.svg"
          alt="Xphere"
          width={40}
          height={40}
          className="h-10 w-10 shrink-0 rounded-[10px]"
          priority
        />
        <div>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </div>
      </div>
    </DialogHeader>
  )
}

function NativeInstall({
  onInstall,
  onDismiss,
}: {
  onInstall: () => Promise<'accepted' | 'dismissed' | 'unavailable'>
  onDismiss: () => void
}) {
  const [pending, setPending] = React.useState(false)

  async function handleInstall() {
    setPending(true)
    try {
      await onInstall()
    } finally {
      setPending(false)
    }
  }

  return (
    <>
      <AppHeader
        title="Install Xphere"
        description="Add the app to your device for a faster, dedicated experience."
      />

      <ul className="space-y-2.5 py-2">
        <Benefit icon={Zap} title="Instant launch" description="Open straight from your home screen — no browser tab to find." />
        <Benefit icon={Bell} title="Push notifications" description="Get notified the moment a customer messages or a campaign finishes." />
        <Benefit icon={Wifi} title="Works offline" description="Browse the inbox and recent activity even on a flaky connection." />
      </ul>

      <DialogFooter className="gap-2 sm:gap-2">
        <Button variant="ghost" onClick={onDismiss} disabled={pending}>
          Maybe later
        </Button>
        <Button onClick={handleInstall} disabled={pending} className="gap-1.5">
          <Download className="h-3.5 w-3.5" />
          {pending ? 'Installing…' : 'Install'}
        </Button>
      </DialogFooter>
    </>
  )
}

function ManualInstall({
  platform,
  onDismiss,
}: {
  platform: InstallPlatform
  onDismiss: () => void
}) {
  const ios = platform.os === 'ios'

  return (
    <>
      <AppHeader
        title={ios ? 'Add Xphere to your Home Screen' : 'Install Xphere'}
        description={
          ios
            ? 'Required to receive push notifications on iPhone and iPad, and gives you a full-screen native feel.'
            : 'Takes a few seconds — instant launch from your home screen and push notifications.'
        }
      />

      <div className="py-2">
        <ManualInstallSteps platform={platform} />
      </div>

      {ios && (
        <div className="rounded-[8px] border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11.5px] text-amber-200">
          <strong>Tip:</strong> Web push notifications on iOS only work when launched from a Home
          Screen installation — not from the browser.
        </div>
      )}

      <DialogFooter>
        <Button onClick={onDismiss} className="gap-1.5">
          <Check className="h-3.5 w-3.5" />
          Got it
        </Button>
      </DialogFooter>
    </>
  )
}

function Benefit({
  icon: Icon,
  title,
  description,
}: {
  icon: React.ComponentType<{ className?: string }>
  title: string
  description: string
}) {
  return (
    <li className="flex items-start gap-3">
      <div className="mt-0.5 flex h-7 w-7 items-center justify-center rounded-[8px] bg-bg-tertiary text-text-secondary">
        <Icon className="h-3.5 w-3.5" />
      </div>
      <div>
        <p className="text-[13px] font-medium text-text-primary">{title}</p>
        <p className="text-[12px] text-text-secondary leading-relaxed">{description}</p>
      </div>
    </li>
  )
}
