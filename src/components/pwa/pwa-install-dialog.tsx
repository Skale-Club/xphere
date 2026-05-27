'use client'

/**
 * PwaInstallDialog — adaptive install prompt rendered globally in the
 * dashboard layout. Different content for Android/desktop (native prompt
 * available) vs iOS (manual Add-to-Home-Screen instructions).
 *
 * Visibility is fully controlled by PwaInstallContext: this component
 * doesn't decide when to show, it only renders.
 */

import * as React from 'react'
import {
  Download,
  Share,
  Plus,
  Check,
  Bell,
  Zap,
  Wifi,
  CheckCircle2,
} from 'lucide-react'

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { usePwaInstall } from './pwa-install-context'

export function PwaInstallDialog() {
  const { isStandalone, isIos, canInstall, open, closeDialog, promptInstall, markDismissed } =
    usePwaInstall()

  // Nothing to offer? Don't render at all.
  if (isStandalone) return null
  if (!canInstall && !isIos) return null

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) closeDialog()
      }}
    >
      <DialogContent className="sm:max-w-md">
        {isIos ? (
          <IosInstructions onDismiss={markDismissed} />
        ) : (
          <DesktopAndroidInstall
            onInstall={promptInstall}
            onDismiss={markDismissed}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

function DesktopAndroidInstall({
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
      <DialogHeader>
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-[10px] bg-emerald-500/15 text-emerald-300">
            <Download className="h-5 w-5" />
          </div>
          <div>
            <DialogTitle>Install xphere</DialogTitle>
            <DialogDescription>
              Add the app to your device for a faster, dedicated experience.
            </DialogDescription>
          </div>
        </div>
      </DialogHeader>

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

function IosInstructions({ onDismiss }: { onDismiss: () => void }) {
  return (
    <>
      <DialogHeader>
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-[10px] bg-emerald-500/15 text-emerald-300">
            <Download className="h-5 w-5" />
          </div>
          <div>
            <DialogTitle>Add xphere to your Home Screen</DialogTitle>
            <DialogDescription>
              Required to receive push notifications on iOS, and gives you a full-screen native feel.
            </DialogDescription>
          </div>
        </div>
      </DialogHeader>

      <ol className="space-y-3 py-2">
        <Step
          n={1}
          icon={Share}
          title="Tap the Share button"
          description="In Safari's toolbar at the bottom of the screen."
        />
        <Step
          n={2}
          icon={Plus}
          title="Choose 'Add to Home Screen'"
          description="Scroll the share sheet until you see it."
        />
        <Step
          n={3}
          icon={Check}
          title="Tap 'Add'"
          description="The xphere icon appears on your home screen. Open it from there from now on."
        />
      </ol>

      <div className="rounded-[8px] border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11.5px] text-amber-200">
        <strong>Tip:</strong> Web push notifications on iOS only work when launched from a Home
        Screen installation — not from Safari.
      </div>

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

function Step({
  n,
  icon: Icon,
  title,
  description,
}: {
  n: number
  icon: React.ComponentType<{ className?: string }>
  title: string
  description: string
}) {
  return (
    <li className="flex items-start gap-3">
      <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent/15 text-accent text-[11px] font-semibold">
        {n}
      </div>
      <div className="flex-1">
        <p className="flex items-center gap-1.5 text-[13px] font-medium text-text-primary">
          <Icon className="h-3.5 w-3.5 text-text-tertiary" />
          {title}
        </p>
        <p className="text-[12px] text-text-secondary leading-relaxed mt-0.5">{description}</p>
      </div>
    </li>
  )
}

// Re-export for use by the settings inline control
export { CheckCircle2 }
