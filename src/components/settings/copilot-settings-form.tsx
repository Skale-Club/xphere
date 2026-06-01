'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { Plug2 } from 'lucide-react'
import { toast } from 'sonner'

import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { setCopilotEnabled } from '@/app/(dashboard)/settings/copilot/actions'

interface CopilotSettingsFormProps {
  initialEnabled: boolean
  hasProvider: boolean
}

export function CopilotSettingsForm({ initialEnabled, hasProvider }: CopilotSettingsFormProps) {
  const [enabled, setEnabled] = useState(initialEnabled)
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
