'use client'

import * as React from 'react'
import { Plus, Pencil, Trash2, Loader2 } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { TagBadge } from './tag-badge'
import {
  createTag,
  updateTag,
  deleteTag,
  type TagRow,
} from '@/app/(dashboard)/settings/tags/actions'
import { cn } from '@/lib/utils'

const SWATCH_COLORS = [
  '#64748B', '#EF4444', '#F97316', '#F59E0B',
  '#EAB308', '#84CC16', '#22C55E', '#14B8A6',
  '#06B6D4', '#3B82F6', '#6366F1', '#8B5CF6',
  '#A855F7', '#EC4899', '#F43F5E', '#71717A',
]

const HEX_RE = /^#[0-9A-Fa-f]{6}$/

interface TagsManagerProps {
  initialTags: TagRow[]
}

export function TagsManager({ initialTags }: TagsManagerProps) {
  const [tags, setTags] = React.useState(initialTags)
  const [search, setSearch] = React.useState('')

  // Create/Edit modal
  const [formOpen, setFormOpen] = React.useState(false)
  const [editing, setEditing] = React.useState<TagRow | null>(null)
  const [formName, setFormName] = React.useState('')
  const [formColor, setFormColor] = React.useState(SWATCH_COLORS[9])
  const [formSaving, setFormSaving] = React.useState(false)

  // Delete confirm
  const [deleteTarget, setDeleteTarget] = React.useState<TagRow | null>(null)
  const [deleting, setDeleting] = React.useState(false)

  const filtered = tags.filter((t) =>
    search === '' || t.name.toLowerCase().includes(search.toLowerCase()),
  )

  function openCreate() {
    setEditing(null)
    setFormName('')
    setFormColor(SWATCH_COLORS[9])
    setFormOpen(true)
  }

  function openEdit(tag: TagRow) {
    setEditing(tag)
    setFormName(tag.name)
    setFormColor(tag.color)
    setFormOpen(true)
  }

  async function handleSave() {
    if (!formName.trim()) { toast.error('Name is required'); return }
    if (!HEX_RE.test(formColor)) { toast.error('Invalid color'); return }
    setFormSaving(true)
    const input = { name: formName.trim(), color: formColor }
    const res = editing
      ? await updateTag(editing.id, input)
      : await createTag(input)
    setFormSaving(false)
    if (!res.ok) { toast.error(res.error); return }
    if (editing) {
      setTags((prev) => prev.map((t) => t.id === editing.id ? { ...t, ...res.tag } : t))
      toast.success('Tag updated')
    } else {
      setTags((prev) => [...prev, res.tag].sort((a, b) => a.name.localeCompare(b.name)))
      toast.success('Tag created')
    }
    setFormOpen(false)
  }

  async function handleDelete() {
    if (!deleteTarget) return
    setDeleting(true)
    const res = await deleteTag(deleteTarget.id)
    setDeleting(false)
    if (!res.ok) { toast.error(res.error); return }
    setTags((prev) => prev.filter((t) => t.id !== deleteTarget.id))
    setDeleteTarget(null)
    toast.success('Tag deleted')
  }

  const hexValid = HEX_RE.test(formColor)

  return (
    <>
      <div className="space-y-4">
        {/* Toolbar */}
        <div className="flex items-center gap-3">
          <Input
            placeholder="Search tags…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="max-w-xs h-8 text-[13px]"
          />
          <Button size="sm" onClick={openCreate}>
            <Plus className="h-3.5 w-3.5" />
            New tag
          </Button>
        </div>

        {/* Table */}
        <div className="rounded-[10px] border border-border bg-bg-secondary overflow-hidden">
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
              <p className="text-[13px] text-text-secondary">
                {search ? 'No tags match your search.' : 'No tags yet.'}
              </p>
              {!search && (
                <Button size="sm" variant="secondary" onClick={openCreate}>
                  <Plus className="h-3.5 w-3.5" />
                  Create your first tag
                </Button>
              )}
            </div>
          ) : (
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-border text-[11px] uppercase tracking-[0.06em] text-text-tertiary">
                  <th className="px-4 py-2.5 text-left font-medium w-12">Color</th>
                  <th className="px-4 py-2.5 text-left font-medium">Name</th>
                  <th className="px-4 py-2.5 text-left font-medium">Used in</th>
                  <th className="px-4 py-2.5 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filtered.map((tag) => {
                  const usedIn = [
                    tag.contact_count > 0 ? `${tag.contact_count} contact${tag.contact_count !== 1 ? 's' : ''}` : null,
                    tag.opportunity_count > 0 ? `${tag.opportunity_count} deal${tag.opportunity_count !== 1 ? 's' : ''}` : null,
                  ].filter(Boolean).join(', ')

                  return (
                    <tr key={tag.id} className="hover:bg-bg-primary/50 transition-colors">
                      <td className="px-4 py-3">
                        <span
                          className="inline-block h-3.5 w-3.5 rounded-full"
                          style={{ backgroundColor: tag.color }}
                        />
                      </td>
                      <td className="px-4 py-3">
                        <TagBadge name={tag.name} color={tag.color} size="md" />
                      </td>
                      <td className="px-4 py-3 text-text-tertiary">
                        {usedIn || <span className="text-text-tertiary/50">|</span>}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 px-2"
                            onClick={() => openEdit(tag)}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 px-2 text-rose-400 hover:text-rose-300"
                            onClick={() => setDeleteTarget(tag)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>

        <p className="text-[11px] text-text-tertiary">
          {tags.length} tag{tags.length !== 1 ? 's' : ''} total
        </p>
      </div>

      {/* Create / Edit modal */}
      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit tag' : 'Create tag'}</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="tag-name" className="text-[12px]">Name</Label>
              <Input
                id="tag-name"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                placeholder="VIP, Hot Lead, Parceiro…"
                maxLength={80}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleSave() } }}
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-[12px]">Color</Label>
              <div className="flex flex-wrap gap-2">
                {SWATCH_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    className={cn(
                      'h-6 w-6 rounded-full transition-all ring-offset-1',
                      formColor === c ? 'ring-2' : 'hover:scale-110',
                    )}
                    style={{
                      backgroundColor: c,
                      outline: formColor === c ? `2px solid ${c}` : undefined,
                      outlineOffset: formColor === c ? '2px' : undefined,
                    }}
                    onClick={() => setFormColor(c)}
                  />
                ))}
              </div>
              <div className="flex items-center gap-2 mt-2">
                <span className="text-[12px] text-text-tertiary">Custom:</span>
                <div className="relative flex items-center">
                  <span
                    className="absolute left-2 h-3 w-3 rounded-full"
                    style={{ backgroundColor: hexValid ? formColor : '#6B7280' }}
                  />
                  <Input
                    value={formColor}
                    onChange={(e) => setFormColor(e.target.value)}
                    className="pl-7 h-7 w-28 font-mono text-[12px]"
                    maxLength={7}
                    placeholder="#10B981"
                  />
                </div>
              </div>
            </div>

            {/* Preview */}
            <div className="space-y-1.5">
              <Label className="text-[12px]">Preview</Label>
              <TagBadge
                name={formName || 'Tag name'}
                color={hexValid ? formColor : '#6B7280'}
                size="md"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setFormOpen(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={formSaving || !formName.trim()}>
              {formSaving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {editing ? 'Save changes' : 'Create tag'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <AlertDialog open={Boolean(deleteTarget)} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete tag?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget && (
                <>
                  <TagBadge name={deleteTarget.name} color={deleteTarget.color} className="mb-2" />
                  {' '}will be removed from{' '}
                  {[
                    deleteTarget.contact_count > 0
                      ? `${deleteTarget.contact_count} contact${deleteTarget.contact_count !== 1 ? 's' : ''}`
                      : null,
                    deleteTarget.opportunity_count > 0
                      ? `${deleteTarget.opportunity_count} deal${deleteTarget.opportunity_count !== 1 ? 's' : ''}`
                      : null,
                  ].filter(Boolean).join(' and ') || 'no records'}
                  . This cannot be undone.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-rose-500 hover:bg-rose-600"
              onClick={handleDelete}
              disabled={deleting}
            >
              {deleting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
