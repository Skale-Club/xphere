'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import { toggleWorkflowActive } from '@/app/(dashboard)/workflows/flows/_actions/workflows'

interface Props {
  workflowId: string
  initialActive: boolean
  blocked?: boolean
  blockedReason?: string | null
  showLabel?: boolean
  /** Smaller footprint for tight spaces, e.g. the sidebar tree row. */
  compact?: boolean
}

export function WorkflowToggle({
  workflowId,
  initialActive,
  blocked,
  blockedReason,
  showLabel,
  compact,
}: Props) {
  const router = useRouter()
  const [active, setActive] = useState(initialActive)
  const [isPending, startTransition] = useTransition()

  if (blocked) {
    return (
      <Badge
        variant="secondary"
        className={cn('bg-red-500/15 text-red-500', compact ? 'h-4 px-1.5 py-0 text-[9px]' : 'text-[10px]')}
        title={blockedReason ?? undefined}
      >
        Blocked
      </Badge>
    )
  }

  function handleToggle(checked: boolean) {
    setActive(checked)
    startTransition(async () => {
      const result = await toggleWorkflowActive(workflowId, checked)
      if (!result.ok) {
        setActive(!checked)
        toast.error(`Could not update workflow: ${result.error}`)
        return
      }
      router.refresh()
    })
  }

  return (
    <div className={cn('flex items-center', compact ? 'gap-1' : 'gap-2')}>
      <Switch
        size={compact ? 'sm' : 'default'}
        checked={active}
        onCheckedChange={handleToggle}
        disabled={isPending}
        aria-label={active ? 'Deactivate workflow' : 'Activate workflow'}
      />
      {showLabel && (
        <span className="text-xs text-text-secondary">{active ? 'Active' : 'Inactive'}</span>
      )}
    </div>
  )
}
