'use client'

/**
 * DndBadge — compact visual indicator that a contact has DND active.
 * Used in contact list rows and conversation headers.
 */

import { PhoneOff } from 'lucide-react'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { DND_CHANNEL_LABELS } from '@/lib/dnd'

interface DndBadgeProps {
  dndEnabled: boolean
  dndChannels: string[]
  /** Compact icon-only mode (default true). Set to false for pill with label. */
  iconOnly?: boolean
}

export function DndBadge({ dndEnabled, dndChannels, iconOnly = true }: DndBadgeProps) {
  if (!dndEnabled || dndChannels.length === 0) return null

  const isAll = dndChannels.includes('all')
  const channelLabel = isAll
    ? 'all channels'
    : dndChannels.map((c) => DND_CHANNEL_LABELS[c] ?? c).join(', ')
  const tooltip = `DND active — ${channelLabel} blocked`

  if (iconOnly) {
    return (
      <TooltipProvider delayDuration={200}>
        <Tooltip>
          <TooltipTrigger asChild>
            <span
              aria-label={tooltip}
              className="inline-flex items-center justify-center rounded-full bg-rose-500/15 p-0.5 text-rose-400"
            >
              <PhoneOff className="h-3 w-3" />
            </span>
          </TooltipTrigger>
          <TooltipContent>{tooltip}</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    )
  }

  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            aria-label={tooltip}
            className="inline-flex items-center gap-1 rounded-full bg-rose-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-rose-400"
          >
            <PhoneOff className="h-3 w-3" />
            DND
          </span>
        </TooltipTrigger>
        <TooltipContent>{tooltip}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
