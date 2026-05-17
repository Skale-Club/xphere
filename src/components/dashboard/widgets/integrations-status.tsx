import Link from 'next/link'
import { MessageCircle, Phone, Camera, MessageSquare, Star, Zap, Check, Plug2 } from 'lucide-react'

import { createClient } from '@/lib/supabase/server'
import { WidgetCard } from '@/components/dashboard/widget-card'
import { cn } from '@/lib/utils'

interface Tile {
  id: string
  label: string
  icon: React.ComponentType<{ className?: string }>
  href: string
  connected: boolean
  detail?: string
}

/**
 * Connected services grid. Renders the six core integrations as 2x3 tiles,
 * each showing connection state + a one-line detail (phone number, place
 * name, etc.) when available.
 */
export async function IntegrationsStatus() {
  let tiles: Tile[] = []

  try {
    const supabase = await createClient()

    const [{ data: evos }, { data: ints }, { data: gbps }] = [
      await supabase
        .from('evolution_instances')
        .select('status, phone_number, is_active')
        .eq('is_active', true)
        .limit(1)
        .maybeSingle(),
      await supabase.from('integrations').select('provider, is_active, name, key_hint'),
      await supabase
        .from('google_business_profiles')
        .select('business_name, is_active')
        .eq('is_active', true)
        .limit(1)
        .maybeSingle(),
    ]

    const byProvider = new Map<string, { is_active: boolean; name: string | null; key_hint: string | null }>()
    for (const i of ints ?? []) {
      if (!byProvider.has(i.provider) || i.is_active) {
        byProvider.set(i.provider, { is_active: i.is_active, name: i.name, key_hint: i.key_hint })
      }
    }

    const evo = evos as { status: string; phone_number: string | null; is_active: boolean } | null
    const gbp = gbps as { business_name: string | null; is_active: boolean } | null

    const twilio = byProvider.get('twilio')
    const manychat = byProvider.get('manychat')
    const ghl = byProvider.get('gohighlevel')

    tiles = [
      {
        id: 'whatsapp',
        label: 'WhatsApp',
        icon: MessageCircle,
        href: '/integrations/evolution',
        connected: Boolean(evo && evo.status === 'connected'),
        detail: evo?.phone_number ?? undefined,
      },
      {
        id: 'twilio',
        label: 'Twilio',
        icon: Phone,
        href: '/integrations/twilio',
        connected: Boolean(twilio?.is_active),
        detail: twilio?.name ?? undefined,
      },
      {
        id: 'meta',
        label: 'Meta',
        icon: Camera,
        href: '/integrations/meta',
        connected: false, // Meta isn't represented as an integrations row; placeholder
        detail: undefined,
      },
      {
        id: 'manychat',
        label: 'ManyChat',
        icon: MessageSquare,
        href: '/integrations/manychat',
        connected: Boolean(manychat?.is_active),
      },
      {
        id: 'reviews',
        label: 'Reviews',
        icon: Star,
        href: '/integrations/google-reviews',
        connected: Boolean(gbp),
        detail: gbp?.business_name ?? undefined,
      },
      {
        id: 'ghl',
        label: 'GoHighLevel',
        icon: Zap,
        href: '/integrations',
        connected: Boolean(ghl?.is_active),
      },
    ]
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[dashboard:integrations-status]', err)
  }

  const connectedCount = tiles.filter((t) => t.connected).length

  return (
    <WidgetCard
      title="Connected services"
      icon={Plug2}
      href="/integrations"
      headerExtra={
        <span className="rounded-[5px] bg-bg-tertiary px-1.5 py-0.5 text-[11px] font-medium tabular text-text-tertiary">
          {connectedCount}/{tiles.length}
        </span>
      }
    >
      <div className="grid grid-cols-2 gap-2">
        {tiles.map((t) => {
          const Icon = t.icon
          return (
            <Link
              key={t.id}
              href={t.href}
              className={cn(
                'group flex items-center gap-2.5 rounded-[10px] border border-border-subtle bg-bg-tertiary/40 p-2.5 transition-all',
                'hover:-translate-y-0.5 hover:border-border-strong hover:bg-bg-tertiary',
              )}
            >
              <div
                className={cn(
                  'flex h-7 w-7 shrink-0 items-center justify-center rounded-[6px] ring-1',
                  t.connected
                    ? 'bg-success-muted text-success ring-success/20'
                    : 'bg-bg-tertiary text-text-tertiary ring-border-subtle',
                )}
              >
                <Icon className="h-3.5 w-3.5" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="text-[12px] font-medium text-text-primary">{t.label}</span>
                  {t.connected && <Check className="h-3 w-3 text-success" />}
                </div>
                <div className="truncate text-[10.5px] text-text-tertiary">
                  {t.connected ? (t.detail ?? 'Connected') : 'Not connected'}
                </div>
              </div>
            </Link>
          )
        })}
      </div>
    </WidgetCard>
  )
}
