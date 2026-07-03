'use client'

import { useState, useTransition } from 'react'
import { RefreshCw } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { syncZernioTemplatesAction } from '@/app/(dashboard)/integrations/whatsapp/actions'

export function SyncZernioTemplatesButton() {
  const [pending, startTransition] = useTransition()
  const [spinning, setSpinning] = useState(false)

  function handleSync() {
    setSpinning(true)
    startTransition(async () => {
      const res = await syncZernioTemplatesAction()
      setSpinning(false)
      if (!res.ok) {
        toast.error(res.error)
      } else {
        toast.success(`Synced ${res.synced} template${res.synced !== 1 ? 's' : ''} from Zernio.`)
      }
    })
  }

  return (
    <Button variant="outline" onClick={handleSync} disabled={pending} className="gap-1.5">
      <RefreshCw className={`h-3.5 w-3.5 ${spinning ? 'animate-spin' : ''}`} />
      Sync
    </Button>
  )
}
