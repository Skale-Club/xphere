'use client'

/**
 * PwaInstallControl — the same install affordances as the popup, but
 * rendered inline on the Settings → Install page so the user can come
 * back to it any time after dismissing the popup.
 */

import * as React from 'react'
import { CheckCircle2, Download, Share, Plus, Check, AlertCircle } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { usePwaInstall } from './pwa-install-context'

export function PwaInstallControl() {
  const { isStandalone, isIos, canInstall, promptInstall } = usePwaInstall()
  const [pending, setPending] = React.useState(false)

  if (isStandalone) {
    return (
      <div className="rounded-[12px] border border-emerald-500/30 bg-emerald-500/10 p-5">
        <div className="flex items-start gap-3">
          <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-400 mt-0.5" />
          <div>
            <h2 className="text-[15px] font-semibold text-text-primary">App installed</h2>
            <p className="mt-1 text-[13px] text-text-secondary leading-relaxed">
              You&apos;re launching Xphere as a standalone app. Push notifications, offline mode and
              faster startup are all active.
            </p>
          </div>
        </div>
      </div>
    )
  }

  if (isIos) {
    return (
      <div className="rounded-[12px] border border-border bg-bg-secondary p-5 space-y-4">
        <div>
          <h2 className="text-[15px] font-semibold text-text-primary">Add to Home Screen</h2>
          <p className="mt-1 text-[13px] text-text-secondary leading-relaxed">
            iOS Safari doesn&apos;t let apps install themselves. Follow the steps below to add
            Xphere to your home screen — required for push notifications on iOS.
          </p>
        </div>

        <ol className="space-y-3">
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
            description="Scroll the share sheet if you don't see it immediately."
          />
          <Step
            n={3}
            icon={Check}
            title="Tap 'Add'"
            description="The Xphere icon will appear on your home screen. Open the app from there from now on."
          />
        </ol>
      </div>
    )
  }

  if (canInstall) {
    return (
      <div className="rounded-[12px] border border-border bg-bg-secondary p-5 space-y-4">
        <div>
          <h2 className="text-[15px] font-semibold text-text-primary">Install Xphere</h2>
          <p className="mt-1 text-[13px] text-text-secondary leading-relaxed">
            Add the app to your device for a faster, dedicated experience — instant launch, push
            notifications, and offline support.
          </p>
        </div>
        <Button
          onClick={async () => {
            setPending(true)
            try {
              await promptInstall()
            } finally {
              setPending(false)
            }
          }}
          disabled={pending}
          className="gap-1.5"
        >
          <Download className="h-3.5 w-3.5" />
          {pending ? 'Installing…' : 'Install now'}
        </Button>
      </div>
    )
  }

  return (
    <div className="rounded-[12px] border border-border bg-bg-secondary p-5">
      <div className="flex items-start gap-3">
        <AlertCircle className="h-5 w-5 shrink-0 text-text-tertiary mt-0.5" />
        <div>
          <h2 className="text-[15px] font-semibold text-text-primary">Browser not supported</h2>
          <p className="mt-1 text-[13px] text-text-secondary leading-relaxed">
            This browser can&apos;t install web apps. Try opening Xphere in Chrome or Edge on
            desktop, or in Safari on iOS, to install.
          </p>
        </div>
      </div>
    </div>
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
