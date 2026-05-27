'use client'

// SEED-042 | Generic api_key panel.
// Renders the IntegrationDefinition.fields as a form, with Test → Save → Activate flow.

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Check, ExternalLink, Eye, EyeOff, Loader2, Save, X, Zap } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { cn } from '@/lib/utils'

import { IntegrationLogo } from './integration-logo'
import {
  saveIntegrationCredentials,
  testIntegrationConnection,
  toggleIntegrationActive,
} from '@/app/(dashboard)/integrations/actions'
import type { CustomPanelProps } from '@/lib/integrations/registry'

export function ApiKeyPanel({ definition, existing, onClose }: CustomPanelProps) {
  const router = useRouter()
  const [fields, setFields] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {}
    const config =
      existing?.config && typeof existing.config === 'object' && !Array.isArray(existing.config)
        ? (existing.config as Record<string, unknown>)
        : {}
    for (const field of definition.fields ?? []) {
      if (field.key === 'api_key') continue
      const value = config[field.key]
      if (typeof value === 'string') init[field.key] = value
    }
    if (existing?.location_id) init.location_id = existing.location_id
    return init
  })
  const [showField, setShowField] = useState<Record<string, boolean>>({})
  const [testState, setTestState] = useState<'idle' | 'testing' | 'pass' | 'fail'>('idle')
  const [testMessage, setTestMessage] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [isActive, setIsActive] = useState(existing?.is_active ?? false)
  const [isToggling, setIsToggling] = useState(false)

  const apiKeyDirty = !!fields.api_key && fields.api_key.trim().length > 0
  const hasChanges = Object.keys(fields).length > 0
  const requiredFieldsFilled = (definition.fields ?? []).every((field) => {
    if (!field.required) return true
    if (field.key === 'api_key') return !!existing || apiKeyDirty
    return (fields[field.key] ?? '').trim().length > 0
  })
  const canSave = requiredFieldsFilled && (definition.testable
    ? testState === 'pass' || (!!existing && !apiKeyDirty && hasChanges)
    : apiKeyDirty || !existing || hasChanges)

  async function handleTest() {
    setTestState('testing')
    setTestMessage('Testing connection…')
    // For edits where the key hasn't been touched, we can't test without
    // re-entering the key. The UI nudges the user accordingly.
    if (!fields.api_key && existing) {
      setTestState('fail')
      setTestMessage('Re-enter the API key to test.')
      return
    }
    const res = await testIntegrationConnection(definition.id, fields)
    if (res.ok) {
      setTestState('pass')
      setTestMessage('Connection successful.')
    } else {
      setTestState('fail')
      setTestMessage(res.error ?? 'Test failed.')
    }
  }

  async function handleSave() {
    setIsSaving(true)
    try {
      const res = await saveIntegrationCredentials(definition.id, fields)
      if (!res.ok) {
        toast.error(res.error ?? 'Failed to save.')
        return
      }
      toast.success(`${definition.name} saved.`)
      router.refresh()
      onClose()
    } finally {
      setIsSaving(false)
    }
  }

  async function handleToggleActive(next: boolean) {
    if (!existing) return
    setIsToggling(true)
    const previous = isActive
    setIsActive(next)
    try {
      const res = await toggleIntegrationActive(definition.id, next)
      if (!res.ok) {
        setIsActive(previous)
        toast.error(res.error ?? 'Failed to update.')
      } else {
        toast.success(next ? 'Integration activated.' : 'Integration deactivated.')
        router.refresh()
      }
    } finally {
      setIsToggling(false)
    }
  }

  return (
    <div className="flex h-full flex-col px-6 pt-6 pb-4">
      <SheetHeader className="space-y-3 pb-4">
        <div className="flex items-center gap-3">
          <IntegrationLogo logo={definition.logo} name={definition.name} size={40} />
          <div className="min-w-0">
            <SheetTitle className="text-[15px]">{definition.name}</SheetTitle>
            <p className="text-[12px] text-text-tertiary">{definition.description}</p>
          </div>
        </div>
        {definition.docsUrl && (
          <a
            href={definition.docsUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-[12px] text-accent hover:underline"
          >
            <ExternalLink className="h-3 w-3" /> Documentation
          </a>
        )}
      </SheetHeader>

      <div className="flex-1 overflow-y-auto space-y-4 py-2">
        {definition.fields?.map((field) => {
          const isPwd = field.type === 'password'
          const visible = showField[field.key] ?? false
          return (
            <div key={field.key} className="space-y-1.5">
              <Label htmlFor={`fld-${field.key}`}>
                {field.label}
                {field.required && <span className="ml-0.5 text-rose-400">*</span>}
              </Label>
              <div className="relative">
                <Input
                  id={`fld-${field.key}`}
                  type={isPwd && !visible ? 'password' : 'text'}
                  placeholder={
                    existing && field.key === 'api_key'
                      ? `••••••••• (${existing.masked_api_key})`
                      : field.placeholder
                  }
                  value={fields[field.key] ?? ''}
                  onChange={(e) => {
                    const v = e.target.value
                    setFields((prev) => ({ ...prev, [field.key]: v }))
                    if (field.key === 'api_key' && testState !== 'idle') setTestState('idle')
                  }}
                  autoComplete="new-password"
                />
                {isPwd && (
                  <button
                    type="button"
                    onClick={() => setShowField((p) => ({ ...p, [field.key]: !visible }))}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-text-tertiary hover:text-text-primary"
                    aria-label={visible ? 'Hide' : 'Show'}
                  >
                    {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                )}
              </div>
              {field.hint && (
                <p className="text-[11px] text-text-tertiary">{field.hint}</p>
              )}
            </div>
          )
        })}

        {testState !== 'idle' && (
          <div
            className={cn(
              'flex items-center gap-2 rounded-[8px] px-3 py-2 text-[12.5px]',
              testState === 'pass' && 'bg-[var(--success-muted)] text-success',
              testState === 'fail' && 'bg-rose-500/10 text-rose-400',
              testState === 'testing' && 'bg-bg-tertiary text-text-tertiary',
            )}
          >
            {testState === 'testing' && (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            )}
            {testState === 'pass' && <Check className="h-3.5 w-3.5" />}
            {testState === 'fail' && <X className="h-3.5 w-3.5" />}
            <span>{testMessage}</span>
          </div>
        )}
      </div>

      <div className="border-t border-border-subtle pt-4 space-y-3">
        {definition.canActivate && existing && (
          <div className="flex items-center justify-between">
            <div className="min-w-0">
              <p className="text-[13px] font-medium text-text-primary">Active</p>
              <p className="text-[11px] text-text-tertiary">
                {isActive
                  ? 'Available to workflows and agents.'
                  : 'Saved but not used until enabled.'}
              </p>
            </div>
            <Switch
              checked={isActive}
              disabled={isToggling}
              onCheckedChange={handleToggleActive}
            />
          </div>
        )}

        <div className="flex gap-2">
          {definition.testable && (
            <Button
              variant="outline"
              onClick={handleTest}
              disabled={testState === 'testing' || isSaving || !hasChanges}
              className="flex-1"
            >
              {testState === 'testing' ? (
                <>
                  <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> Testing…
                </>
              ) : (
                <>
                  <Zap className="mr-1 h-3.5 w-3.5" /> Test
                </>
              )}
            </Button>
          )}
          <Button
            onClick={handleSave}
            disabled={!canSave || isSaving}
            className={cn('flex-1', !definition.testable && 'w-full')}
          >
            {isSaving ? (
              <>
                <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> Saving…
              </>
            ) : (
              <>
                <Save className="mr-1 h-3.5 w-3.5" /> Save
              </>
            )}
          </Button>
        </div>

        {definition.testable && testState !== 'pass' && !existing && (
          <p className="text-center text-[11px] text-text-tertiary">
            Test the credentials before saving.
          </p>
        )}
      </div>
    </div>
  )
}
