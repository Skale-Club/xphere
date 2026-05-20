// SEED-025 Phase D: small status pill rendered next to integrations and
// workflows. Three colors, one icon, one optional tooltip with last_error.

import { CheckCircle2, AlertTriangle, XCircle, HelpCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { IntegrationHealth } from '@/lib/workflows/health'

interface HealthBadgeProps {
  status: IntegrationHealth
  lastError?: string | null
  className?: string
}

const STYLES: Record<IntegrationHealth, { label: string; cls: string; Icon: typeof CheckCircle2 }> = {
  connected: {
    label: 'Connected',
    cls: 'bg-emerald-500/15 text-emerald-500 border-emerald-500/30',
    Icon: CheckCircle2,
  },
  degraded: {
    label: 'Degraded',
    cls: 'bg-amber-500/15 text-amber-500 border-amber-500/30',
    Icon: AlertTriangle,
  },
  disconnected: {
    label: 'Disconnected',
    cls: 'bg-red-500/15 text-red-500 border-red-500/30',
    Icon: XCircle,
  },
  unknown: {
    label: 'Unchecked',
    cls: 'bg-zinc-500/15 text-zinc-400 border-zinc-500/30',
    Icon: HelpCircle,
  },
}

export function HealthBadge({ status, lastError, className }: HealthBadgeProps) {
  const { label, cls, Icon } = STYLES[status]
  return (
    <span
      title={lastError ?? undefined}
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium',
        cls,
        className,
      )}
    >
      <Icon className="h-3 w-3" />
      {label}
    </span>
  )
}
