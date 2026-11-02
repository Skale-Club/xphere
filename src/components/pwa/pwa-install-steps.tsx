'use client'

/**
 * Manual "Add to Home Screen" steps, picked by OS + browser. Shared by the
 * install dialog and Settings → Install.
 *
 * Used wherever the browser gives us no `beforeinstallprompt`: every iOS
 * browser, and Android browsers that don't fire it (Samsung Internet, Firefox,
 * or Chrome during its cooldown after the user dismissed the native prompt).
 */

import * as React from 'react'
import {
  Check,
  Compass,
  Copy,
  EllipsisVertical,
  Menu,
  Share,
  SquarePlus,
} from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import type { InstallPlatform } from '@/lib/pwa/platform'

type IconType = React.ComponentType<{ className?: string }>

interface StepSpec {
  icon: IconType
  title: string
  description: string
}

/** True when we can tell this user how to install by hand. */
export function hasManualSteps(platform: InstallPlatform | null): platform is InstallPlatform {
  return platform?.os === 'ios' || platform?.os === 'android'
}

/** In-app browsers can't install; the user must reopen the page elsewhere. */
export function needsRealBrowser(platform: InstallPlatform | null): boolean {
  return platform?.browser === 'in-app'
}

function iosSteps(browser: InstallPlatform['browser']): StepSpec[] {
  if (browser === 'in-app' || browser === 'other') {
    return [
      {
        icon: Compass,
        title: 'Open this page in Safari',
        description:
          "This app's built-in browser can't install apps. Use its menu (••• or the compass icon) → 'Open in Safari', or copy the link below and paste it in Safari.",
      },
      {
        icon: Share,
        title: 'Tap Share → Add to Home Screen',
        description: "Then tap 'Add'. Open Xphere from the new home-screen icon from now on.",
      },
    ]
  }

  const shareWhere: Record<string, string> = {
    safari:
      "At the bottom of Safari. On iOS 26, tap ••• next to the address bar first, then 'Share'.",
    chrome: 'In the address bar, at the top right.',
    edge: "Open the ••• menu at the bottom, then tap 'Share'.",
    firefox: "Open the ☰ menu at the bottom right, then tap 'Share'.",
  }

  return [
    {
      icon: Share,
      title: 'Tap the Share button',
      description: shareWhere[browser] ?? shareWhere.safari,
    },
    {
      icon: SquarePlus,
      title: "Choose 'Add to Home Screen'",
      description: "Scroll down the list — tap 'View More' if it isn't there.",
    },
    {
      icon: Check,
      title: "Tap 'Add'",
      description:
        "Keep 'Open as Web App' on. Then open Xphere from the new home-screen icon from now on.",
    },
  ]
}

function androidSteps(browser: InstallPlatform['browser']): StepSpec[] {
  if (browser === 'in-app') {
    return [
      {
        icon: Compass,
        title: 'Open this page in Chrome',
        description:
          "This app's built-in browser can't install apps. Use its ⋮ menu → 'Open in Chrome' (or 'Open in browser'), or copy the link below.",
      },
      {
        icon: EllipsisVertical,
        title: "Tap ⋮ → 'Install app'",
        description: 'Then confirm. Xphere appears on your home screen and in your app drawer.',
      },
    ]
  }

  if (browser === 'samsung') {
    return [
      { icon: Menu, title: 'Tap the ☰ menu', description: 'At the bottom right of Samsung Internet.' },
      {
        icon: SquarePlus,
        title: "Choose 'Add page to' → 'Home screen'",
        description: "Some versions show 'Install app' instead — either works.",
      },
      { icon: Check, title: "Tap 'Add'", description: 'Xphere appears on your home screen.' },
    ]
  }

  const menuWhere: Record<string, string> = {
    chrome: 'At the top right of Chrome, next to the address bar.',
    edge: 'At the bottom of Edge (•••).',
    firefox: 'At the top right of Firefox (or the bottom, depending on your toolbar).',
  }
  const option: Record<string, string> = {
    edge: "Choose 'Add to phone'",
    firefox: "Choose 'Install' or 'Add to Home screen'",
  }

  return [
    {
      icon: EllipsisVertical,
      title: 'Tap the ⋮ menu',
      description: menuWhere[browser] ?? "Your browser's main menu, usually at the top right.",
    },
    {
      icon: SquarePlus,
      title: option[browser] ?? "Choose 'Install app' or 'Add to Home screen'",
      description: "If neither is listed, open this page in Chrome and try again.",
    },
    {
      icon: Check,
      title: "Confirm with 'Install'",
      description: 'Xphere appears on your home screen and in your app drawer.',
    },
  ]
}

export function ManualInstallSteps({ platform }: { platform: InstallPlatform }) {
  const steps = platform.os === 'ios' ? iosSteps(platform.browser) : androidSteps(platform.browser)

  return (
    <div className="space-y-3">
      <ol className="space-y-3">
        {steps.map((s, i) => (
          <Step key={s.title} n={i + 1} icon={s.icon} title={s.title} description={s.description} />
        ))}
      </ol>
      {needsRealBrowser(platform) && <CopyLinkButton />}
    </div>
  )
}

function CopyLinkButton() {
  const [copied, setCopied] = React.useState(false)

  async function copy() {
    try {
      await navigator.clipboard.writeText(window.location.href)
      setCopied(true)
      toast.success('Link copied')
      setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error("Couldn't copy — long-press the address bar instead")
    }
  }

  return (
    <Button variant="secondary" onClick={copy} className="w-full gap-1.5">
      {copied ? <Check /> : <Copy />}
      {copied ? 'Copied' : 'Copy link'}
    </Button>
  )
}

export function Step({
  n,
  icon: Icon,
  title,
  description,
}: {
  n: number
  icon: IconType
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
          <Icon className="h-3.5 w-3.5 shrink-0 text-text-tertiary" />
          {title}
        </p>
        <p className="text-[12px] text-text-secondary leading-relaxed mt-0.5">{description}</p>
      </div>
    </li>
  )
}
