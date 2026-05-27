'use client'

import * as React from 'react'
import { Check, ChevronsUpDown, Plus, Loader2 } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { Input } from '@/components/ui/input'
import { TagBadge } from './tag-badge'
import { createTag, type TagRow } from '@/app/(dashboard)/settings/tags/actions'
import { cn } from '@/lib/utils'

const SWATCH_COLORS = [
  '#64748B', '#EF4444', '#F97316', '#F59E0B',
  '#EAB308', '#84CC16', '#22C55E', '#14B8A6',
  '#06B6D4', '#3B82F6', '#6366F1', '#8B5CF6',
  '#A855F7', '#EC4899', '#F43F5E', '#71717A',
]

interface TagPickerProps {
  allTags: TagRow[]
  value: string[]
  onChange: (tagIds: string[]) => void
  placeholder?: string
  className?: string
  onTagCreated?: (tag: TagRow) => void
}

export function TagPicker({
  allTags,
  value,
  onChange,
  placeholder = 'Add tags…',
  className,
  onTagCreated,
}: TagPickerProps) {
  const [open, setOpen] = React.useState(false)
  const [search, setSearch] = React.useState('')
  const [creating, setCreating] = React.useState(false)
  const [newColor, setNewColor] = React.useState(SWATCH_COLORS[9])

  const selectedTags = allTags.filter((t) => value.includes(t.id))
  const query = search.trim().toLowerCase()

  const filtered = allTags.filter(
    (t) =>
      !value.includes(t.id) &&
      (query === '' || t.name.toLowerCase().includes(query)),
  )

  const exactMatch = allTags.some(
    (t) => t.name.toLowerCase() === query,
  )
  const canCreate = query.length > 0 && !exactMatch

  function toggle(tagId: string) {
    if (value.includes(tagId)) {
      onChange(value.filter((id) => id !== tagId))
    } else {
      onChange([...value, tagId])
    }
  }

  async function handleCreate() {
    if (!canCreate) return
    setCreating(true)
    const res = await createTag({ name: search.trim(), color: newColor })
    setCreating(false)
    if (!res.ok) {
      toast.error(res.error)
      return
    }
    onTagCreated?.(res.tag)
    onChange([...value, res.tag.id])
    setSearch('')
    toast.success(`Tag "${res.tag.name}" created`)
  }

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      {selectedTags.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {selectedTags.map((t) => (
            <TagBadge
              key={t.id}
              name={t.name}
              color={t.color}
              onRemove={() => toggle(t.id)}
            />
          ))}
        </div>
      )}

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className={cn(
              'flex h-9 w-full items-center justify-between rounded-[8px] border border-border bg-bg-secondary px-3',
              'text-[13.5px] text-text-tertiary',
              'transition-[border-color,box-shadow] duration-150 ease-out',
              'hover:border-border focus-visible:outline-none focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/30',
            )}
          >
            <span>{placeholder}</span>
            <ChevronsUpDown className="h-3.5 w-3.5 opacity-50" />
          </button>
        </PopoverTrigger>

        <PopoverContent className="w-64 p-0" align="start">
          <div className="p-2 border-b border-border">
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search or create tag…"
              className="h-7 text-[12px]"
              autoFocus
            />
          </div>

          <div className="max-h-48 overflow-y-auto py-1">
            {filtered.length === 0 && !canCreate && (
              <p className="px-3 py-2 text-[12px] text-text-tertiary">
                {query ? 'No tags match.' : 'No more tags.'}
              </p>
            )}
            {filtered.map((t) => (
              <button
                key={t.id}
                type="button"
                className="w-full flex items-center gap-2 px-3 py-1.5 text-[12px] hover:bg-bg-secondary transition-colors"
                onClick={() => { toggle(t.id); setSearch('') }}
              >
                <span
                  className="h-2 w-2 rounded-full flex-shrink-0"
                  style={{ backgroundColor: t.color }}
                />
                <span className="flex-1 text-left text-text-primary">{t.name}</span>
                {value.includes(t.id) && <Check className="h-3 w-3 text-accent" />}
              </button>
            ))}

            {canCreate && (
              <>
                {filtered.length > 0 && (
                  <div className="mx-3 my-1 border-t border-border" />
                )}
                <div className="px-3 py-2 space-y-2">
                  <p className="text-[11px] text-text-tertiary">Create new tag</p>
                  <div className="flex flex-wrap gap-1">
                    {SWATCH_COLORS.map((c) => (
                      <button
                        key={c}
                        type="button"
                        className={cn(
                          'h-4 w-4 rounded-full ring-offset-1 transition-all',
                          newColor === c ? 'ring-2 ring-offset-bg-primary' : 'hover:scale-110',
                        )}
                        style={{ backgroundColor: c }}
                        onClick={() => setNewColor(c)}
                      />
                    ))}
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    className="w-full h-7 text-[11px]"
                    onClick={handleCreate}
                    disabled={creating}
                  >
                    {creating ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <Plus className="h-3 w-3" />
                    )}
                    Create&nbsp;
                    <span
                      className="inline-flex items-center gap-1 rounded-full px-1.5 py-0 text-[10px] font-semibold"
                      style={{ backgroundColor: `${newColor}33`, color: newColor }}
                    >
                      <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: newColor }} />
                      {search.trim()}
                    </span>
                  </Button>
                </div>
              </>
            )}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  )
}
