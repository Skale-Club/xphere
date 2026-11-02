'use client'

/**
 * PwaInstallControl — the same install affordances as the popup, but
 * rendered inline on the Settings → Install page so the user can come
 * back to it any time after dismissing the popup.
 */

import * as React from 'react'
import { CheckCircle2, Download, AlertCircle } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { usePwaInstall } from './pwa-install-context'
import { ManualInstallSteps, hasManualSteps } from './pwa-install-steps'

export function PwaInstallControl() {
  const { isStandalone, platform, canInstall, promptInstall } = usePwaInstall()
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

  // Platform is detected after mount — don't flash "not supported" first.
  if (!platform) return null

  if (hasManualSteps(platform)) {
    const ios = platform.os === 'ios'
    return (
      <div className="rounded-[12px] border border-border bg-bg-secondary p-5 space-y-4">
        <div>
          <h2 className="text-[15px] font-semibold text-text-primary">
            {ios ? 'Add to Home Screen' : 'Install Xphere'}
          </h2>
          <p className="mt-1 text-[13px] text-text-secondary leading-relaxed">
            {ios
              ? "iOS doesn't let apps install themselves. Follow the steps below to add Xphere to your home screen — required for push notifications on iPhone and iPad."
              : "Your browser doesn't offer a one-tap install here. Follow the steps below to add Xphere to your home screen."}
          </p>
        </div>
        <ManualInstallSteps platform={platform} />
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
            desktop, or on your phone, to install.
          </p>
        </div>
      </div>
    </div>
  )
}
