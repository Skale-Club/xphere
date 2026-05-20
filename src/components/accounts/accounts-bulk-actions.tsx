'use client'

import * as React from 'react'
import { UserPlus, Tag, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  bulkAssignOwner,
  bulkAddTag,
  deleteAccount,
} from '@/app/(dashboard)/companies/actions'

interface AccountsBulkActionsProps {
  selected: Set<string>
  onClearSelection: () => void
  onRefresh: () => void
}

export function AccountsBulkActions({
  selected,
  onClearSelection,
  onRefresh,
}: AccountsBulkActionsProps) {
  // Assign owner dialog state
  const [assignOpen, setAssignOpen] = React.useState(false)
  const [ownerInput, setOwnerInput] = React.useState('')
  const [assignPending, setAssignPending] = React.useState(false)

  // Add tag dialog state
  const [tagOpen, setTagOpen] = React.useState(false)
  const [tagInput, setTagInput] = React.useState('')
  const [tagPending, setTagPending] = React.useState(false)

  // Delete pending state
  const [deletePending, setDeletePending] = React.useState(false)

  async function handleAssign() {
    setAssignPending(true)
    try {
      const result = await bulkAssignOwner([...selected], ownerInput.trim())
      if (result.ok) {
        const label = ownerInput.trim() ? `Assigned owner to ${result.data.updated} company/companies` : `Unassigned owner from ${result.data.updated} company/companies`
        toast.success(label)
        setAssignOpen(false)
        setOwnerInput('')
        onClearSelection()
        onRefresh()
      } else {
        toast.error(result.error ?? 'Assign owner failed')
      }
    } finally {
      setAssignPending(false)
    }
  }

  async function handleAddTag() {
    if (!tagInput.trim()) return
    setTagPending(true)
    try {
      const result = await bulkAddTag([...selected], tagInput.trim())
      if (result.ok) {
        toast.success(`Tag added to ${result.data.updated} company/companies`)
        setTagOpen(false)
        setTagInput('')
        onClearSelection()
        onRefresh()
      } else {
        toast.error(result.error ?? 'Add tag failed')
      }
    } finally {
      setTagPending(false)
    }
  }

  async function handleDelete() {
    const count = selected.size
    const confirmed = window.confirm(
      `Delete ${count} company/companies? This cannot be undone.`,
    )
    if (!confirmed) return

    setDeletePending(true)
    const ids = [...selected]
    let deletedCount = 0
    let blockedCount = 0

    try {
      for (const id of ids) {
        const result = await deleteAccount(id)
        if (result.ok) {
          deletedCount++
        } else if (result.error === 'account_has_references') {
          blockedCount++
        }
        // other errors (network, auth) are counted as neither deleted nor blocked
      }

      if (deletedCount > 0) {
        toast.success(`Deleted ${deletedCount} / ${count} company/companies`)
      }
      if (blockedCount > 0) {
        toast.warning(
          `${blockedCount} could not be deleted (referenced by contacts or opportunities)`,
        )
      }
      if (deletedCount === 0 && blockedCount === 0) {
        toast.error('No companies were deleted')
      }

      onClearSelection()
      onRefresh()
    } finally {
      setDeletePending(false)
    }
  }

  return (
    <>
      <div className="flex items-center justify-between rounded-[10px] border border-accent/30 bg-accent-muted/40 px-3 py-2">
        <span className="text-[12.5px] text-text-primary">{selected.size} selected</span>
        <div className="flex items-center gap-2">
          {/* Assign owner */}
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setAssignOpen(true)}
            disabled={deletePending}
          >
            <UserPlus className="h-3.5 w-3.5 mr-1.5" />
            Assign owner
          </Button>

          {/* Add tag */}
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setTagOpen(true)}
            disabled={deletePending}
          >
            <Tag className="h-3.5 w-3.5 mr-1.5" />
            Add tag
          </Button>

          {/* Delete */}
          <Button
            size="sm"
            variant="ghost"
            className="text-rose-400 hover:text-rose-300"
            onClick={handleDelete}
            disabled={deletePending}
          >
            <Trash2 className="h-3.5 w-3.5 mr-1.5" />
            Delete selected
          </Button>
        </div>
      </div>

      {/* Assign owner dialog */}
      <Dialog open={assignOpen} onOpenChange={setAssignOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Assign owner</DialogTitle>
          </DialogHeader>
          <div className="py-2">
            <Input
              placeholder="User UUID or email…"
              value={ownerInput}
              onChange={(e) => setOwnerInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleAssign()
              }}
            />
            <p className="mt-1.5 text-[11.5px] text-text-tertiary">
              Leave blank to unassign. Applies to {selected.size} selected company/companies.
            </p>
          </div>
          <DialogFooter>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setAssignOpen(false)
                setOwnerInput('')
              }}
              disabled={assignPending}
            >
              Cancel
            </Button>
            <Button size="sm" onClick={handleAssign} disabled={assignPending}>
              {assignPending ? 'Assigning…' : 'Assign'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add tag dialog */}
      <Dialog open={tagOpen} onOpenChange={setTagOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add tag</DialogTitle>
          </DialogHeader>
          <div className="py-2">
            <Input
              placeholder="Tag name…"
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && tagInput.trim()) handleAddTag()
              }}
            />
            <p className="mt-1.5 text-[11.5px] text-text-tertiary">
              Adds the tag to {selected.size} company/companies that don&apos;t already have it.
            </p>
          </div>
          <DialogFooter>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setTagOpen(false)
                setTagInput('')
              }}
              disabled={tagPending}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={handleAddTag}
              disabled={tagPending || tagInput.trim() === ''}
            >
              {tagPending ? 'Adding…' : 'Add tag'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
