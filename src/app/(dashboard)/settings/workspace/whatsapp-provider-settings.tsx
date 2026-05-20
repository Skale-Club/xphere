'use client'

// SEED-031 — WhatsApp provider settings UI.
// One active provider per org. Switching providers replaces the previous one
// (server-side: previous row goes is_active=false, new row goes is_active=true).

import { useState, useTransition } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { saveWhatsAppProvider } from './actions'
import type { ActiveWhatsAppProvider } from './actions'
import type { WhatsAppProvider } from '@/lib/whatsapp/types'

interface Props {
  initial: ActiveWhatsAppProvider | null
}

const PROVIDER_LABEL: Record<WhatsAppProvider, string> = {
  evolution: 'Evolution Go',
  zapi: 'Z-API',
  wapi: 'W-API',
}

const WEBHOOK_URL: Record<WhatsAppProvider, string> = {
  evolution: 'https://xphere.app/api/evolution/webhook',
  zapi: 'https://xphere.app/api/zapi/webhook?instance={instanceId}',
  wapi: 'https://xphere.app/api/wapi/webhook?instance={instance_key}',
}

export function WhatsAppProviderSettings({ initial }: Props) {
  const [provider, setProvider] = useState<WhatsAppProvider>(initial?.provider ?? 'evolution')
  const [displayName, setDisplayName] = useState<string>(initial?.displayName ?? '')
  const [config, setConfig] = useState<Record<string, string>>(initial?.config ?? {})
  const [pending, startTransition] = useTransition()

  function updateField(key: string, value: string) {
    setConfig((prev) => ({ ...prev, [key]: value }))
  }

  function switchProvider(next: WhatsAppProvider) {
    if (next === provider) return
    // Reset config when switching to a different provider so we don't smuggle
    // stale fields from the previous provider's shape.
    setProvider(next)
    if (initial && initial.provider === next) {
      setConfig(initial.config)
    } else {
      setConfig({})
    }
  }

  function onSave() {
    startTransition(async () => {
      const res = await saveWhatsAppProvider({
        provider,
        displayName,
        config,
      })
      if (res?.error) {
        toast.error(res.error)
      } else {
        toast.success('WhatsApp provider saved')
      }
    })
  }

  const webhookUrl = WEBHOOK_URL[provider]

  return (
    <Card>
      <CardHeader>
        <CardTitle>WhatsApp</CardTitle>
        <CardDescription>
          Choose which unofficial WhatsApp provider this workspace uses. Only
          one provider can be active at a time — switching deactivates the
          previous one automatically.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-2">
          <Label htmlFor="wa-provider">Provider</Label>
          <Select value={provider} onValueChange={(v) => switchProvider(v as WhatsAppProvider)}>
            <SelectTrigger id="wa-provider" className="w-full max-w-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="evolution">Evolution Go</SelectItem>
              <SelectItem value="zapi">Z-API</SelectItem>
              <SelectItem value="wapi">W-API</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="wa-display-name">Display name</Label>
          <Input
            id="wa-display-name"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder={`${PROVIDER_LABEL[provider]} instance`}
          />
        </div>

        {provider === 'evolution' && (
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="evo-base">Base URL</Label>
              <Input
                id="evo-base"
                value={config.base_url ?? ''}
                onChange={(e) => updateField('base_url', e.target.value)}
                placeholder="https://evolution.example.com"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="evo-token">API key</Label>
              <Input
                id="evo-token"
                type="password"
                value={config.token ?? ''}
                onChange={(e) => updateField('token', e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="evo-instance">Instance name</Label>
              <Input
                id="evo-instance"
                value={config.instance_name ?? ''}
                onChange={(e) => updateField('instance_name', e.target.value)}
              />
            </div>
          </div>
        )}

        {provider === 'zapi' && (
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="zapi-instance">Instance ID</Label>
              <Input
                id="zapi-instance"
                value={config.instance_id ?? ''}
                onChange={(e) => updateField('instance_id', e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="zapi-token">Client-Token</Label>
              <Input
                id="zapi-token"
                type="password"
                value={config.token ?? ''}
                onChange={(e) => updateField('token', e.target.value)}
              />
            </div>
          </div>
        )}

        {provider === 'wapi' && (
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="wapi-base">Base URL</Label>
              <Input
                id="wapi-base"
                value={config.base_url ?? ''}
                onChange={(e) => updateField('base_url', e.target.value)}
                placeholder="https://api.w-api.app"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="wapi-key">Instance key</Label>
              <Input
                id="wapi-key"
                value={config.instance_key ?? ''}
                onChange={(e) => updateField('instance_key', e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="wapi-token">Bearer token</Label>
              <Input
                id="wapi-token"
                type="password"
                value={config.token ?? ''}
                onChange={(e) => updateField('token', e.target.value)}
              />
            </div>
          </div>
        )}

        <div className="space-y-2">
          <Label>Webhook URL</Label>
          <div className="rounded-md border bg-muted px-3 py-2 font-mono text-xs">
            {webhookUrl}
          </div>
          <p className="text-xs text-muted-foreground">
            Configure this URL in the {PROVIDER_LABEL[provider]} dashboard so
            inbound messages reach Xphere.
          </p>
        </div>

        {initial?.phoneNumber && (
          <p className="text-sm text-muted-foreground">
            Connected as <strong>{initial.phoneNumber}</strong>
            {initial.status ? ` · status: ${initial.status}` : ''}
          </p>
        )}

        <div className="flex justify-end">
          <Button onClick={onSave} disabled={pending}>
            {pending ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
