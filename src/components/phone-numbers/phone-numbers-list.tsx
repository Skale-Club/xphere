'use client'

/**
 * Settings > Phone Numbers list (phone-numbers project Phase 5).
 *
 * Read-only list view. Editing happens on the detail page so we can fit the
 * larger per-number form (Vapi assistant, responsible user, chat routing,
 * workflow settings, etc.) without cramming a dialog.
 *
 * Add/edit/delete still flows through /integrations/twilio for the narrower
 * "credentials + capabilities" surface; we link to it from the empty state.
 */

import * as React from 'react'
import Link from 'next/link'
import { CheckCircle2, ExternalLink, Phone, Star } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/empty-states/empty-state'
import type { TwilioPhoneNumberRow } from '@/app/(dashboard)/integrations/twilio/numbers-actions'

interface Props {
  initial: TwilioPhoneNumberRow[]
}

function displayLabel(row: TwilioPhoneNumberRow): string {
  return row.inbox_label?.trim() || row.friendly_name || row.e164
}

function capabilitySummary(row: TwilioPhoneNumberRow): string {
  const caps: string[] = []
  if (row.capability_voice) caps.push('Voice')
  if (row.capability_sms) caps.push('SMS')
  if (row.capability_mms) caps.push('MMS')
  return caps.length === 0 ? '—' : caps.join(' · ')
}

export function PhoneNumbersList({ initial }: Props) {
  if (initial.length === 0) {
    return (
      <EmptyState
        icon={Phone}
        title="No phone numbers yet"
        description="Connect a Twilio number to enable inbound/outbound calls and SMS. Numbers added in the Twilio integration appear here automatically."
        action={{ label: 'Add a number', href: '/integrations/twilio' }}
      />
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-end">
        <Button asChild variant="outline" size="sm">
          <Link href="/integrations/twilio">
            Add or remove numbers <ExternalLink className="ml-2 h-3.5 w-3.5" />
          </Link>
        </Button>
      </div>

      <ul className="divide-y divide-border-subtle overflow-hidden rounded-lg border border-border-subtle bg-bg-primary">
        {initial.map((row) => (
          <li key={row.id} className="flex items-center gap-3 px-4 py-3">
            <Phone className="h-4 w-4 shrink-0 text-text-tertiary" />

            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="truncate text-sm font-medium text-text-primary">
                  {displayLabel(row)}
                </span>
                {row.is_default && (
                  <span
                    className="inline-flex items-center gap-1 rounded-full bg-success-soft px-1.5 py-0.5 text-[10.5px] font-medium text-success"
                    title="Default outbound number"
                  >
                    <Star className="h-2.5 w-2.5" />
                    Default
                  </span>
                )}
                {!row.is_active && (
                  <span className="rounded-full bg-bg-secondary px-1.5 py-0.5 text-[10.5px] font-medium text-text-tertiary">
                    Archived
                  </span>
                )}
              </div>
              <div className="flex items-center gap-3 text-[11px] text-text-tertiary">
                <span className="font-mono">{row.e164}</span>
                <span>{capabilitySummary(row)}</span>
                {row.business_purpose && (
                  <span className="truncate">{row.business_purpose}</span>
                )}
                {row.vapi_assistant_id && (
                  <span className="inline-flex items-center gap-1">
                    <CheckCircle2 className="h-3 w-3 text-success" />
                    Vapi assistant linked
                  </span>
                )}
              </div>
            </div>

            <Button asChild size="sm" variant="ghost">
              <Link href={`/settings/phone-numbers/${row.id}`}>Configure</Link>
            </Button>
          </li>
        ))}
      </ul>
    </div>
  )
}
