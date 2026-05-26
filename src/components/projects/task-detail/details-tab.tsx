'use client'

// DetailsTab | left column of the redesigned task detail.
//
// Composes: description (markdown editor) + definition of done callout.
// Subtasks moved out to the persistent right panel (SubtasksPanel) | each
// subtask can be drilled into to expose its own description + nested
// subtasks recursively via the focus stack in TaskBody.

import * as React from 'react'
import { MarkdownEditor } from '@/components/projects/markdown-editor'
import { DefinitionOfDone } from './definition-of-done'
import type { TaskWithLabels } from '@/app/(dashboard)/projects/actions'

interface Props {
  task: TaskWithLabels
  description: string
  setDescription: (v: string) => void
  onSaveDescription: (md: string) => void
  onSaveDeliverable: (next: string) => void
}

export function DetailsTab({
  task,
  description,
  setDescription,
  onSaveDescription,
  onSaveDeliverable,
}: Props) {
  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <h3 className="text-[11px] font-medium uppercase tracking-wider text-text-tertiary">
          Description
        </h3>
        <MarkdownEditor
          value={description}
          onChange={setDescription}
          onBlur={(md) => {
            if (md !== (task.description ?? '')) onSaveDescription(md)
          }}
          placeholder="Add a description…"
          minRows={5}
        />
      </section>

      <DefinitionOfDone
        taskId={task.id}
        value={task.expected_deliverable ?? ''}
        onSave={onSaveDeliverable}
      />
    </div>
  )
}
