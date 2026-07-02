'use client'

// SEED-038: small client-side button + dialog that calls the createFolder
// server action and refreshes the workflows page so the new folder appears.

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { FolderPlus } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { createFolder as createWorkflowFolder } from '@/app/(dashboard)/workflows/_actions/folders'

interface NewFolderButtonProps {
  className?: string
  iconOnly?: boolean
  /**
   * Folder-create action. Defaults to the Workflows create action so existing
   * Workflows call sites need no props. Other entities (e.g. email templates,
   * Phase 117 / UFE-06) pass their own `createFolder` bound to the right
   * entity_type.
   */
  createFolder?: (
    input: { name: string },
  ) => Promise<{ ok: true; data: { name: string } } | { ok: false; error: string }>
}

export function NewFolderButton({
  className,
  iconOnly = false,
  createFolder = createWorkflowFolder,
}: NewFolderButtonProps) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [isPending, startTransition] = useTransition()

  function reset() {
    setName('')
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) {
      toast.error('Folder name is required.')
      return
    }

    startTransition(async () => {
      const res = await createFolder({ name: trimmed })
      if (!res.ok) {
        toast.error(res.error)
        return
      }
      toast.success(`Folder "${res.data.name}" created.`)
      reset()
      setOpen(false)
      router.refresh()
    })
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) reset()
        setOpen(o)
      }}
    >
      <DialogTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={className}
          aria-label={iconOnly ? 'Folder' : undefined}
        >
          <FolderPlus className="h-3.5 w-3.5" />
          {!iconOnly && 'Folder'}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-sm">
        <form onSubmit={handleSubmit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>New folder</DialogTitle>
            <DialogDescription>
              Group related workflows together. You can move workflows in from each row&rsquo;s menu.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="folder-name">Name</Label>
            <Input
              id="folder-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Onboarding"
              autoFocus
              disabled={isPending}
              maxLength={120}
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setOpen(false)}
              disabled={isPending}
            >
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={isPending}>
              {isPending ? 'Creating…' : 'Create folder'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
