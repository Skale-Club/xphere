'use client'

import { useRouter } from 'next/navigation'
import { useTransition } from 'react'
import { toast } from 'sonner'
import { RefreshCw, Loader2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { syncCloudTemplates } from '@/app/(dashboard)/integrations/whatsapp/actions'

export function SyncTemplatesButton() {
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  function handleClick() {
    startTransition(async () => {
      const res = await syncCloudTemplates()
      if (!res.ok) {
        toast.error(res.error)
        return
      }
      toast.success(
        `Templates synced: +${res.inserted} new, ${res.updated} updated, -${res.deleted} removed`,
      )
      router.refresh()
    })
  }

  return (
    <Button onClick={handleClick} disabled={pending} className="gap-1.5">
      {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
      Sync from Meta
    </Button>
  )
}
