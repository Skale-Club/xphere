'use client'

import { useState, useTransition } from 'react'
import { formatDistanceToNow } from 'date-fns'
import { toast } from 'sonner'
import { CheckCircle, Clock, RotateCcw } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { activatePromptVersion } from '@/app/(dashboard)/agents/actions'
import type { PromptVersionListItem } from '@/app/(dashboard)/agents/actions'

interface PromptHistoryPanelProps {
  agentId: string
  versions: PromptVersionListItem[]
}

export function PromptHistoryPanel({ agentId, versions }: PromptHistoryPanelProps) {
  const [selectedIdx, setSelectedIdx] = useState(0)
  const [isPending, startTransition] = useTransition()

  const selected = versions[selectedIdx]
  const previousVersion = versions[selectedIdx + 1] ?? null

  function handleActivate(versionId: string) {
    startTransition(async () => {
      const result = await activatePromptVersion(agentId, versionId)
      if (result && 'error' in result) {
        toast.error(result.error)
      } else {
        toast.success('Version activated — runtime now uses this prompt')
      }
    })
  }

  if (versions.length === 0) {
    return (
      <div className="text-sm text-muted-foreground p-4">
        No prompt versions recorded yet. Save the agent to create the first version.
      </div>
    )
  }

  return (
    <div className="flex gap-4 h-[600px]">
      {/* Version List */}
      <div className="w-64 shrink-0 border rounded-md">
        <ScrollArea className="h-full">
          <div className="p-2 space-y-1">
            {versions.map((v, idx) => (
              <button
                key={v.id}
                onClick={() => setSelectedIdx(idx)}
                className={`w-full text-left px-3 py-2 rounded-md text-sm transition-colors ${
                  idx === selectedIdx
                    ? 'bg-accent text-accent-foreground'
                    : 'hover:bg-muted'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-mono font-medium">v{v.version}</span>
                  {v.is_active && (
                    <Badge variant="default" className="text-xs px-1 py-0">Live</Badge>
                  )}
                </div>
                <div className="text-xs text-muted-foreground mt-0.5 truncate">
                  {v.created_by_email ?? 'Unknown'}
                </div>
                <div className="text-xs text-muted-foreground flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  {formatDistanceToNow(new Date(v.created_at), { addSuffix: true })}
                </div>
              </button>
            ))}
          </div>
        </ScrollArea>
      </div>

      {/* Version Detail + Diff */}
      <div className="flex-1 border rounded-md overflow-hidden flex flex-col">
        {selected && (
          <>
            <div className="px-4 py-3 border-b flex items-center justify-between">
              <div>
                <span className="font-mono font-semibold">Version {selected.version}</span>
                {selected.is_active && (
                  <Badge variant="default" className="ml-2 text-xs">Currently Live</Badge>
                )}
                <p className="text-xs text-muted-foreground mt-0.5">
                  by {selected.created_by_email ?? 'Unknown'} ·{' '}
                  {new Date(selected.created_at).toLocaleString()}
                </p>
              </div>
              {!selected.is_active && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={isPending}
                  onClick={() => handleActivate(selected.id)}
                  className="gap-1"
                >
                  <RotateCcw className="h-3 w-3" />
                  Activate
                </Button>
              )}
              {selected.is_active && (
                <div className="flex items-center gap-1 text-sm text-green-600">
                  <CheckCircle className="h-4 w-4" />
                  <span>Active</span>
                </div>
              )}
            </div>

            <ScrollArea className="flex-1 p-4">
              {previousVersion ? (
                <PromptDiff
                  label={`diff v${previousVersion.version} → v${selected.version}`}
                  before={previousVersion.system_prompt}
                  after={selected.system_prompt}
                />
              ) : (
                <div>
                  <p className="text-xs text-muted-foreground mb-2">Initial version (no previous to diff against)</p>
                  <pre className="text-xs font-mono whitespace-pre-wrap bg-muted rounded p-3">
                    {selected.system_prompt}
                  </pre>
                </div>
              )}
            </ScrollArea>
          </>
        )}
      </div>
    </div>
  )
}

// ─── Inline unified diff renderer ────────────────────────────────────────────

function PromptDiff({ label, before, after }: { label: string; before: string; after: string }) {
  // Line-level diff: show removed lines in red, added lines in green, unchanged in default
  const beforeLines = before.split('\n')
  const afterLines = after.split('\n')

  // Simple LCS-based line diff using longest common subsequence
  const diff = computeLineDiff(beforeLines, afterLines)

  return (
    <div>
      <p className="text-xs text-muted-foreground mb-2 font-mono">{label}</p>
      <div className="border rounded text-xs font-mono">
        {diff.map((chunk, idx) => (
          <div
            key={idx}
            className={
              chunk.type === 'removed'
                ? 'bg-red-50 text-red-800 px-3 py-0.5 border-l-2 border-red-400'
                : chunk.type === 'added'
                ? 'bg-green-50 text-green-800 px-3 py-0.5 border-l-2 border-green-400'
                : 'px-3 py-0.5 text-muted-foreground'
            }
          >
            {chunk.type === 'removed' ? '− ' : chunk.type === 'added' ? '+ ' : '  '}
            {chunk.line}
          </div>
        ))}
      </div>
    </div>
  )
}

type DiffChunk = { type: 'added' | 'removed' | 'unchanged'; line: string }

function computeLineDiff(before: string[], after: string[]): DiffChunk[] {
  // Myers diff algorithm (simplified O(ND) for line-level diffs)
  // For prompt versioning use case, prompts are <200 lines — O(N²) LCS is fine
  const m = before.length
  const n = after.length
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0))

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (before[i - 1] === after[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1])
      }
    }
  }

  const result: DiffChunk[] = []
  let i = m, j = n
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && before[i - 1] === after[j - 1]) {
      result.unshift({ type: 'unchanged', line: before[i - 1] })
      i--; j--
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      result.unshift({ type: 'added', line: after[j - 1] })
      j--
    } else {
      result.unshift({ type: 'removed', line: before[i - 1] })
      i--
    }
  }
  return result
}
