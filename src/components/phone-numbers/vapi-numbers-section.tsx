// src/components/phone-numbers/vapi-numbers-section.tsx
// Read-only Vapi phone number inventory, rendered under the Twilio number
// list on the Numbers settings tab. These numbers live in the org's Vapi
// account (not Twilio) and are what voice assistants / call campaigns pick
// from — this section just surfaces them, no CRUD here. Full number config
// still happens in Vapi or on the Twilio number editor.

import type { ReactNode } from 'react'
import Link from 'next/link'
import { AlertTriangle, Bot, Phone, Plug } from 'lucide-react'

import { createClient } from '@/lib/supabase/server'
import { getVapiApiKey, listVapiPhoneNumbers, type VapiPhoneNumber } from '@/lib/vapi/client'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import type { TwilioPhoneNumberRow } from '@/app/(dashboard)/integrations/twilio/numbers-actions'

interface Props {
  /** Twilio numbers the page already fetched — used only to flag E.164 overlap, never re-queried. */
  twilioNumbers: TwilioPhoneNumberRow[]
}

function formatE164(e164: string): string {
  // +18667240005 → +1 (866) 724-0005
  const m = e164.match(/^\+1(\d{3})(\d{3})(\d{4})$/)
  if (m) return `+1 (${m[1]}) ${m[2]}-${m[3]}`
  return e164
}

const PROVIDER_LABEL: Record<string, string> = {
  twilio: 'Twilio',
  vonage: 'Vonage',
  vapi: 'Vapi',
  'byo-phone-number': 'BYO',
}

const STATUS_STYLE: Record<string, string> = {
  active: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  activating: 'bg-amber-400/10 text-amber-300 border-amber-400/20',
  blocked: 'bg-rose-500/10 text-rose-400 border-rose-500/20',
}

function Section({ children }: { children: ReactNode }) {
  return (
    <div className="mt-6 space-y-3">
      <div>
        <h2 className="text-[13.5px] font-semibold text-text-primary">AI Phone Numbers (Vapi)</h2>
        <p className="mt-0.5 text-[12px] text-text-secondary">
          Numbers from your Vapi inventory, used by voice assistants and outbound call campaigns.
        </p>
      </div>
      {children}
    </div>
  )
}

export async function VapiNumbersSection({ twilioNumbers }: Props) {
  const apiKey = await getVapiApiKey()

  if (!apiKey) {
    return (
      <Section>
        <div className="flex items-center gap-3 rounded-[12px] border border-dashed border-border bg-bg-secondary/50 px-4 py-3.5">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] bg-bg-tertiary text-text-tertiary">
            <Plug className="h-4 w-4" />
          </div>
          <p className="text-[12.5px] text-text-secondary">
            Vapi not connected —{' '}
            <Link href="/integrations" className="text-accent hover:underline">
              connect it in Integrations
            </Link>{' '}
            to see AI phone numbers here.
          </p>
        </div>
      </Section>
    )
  }

  let numbers: VapiPhoneNumber[]
  try {
    numbers = await listVapiPhoneNumbers(apiKey)
  } catch {
    return (
      <Section>
        <div className="flex items-center gap-3 rounded-[12px] border border-border bg-bg-secondary px-4 py-3.5">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] bg-rose-500/10 text-rose-400">
            <AlertTriangle className="h-4 w-4" />
          </div>
          <p className="text-[12.5px] text-text-secondary">
            Couldn&apos;t reach Vapi — numbers may be out of date.
          </p>
        </div>
      </Section>
    )
  }

  if (numbers.length === 0) {
    return (
      <Section>
        <div className="rounded-[12px] border border-dashed border-border py-8 text-center">
          <div className="mx-auto mb-3 flex h-9 w-9 items-center justify-center rounded-full bg-bg-secondary">
            <Phone className="h-4 w-4 text-text-tertiary" />
          </div>
          <p className="text-[12.5px] text-text-secondary">No phone numbers in this Vapi account yet.</p>
        </div>
      </Section>
    )
  }

  const assistantIds = Array.from(
    new Set(numbers.map((n) => n.assistantId).filter((id): id is string => Boolean(id))),
  )

  const assistantNames = new Map<string, string>()
  if (assistantIds.length > 0) {
    const supabase = await createClient()
    const { data } = await supabase
      .from('assistant_mappings')
      .select('vapi_assistant_id, name')
      .in('vapi_assistant_id', assistantIds)
    for (const m of data ?? []) {
      assistantNames.set(m.vapi_assistant_id, m.name?.trim() || m.vapi_assistant_id)
    }
  }

  const twilioE164s = new Set(twilioNumbers.map((n) => n.e164))

  return (
    <Section>
      <div className="space-y-2.5">
        {numbers.map((n) => {
          const label = n.number ? formatE164(n.number) : n.name || n.id
          const managedInTwilio = n.number ? twilioE164s.has(n.number) : false
          const providerLabel = n.provider ? (PROVIDER_LABEL[n.provider] ?? n.provider) : null
          const assistantLabel = n.assistantId ? (assistantNames.get(n.assistantId) ?? null) : null
          const statusClass = n.status ? STATUS_STYLE[n.status] : undefined

          return (
            <div
              key={n.id}
              className="flex items-center gap-4 rounded-[12px] border border-border bg-bg-secondary px-4 py-3.5"
            >
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-bg-tertiary">
                <Phone className="h-4 w-4 text-text-secondary" />
              </div>

              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[13.5px] font-semibold text-text-primary truncate">{label}</span>
                  {n.name && n.number && (
                    <span className="text-[11.5px] text-text-tertiary truncate">{n.name}</span>
                  )}
                  {managedInTwilio && (
                    <Badge
                      variant="outline"
                      className="h-4 px-1.5 text-[10px] font-medium text-text-secondary border-border-subtle"
                    >
                      Managed in Twilio tab
                    </Badge>
                  )}
                </div>

                <div className="mt-1 flex flex-wrap items-center gap-2 text-[11.5px] text-text-tertiary">
                  {providerLabel && (
                    <>
                      <span>{providerLabel}</span>
                      <span className="text-text-tertiary/40">·</span>
                    </>
                  )}
                  {n.assistantId ? (
                    <span className="inline-flex items-center gap-1 text-emerald-400">
                      <Bot className="h-3 w-3" />
                      {assistantLabel ?? <span className="font-mono">{n.assistantId.slice(0, 8)}…</span>}
                    </span>
                  ) : (
                    <span>No assistant linked</span>
                  )}
                  {n.status && (
                    <>
                      <span className="text-text-tertiary/40">·</span>
                      <Badge
                        variant="outline"
                        className={cn(
                          'h-4 px-1.5 text-[10px] font-medium capitalize',
                          statusClass ?? 'text-text-secondary border-border-subtle',
                        )}
                      >
                        {n.status}
                      </Badge>
                    </>
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </Section>
  )
}
