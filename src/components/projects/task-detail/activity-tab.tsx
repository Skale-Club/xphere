'use client'

// ActivityTab | execution runs history + (future) comments.
// For v1 it just embeds ExecutionRunsPanel without the legacy SectionCard
// wrapper that conflicted with the new layout.

import * as React from 'react'
import { ExecutionRunsPanel } from '@/components/projects/execution-runs-panel'

interface Props {
  taskId: string
  projectId: string
}

export function ActivityTab({ taskId, projectId }: Props) {
  return (
    <div className="space-y-5">
      <ExecutionRunsPanel taskId={taskId} projectId={projectId} />
      {/* Future: comments timeline goes here */}
    </div>
  )
}
