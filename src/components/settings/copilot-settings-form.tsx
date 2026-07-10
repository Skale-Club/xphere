'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { Plug2 } from 'lucide-react'
import { toast } from 'sonner'

import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import {
  setCopilotEnabled,
  setCopilotModelTier,
} from '@/app/(dashboard)/settings/copilot/actions'
import type { CopilotModelTier } from '@/lib/copilot/resolve-provider'

const MODEL_TIER_OPTIONS: Array<{
  value: CopilotModelTier
  label: string
  description: string
}> = [
  {
    value: 'fast',
    label: 'Fast (Haiku)',
    description: 'Cheapest and quickest. Great for lookups and simple edits.',
  },
  {
    value: 'default',
    label: 'Balanced (Sonnet)',
    description: 'Recommended. Strong reasoning at a moderate cost.',
  },
  {
    value: 'max',
    label: 'Max (Opus)',
    description: 'Most capable. Best for complex analysis; costs more per turn.',
  },
]

interface CopilotSettingsFormProps {
  initialEnabled: boolean
  hasProvider: boolean
  initialModelTier: CopilotModelTier
}

export function CopilotSettingsForm({
  initialEnabled,
  hasProvider,
  initialModelTier,
}: CopilotSettingsFormProps) {
  const [enabled, setEnabled] = useState(initialEnabled)
  const [modelTier, setModelTier] = useState<CopilotModelTier>(initialModelTier)
  const [isPending, startTransition] = useTransition()

  function handleToggle(value: boolean) {
    setEnabled(value)
    startTransition(async () => {
      try {
        await setCopilotEnabled(value)
        toast.success(value ? 'Copilot enabled' : 'Copilot disabled')
      } catch {
        setEnabled(!value) // revert on error
        toast.error('Failed to update Copilot settings')
      }
    })
  }

  function handleTierChange(value: CopilotModelTier) {
    const previous = modelTier
    setModelTier(value)
    startTransition(async () => {
      try {
        await setCopilotModelTier(value)
        toast.success('Copilot model updated')
      } catch {
        setModelTier(previous) // revert on error
        toast.error('Failed to update Copilot model')
      }
    })
  }

  return (
    <div className="mt-6 space-y-4">
      {/* Main toggle */}
      <div className="flex items-start gap-4 rounded-lg border border-border bg-bg-secondary p-5">
        <div className="flex-1 space-y-1">
          <Label
            htmlFor="copilot-toggle"
            className="cursor-pointer text-[14px] font-medium text-text-primary"
          >
            Enable Copilot
          </Label>
          <p className="text-[13px] leading-snug text-text-tertiary">
            Shows the Copilot button and panel to all users in this workspace.
            Disable to hide it completely.
          </p>
        </div>
        <Switch
          id="copilot-toggle"
          checked={enabled}
          onCheckedChange={handleToggle}
          disabled={isPending}
          aria-label="Enable or disable Copilot"
        />
      </div>

      {/* Model tier — which model the copilot runs on for this workspace */}
      {enabled && (
        <div className="rounded-lg border border-border bg-bg-secondary p-5">
          <p className="text-[14px] font-medium text-text-primary">Model</p>
          <p className="mt-1 text-[13px] leading-snug text-text-tertiary">
            The speed/quality trade-off for every Copilot turn in this
            workspace. Applies to both OpenRouter and direct Anthropic keys.
          </p>
          <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Copilot model">
            {MODEL_TIER_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                role="radio"
                aria-checked={modelTier === opt.value}
                disabled={isPending}
                onClick={() => handleTierChange(opt.value)}
                className={cn(
                  'rounded-lg border p-3 text-left transition-colors',
                  modelTier === opt.value
                    ? 'border-accent bg-accent/5'
                    : 'border-border bg-bg-primary hover:bg-bg-tertiary',
                )}
              >
                <span className="block text-[13px] font-medium text-text-primary">
                  {opt.label}
                </span>
                <span className="mt-0.5 block text-[12px] leading-snug text-text-tertiary">
                  {opt.description}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Provider status — only relevant when copilot is on */}
      {enabled && !hasProvider && (
        <div className="flex items-start gap-3 rounded-lg border border-amber-500/30 bg-amber-500/5 p-4">
          <Plug2 className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
          <div className="space-y-1">
            <p className="text-[13px] font-medium text-amber-500">
              No AI provider connected
            </p>
            <p className="text-[12px] leading-snug text-text-tertiary">
              Copilot is enabled but has no model to run on. Connect OpenRouter
              (or an Anthropic key) in Integrations to activate it.
            </p>
            <Link
              href="/integrations"
              className="mt-1 inline-flex items-center gap-1 text-[12px] font-medium text-accent hover:underline"
            >
              Go to Integrations →
            </Link>
          </div>
        </div>
      )}

      {enabled && hasProvider && (
        <div className="flex items-start gap-3 rounded-lg border border-green-500/30 bg-green-500/5 p-4">
          <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-green-500" />
          <div>
            <p className="text-[13px] font-medium text-green-600 dark:text-green-400">
              AI provider connected
            </p>
            <p className="text-[12px] leading-snug text-text-tertiary">
              Copilot is active and ready to use.
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
