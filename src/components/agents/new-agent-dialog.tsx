'use client'

// Popup for creating a new agent. Collects just a name (+ optional description),
// births the agent with defaults via createAgentQuick, then navigates to its
// page so the user configures prompt/tools/channels there. Creation is always
// done through this popup — there is no full-page create form.

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { useTransition } from 'react'
import { toast } from 'sonner'

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { createAgentQuick } from '@/app/(dashboard)/agents/actions'

interface NewAgentDialogProps {
  /** Trigger element. Defaults to a plain "New agent" button if omitted. */
  children?: React.ReactNode
}

export function NewAgentDialog({ children }: NewAgentDialogProps) {
  const router = useRouter()
  const [open, setOpen] = React.useState(false)
  const [name, setName] = React.useState('')
  const [description, setDescription] = React.useState('')
  const [isPending, startTransition] = useTransition()

  function create() {
    const trimmed = name.trim()
    if (!trimmed) {
      toast.error('Name is required.')
      return
    }
    startTransition(async () => {
      const res = await createAgentQuick({ name: trimmed, description })
      if (res.error) {
        toast.error(res.error)
        return
      }
      toast.success('Agent created')
      setOpen(false)
      setName('')
      setDescription('')
      if (res.id) router.push(`/agents/${res.id}`)
      router.refresh()
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {children ?? <Button size="sm">New agent</Button>}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New agent</DialogTitle>
          <DialogDescription>
            Give your agent a name to get started. You&apos;ll set its prompt,
            tools, and channels next.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="new-agent-name">Name</Label>
            <Input
              id="new-agent-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  create()
                }
              }}
              placeholder="e.g. Sky"
              autoFocus
              disabled={isPending}
              maxLength={100}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="new-agent-desc">
              Description <span className="text-text-tertiary">(optional)</span>
            </Label>
            <Textarea
              id="new-agent-desc"
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={isPending}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={isPending}>
            Cancel
          </Button>
          <Button onClick={create} disabled={isPending || !name.trim()}>
            {isPending ? 'Creating…' : 'Create agent'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
