'use client'

import { useTransition } from 'react'
import { toast } from 'sonner'
import { useRouter } from 'next/navigation'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { NoteForm } from './note-form'
import { createNote, updateNote } from '@/app/(dashboard)/notes/actions'
import type { NoteRow } from '@/app/(dashboard)/notes/actions'
import type { CrmEntityType } from '@/types/database'

interface NoteSlideOverProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  note?: NoteRow | null
  prefill?: { entity_type?: CrmEntityType; entity_id?: string }
}

export function NoteSlideOver({ open, onOpenChange, note, prefill }: NoteSlideOverProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  async function handleSubmit(values: Parameters<React.ComponentProps<typeof NoteForm>['onSubmit']>[0]) {
    startTransition(async () => {
      const result = note
        ? await updateNote(note.id, values)
        : await createNote(values)

      if (!result.ok) {
        toast.error(result.error)
        return
      }

      toast.success(note ? 'Note updated' : 'Note created')
      onOpenChange(false)
      router.refresh()
    })
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto">
        <SheetHeader className="mb-4">
          <SheetTitle>{note ? 'Edit Note' : 'New Note'}</SheetTitle>
        </SheetHeader>
        <NoteForm
          defaultValues={
            note
              ? {
                  title: note.title ?? '',
                  content: note.content,
                }
              : undefined
          }
          prefill={prefill}
          onSubmit={handleSubmit}
          loading={isPending}
          submitLabel={note ? 'Update Note' : 'Create Note'}
        />
      </SheetContent>
    </Sheet>
  )
}
