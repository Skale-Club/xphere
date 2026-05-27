'use client'

// SEED-042 | WhatsApp custom panel.
// Inline provider selector (Evolution Go / Z-API / W-API) backed by the same
// server actions used in /settings/workspace (SEED-031). Both surfaces stay
// in sync because they call `saveWhatsAppProvider` directly.

import { useEffect, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Save } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { formatPhoneDisplay } from '@/lib/phone-numbers/format'
import { cn } from '@/lib/utils'

import { IntegrationLogo } from '../integration-logo'
import {
  getActiveWhatsAppProvider,
  saveWhatsAppProvider,
  type ActiveWhatsAppProvider,
} from '@/app/(dashboard)/settings/workspace/actions'
import type { CustomPanelProps } from '@/lib/integrations/registry'
import type { WhatsAppProvider } from '@/lib/whatsapp/types'

// Non-official inbox providers only. The official Meta Cloud lives in a
// separate integration (whatsapp_cloud_accounts) with its own panel.
type LegacyProvider = Exclude<WhatsAppProvider, 'meta_cloud'>

const PROVIDER_LABEL: Record<LegacyProvider, { label: string; hint: string }> = {
  evolution: { label: 'Evolution Go', hint: 'Self-hosted' },
  zapi: { label: 'Z-API', hint: 'Cloud' },
  wapi: { label: 'W-API', hint: 'Cloud' },
}

export function WhatsAppPanel({ definition, onClose }: CustomPanelProps) {
  const router = useRouter()
  const [active, setActive] = useState<ActiveWhatsAppProvider | null>(null)
  const [loading, setLoading] = useState(true)
  const [provider, setProvider] = useState<LegacyProvider>('evolution')
  const [displayName, setDisplayName] = useState('')
  const [config, setConfig] = useState<Record<string, string>>({})
  const [pending, startTransition] = useTransition()

  useEffect(() => {
    let cancelled = false
    getActiveWhatsAppProvider()
      .then((data) => {
        if (cancelled) return
        setActive(data)
        if (data && data.provider !== 'meta_cloud') {
          setProvider(data.provider as LegacyProvider)
          setDisplayName(data.displayName ?? '')
          setConfig(data.config ?? {})
        }
      })
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [])

  function switchProvider(next: LegacyProvider) {
    if (next === provider) return
    setProvider(next)
    if (active && active.provider === next) {
      setConfig(active.config)
    } else {
      setConfig({})
    }
  }

  function update(key: string, value: string) {
    setConfig((prev) => ({ ...prev, [key]: value }))
  }

  function onSave() {
    startTransition(async () => {
      const res = await saveWhatsAppProvider({ provider, displayName, config })
      if (res?.error) {
        toast.error(res.error)
      } else {
        toast.success('WhatsApp provider saved')
        router.refresh()
        onClose()
      }
    })
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
      </SheetHeader>

      <div className="flex-1 overflow-y-auto space-y-5 py-2">
        {loading ? (
          <div className="flex items-center justify-center py-10 text-text-tertiary">
            <Loader2 className="h-4 w-4 animate-spin" />
          </div>
        ) : (
          <>
            <div className="space-y-2">
              <Label>Provider</Label>
              <div className="grid grid-cols-3 gap-2">
                {(Object.keys(PROVIDER_LABEL) as LegacyProvider[]).map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => switchProvider(p)}
                    className={cn(
                      'rounded-[8px] border p-2.5 text-left transition-colors',
                      provider === p
                        ? 'border-accent bg-[var(--accent-muted)] text-text-primary'
                        : 'border-border-subtle text-text-secondary hover:border-border-strong',
                    )}
                  >
                    <p className="text-[12.5px] font-medium">{PROVIDER_LABEL[p].label}</p>
                    <p className="text-[10.5px] text-text-tertiary">
                      {PROVIDER_LABEL[p].hint}
                    </p>
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="wa-display-name">Display name</Label>
              <Input
                id="wa-display-name"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder={`${PROVIDER_LABEL[provider].label} instance`}
              />
            </div>

            {provider === 'evolution' && (
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="evo-base">Base URL</Label>
                  <Input
                    id="evo-base"
                    value={config.base_url ?? ''}
                    onChange={(e) => update('base_url', e.target.value)}
                    placeholder="https://evolution.example.com"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="evo-token">API key</Label>
                  <Input
                    id="evo-token"
                    type="password"
                    value={config.token ?? ''}
                    onChange={(e) => update('token', e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="evo-instance">Instance name</Label>
                  <Input
                    id="evo-instance"
                    value={config.instance_name ?? ''}
                    onChange={(e) => update('instance_name', e.target.value)}
                  />
                </div>
              </div>
            )}

            {provider === 'zapi' && (
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="zapi-instance">Instance ID</Label>
                  <Input
                    id="zapi-instance"
                    value={config.instance_id ?? ''}
                    onChange={(e) => update('instance_id', e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="zapi-token">Client-Token</Label>
                  <Input
                    id="zapi-token"
                    type="password"
                    value={config.token ?? ''}
                    onChange={(e) => update('token', e.target.value)}
                  />
                </div>
              </div>
            )}

            {provider === 'wapi' && (
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="wapi-base">Base URL</Label>
                  <Input
                    id="wapi-base"
                    value={config.base_url ?? ''}
                    onChange={(e) => update('base_url', e.target.value)}
                    placeholder="https://api.w-api.app"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="wapi-key">Instance key</Label>
                  <Input
                    id="wapi-key"
                    value={config.instance_key ?? ''}
                    onChange={(e) => update('instance_key', e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="wapi-token">Bearer token</Label>
                  <Input
                    id="wapi-token"
                    type="password"
                    value={config.token ?? ''}
                    onChange={(e) => update('token', e.target.value)}
                  />
                </div>
              </div>
            )}

            {active?.phoneNumber && (
              <p className="text-[12px] text-text-tertiary">
                Connected as <strong>{formatPhoneDisplay(active.phoneNumber)}</strong>
                {active.status ? ` · ${active.status}` : ''}
              </p>
            )}
          </>
        )}
      </div>

      <div className="border-t border-border-subtle pt-4">
        <Button onClick={onSave} disabled={pending || loading} className="w-full">
          {pending ? (
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
    </div>
  )
}
