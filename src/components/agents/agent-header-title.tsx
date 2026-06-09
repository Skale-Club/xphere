'use client'

// Big, inline-editable agent name shown in the agent detail header (replaces
// the raw id). Click to rename — Enter saves, Esc cancels — persisting via
// `renameAgent`. Also registers the name as the breadcrumb label for the agent
// id segment so the top breadcrumb shows the name instead of the uuid.

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Check, Pencil, X } from 'lucide-react'
import { toast } from 'sonner'

import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { useBreadcrumbOverride } from '@/components/layout/breadcrumb-override-context'
import { renameAgent } from '@/app/(dashboard)/agents/actions'

interface AgentHeaderTitleProps {
  agentId: string
  name: string
  isActive: boolean
  subtitle?: string | null
}

export function AgentHeaderTitle({
  agentId,
  name,
  isActive,
  subtitle,
}: AgentHeaderTitleProps) {
  const router = useRouter()
  const { setSegmentLabel } = useBreadcrumbOverride()
  const [editing, setEditing] = React.useState(false)
  const [draft, setDraft] = React.useState(name)
  const [displayName, setDisplayName] = React.useState(name)
  const [saving, setSaving] = React.useState(false)

  // Keep the breadcrumb's agent-id segment showing the (current) name.
  React.useEffect(() => {
    setSegmentLabel(agentId, displayName)
  }, [agentId, displayName, setSegmentLabel])

  // Sync when the server sends a fresh name (e.g. after router.refresh).
  React.useEffect(() => {
    if (!editing) setDisplayName(name)
  }, [name, editing])

  function beginRename() {
    setDraft(displayName)
    setEditing(true)
  }

  async function commitRename() {
    const next = draft.trim()
    if (!next) {
      toast.error('Name is required.')
      return
    }
    if (next === displayName) {
      setEditing(false)
      return
    }
    setSaving(true)
    try {
      const res = await renameAgent(agentId, next)
      if (res && 'error' in res && res.error) {
        toast.error(res.error)
        return
      }
      setDisplayName(next)
      setEditing(false)
      toast.success('Agent renamed')
      router.refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to rename agent')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="min-w-0">
      <div className="flex items-center gap-2">
        {editing ? (
          <span className="inline-flex min-w-0 items-center gap-1">
            <Input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void commitRename()
                if (e.key === 'Escape') setEditing(false)
              }}
              autoFocus
              disabled={saving}
              maxLength={100}
              className="h-9 w-64 px-2 text-2xl font-bold sm:w-80"
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-7 w-7 shrink-0 text-emerald-500"
              onClick={() => void commitRename()}
              disabled={saving}
              aria-label="Save name"
            >
              <Check className="h-4 w-4" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-7 w-7 shrink-0 text-text-tertiary"
              onClick={() => setEditing(false)}
              disabled={saving}
              aria-label="Cancel rename"
            >
              <X className="h-4 w-4" />
            </Button>
          </span>
        ) : (
          <button
            type="button"
            onClick={beginRename}
            className="group inline-flex min-w-0 items-center gap-2 rounded-[8px] px-1 py-0.5 text-left hover:bg-bg-tertiary/60"
            aria-label="Rename agent"
            title="Click to rename"
          >
            <h1 className="truncate text-2xl font-bold tracking-tight text-text-primary">
              {displayName}
            </h1>
            <Pencil className="h-4 w-4 shrink-0 text-text-tertiary opacity-0 transition-opacity group-hover:opacity-70" />
          </button>
        )}
        <Badge variant={isActive ? 'success' : 'outline'} className="shrink-0">
          {isActive ? 'Active' : 'Inactive'}
        </Badge>
      </div>
      {subtitle && (
        <p className="mt-0.5 px-1 text-sm text-text-secondary">{subtitle}</p>
      )}
    </div>
  )
}
