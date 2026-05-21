'use client'

// SEED-042 | Generic OAuth-shaped panel.
// Defers the actual OAuth handshake to the existing per-provider dedicated
// page (e.g. /integrations/meta). The Sheet only provides quick context and
// a launcher.

import Link from 'next/link'
import { ArrowRight, ExternalLink, Loader2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { SheetHeader, SheetTitle } from '@/components/ui/sheet'

import { IntegrationLogo } from './integration-logo'
import { toggleIntegrationActive } from '@/app/(dashboard)/integrations/actions'
import type { CustomPanelProps } from '@/lib/integrations/registry'

export function OAuthPanel({ definition, existing }: CustomPanelProps) {
  const router = useRouter()
  const [isActive, setIsActive] = useState(existing?.is_active ?? false)
  const [isToggling, setIsToggling] = useState(false)

  async function handleToggleActive(next: boolean) {
    if (!existing) return
    setIsToggling(true)
    const prev = isActive
    setIsActive(next)
    try {
      const res = await toggleIntegrationActive(definition.id, next)
      if (!res.ok) {
        setIsActive(prev)
        toast.error(res.error ?? 'Failed to update.')
      } else {
        toast.success(next ? 'Integration activated.' : 'Integration deactivated.')
        router.refresh()
      }
    } finally {
      setIsToggling(false)
    }
  }

  const href = definition.oauthHref ?? `/integrations/${definition.id}`

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

      <div className="flex-1 overflow-y-auto space-y-4 py-2 text-[13px] text-text-secondary">
        <p>
          {existing
            ? 'Manage scopes, reconnect or revoke this connection from the dedicated page.'
            : 'Connect via OAuth from the dedicated page. We will redirect back here once authorization completes.'}
        </p>
        <Button asChild className="w-full justify-between">
          <Link href={href}>
            {existing ? 'Open settings' : 'Connect'}
            {existing ? (
              <ExternalLink className="ml-2 h-3.5 w-3.5" />
            ) : (
              <ArrowRight className="ml-2 h-3.5 w-3.5" />
            )}
          </Link>
        </Button>
      </div>

      {definition.canActivate && existing && (
        <div className="border-t border-border-subtle pt-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[13px] font-medium text-text-primary">Active</p>
              <p className="text-[11px] text-text-tertiary">
                {isActive ? 'In use by workflows and agents.' : 'Connected but disabled.'}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {isToggling && <Loader2 className="h-3.5 w-3.5 animate-spin text-text-tertiary" />}
              <Switch checked={isActive} disabled={isToggling} onCheckedChange={handleToggleActive} />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
