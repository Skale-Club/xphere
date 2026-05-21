'use client'

// SEED-043 Phase 4 | Centered onboarding card shown when the canvas has zero
// nodes. Renders five trigger choices; clicking any one delegates to the
// parent which creates a trigger node at viewport center.

import { Zap, Clock, Calendar, MousePointerClick, Webhook } from 'lucide-react'
import { cn } from '@/lib/utils'

export type EmptyCanvasTriggerType =
  | 'manual'
  | 'schedule'
  | 'event'
  | 'tool_call'
  | 'webhook_url'

const TRIGGERS = [
  { id: 'manual',      label: 'Manual',     icon: MousePointerClick, color: '#64748b', description: 'Run on demand' },
  { id: 'schedule',    label: 'Schedule',   icon: Clock,             color: '#06b6d4', description: 'Cron-based' },
  { id: 'event',       label: 'Event',      icon: Calendar,          color: '#f59e0b', description: 'When something happens' },
  { id: 'tool_call',   label: 'Tool call',  icon: Zap,               color: '#6366f1', description: 'Called by an agent' },
  { id: 'webhook_url', label: 'Webhook',    icon: Webhook,           color: '#f97316', description: 'External HTTP POST' },
] as const

interface EmptyCanvasStateProps {
  onPickTrigger: (triggerType: EmptyCanvasTriggerType) => void
}

export function EmptyCanvasState({ onPickTrigger }: EmptyCanvasStateProps) {
  return (
    <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-[5]">
      <div className="pointer-events-auto max-w-md text-center space-y-5 px-6">
        <div className="space-y-1.5">
          <h2 className="text-[15px] font-semibold text-text-primary">What triggers this workflow?</h2>
          <p className="text-[12.5px] text-text-secondary">Pick how this workflow starts. You can change it later.</p>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
          {TRIGGERS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => onPickTrigger(t.id)}
              className={cn(
                'flex flex-col items-center gap-1.5 rounded-[10px] border border-border-subtle bg-bg-secondary',
                'px-3 py-3 text-left transition-colors',
                'hover:border-border-strong hover:bg-bg-tertiary',
              )}
            >
              <div
                className="flex h-8 w-8 items-center justify-center rounded-[7px] text-white shrink-0"
                style={{ backgroundColor: t.color }}
              >
                <t.icon className="h-4 w-4" />
              </div>
              <span className="text-[12.5px] font-medium text-text-primary">{t.label}</span>
              <span className="text-[10.5px] text-text-tertiary leading-tight">{t.description}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
