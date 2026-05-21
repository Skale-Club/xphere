'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Loader2, Workflow } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { createWorkflow } from '@/app/(dashboard)/workflows/flows/_actions/workflows'

function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 80)
}

interface NewFlowFormProps {
  /** Called after the flow is created, before navigation (e.g. to close a dialog). */
  onCreated?: () => void
}

export function NewFlowForm({ onCreated }: NewFlowFormProps = {}) {
  const router = useRouter()
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [description, setDescription] = useState('')
  const [slugTouched, setSlugTouched] = useState(false)
  const [isPending, startTransition] = useTransition()

  function handleNameChange(value: string) {
    setName(value)
    if (!slugTouched) setSlug(slugify(value))
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim() || !slug.trim()) return

    startTransition(async () => {
      const result = await createWorkflow({
        name: name.trim(),
        slug: slug.trim(),
        description: description.trim() || undefined,
      })
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      toast.success('Flow created')
      onCreated?.()
      router.push(`/workflows/flows/${result.data.id}`)
    })
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="name">Name</Label>
        <Input
          id="name"
          value={name}
          onChange={(e) => handleNameChange(e.target.value)}
          placeholder="Lead qualification flow"
          required
          maxLength={120}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="slug">Slug</Label>
        <Input
          id="slug"
          value={slug}
          onChange={(e) => { setSlug(slugify(e.target.value)); setSlugTouched(true) }}
          placeholder="lead-qualification"
          required
          maxLength={80}
          pattern="^[a-z0-9-]+$"
          className="font-mono"
        />
        <p className="text-[11px] text-muted-foreground">
          Lowercase letters, numbers and dashes. Used in URLs and AI references.
        </p>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="description">Description (optional)</Label>
        <Textarea
          id="description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          maxLength={2000}
          placeholder="What this flow does, when it runs, what it produces…"
          className="resize-none"
        />
      </div>

      <Button type="submit" disabled={isPending || !name.trim() || !slug.trim()} className="w-full gap-2">
        {isPending ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" /> Creating…
          </>
        ) : (
          <>
            <Workflow className="h-4 w-4" /> Create flow
          </>
        )}
      </Button>
    </form>
  )
}
