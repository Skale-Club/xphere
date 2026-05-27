'use client'

import * as React from 'react'
import { AlertTriangle, ArrowRight, Loader2 } from 'lucide-react'
import { toast } from 'sonner'

import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  mergeContactAction,
  getPendingMergeConflict,
  type MergeConflictPair,
} from '@/app/(dashboard)/contacts/actions'

interface MergeConflictPanelProps {
  contactId: string
  /** Called after a successful merge so the parent can refresh/navigate. */
  onMerged?: (survivorId: string) => void
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

function ContactCard({
  contact,
  label,
  isWinner,
  onSelect,
}: {
  contact: MergeConflictPair['conflict'] | MergeConflictPair['peer']
  label: string
  isWinner: boolean
  onSelect: () => void
}) {
  return (
    <div
      className={`flex-1 rounded-lg border p-4 transition-all cursor-pointer ${
        isWinner
          ? 'border-accent bg-accent-muted/30 ring-1 ring-accent/50'
          : 'border-border bg-bg-secondary hover:border-accent/40'
      }`}
      onClick={onSelect}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onSelect()
        }
      }}
    >
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[11px] font-medium uppercase tracking-wide text-text-tertiary">
          {label}
        </span>
        {isWinner && (
          <Badge
            variant="secondary"
            className="text-[10px] px-1.5 py-0.5 text-accent bg-accent-muted"
          >
            Keep
          </Badge>
        )}
      </div>
      <p className="text-[14px] font-medium text-text-primary truncate">
        {contact.name ?? <span className="italic text-text-tertiary">Unnamed</span>}
      </p>
      {contact.phone && (
        <p className="mt-1 text-[12.5px] text-text-secondary">{contact.phone}</p>
      )}
      {contact.email && (
        <p className="mt-0.5 text-[12.5px] text-text-secondary truncate">{contact.email}</p>
      )}
      <p className="mt-2 text-[11px] text-text-tertiary capitalize">
        Added {formatDate(contact.created_at)}
      </p>
    </div>
  )
}

/**
 * Phase 6 — Banner + sheet for contacts with identity_status = 'merge_conflict'.
 *
 * Renders a sticky "Duplicate detected" alert. Clicking opens a Sheet showing
 * the two conflicting contacts side by side with a "Merge" button.
 *
 * The user selects which contact to keep (survivor). The other is archived
 * via the `merge_contacts` SECURITY DEFINER SQL function.
 */
export function MergeConflictPanel({ contactId, onMerged }: MergeConflictPanelProps) {
  const [open, setOpen] = React.useState(false)
  const [pair, setPair] = React.useState<MergeConflictPair | null>(null)
  const [loadingPair, setLoadingPair] = React.useState(false)
  const [winnerId, setWinnerId] = React.useState<string | null>(null)
  const [merging, setMerging] = React.useState(false)

  function openSheet() {
    setOpen(true)
    if (pair) return
    setLoadingPair(true)
    getPendingMergeConflict(contactId)
      .then((p) => {
        setPair(p)
        if (p) {
          // Default winner = conflict contact (the one currently viewing)
          setWinnerId(p.conflict.id)
        }
      })
      .catch(() => {
        toast.error('Could not load conflict details.')
      })
      .finally(() => setLoadingPair(false))
  }

  async function handleMerge() {
    if (!pair || !winnerId) return
    const loserId = winnerId === pair.conflict.id ? pair.peer.id : pair.conflict.id
    setMerging(true)
    const res = await mergeContactAction(winnerId, loserId)
    setMerging(false)
    if (!res.ok) {
      toast.error(res.error ?? 'Merge failed.')
      return
    }
    toast.success('Contacts merged.')
    setOpen(false)
    onMerged?.(winnerId)
  }

  return (
    <>
      {/* Banner */}
      <button
        type="button"
        className="w-full flex items-center gap-2 rounded-md border border-amber-500/30 bg-amber-500/8 px-3 py-2 text-left text-sm hover:bg-amber-500/12 transition-colors"
        onClick={openSheet}
      >
        <AlertTriangle className="h-4 w-4 shrink-0 text-amber-500" />
        <span className="flex-1 text-[13px] text-text-secondary">
          Duplicate detected — Review merge
        </span>
        <ArrowRight className="h-3.5 w-3.5 shrink-0 text-amber-500" />
      </button>

      {/* Sheet */}
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          side="right"
          className="w-full sm:max-w-[520px] flex flex-col overflow-hidden"
        >
          <SheetHeader className="shrink-0">
            <SheetTitle>Resolve duplicate contact</SheetTitle>
            <SheetDescription>
              Choose which contact to keep. The other will be archived and its conversations,
              notes, and tags moved to the survivor.
            </SheetDescription>
          </SheetHeader>

          <div className="flex-1 overflow-y-auto py-4">
            {loadingPair ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-5 w-5 animate-spin text-text-tertiary" />
              </div>
            ) : !pair ? (
              <div className="py-8 text-center text-[13px] text-text-secondary">
                No conflict details found. The conflict may have already been resolved.
              </div>
            ) : (
              <div className="space-y-4">
                <p className="text-[12.5px] text-text-secondary">
                  Click a contact to select it as the survivor.
                </p>
                <div className="flex gap-3">
                  <ContactCard
                    contact={pair.conflict}
                    label="Current"
                    isWinner={winnerId === pair.conflict.id}
                    onSelect={() => setWinnerId(pair.conflict.id)}
                  />
                  <ContactCard
                    contact={pair.peer}
                    label="Duplicate"
                    isWinner={winnerId === pair.peer.id}
                    onSelect={() => setWinnerId(pair.peer.id)}
                  />
                </div>

                <div className="rounded-md border border-border bg-bg-secondary px-3 py-2 text-[12px] text-text-secondary">
                  The archived contact will have{' '}
                  <span className="font-medium text-text-primary">
                    status = archived_duplicate
                  </span>
                  . All linked data (conversations, notes, tags, opportunities) will be moved to
                  the survivor.
                </div>
              </div>
            )}
          </div>

          <div className="shrink-0 border-t border-border-subtle pt-4 flex items-center justify-end gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={merging}>
              Cancel
            </Button>
            <Button onClick={handleMerge} disabled={!pair || !winnerId || merging}>
              {merging ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Merging…
                </>
              ) : (
                'Merge'
              )}
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    </>
  )
}
