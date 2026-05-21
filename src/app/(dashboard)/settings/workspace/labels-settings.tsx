'use client'

/**
 * SEED-035 | workspace-level CRUD for conversation labels.
 *
 * NOTE: integration into the workspace settings page is a follow-up step.
 * This file intentionally only defines the component so it can be embedded
 * later without touching `page.tsx` / `actions.ts` (which other agents may
 * modify in parallel).
 *
 * Usage (when ready):
 *   import { LabelsSettings } from './labels-settings'
 *   <LabelsSettings />
 */

import { useEffect, useState } from 'react'
import { Plus, Trash2, Check, Pencil, X } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

interface Label {
  id: string
  name: string
  color: string
  position: number
}

const DEFAULT_COLORS = [
  '#6366F1', // indigo
  '#8B5CF6', // violet
  '#EC4899', // pink
  '#EF4444', // red
  '#F59E0B', // amber
  '#10B981', // emerald
  '#06B6D4', // cyan
  '#3B82F6', // blue
  '#64748B', // slate
]

export function LabelsSettings() {
  const [labels, setLabels] = useState<Label[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [newColor, setNewColor] = useState(DEFAULT_COLORS[0])
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editColor, setEditColor] = useState('')

  async function reload() {
    setLoading(true)
    try {
      const res = await fetch('/api/chat/labels')
      if (!res.ok) throw new Error()
      const data = await res.json()
      setLabels(data.labels ?? [])
    } catch {
      toast.error('Failed to load labels')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    reload()
  }, [])

  async function handleCreate() {
    const name = newName.trim()
    if (!name) return
    setCreating(true)
    try {
      const res = await fetch('/api/chat/labels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, color: newColor }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error ?? 'Failed')
      }
      setNewName('')
      setNewColor(DEFAULT_COLORS[0])
      await reload()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not create label')
    } finally {
      setCreating(false)
    }
  }

  function startEdit(label: Label) {
    setEditingId(label.id)
    setEditName(label.name)
    setEditColor(label.color)
  }

  function cancelEdit() {
    setEditingId(null)
    setEditName('')
    setEditColor('')
  }

  async function saveEdit() {
    if (!editingId) return
    const name = editName.trim()
    if (!name) return
    try {
      const res = await fetch(`/api/chat/labels/${editingId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, color: editColor }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error ?? 'Failed')
      }
      cancelEdit()
      await reload()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save label')
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this label? It will be removed from all conversations.')) return
    try {
      const res = await fetch(`/api/chat/labels/${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error()
      await reload()
    } catch {
      toast.error('Could not delete label')
    }
  }

  return (
    <div className="rounded-[10px] border border-border-subtle bg-bg-primary p-5">
      <div className="mb-4">
        <h3 className="text-[14px] font-semibold text-text-primary">Conversation labels</h3>
        <p className="mt-1 text-[12px] text-text-tertiary">
          Tag conversations across all channels. Labels appear in the inbox card and
          the advanced filter panel.
        </p>
      </div>

      {/* Create */}
      <div className="mb-4 flex items-center gap-2">
        <Input
          placeholder="New label name…"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleCreate()
          }}
          className="h-8 flex-1 text-[12.5px]"
        />
        <ColorSwatchPicker value={newColor} onChange={setNewColor} />
        <Button
          size="sm"
          onClick={handleCreate}
          disabled={creating || !newName.trim()}
          className="h-8 px-3 text-[12px]"
        >
          <Plus className="h-3.5 w-3.5 mr-1" /> Add
        </Button>
      </div>

      {/* List */}
      <div className="space-y-1">
        {loading ? (
          <div className="py-4 text-center text-[12px] text-text-tertiary">Loading…</div>
        ) : labels.length === 0 ? (
          <div className="py-6 text-center text-[12px] text-text-tertiary">
            No labels yet. Create your first one above.
          </div>
        ) : (
          labels.map((label) => {
            const isEditing = editingId === label.id
            return (
              <div
                key={label.id}
                className="flex items-center gap-2 rounded-[6px] border border-border-subtle bg-bg-secondary/30 px-2 py-1.5"
              >
                {isEditing ? (
                  <>
                    <Input
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      className="h-7 flex-1 text-[12.5px]"
                      autoFocus
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') saveEdit()
                        if (e.key === 'Escape') cancelEdit()
                      }}
                    />
                    <ColorSwatchPicker value={editColor} onChange={setEditColor} />
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7"
                      onClick={saveEdit}
                      aria-label="Save"
                    >
                      <Check className="h-3.5 w-3.5 text-emerald-500" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7"
                      onClick={cancelEdit}
                      aria-label="Cancel"
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </>
                ) : (
                  <>
                    <span
                      className="h-3 w-3 shrink-0 rounded-full"
                      style={{ backgroundColor: label.color }}
                    />
                    <span className="flex-1 truncate text-[12.5px] text-text-primary">
                      {label.name}
                    </span>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7 text-text-tertiary hover:text-text-primary"
                      onClick={() => startEdit(label)}
                      aria-label="Edit label"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7 text-text-tertiary hover:text-rose-500"
                      onClick={() => handleDelete(label.id)}
                      aria-label="Delete label"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </>
                )}
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}

function ColorSwatchPicker({
  value,
  onChange,
}: {
  value: string
  onChange: (v: string) => void
}) {
  return (
    <div className="flex items-center gap-0.5 rounded-[6px] bg-bg-tertiary/40 p-0.5">
      {DEFAULT_COLORS.map((c) => (
        <button
          key={c}
          type="button"
          onClick={() => onChange(c)}
          aria-label={`Pick color ${c}`}
          className="relative h-5 w-5 rounded-[4px] transition-transform hover:scale-110"
          style={{ backgroundColor: c }}
        >
          {value.toLowerCase() === c.toLowerCase() && (
            <span className="absolute inset-0 flex items-center justify-center">
              <Check className="h-3 w-3 text-white" />
            </span>
          )}
        </button>
      ))}
    </div>
  )
}
