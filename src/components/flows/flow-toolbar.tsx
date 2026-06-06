'use client'

import { useCallback, useEffect, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Save, CheckCircle2, AlertCircle, Loader2, Play, History, Pencil } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { WorkflowToggle } from '@/components/workflows/workflow-toggle'
import { useFlowStore } from '@/stores/flow-store'
import { validateFlow } from '@/lib/flows/schema'
import {
  saveWorkflowDefinition,
  updateWorkflow,
} from '@/app/(dashboard)/workflows/flows/_actions/workflows'
import { runFlowNow } from '@/app/(dashboard)/workflows/flows/_actions/runs'
import { RunsDialog } from '@/components/flows/runs-dialog'
import { cn } from '@/lib/utils'
import { useBreadcrumbOverride } from '@/components/layout/breadcrumb-override-context'

interface FlowToolbarProps {
  workflowId: string
  workflowName: string
  isActive: boolean
}

export function FlowToolbar({ workflowId, workflowName, isActive }: FlowToolbarProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [isRunning, startRun] = useTransition()
  const [name, setName] = useState(workflowName)
  const [editing, setEditing] = useState(false)
  const [runsOpen, setRunsOpen] = useState(false)
  const [runsInitialId, setRunsInitialId] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const { setSegmentLabel, setSegmentNode } = useBreadcrumbOverride()

  const dirty = useFlowStore((s) => s.dirty)
  const lastSavedAt = useFlowStore((s) => s.lastSavedAt)
  const toDefinition = useFlowStore((s) => s.toDefinition)
  const markSaved = useFlowStore((s) => s.markSaved)

  useEffect(() => {
    setName(workflowName)
  }, [workflowName])

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [editing])

  const commitName = useCallback(async () => {
    setEditing(false)
    const trimmed = name.trim()
    if (!trimmed || trimmed === workflowName) {
      setName(workflowName)
      return
    }
    const result = await updateWorkflow(workflowId, { name: trimmed })
    if (!result.ok) {
      toast.error(`Rename failed: ${result.error}`)
      setName(workflowName)
      return
    }
    toast.success('Flow renamed')
    router.refresh()
  }, [name, router, workflowId, workflowName])

  useEffect(() => {
    setSegmentLabel(workflowId, name || workflowName || 'Untitled flow')
    setSegmentNode(
      workflowId,
      editing ? (
        <input
          autoFocus
          ref={inputRef}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onFocus={(e) => e.currentTarget.select()}
          onBlur={commitName}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitName()
            if (e.key === 'Escape') {
              setName(workflowName)
              setEditing(false)
            }
          }}
          className={cn(
            'h-7 w-[min(48vw,320px)] rounded-[6px] border border-border bg-bg-secondary px-2',
            'text-sm font-medium text-text-primary outline-none focus:border-accent',
          )}
        />
      ) : (
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="group/flow-breadcrumb inline-flex min-w-0 max-w-[min(48vw,360px)] items-center gap-1 rounded-[6px] px-1 py-0.5 text-left text-sm font-medium text-inherit hover:bg-bg-tertiary/70"
          title="Rename flow"
        >
          <span className="truncate">{name || 'Untitled flow'}</span>
          <Pencil className="h-3 w-3 shrink-0 opacity-0 transition-opacity group-hover/flow-breadcrumb:opacity-70" />
        </button>
      ),
    )
  }, [
    commitName,
    editing,
    name,
    setSegmentLabel,
    setSegmentNode,
    workflowId,
    workflowName,
  ])

  function handleSaveVersion() {
    startTransition(async () => {
      const def = toDefinition()
      const issues = validateFlow(def)
      const errors = issues.filter((i) => i.level === 'error')
      if (errors.length > 0) {
        toast.error(`${errors.length} validation error${errors.length > 1 ? 's' : ''}: ${errors[0].message}`)
        return
      }
      const result = await saveWorkflowDefinition(workflowId, def, { createNewVersion: true })
      if (!result.ok) {
        toast.error(`Save failed: ${result.error}`)
        return
      }
      markSaved()
      toast.success(`Saved version ${result.data.versionNumber}`)
      router.refresh()
    })
  }

  function handleRunNow() {
    startRun(async () => {
      if (dirty) {
        const save = await saveWorkflowDefinition(workflowId, toDefinition())
        if (save.ok) markSaved()
      }
      const result = await runFlowNow({ workflowId, triggerPayload: {} })
      if (!result.ok) {
        toast.error(`Run failed: ${result.error}`)
        return
      }
      if (result.data.status === 'succeeded') {
        toast.success('Run succeeded')
      } else {
        toast.error('Run failed | check run history')
      }
      // Open the Runs modal straight to this run's detail (no page navigation).
      setRunsInitialId(result.data.runId)
      setRunsOpen(true)
    })
  }

  // ── Status indicator ────────────────────────────────────────────────────────
  let statusEl: React.ReactNode = null
  if (isPending) {
    statusEl = (
      <span className="flex items-center gap-1 text-[11px] text-text-tertiary">
        <Loader2 className="h-3 w-3 animate-spin" /> Saving…
      </span>
    )
  } else if (dirty) {
    statusEl = (
      <span className="flex items-center gap-1 text-[11px] text-amber-400">
        <AlertCircle className="h-3 w-3" /> Unsaved
      </span>
    )
  } else if (lastSavedAt) {
    statusEl = (
      <span className="flex items-center gap-1 text-[11px] text-emerald-400">
        <CheckCircle2 className="h-3 w-3" /> Saved
      </span>
    )
  }

  return (
    <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-background shrink-0">
      {/* Left | back + name (flex-grow) */}
      <div className="flex items-center gap-2 min-w-0 flex-1">
        {statusEl && <div className="hidden lg:flex">{statusEl}</div>}
        {statusEl && <div className="hidden h-4 w-px bg-border lg:block" />}
        <WorkflowToggle
          workflowId={workflowId}
          initialActive={isActive}
          showLabel
        />
      </div>

      {/* Right | actions (shrink-0, gracefully collapse labels on small widths) */}
      <div className="flex items-center gap-1.5 shrink-0">
        <Button
          size="sm"
          variant="ghost"
          className="gap-1.5 px-2"
          onClick={() => setRunsOpen(true)}
        >
          <History className="h-3.5 w-3.5" />
          <span className="hidden md:inline">Runs</span>
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={handleRunNow}
          disabled={isRunning}
          className="gap-1.5 px-2"
        >
          {isRunning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
          <span className="hidden md:inline">Run now</span>
        </Button>
        <Button size="sm" onClick={handleSaveVersion} disabled={isPending} className="gap-1.5 px-2.5">
          {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
          <span className="hidden sm:inline">Save</span>
        </Button>
      </div>

      <RunsDialog
        open={runsOpen}
        onOpenChange={(o) => {
          setRunsOpen(o)
          if (!o) setRunsInitialId(null)
        }}
        workflowId={workflowId}
        workflowName={name}
        initialRunId={runsInitialId}
      />
    </div>
  )
}
