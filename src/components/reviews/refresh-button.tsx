'use client'

import { useTransition } from 'react'
import { Loader2, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'

import { refreshNow } from '@/app/(dashboard)/integrations/google-reviews/actions'
import { Button } from '@/components/ui/button'

export function RefreshButton({ disabled }: { disabled?: boolean }) {
  const [isPending, startTransition] = useTransition()

  function handleClick() {
    startTransition(async () => {
      const res = await refreshNow()
      if (res.error) {
        toast.error(res.error)
        return
      }
      const parts: string[] = []
      if (typeof res.newReviews === 'number') parts.push(`${res.newReviews} new`)
      if (typeof res.upserted === 'number') parts.push(`${res.upserted} synced`)
      if (typeof res.removed === 'number' && res.removed > 0) parts.push(`${res.removed} removed`)
      toast.success(`Refresh complete | ${parts.join(' · ')}`)
    })
  }

  return (
    <Button onClick={handleClick} disabled={isPending || disabled} size="sm">
      {isPending ? (
        <>
          <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
          Scraping…
        </>
      ) : (
        <>
          <RefreshCw className="mr-2 h-3.5 w-3.5" />
          Refresh now
        </>
      )}
    </Button>
  )
}
