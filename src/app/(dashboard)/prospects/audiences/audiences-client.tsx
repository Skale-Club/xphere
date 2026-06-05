'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Plus, Target, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

import { createProspectAudience, deleteProspectAudience, type ProspectAudienceRow } from '../actions'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

export function AudiencesClient({ audiences }: { audiences: ProspectAudienceRow[] }) {
  const router = useRouter()
  const [busyId, setBusyId] = React.useState<string | null>(null)

  async function handleDelete(row: ProspectAudienceRow) {
    if (!confirm(`Delete the audience "${row.name}"?`)) return
    setBusyId(row.id)
    const res = await deleteProspectAudience(row.id)
    setBusyId(null)
    if (!res.ok) {
      toast.error(res.error)
      return
    }
    toast.success('Audience deleted')
    router.refresh()
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <NewAudienceDialog onCreated={() => router.refresh()} />
        <div className="flex-1" />
        <Badge variant="secondary">{audiences.length}</Badge>
      </div>

      {audiences.length === 0 ? (
        <div className="rounded-[12px] border border-border bg-bg-secondary px-4 py-10 text-center text-[13px] text-text-secondary">
          No audiences yet. Save a segment to sync it to outreach platforms in a later step.
        </div>
      ) : (
        <div className="rounded-[12px] border border-border bg-bg-secondary overflow-hidden divide-y divide-border-subtle">
          {audiences.map((audience) => (
            <div key={audience.id} className="flex items-center gap-3 px-4 py-3">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] bg-accent-muted text-accent">
                <Target className="h-4 w-4" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-medium text-text-primary">{audience.name}</div>
                {audience.description ? (
                  <div className="truncate text-[11.5px] text-text-tertiary">{audience.description}</div>
                ) : null}
              </div>
              {audience.syncedPlatforms.length > 0 ? (
                <div className="hidden shrink-0 gap-1 sm:flex">
                  {audience.syncedPlatforms.map((p) => (
                    <Badge key={p} variant="outline" className="capitalize">{p}</Badge>
                  ))}
                </div>
              ) : (
                <Badge variant="outline" className="shrink-0 text-text-tertiary">Not synced</Badge>
              )}
              <button
                type="button"
                onClick={() => handleDelete(audience)}
                disabled={busyId === audience.id}
                className="shrink-0 text-text-tertiary transition-colors hover:text-red-500"
                title="Delete audience"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function NewAudienceDialog({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = React.useState(false)
  const [name, setName] = React.useState('')
  const [description, setDescription] = React.useState('')
  const [pending, startTransition] = React.useTransition()

  function submit() {
    startTransition(async () => {
      const res = await createProspectAudience({ name, description })
      if (!res.ok) {
        toast.error(res.error)
        return
      }
      toast.success('Audience created')
      setName('')
      setDescription('')
      setOpen(false)
      onCreated()
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" className="h-8">
          <Plus className="h-3.5 w-3.5" />
          Audience
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New audience</DialogTitle>
          <DialogDescription>
            Save a named segment. Syncing to outreach platforms (Xmail, Meta) comes in a later step.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. High-intent cleaning leads" autoFocus />
          </div>
          <div className="space-y-1.5">
            <Label>Description</Label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional"
              className="min-h-[72px]"
            />
          </div>
          <Button onClick={submit} disabled={pending || !name.trim()} className="w-full">
            {pending ? 'Creating...' : 'Create audience'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
