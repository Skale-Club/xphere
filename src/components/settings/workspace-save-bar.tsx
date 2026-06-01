'use client'

import * as React from 'react'
import { Check, Loader2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/**
 * Cross-form "unsaved changes" coordinator for the Workspace settings page.
 *
 * Each form on the page registers a *section* (its dirty flag + a save + a
 * reset callback) via {@link useWorkspaceSaveSection}. The provider aggregates
 * every section's dirty state and renders a single floating action bar — fixed
 * just above the Copilot launcher (bottom-right) — that only appears when there
 * is at least one pending change anywhere on the page. Saving runs every dirty
 * section's save callback; discarding runs every reset callback.
 */

interface SectionHandlers {
  save: () => Promise<boolean>
  reset: () => void
}

interface SaveBarContextValue {
  report: (id: string, dirty: boolean, handlers: SectionHandlers) => void
  remove: (id: string) => void
}

const SaveBarContext = React.createContext<SaveBarContextValue | null>(null)

export interface WorkspaceSaveSection {
  /** Stable, unique id for this section. */
  id: string
  /** Whether this section has pending unsaved changes. */
  dirty: boolean
  /** Persist the section. Resolve `true` on success, `false` on failure. */
  save: () => Promise<boolean>
  /** Revert the section's inputs back to their last-saved values. */
  reset: () => void
}

/**
 * Register a form section with the page-level save bar. The save/reset
 * closures are read from refs at call time, so they always see fresh state
 * without retriggering effects.
 */
export function useWorkspaceSaveSection({
  id,
  dirty,
  save,
  reset,
}: WorkspaceSaveSection): void {
  const ctx = React.useContext(SaveBarContext)

  // Keep the latest handlers in a ref so identity churn doesn't re-run effects.
  const handlersRef = React.useRef<SectionHandlers>({ save, reset })
  handlersRef.current = { save, reset }

  React.useEffect(() => {
    ctx?.report(id, dirty, {
      save: () => handlersRef.current.save(),
      reset: () => handlersRef.current.reset(),
    })
  }, [ctx, id, dirty])

  React.useEffect(() => {
    return () => ctx?.remove(id)
  }, [ctx, id])
}

export function WorkspaceSaveProvider({
  children,
}: {
  children: React.ReactNode
}) {
  const handlersRef = React.useRef<Map<string, SectionHandlers>>(new Map())
  const [dirtyMap, setDirtyMap] = React.useState<Record<string, boolean>>({})
  const [saving, setSaving] = React.useState(false)

  const report = React.useCallback(
    (id: string, dirty: boolean, handlers: SectionHandlers) => {
      handlersRef.current.set(id, handlers)
      setDirtyMap((prev) => (prev[id] === dirty ? prev : { ...prev, [id]: dirty }))
    },
    [],
  )

  const remove = React.useCallback((id: string) => {
    handlersRef.current.delete(id)
    setDirtyMap((prev) => {
      if (!(id in prev)) return prev
      const next = { ...prev }
      delete next[id]
      return next
    })
  }, [])

  const dirtyIds = React.useMemo(
    () => Object.entries(dirtyMap).filter(([, d]) => d).map(([id]) => id),
    [dirtyMap],
  )
  const anyDirty = dirtyIds.length > 0

  const handleSave = React.useCallback(async () => {
    setSaving(true)
    try {
      for (const id of dirtyIds) {
        const fn = handlersRef.current.get(id)
        if (fn) await fn.save()
      }
    } finally {
      setSaving(false)
    }
  }, [dirtyIds])

  const handleDiscard = React.useCallback(() => {
    for (const id of dirtyIds) {
      handlersRef.current.get(id)?.reset()
    }
  }, [dirtyIds])

  const ctx = React.useMemo<SaveBarContextValue>(
    () => ({ report, remove }),
    [report, remove],
  )

  return (
    <SaveBarContext.Provider value={ctx}>
      {children}
      <WorkspaceSaveBar
        visible={anyDirty}
        saving={saving}
        onSave={handleSave}
        onDiscard={handleDiscard}
      />
    </SaveBarContext.Provider>
  )
}

function WorkspaceSaveBar({
  visible,
  saving,
  onSave,
  onDiscard,
}: {
  visible: boolean
  saving: boolean
  onSave: () => void
  onDiscard: () => void
}) {
  // Keep mounted for one frame after hide so the exit transition can play.
  const [mounted, setMounted] = React.useState(visible)
  React.useEffect(() => {
    if (visible) {
      setMounted(true)
      return
    }
    const t = window.setTimeout(() => setMounted(false), 200)
    return () => window.clearTimeout(t)
  }, [visible])

  if (!mounted) return null

  return (
    <div
      className={cn(
        // Fixed just above the Copilot launcher (bottom-right).
        'fixed bottom-[92px] right-5 z-40 transition-all duration-200 ease-out',
        visible
          ? 'translate-y-0 opacity-100'
          : 'pointer-events-none translate-y-2 opacity-0',
      )}
      role="region"
      aria-label="Unsaved changes"
    >
      <div className="flex items-center gap-2 rounded-xl border border-border bg-bg-secondary/95 px-3 py-2 shadow-xl shadow-black/20 backdrop-blur">
        <span className="mr-1 text-[12.5px] font-medium text-text-secondary">
          Unsaved changes
        </span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onDiscard}
          disabled={saving}
        >
          Discard
        </Button>
        <Button type="button" size="sm" onClick={onSave} disabled={saving}>
          {saving ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Check className="h-3.5 w-3.5" />
          )}
          Save changes
        </Button>
      </div>
    </div>
  )
}
