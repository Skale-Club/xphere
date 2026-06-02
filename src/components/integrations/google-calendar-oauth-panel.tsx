'use client'

// Google Calendar OAuth panel for the unified /integrations grid.
// The connect handshake is a plain GET API route that issues a redirect to
// Google, so we navigate with a real <a> (a Next <Link> would try a soft
// navigation and break the redirect). Mirrors GoogleContactsOAuthPanel.

import Link from 'next/link'
import { ArrowRight, ExternalLink, Loader2, RefreshCw } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { SheetHeader, SheetTitle } from '@/components/ui/sheet'

import { IntegrationLogo } from './integration-logo'
import { toggleIntegrationActive } from '@/app/(dashboard)/integrations/actions'
import type { CustomPanelProps } from '@/lib/integrations/registry'

const CONNECT_HREF = '/api/google/calendar-oauth?return=/integrations'

export function GoogleCalendarOAuthPanel({ definition, existing }: CustomPanelProps) {
  const router = useRouter()
  const [isActive, setIsActive] = useState(existing?.is_active ?? false)
  const [isToggling, setIsToggling] = useState(false)

  const googleEmail = (existing?.config as { google_email?: string } | null)?.google_email

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
            ? 'Horários ocupados são respeitados ao gerar slots, e bookings criam eventos com link do Google Meet.'
            : 'Clique em Conectar para autorizar via OAuth. Você será redirecionado para o Google e voltará automaticamente.'}
        </p>

        {existing && googleEmail && (
          <p className="text-[12px] text-text-tertiary">
            Conta: <span className="font-medium text-text-secondary">{googleEmail}</span>
          </p>
        )}

        {existing ? (
          <div className="space-y-2">
            <Button asChild variant="outline" className="w-full justify-between">
              <a href={CONNECT_HREF}>
                Reconectar
                <RefreshCw className="ml-2 h-3.5 w-3.5" />
              </a>
            </Button>
            <Button asChild variant="ghost" className="w-full justify-between">
              <Link href="/scheduling">
                Gerenciar no Agendamento
                <ExternalLink className="ml-2 h-3.5 w-3.5" />
              </Link>
            </Button>
          </div>
        ) : (
          <Button asChild className="w-full justify-between">
            <a href={CONNECT_HREF}>
              Conectar
              <ArrowRight className="ml-2 h-3.5 w-3.5" />
            </a>
          </Button>
        )}
      </div>

      {definition.canActivate && existing && (
        <div className="border-t border-border-subtle pt-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[13px] font-medium text-text-primary">Ativo</p>
              <p className="text-[11px] text-text-tertiary">
                {isActive ? 'Em uso por agendamentos e workflows.' : 'Conectado mas desativado.'}
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
