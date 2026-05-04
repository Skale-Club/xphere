'use client'

import { useId, useTransition } from 'react'
import { Loader2, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'

import { syncReviews } from '@/app/(dashboard)/reviews/actions'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

const COOLDOWN_MS = 24 * 60 * 60 * 1000

function isCooldownActive(fetchedAt: string | null): boolean {
  if (!fetchedAt) return false
  return Date.now() - new Date(fetchedAt).getTime() < COOLDOWN_MS
}

function getHoursRemaining(fetchedAt: string): string {
  const msSince = Date.now() - new Date(fetchedAt).getTime()
  const msLeft = COOLDOWN_MS - msSince
  return Math.ceil(msLeft / (1000 * 60 * 60)).toString()
}

interface SyncButtonProps {
  locationId: string
  fetchedAt: string | null
}

export function SyncButton({ locationId, fetchedAt }: SyncButtonProps) {
  const [isPending, startTransition] = useTransition()
  const tooltipId = useId()
  const cooldownActive = isCooldownActive(fetchedAt)
  const tooltipText = fetchedAt
    ? `Available in ${getHoursRemaining(fetchedAt)}h - 24h minimum between syncs`
    : ''

  function handleClick() {
    startTransition(async () => {
      const result = await syncReviews(locationId)

      if (result.error) {
        toast.error(`Sync failed: ${result.error}`)
        return
      }

      toast.success(`Reviews synced - ${result.reviewCount ?? 0} review(s) loaded.`)
    })
  }

  if (cooldownActive) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span tabIndex={0}>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled
              aria-disabled="true"
              aria-describedby={tooltipId}
            >
              <RefreshCw className="mr-2 h-4 w-4" />
              Sync Reviews
            </Button>
          </span>
        </TooltipTrigger>
        <TooltipContent id={tooltipId}>{tooltipText}</TooltipContent>
      </Tooltip>
    )
  }

  return (
    <Button type="button" variant="outline" size="sm" disabled={isPending} onClick={handleClick}>
      {isPending ? (
        <>
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Syncing...
        </>
      ) : (
        <>
          <RefreshCw className="mr-2 h-4 w-4" />
          Sync Reviews
        </>
      )}
    </Button>
  )
}
