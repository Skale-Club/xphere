'use client'

/**
 * Settings > Phone Numbers | the single home for managing org numbers.
 *
 * Lists numbers, adds via the Twilio wizard (AddPhoneNumberDialog), and exposes
 * per-row actions (set default, configure, remove). Full per-number editing
 * (capabilities, routing, identity, owner) lives on the detail page so the
 * larger form has room to breathe.
 */

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { CheckCircle2, MoreHorizontal, Phone, Plus, Settings2, Star, Trash2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/empty-states/empty-state'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import { AddPhoneNumberDialog } from '@/components/phone-numbers/add-phone-number-dialog'
import { EditPhoneNumberDialog } from '@/components/phone-numbers/edit-phone-number-dialog'
import {
  setDefaultTwilioNumber,
  softDeleteTwilioNumber,
  type TwilioPhoneNumberRow,
} from '@/app/(dashboard)/integrations/twilio/numbers-actions'

interface Props {
  initial: TwilioPhoneNumberRow[]
  twilioConnected: boolean
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

export function PhoneNumbersList({ initial, twilioConnected }: Props) {
  const router = useRouter()
  const [addOpen, setAddOpen] = React.useState(false)
  const [editRow, setEditRow] = React.useState<TwilioPhoneNumberRow | null>(null)
  const [busyId, setBusyId] = React.useState<string | null>(null)

  const handleSetDefault = React.useCallback(
    async (row: TwilioPhoneNumberRow) => {
      if (row.is_default) return
      setBusyId(row.id)
      try {
        const res = await setDefaultTwilioNumber(row.id)
        if (res.error) {
          toast.error(res.error)
          return
        }
        toast.success(`${displayLabel(row)} is now the default number.`)
        router.refresh()
      } finally {
        setBusyId(null)
      }
    },
    [router],
  )

  const handleDelete = React.useCallback(
    async (row: TwilioPhoneNumberRow) => {
      if (typeof window !== 'undefined') {
        const ok = window.confirm(
          `Remove ${displayLabel(row)} (${row.e164})? This soft-deletes the number | history is preserved but it will no longer be available for outbound or inbound flows.`,
        )
        if (!ok) return
      }
      setBusyId(row.id)
      try {
        const res = await softDeleteTwilioNumber(row.id)
        if (res.error) {
          toast.error(res.error)
          return
        }
        toast.success(`${displayLabel(row)} removed.`)
        router.refresh()
      } finally {
        setBusyId(null)
      }
    },
    [router],
  )

  if (initial.length === 0) {
    return (
      <>
        <EmptyState
          icon={Phone}
          title="No phone numbers yet"
          description="Connect a Twilio number to enable inbound/outbound calls and SMS. Pick one straight from your Twilio account."
          action={{ label: 'Add a number', onClick: () => setAddOpen(true) }}
        />
        <AddPhoneNumberDialog
          open={addOpen}
          onOpenChange={setAddOpen}
          twilioConnected={twilioConnected}
        />
      </>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-end">
        <Button size="sm" onClick={() => setAddOpen(true)}>
          <Plus className="mr-1.5 h-3.5 w-3.5" />
          Add number
        </Button>
      </div>

      <ul className="divide-y divide-border-subtle overflow-hidden rounded-lg border border-border-subtle bg-bg-primary">
        {initial.map((row) => (
          <li
            key={row.id}
            className={cn(
              'flex items-center gap-3 px-4 py-3',
              busyId === row.id && 'pointer-events-none opacity-60',
            )}
          >
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
                {row.business_purpose && <span className="truncate">{row.business_purpose}</span>}
                {row.vapi_assistant_id && (
                  <span className="inline-flex items-center gap-1">
                    <CheckCircle2 className="h-3 w-3 text-success" />
                    Vapi assistant linked
                  </span>
                )}
              </div>
            </div>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="More actions">
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {!row.is_default && row.is_active && (
                  <DropdownMenuItem onClick={() => handleSetDefault(row)}>
                    <Star className="h-3.5 w-3.5" />
                    Set as default
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem onClick={() => setEditRow(row)}>
                  <Settings2 className="h-3.5 w-3.5" />
                  Configure
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => handleDelete(row)}
                  className="text-destructive focus:text-destructive"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Remove
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </li>
        ))}
      </ul>

      <AddPhoneNumberDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        twilioConnected={twilioConnected}
      />

      <EditPhoneNumberDialog
        number={editRow}
        open={editRow !== null}
        onOpenChange={(open) => !open && setEditRow(null)}
      />
    </div>
  )
}
