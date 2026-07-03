'use client'

import * as React from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Bot, Phone, Route, Settings2, type LucideIcon } from 'lucide-react'

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'

export type VoiceSettingsTab = 'numbers' | 'routing' | 'assistants' | 'general'

const TABS: Array<{ id: VoiceSettingsTab; label: string; icon: LucideIcon }> = [
  { id: 'numbers', label: 'Phone Numbers', icon: Phone },
  { id: 'routing', label: 'Call Routing', icon: Route },
  { id: 'assistants', label: 'Voice Assistants', icon: Bot },
  { id: 'general', label: 'General', icon: Settings2 },
]

export function isVoiceSettingsTab(v: string | undefined): v is VoiceSettingsTab {
  return v === 'numbers' || v === 'routing' || v === 'assistants' || v === 'general'
}

/**
 * Org-level voice configuration modal, driven by `?settings={tab}`. The server
 * page fetches data for the active tab and renders it as children; switching
 * tabs is a shallow URL replace so old deep links (/calls/routing etc.) can
 * redirect straight into the right tab.
 */
export function VoiceSettingsDialog({
  tab,
  children,
}: {
  tab: VoiceSettingsTab
  children: React.ReactNode
}) {
  const router = useRouter()
  const pathname = usePathname()
  const sp = useSearchParams()

  const setParams = React.useCallback(
    (mutate: (params: URLSearchParams) => void) => {
      const params = new URLSearchParams(Array.from(sp.entries()))
      mutate(params)
      router.replace(`${pathname}${params.toString() ? `?${params.toString()}` : ''}`)
    },
    [router, pathname, sp],
  )

  return (
    <Dialog open onOpenChange={(open) => { if (!open) setParams((p) => p.delete('settings')) }}>
      <DialogContent className="flex max-h-[88vh] w-[calc(100vw-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-[1040px]">
        <DialogHeader className="border-b border-border px-6 pb-4 pt-5">
          <DialogTitle className="text-[15px]">Voice Settings</DialogTitle>
          <DialogDescription className="text-[12.5px]">
            Organization-wide call behavior. Provider credentials live in Integrations.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-1 border-b border-border px-4 py-2">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => setParams((p) => p.set('settings', id))}
              className={cn(
                'flex items-center gap-1.5 rounded-[8px] px-3 py-1.5 text-[12.5px] font-medium transition-colors',
                tab === id
                  ? 'bg-accent/10 text-text-primary'
                  : 'text-text-secondary hover:bg-bg-tertiary hover:text-text-primary',
              )}
            >
              <Icon className={cn('h-3.5 w-3.5', tab === id ? 'text-accent' : 'text-text-tertiary')} />
              {label}
            </button>
          ))}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">{children}</div>
      </DialogContent>
    </Dialog>
  )
}
