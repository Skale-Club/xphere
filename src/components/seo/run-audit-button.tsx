'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Loader2, Play, Square } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cancelAudit, runAudit } from '@/app/(dashboard)/seo/website/actions'

export function RunAuditButton({ siteId, activeAuditId }: { siteId: string; activeAuditId: string | null }) {
  const router = useRouter()
  const [pending, start] = useTransition()

  if (activeAuditId) {
    return (
      <Button
        variant="outline"
        size="sm"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const res = await cancelAudit(activeAuditId)
            if (!res.ok) return void toast.error(res.error)
            toast.success('Audit cancelled')
            router.refresh()
          })
        }
      >
        {pending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Square className="mr-1.5 h-4 w-4" />}
        Cancel audit
      </Button>
    )
  }

  return (
    <Button
      size="sm"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const res = await runAudit(siteId)
          if (!res.ok) return void toast.error(res.error)
          toast.success('Audit queued — it starts within a minute')
          router.refresh()
        })
      }
    >
      {pending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Play className="mr-1.5 h-4 w-4" />}
      Run audit
    </Button>
  )
}
