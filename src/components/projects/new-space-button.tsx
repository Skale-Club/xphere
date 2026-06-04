'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { SquareDashed } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
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
import { createSpace } from '@/app/(dashboard)/projects/_actions/spaces'

interface NewSpaceButtonProps {
  className?: string
}

export function NewSpaceButton({ className }: NewSpaceButtonProps) {
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
      toast.error('Space name is required.')
      return
    }

    startTransition(async () => {
      const res = await createSpace({ name: trimmed })
      if (!res.ok) {
        toast.error(res.error)
        return
      }
      toast.success(`Space "${res.data.name}" created.`)
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
          className={cn('h-8 w-8 px-0 sm:w-auto sm:px-3', className)}
          aria-label="Space"
        >
          <SquareDashed className="h-3.5 w-3.5 sm:mr-1.5" />
          <span className="hidden sm:inline">Space</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-sm">
        <form onSubmit={handleSubmit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>New space</DialogTitle>
            <DialogDescription>
              Group related projects together. You can move projects in from each row&rsquo;s menu.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="space-name">Name</Label>
            <Input
              id="space-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Acme Corp"
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
              {isPending ? 'Creating…' : 'Create space'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
