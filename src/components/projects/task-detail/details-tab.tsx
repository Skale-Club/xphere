'use client'

// DetailsTab | left column of the redesigned task detail.
//
// Composes: description (markdown editor) + definition of done callout +
// subtasks checklist. No SectionCard wrappers | uses dividers + spacing
// for the visual hierarchy.

import * as React from 'react'
import { MarkdownEditor } from '@/components/projects/markdown-editor'
import { DefinitionOfDone } from './definition-of-done'
import { SubtaskChecklist } from './subtask-checklist'
import type { ProjectTaskRow } from '@/types/database'
import type { TaskWithLabels } from '@/app/(dashboard)/projects/actions'

interface Props {
  task: TaskWithLabels
  subtasks: ProjectTaskRow[]
  description: string
  setDescription: (v: string) => void
  onSaveDescription: (md: string) => void
  onSaveDeliverable: (next: string) => void
  onAddSubtask: (name: string) => Promise<void>
  onToggleSubtask: (sub: ProjectTaskRow) => void
}

export function DetailsTab({
  task,
  subtasks,
  description,
  setDescription,
  onSaveDescription,
  onSaveDeliverable,
  onAddSubtask,
  onToggleSubtask,
}: Props) {
  return (
    <div className="space-y-6">
      {/* Description | the focal content; no card wrapper, just the editor */}
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

      <SubtaskChecklist
        subtasks={subtasks}
        onAdd={onAddSubtask}
        onToggle={onToggleSubtask}
      />
    </div>
  )
}
