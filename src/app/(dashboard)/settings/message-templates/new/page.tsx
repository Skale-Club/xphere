'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Loader2, MessagesSquare } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { createMessageTemplate } from '../_actions/message-templates'

export default function NewMessageTemplatePage() {
  const router = useRouter()
  const [name, setName] = useState('')
  const [isPending, startTransition] = useTransition()

  function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    startTransition(async () => {
      const result = await createMessageTemplate({ name, body: '', channel_overrides: {} })
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      router.push(`/settings/message-templates/${result.data.id}`)
    })
  }

  return (
    <div className="mx-auto w-full max-w-md px-4 py-16 space-y-6">
      <div className="text-center space-y-2">
        <div className="flex items-center justify-center w-12 h-12 rounded-full bg-muted mx-auto">
          <MessagesSquare className="h-6 w-6 text-muted-foreground" />
        </div>
        <h1 className="text-xl font-semibold">New Messages Template</h1>
        <p className="text-sm text-muted-foreground">
          Give your template a name to get started.
        </p>
      </div>

      <form onSubmit={handleCreate} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="name">Template name</Label>
          <Input
            id="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Appointment reminder"
            autoFocus
            required
          />
        </div>

        <Button type="submit" className="w-full gap-2" disabled={!name.trim() || isPending}>
          {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <MessagesSquare className="h-4 w-4" />}
          Create and open editor
        </Button>
      </form>
    </div>
  )
}
