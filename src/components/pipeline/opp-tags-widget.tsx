'use client'

import * as React from 'react'
import { Pencil, Check } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { TagBadge } from '@/components/tags/tag-badge'
import { TagPicker } from '@/components/tags/tag-picker'
import {
  setOpportunityTags,
  type TagRow,
} from '@/app/(dashboard)/settings/tags/actions'

interface OppTagsWidgetProps {
  opportunityId: string
  initialTagIds: string[]
  allTags: TagRow[]
}

export function OppTagsWidget({ opportunityId, initialTagIds, allTags: initialAllTags }: OppTagsWidgetProps) {
  const [allTags, setAllTags] = React.useState(initialAllTags)
  const [tagIds, setTagIds] = React.useState(initialTagIds)
  const [editing, setEditing] = React.useState(false)
  const [saving, setSaving] = React.useState(false)

  const selectedTags = allTags.filter((t) => tagIds.includes(t.id))

  async function handleSave() {
    setSaving(true)
    const res = await setOpportunityTags(opportunityId, tagIds)
    setSaving(false)
    if (!res.ok) {
      toast.error(res.error)
      return
    }
    setEditing(false)
    toast.success('Tags updated')
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-[10.5px] uppercase tracking-wide text-text-tertiary">Tags</span>
        {!editing && (
          <Button size="sm" variant="ghost" className="h-5 px-1.5 text-[11px]" onClick={() => setEditing(true)}>
            <Pencil className="h-3 w-3" /> Edit
          </Button>
        )}
        {editing && (
          <Button size="sm" variant="ghost" className="h-5 px-1.5 text-[11px]" onClick={handleSave} disabled={saving}>
            <Check className="h-3 w-3" /> Save
          </Button>
        )}
      </div>

      {editing ? (
        <TagPicker
          allTags={allTags}
          value={tagIds}
          onChange={setTagIds}
          onTagCreated={(tag) => setAllTags((prev) => [...prev, tag].sort((a, b) => a.name.localeCompare(b.name)))}
        />
      ) : selectedTags.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {selectedTags.map((t) => (
            <TagBadge key={t.id} name={t.name} color={t.color} />
          ))}
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="text-[12px] text-text-tertiary hover:text-text-secondary transition-colors"
        >
          No tags | click to add
        </button>
      )}
    </div>
  )
}
