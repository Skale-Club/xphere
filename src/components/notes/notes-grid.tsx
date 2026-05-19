'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { format, parseISO } from 'date-fns'
import { Pin, PinOff, Plus, Pencil, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { NoteSlideOver } from './note-slide-over'
import { toggleNotePin, deleteNote } from '@/app/(dashboard)/notes/actions'
import type { NoteRow } from '@/app/(dashboard)/notes/actions'
import type { CrmEntityType } from '@/types/database'
import { cn } from '@/lib/utils'

function contentPreview(note: NoteRow): string {
  const text = note.content
  return text.length > 160 ? text.slice(0, 160) + '…' : text
}

interface NotesGridProps {
  notes: NoteRow[]
  prefill?: { entity_type?: CrmEntityType; entity_id?: string }
  compact?: boolean
}

export function NotesGrid({ notes, prefill, compact }: NotesGridProps) {
  const router = useRouter()
  const [isOpen, setIsOpen] = useState(false)
  const [editingNote, setEditingNote] = useState<NoteRow | null>(null)
  const [isPending, startTransition] = useTransition()

  function handleEdit(note: NoteRow) {
    setEditingNote(note)
    setIsOpen(true)
  }

  function handleNew() {
    setEditingNote(null)
    setIsOpen(true)
  }

  function handlePin(id: string) {
    startTransition(async () => {
      const result = await toggleNotePin(id)
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      router.refresh()
    })
  }

  function handleDelete(id: string) {
    startTransition(async () => {
      const result = await deleteNote(id)
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      toast.success('Note deleted')
      router.refresh()
    })
  }

  const pinned = notes.filter((n) => n.pinned)
  const unpinned = notes.filter((n) => !n.pinned)

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button size="sm" onClick={handleNew} className="gap-1.5">
          <Plus className="h-3.5 w-3.5" />
          New Note
        </Button>
      </div>

      {notes.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border py-10 text-center text-sm text-muted-foreground">
          No notes yet. Create one to capture insights and context.
        </div>
      ) : (
        <div className="space-y-4">
          {pinned.length > 0 && (
            <div className="space-y-2">
              {!compact && (
                <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                  <Pin className="h-3 w-3" /> Pinned
                </p>
              )}
              <NoteCardList
                notes={pinned}
                onEdit={handleEdit}
                onPin={handlePin}
                onDelete={handleDelete}
                isPending={isPending}
                compact={compact}
              />
            </div>
          )}
          {unpinned.length > 0 && (
            <div className="space-y-2">
              {!compact && pinned.length > 0 && (
                <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Other
                </p>
              )}
              <NoteCardList
                notes={unpinned}
                onEdit={handleEdit}
                onPin={handlePin}
                onDelete={handleDelete}
                isPending={isPending}
                compact={compact}
              />
            </div>
          )}
        </div>
      )}

      <NoteSlideOver
        open={isOpen}
        onOpenChange={setIsOpen}
        note={editingNote}
        prefill={prefill}
      />
    </div>
  )
}

interface NoteCardListProps {
  notes: NoteRow[]
  onEdit: (note: NoteRow) => void
  onPin: (id: string) => void
  onDelete: (id: string) => void
  isPending: boolean
  compact?: boolean
}

function NoteCardList({ notes, onEdit, onPin, onDelete, isPending, compact }: NoteCardListProps) {
  return (
    <div className={cn('grid gap-3', compact ? 'grid-cols-1' : 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3')}>
      {notes.map((note) => (
        <NoteCard
          key={note.id}
          note={note}
          onEdit={onEdit}
          onPin={onPin}
          onDelete={onDelete}
          isPending={isPending}
        />
      ))}
    </div>
  )
}

interface NoteCardProps {
  note: NoteRow
  onEdit: (note: NoteRow) => void
  onPin: (id: string) => void
  onDelete: (id: string) => void
  isPending: boolean
}

function NoteCard({ note, onEdit, onPin, onDelete, isPending }: NoteCardProps) {
  return (
    <div className="group relative rounded-lg border border-border bg-card p-4 flex flex-col gap-2 hover:border-border/80 transition-colors">
      {note.pinned && (
        <div className="absolute top-2 right-2">
          <Pin className="h-3.5 w-3.5 text-amber-400" />
        </div>
      )}

      {note.title && (
        <p className="text-sm font-medium text-foreground pr-5 line-clamp-1">
          {note.title}
        </p>
      )}

      <p className="text-xs text-muted-foreground line-clamp-4 flex-1">
        {contentPreview(note)}
      </p>

      <div className="flex items-center justify-between">
        <span className="text-[11px] text-muted-foreground tabular-nums">
          {format(parseISO(note.created_at), 'MMM d, yyyy')}
        </span>
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            onClick={() => onPin(note.id)}
            disabled={isPending}
            className="p-1 text-muted-foreground hover:text-amber-400 transition-colors"
            aria-label={note.pinned ? 'Unpin note' : 'Pin note'}
          >
            {note.pinned ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}
          </button>
          <button
            onClick={() => onEdit(note)}
            className="p-1 text-muted-foreground hover:text-foreground transition-colors"
            aria-label="Edit note"
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => onDelete(note.id)}
            disabled={isPending}
            className="p-1 text-muted-foreground hover:text-red-400 transition-colors"
            aria-label="Delete note"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  )
}
