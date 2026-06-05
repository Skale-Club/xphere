'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { ListChecks, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

import { createProspectList, deleteProspectList, type ProspectListRow } from '../actions'
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

export function ListsClient({ lists }: { lists: ProspectListRow[] }) {
  const router = useRouter()
  const [busyId, setBusyId] = React.useState<string | null>(null)

  async function handleDelete(row: ProspectListRow) {
    if (!confirm(`Delete the list "${row.name}"? Prospects stay, only the list is removed.`)) return
    setBusyId(row.id)
    const res = await deleteProspectList(row.id)
    setBusyId(null)
    if (!res.ok) {
      toast.error(res.error)
      return
    }
    toast.success('List deleted')
    router.refresh()
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <NewListDialog onCreated={() => router.refresh()} />
        <div className="flex-1" />
        <Badge variant="secondary">{lists.length}</Badge>
      </div>

      {lists.length === 0 ? (
        <div className="rounded-[12px] border border-border bg-bg-secondary px-4 py-10 text-center text-[13px] text-text-secondary">
          No lists yet. Create one to group prospects for outreach or field visits.
        </div>
      ) : (
        <div className="rounded-[12px] border border-border bg-bg-secondary overflow-hidden divide-y divide-border-subtle">
          {lists.map((list) => (
            <div key={list.id} className="flex items-center gap-3 px-4 py-3">
              <span
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] bg-accent-muted text-accent"
                style={list.color ? { backgroundColor: `${list.color}22`, color: list.color } : undefined}
              >
                <ListChecks className="h-4 w-4" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-medium text-text-primary">{list.name}</div>
                {list.description ? (
                  <div className="truncate text-[11.5px] text-text-tertiary">{list.description}</div>
                ) : null}
              </div>
              <Badge variant="outline" className="shrink-0">
                {list.memberCount} {list.memberCount === 1 ? 'prospect' : 'prospects'}
              </Badge>
              <button
                type="button"
                onClick={() => handleDelete(list)}
                disabled={busyId === list.id}
                className="shrink-0 text-text-tertiary transition-colors hover:text-red-500"
                title="Delete list"
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

function NewListDialog({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = React.useState(false)
  const [name, setName] = React.useState('')
  const [description, setDescription] = React.useState('')
  const [color, setColor] = React.useState('')
  const [pending, startTransition] = React.useTransition()

  function reset() {
    setName('')
    setDescription('')
    setColor('')
  }

  function submit() {
    startTransition(async () => {
      const res = await createProspectList({ name, description, color })
      if (!res.ok) {
        toast.error(res.error)
        return
      }
      toast.success('List created')
      reset()
      setOpen(false)
      onCreated()
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" className="h-8">
          <Plus className="h-3.5 w-3.5" />
          List
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New list</DialogTitle>
          <DialogDescription>Group prospects for outreach, audiences, or field visits.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. São Paulo — cleaning" autoFocus />
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
          <div className="space-y-1.5">
            <Label>Color</Label>
            <Input value={color} onChange={(e) => setColor(e.target.value)} placeholder="Optional hex e.g. #6366f1" />
          </div>
          <Button onClick={submit} disabled={pending || !name.trim()} className="w-full">
            {pending ? 'Creating...' : 'Create list'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
