'use client'

/**
 * ContactDndSection — DND management UI for a contact.
 *
 * Can be embedded in:
 *   - Contact detail sheet / page
 *   - Chat contact-info right panel
 *
 * Features:
 *   - "Block all communications" toggle
 *   - Per-channel toggles: SMS, Email, Calls, WhatsApp
 *   - Optional note/reason field
 *   - Optimistic updates with error recovery
 */

import * as React from 'react'
import { PhoneOff, Mail, MessageSquare, Phone, Ban, AlertTriangle, Loader2 } from 'lucide-react'
import { toast } from 'sonner'

import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import {
  setContactDnd,
  toggleDndChannel,
  type DndChannelKey,
} from '@/app/(dashboard)/contacts/dnd-actions'

interface DndState {
  dnd_enabled: boolean
  dnd_channels: string[]
  dnd_note: string | null
}

interface ContactDndSectionProps {
  contactId: string
  /** Initial DND state from the parent (server-fetched). */
  initialDnd?: DndState
  /** Called after a successful DND change so the parent can update its state. */
  onDndChange?: (next: DndState) => void
  /** Compact mode for the chat info panel (no header, tighter spacing). */
  compact?: boolean
}

const CHANNELS: Array<{ key: DndChannelKey; label: string; icon: React.ReactNode }> = [
  { key: 'sms', label: 'SMS', icon: <MessageSquare className="h-3.5 w-3.5" /> },
  { key: 'email', label: 'Email', icon: <Mail className="h-3.5 w-3.5" /> },
  { key: 'calls', label: 'Calls', icon: <Phone className="h-3.5 w-3.5" /> },
  { key: 'whatsapp', label: 'WhatsApp', icon: <MessageSquare className="h-3.5 w-3.5" /> },
]

export function ContactDndSection({
  contactId,
  initialDnd,
  onDndChange,
  compact = false,
}: ContactDndSectionProps) {
  const [state, setState] = React.useState<DndState>({
    dnd_enabled: initialDnd?.dnd_enabled ?? false,
    dnd_channels: initialDnd?.dnd_channels ?? [],
    dnd_note: initialDnd?.dnd_note ?? null,
  })
  const [noteInput, setNoteInput] = React.useState(initialDnd?.dnd_note ?? '')
  const [loading, setLoading] = React.useState(false)

  const isAllBlocked = state.dnd_channels.includes('all')

  // Sync with parent changes (e.g. after refetch)
  React.useEffect(() => {
    if (!initialDnd) return
    setState({
      dnd_enabled: initialDnd.dnd_enabled,
      dnd_channels: initialDnd.dnd_channels,
      dnd_note: initialDnd.dnd_note,
    })
    setNoteInput(initialDnd.dnd_note ?? '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialDnd?.dnd_enabled, initialDnd?.dnd_channels?.join(','), initialDnd?.dnd_note])

  function optimisticUpdate(next: DndState) {
    setState(next)
    onDndChange?.(next)
  }

  async function handleToggleAll(checked: boolean) {
    const prev = state
    const next: DndState = checked
      ? { dnd_enabled: true, dnd_channels: ['all'], dnd_note: state.dnd_note }
      : { dnd_enabled: false, dnd_channels: [], dnd_note: null }
    optimisticUpdate(next)
    setLoading(true)
    try {
      const res = await setContactDnd({
        contactId,
        enabled: checked,
        channels: checked ? ['all'] : [],
        note: noteInput || undefined,
      })
      if (!res.ok) {
        optimisticUpdate(prev)
        toast.error(`DND update failed: ${res.error}`)
      } else {
        toast.success(checked ? 'DND enabled — all channels blocked' : 'DND removed')
      }
    } catch {
      optimisticUpdate(prev)
      toast.error('DND update failed')
    } finally {
      setLoading(false)
    }
  }

  async function handleToggleChannel(channel: DndChannelKey, checked: boolean) {
    const prev = state
    // Compute next optimistically
    let nextChannels = [...state.dnd_channels]
    if (checked) {
      nextChannels = nextChannels.filter((c) => c !== 'all')
      if (!nextChannels.includes(channel)) nextChannels.push(channel)
    } else {
      nextChannels = nextChannels.filter((c) => c !== channel)
    }
    const next: DndState = {
      dnd_enabled: nextChannels.length > 0,
      dnd_channels: nextChannels,
      dnd_note: state.dnd_note,
    }
    optimisticUpdate(next)
    setLoading(true)
    try {
      const res = await toggleDndChannel(contactId, channel, checked)
      if (!res.ok) {
        optimisticUpdate(prev)
        toast.error(`DND update failed: ${res.error}`)
      }
    } catch {
      optimisticUpdate(prev)
      toast.error('DND update failed')
    } finally {
      setLoading(false)
    }
  }

  async function handleSaveNote() {
    const note = noteInput.trim() || null
    setLoading(true)
    try {
      const res = await setContactDnd({
        contactId,
        enabled: state.dnd_enabled,
        channels: state.dnd_channels as DndChannelKey[],
        note: note ?? undefined,
      })
      if (res.ok) {
        const next: DndState = { ...state, dnd_note: note }
        setState(next)
        onDndChange?.(next)
        toast.success('DND note saved')
      } else {
        toast.error(res.error ?? 'Failed to save note')
      }
    } catch {
      toast.error('Failed to save note')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className={cn('space-y-3', compact ? '' : 'rounded-lg border border-border-subtle p-4')}>
      {!compact && (
        <div className="flex items-center gap-2">
          <PhoneOff className="h-4 w-4 text-text-tertiary" />
          <span className="text-[13px] font-semibold text-text-primary">Do Not Disturb</span>
          {state.dnd_enabled && (
            <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-rose-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-rose-400">
              <span className="h-1.5 w-1.5 rounded-full bg-rose-400" />
              DND Active
            </span>
          )}
        </div>
      )}

      {/* Block all toggle */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Ban className={cn('h-3.5 w-3.5', isAllBlocked ? 'text-rose-400' : 'text-text-tertiary')} />
          <Label htmlFor="dnd-all" className="cursor-pointer text-[12.5px] font-medium text-text-primary">
            Block all communications
          </Label>
        </div>
        <Switch
          id="dnd-all"
          checked={isAllBlocked}
          onCheckedChange={handleToggleAll}
          disabled={loading}
          className="data-[state=checked]:bg-rose-500"
        />
      </div>

      {/* Per-channel toggles — shown only when not blocking all */}
      {!isAllBlocked && (
        <div className="space-y-2 pl-1">
          {CHANNELS.map(({ key, label, icon }) => {
            const blocked = state.dnd_channels.includes(key)
            return (
              <div key={key} className="flex items-center justify-between gap-3">
                <div className={cn('flex items-center gap-2', blocked ? 'text-rose-400' : 'text-text-secondary')}>
                  {icon}
                  <Label htmlFor={`dnd-${key}`} className="cursor-pointer text-[12px]">
                    {label}
                  </Label>
                </div>
                <Switch
                  id={`dnd-${key}`}
                  checked={blocked}
                  onCheckedChange={(c) => handleToggleChannel(key, c)}
                  disabled={loading}
                  className="data-[state=checked]:bg-rose-500"
                />
              </div>
            )
          })}
        </div>
      )}

      {/* Note field */}
      {state.dnd_enabled && (
        <div className="space-y-1.5 pt-1">
          <Label className="text-[11px] text-text-tertiary">Reason / Note (optional)</Label>
          <Textarea
            value={noteInput}
            onChange={(e) => setNoteInput(e.target.value)}
            placeholder="e.g. Requested no contact until Jan 2027"
            className="min-h-[60px] resize-none text-[12px]"
            rows={2}
          />
          <Button
            size="sm"
            variant="outline"
            onClick={handleSaveNote}
            disabled={loading || noteInput.trim() === (state.dnd_note ?? '')}
            className="h-7 text-[11.5px]"
          >
            {loading ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : null}
            Save note
          </Button>
        </div>
      )}

      {/* Warning when DND is active */}
      {state.dnd_enabled && (
        <div className="flex items-start gap-2 rounded-md bg-rose-500/10 px-3 py-2 text-[11.5px] text-rose-400">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            {isAllBlocked
              ? 'All outbound messages and calls are blocked for this contact.'
              : `Outbound ${state.dnd_channels.join(', ')} blocked for this contact.`}
          </span>
        </div>
      )}
    </div>
  )
}
