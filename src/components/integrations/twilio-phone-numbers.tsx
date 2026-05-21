'use client'
/**
 * Twilio phone numbers | per-org list + CRUD dialog (v2.3).
 *
 * Mounted inside `/integrations/twilio` between the Account credentials and
 * Voice SDK sections. Operators can add, edit, set-default, and soft-delete
 * numbers; the test SMS flow lives at the section level (not per-number).
 */

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import {
  CheckCircle2,
  ExternalLink,
  MoreHorizontal,
  Pencil,
  Phone,
  Plus,
  Star,
  Trash2,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { StatusPill } from '@/components/design-system/status-pill'
import { EmptyState } from '@/components/empty-states/empty-state'
import { cn } from '@/lib/utils'

import {
  createTwilioNumber,
  updateTwilioNumber,
  softDeleteTwilioNumber,
  setDefaultTwilioNumber,
  type TwilioPhoneNumberRow,
  type CreateNumberInput,
} from '@/app/(dashboard)/integrations/twilio/numbers-actions'

type RoutingMode = 'browser' | 'sip' | 'forward'
const ROUTING_NONE = '__none__'

interface TwilioPhoneNumbersProps {
  initial: TwilioPhoneNumberRow[]
}

export function TwilioPhoneNumbers({ initial }: TwilioPhoneNumbersProps) {
  const router = useRouter()
  const [numbers, setNumbers] = React.useState<TwilioPhoneNumberRow[]>(initial)
  const [dialogOpen, setDialogOpen] = React.useState(false)
  const [editing, setEditing] = React.useState<TwilioPhoneNumberRow | null>(null)
  const [busyId, setBusyId] = React.useState<string | null>(null)

  // Keep local state in sync if the server passes a new list (e.g. after revalidatePath).
  React.useEffect(() => {
    setNumbers(initial)
  }, [initial])

  function openCreate() {
    setEditing(null)
    setDialogOpen(true)
  }

  function openEdit(row: TwilioPhoneNumberRow) {
    setEditing(row)
    setDialogOpen(true)
  }

  async function handleSetDefault(row: TwilioPhoneNumberRow) {
    if (row.is_default) return
    setBusyId(row.id)
    try {
      const res = await setDefaultTwilioNumber(row.id)
      if (res.error) {
        toast.error(res.error)
        return
      }
      toast.success(`${row.friendly_name} is now the default number.`)
      router.refresh()
    } finally {
      setBusyId(null)
    }
  }

  async function handleDelete(row: TwilioPhoneNumberRow) {
    if (typeof window !== 'undefined') {
      const ok = window.confirm(
        `Remove ${row.friendly_name} (${row.e164})? This soft-deletes the number | history is preserved but it will no longer be available for outbound or inbound flows.`,
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
      toast.success(`${row.friendly_name} removed.`)
      router.refresh()
    } finally {
      setBusyId(null)
    }
  }

  const activeCount = numbers.filter((n) => n.is_active).length

  return (
    <section className="rounded-[14px] border border-border bg-bg-secondary p-6 space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-[10px] bg-bg-tertiary text-text-secondary">
            <Phone className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-[15px] font-medium text-text-primary">
              Phone numbers
            </h2>
            <p className="mt-0.5 max-w-2xl text-[12.5px] text-text-secondary leading-relaxed">
              Numbers operators have registered with Twilio. The default number is used for outbound SMS and outbound calls when no specific number is requested.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <StatusPill tone={activeCount > 0 ? 'success' : 'idle'}>
            {activeCount === 0
              ? 'No numbers'
              : activeCount === 1
                ? '1 active'
                : `${activeCount} active`}
          </StatusPill>
          <Button onClick={openCreate} size="sm">
            <Plus className="h-3.5 w-3.5" />
            Add number
          </Button>
        </div>
      </div>

      {numbers.length === 0 ? (
        <EmptyState
          icon={Phone}
          title="No phone numbers yet"
          description="Add your Twilio number to start sending SMS and receiving calls. You can register multiple numbers and pick a default."
          action={{ label: 'Add your first number', onClick: openCreate }}
          secondary={{
            label: 'Buy a Twilio number',
            href: 'https://console.twilio.com/us1/develop/phone-numbers/manage/incoming',
          }}
        />
      ) : (
        <ul className="divide-y divide-border-subtle rounded-[10px] border border-border-subtle bg-bg-primary">
          {numbers.map((row) => (
            <PhoneNumberRow
              key={row.id}
              row={row}
              busy={busyId === row.id}
              onEdit={() => openEdit(row)}
              onSetDefault={() => handleSetDefault(row)}
              onDelete={() => handleDelete(row)}
            />
          ))}
        </ul>
      )}

      <PhoneNumberDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        editing={editing}
        onSaved={() => {
          setDialogOpen(false)
          setEditing(null)
          router.refresh()
        }}
      />
    </section>
  )
}

// ── List row ────────────────────────────────────────────────────────────────

function PhoneNumberRow({
  row,
  busy,
  onEdit,
  onSetDefault,
  onDelete,
}: {
  row: TwilioPhoneNumberRow
  busy: boolean
  onEdit: () => void
  onSetDefault: () => void
  onDelete: () => void
}) {
  return (
    <li className={cn('flex items-center justify-between gap-3 px-4 py-3', busy && 'opacity-60 pointer-events-none')}>
      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex items-center gap-2">
          <span className="text-[14px] font-semibold text-text-primary">
            {row.friendly_name}
          </span>
          {row.is_default && (
            <StatusPill tone="success">Default</StatusPill>
          )}
        </div>
        <div className="flex items-center gap-3">
          <code className="font-mono text-[12.5px] text-text-secondary">{row.e164}</code>
          <CapabilityBadges row={row} />
        </div>
      </div>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="More actions">
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {!row.is_default && (
            <DropdownMenuItem onClick={onSetDefault}>
              <Star className="h-3.5 w-3.5" />
              Set as default
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onClick={onEdit}>
            <Pencil className="h-3.5 w-3.5" />
            Edit
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={onDelete} className="text-destructive focus:text-destructive">
            <Trash2 className="h-3.5 w-3.5" />
            Remove
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  )
}

function CapabilityBadges({ row }: { row: TwilioPhoneNumberRow }) {
  const items: { key: string; label: string; on: boolean }[] = [
    { key: 'sms', label: 'SMS', on: row.capability_sms },
    { key: 'mms', label: 'MMS', on: row.capability_mms },
    { key: 'voice', label: 'Voice', on: row.capability_voice },
  ]
  const enabled = items.filter((i) => i.on)
  if (enabled.length === 0) {
    return <span className="text-[11.5px] text-text-tertiary">No capabilities</span>
  }
  return (
    <div className="flex items-center gap-1.5">
      {enabled.map((i) => (
        <span
          key={i.key}
          className="inline-flex items-center gap-1 rounded-full border border-border-subtle bg-bg-tertiary px-2 py-0.5 text-[10.5px] font-medium uppercase tracking-wider text-text-secondary"
        >
          <CheckCircle2 className="h-2.5 w-2.5 text-success" />
          {i.label}
        </span>
      ))}
    </div>
  )
}

// ── Dialog ──────────────────────────────────────────────────────────────────

interface PhoneNumberDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  editing: TwilioPhoneNumberRow | null
  onSaved: () => void
}

function PhoneNumberDialog({ open, onOpenChange, editing, onSaved }: PhoneNumberDialogProps) {
  const isEdit = editing !== null

  const [friendlyName, setFriendlyName] = React.useState('')
  const [e164, setE164] = React.useState('')
  const [phoneSid, setPhoneSid] = React.useState('')
  const [capSms, setCapSms] = React.useState(false)
  const [capMms, setCapMms] = React.useState(false)
  const [capVoice, setCapVoice] = React.useState(false)
  const [routingMode, setRoutingMode] = React.useState<'none' | RoutingMode>('none')
  const [forwardTo, setForwardTo] = React.useState('')
  const [isDefault, setIsDefault] = React.useState(false)
  const [notes, setNotes] = React.useState('')
  const [saving, setSaving] = React.useState(false)

  // Sync form state when the dialog opens with a row to edit (or resets to create mode).
  React.useEffect(() => {
    if (!open) return
    if (editing) {
      setFriendlyName(editing.friendly_name)
      setE164(editing.e164)
      setPhoneSid(editing.phone_sid ?? '')
      setCapSms(editing.capability_sms)
      setCapMms(editing.capability_mms)
      setCapVoice(editing.capability_voice)
      setRoutingMode((editing.default_routing_mode as RoutingMode | null) ?? 'none')
      setForwardTo(editing.forward_to_number ?? '')
      setIsDefault(editing.is_default)
      setNotes(editing.notes ?? '')
    } else {
      setFriendlyName('')
      setE164('')
      setPhoneSid('')
      setCapSms(true)
      setCapMms(false)
      setCapVoice(true)
      setRoutingMode('none')
      setForwardTo('')
      setIsDefault(false)
      setNotes('')
    }
  }, [open, editing])

  function clientValidate(): string | null {
    if (!friendlyName.trim()) return 'Friendly name is required.'
    if (!/^\+[1-9]\d{6,14}$/.test(e164)) return 'Invalid E.164 format (e.g. +14155551234).'
    if (phoneSid && !/^PN[a-f0-9]{32}$/i.test(phoneSid)) {
      return 'Phone SID must look like PN followed by 32 hex chars (or leave blank).'
    }
    if (!capSms && !capMms && !capVoice) return 'Enable at least one capability.'
    if (routingMode === 'forward' && !/^\+[1-9]\d{6,14}$/.test(forwardTo)) {
      return 'Forward target must be a valid E.164 number.'
    }
    return null
  }

  async function handleSave() {
    const err = clientValidate()
    if (err) {
      toast.error(err)
      return
    }
    setSaving(true)
    try {
      const payload: CreateNumberInput = {
        friendly_name: friendlyName.trim(),
        e164: e164.trim(),
        phone_sid: phoneSid.trim() || undefined,
        capability_sms: capSms,
        capability_mms: capMms,
        capability_voice: capVoice,
        default_routing_mode: routingMode === 'none' ? null : routingMode,
        forward_to_number: routingMode === 'forward' ? forwardTo.trim() : undefined,
        is_default: isDefault,
        notes: notes.trim() || undefined,
      }

      const res = isEdit && editing
        ? await updateTwilioNumber(editing.id, payload)
        : await createTwilioNumber(payload)

      if (res.error) {
        toast.error(res.error)
        return
      }
      toast.success(isEdit ? 'Number updated.' : 'Number added.')
      onSaved()
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit phone number' : 'Add phone number'}</DialogTitle>
          <DialogDescription>
            Register a Twilio number already provisioned in your Twilio account. Xphere does not purchase numbers | buy in the{' '}
            <a
              href="https://console.twilio.com/us1/develop/phone-numbers/manage/incoming"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-accent underline-offset-4 hover:underline"
            >
              Twilio console
              <ExternalLink className="h-3 w-3" />
            </a>{' '}
            first.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          <div className="grid gap-1.5">
            <Label htmlFor="number-friendly-name">Friendly name</Label>
            <Input
              id="number-friendly-name"
              value={friendlyName}
              onChange={(e) => setFriendlyName(e.target.value)}
              placeholder="Sales BR"
              maxLength={64}
            />
            <p className="text-[11.5px] text-text-tertiary">A short label so you can tell numbers apart in the UI.</p>
          </div>

          <div className="grid gap-1.5 md:grid-cols-2 md:gap-4">
            <div className="grid gap-1.5">
              <Label htmlFor="number-e164">Phone number (E.164)</Label>
              <Input
                id="number-e164"
                value={e164}
                onChange={(e) => setE164(e.target.value)}
                placeholder="+14155551234"
                className="font-mono text-[12.5px]"
                autoComplete="off"
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="number-sid">Phone SID (optional)</Label>
              <Input
                id="number-sid"
                value={phoneSid}
                onChange={(e) => setPhoneSid(e.target.value)}
                placeholder="PN…"
                className="font-mono text-[12.5px]"
                autoComplete="off"
              />
            </div>
          </div>

          <div className="grid gap-2">
            <Label>Capabilities</Label>
            <div className="flex flex-wrap items-center gap-4">
              <CheckboxRow checked={capSms} onChange={setCapSms} label="SMS" />
              <CheckboxRow checked={capMms} onChange={setCapMms} label="MMS" />
              <CheckboxRow checked={capVoice} onChange={setCapVoice} label="Voice" />
            </div>
            <p className="text-[11.5px] text-text-tertiary">
              Mark only the capabilities that are enabled on the Twilio side. Xphere will refuse to send SMS from a non-SMS number.
            </p>
          </div>

          <div className="grid gap-1.5 md:grid-cols-2 md:gap-4">
            <div className="grid gap-1.5">
              <Label htmlFor="number-routing">Default routing mode</Label>
              <Select
                value={routingMode === 'none' ? ROUTING_NONE : routingMode}
                onValueChange={(v) => setRoutingMode(v === ROUTING_NONE ? 'none' : (v as RoutingMode))}
              >
                <SelectTrigger id="number-routing">
                  <SelectValue placeholder="None" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ROUTING_NONE}>None | handled per call</SelectItem>
                  <SelectItem value="browser">Browser dialer</SelectItem>
                  <SelectItem value="sip">SIP (Zoiper, softphone)</SelectItem>
                  <SelectItem value="forward">Forward to number</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {routingMode === 'forward' && (
              <div className="grid gap-1.5">
                <Label htmlFor="number-forward-to">Forward to (E.164)</Label>
                <Input
                  id="number-forward-to"
                  value={forwardTo}
                  onChange={(e) => setForwardTo(e.target.value)}
                  placeholder="+14155557890"
                  className="font-mono text-[12.5px]"
                  autoComplete="off"
                />
              </div>
            )}
          </div>

          <div className="flex items-center justify-between rounded-[8px] border border-border-subtle bg-bg-tertiary/40 px-3 py-2">
            <div>
              <Label htmlFor="number-default" className="text-[13px]">Set as default</Label>
              <p className="text-[11.5px] text-text-tertiary">Default number is used for outbound SMS and outbound calls when no specific number is chosen.</p>
            </div>
            <Switch
              id="number-default"
              checked={isDefault}
              onCheckedChange={setIsDefault}
            />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="number-notes">Notes (optional)</Label>
            <Textarea
              id="number-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Any context about how this number is used internally."
              rows={2}
              maxLength={500}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSave} loading={saving} disabled={saving}>
            {isEdit ? 'Save changes' : 'Add number'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function CheckboxRow({
  checked,
  onChange,
  label,
}: {
  checked: boolean
  onChange: (next: boolean) => void
  label: string
}) {
  const id = `cap-${label.toLowerCase()}`
  return (
    <div className="flex items-center gap-2">
      <Checkbox id={id} checked={checked} onCheckedChange={(v) => onChange(v === true)} />
      <Label htmlFor={id} className="text-[13px] font-medium cursor-pointer">
        {label}
      </Label>
    </div>
  )
}
