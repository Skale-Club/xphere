import type { TaskWithLabels } from '@/app/(dashboard)/projects/actions'
import type { ProjectFilterState } from '@/components/projects/project-filter-bar'

export { type ProjectFilterState }

/**
 * Apply a ProjectFilterState to a list of tasks.
 * All active filter dimensions are ANDed together.
 */
export function applyProjectFilters(
  tasks: TaskWithLabels[],
  filters: ProjectFilterState,
): TaskWithLabels[] {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const todayStr = today.toISOString().slice(0, 10)

  return tasks.filter((task) => {
    // --- step ---
    if (filters.step && filters.step.length > 0) {
      if (!filters.step.includes(task.step as 'backlog' | 'todo' | 'doing' | 'done')) return false
    }

    // --- priority ---
    if (filters.priority && filters.priority.length > 0) {
      if (!filters.priority.includes(task.priority as 'low' | 'medium' | 'high' | 'urgent')) return false
    }

    // --- assignee ---
    if (filters.assignee_id && filters.assignee_id.length > 0) {
      const assigneeId = task.assignee?.user_id ?? null
      const responsibleId = task.responsible?.user_id ?? null
      const match =
        (assigneeId !== null && filters.assignee_id.includes(assigneeId)) ||
        (responsibleId !== null && filters.assignee_id.includes(responsibleId))
      if (!match) return false
    }

    // --- labels ---
    if (filters.label_ids && filters.label_ids.length > 0) {
      const taskLabelIds = task.labels.map((l) => l.id)
      const hasMatch = filters.label_ids.some((lid) => taskLabelIds.includes(lid))
      if (!hasMatch) return false
    }

    // --- due_after ---
    if (filters.due_after) {
      if (!task.end_date || task.end_date < filters.due_after) return false
    }

    // --- due_before ---
    if (filters.due_before) {
      if (!task.end_date || task.end_date > filters.due_before) return false
    }

    // --- overdue ---
    if (filters.overdue) {
      if (!task.end_date || task.end_date >= todayStr || task.completed) return false
    }

    // --- search ---
    if (filters.search && filters.search.trim()) {
      const q = filters.search.trim().toLowerCase()
      if (!task.name.toLowerCase().includes(q)) return false
    }

    return true
  })
}

/** Returns true when no filter dimension is active. */
export function filtersAreEmpty(filters: ProjectFilterState): boolean {
  return (
    (!filters.step || filters.step.length === 0) &&
    (!filters.priority || filters.priority.length === 0) &&
    (!filters.assignee_id || filters.assignee_id.length === 0) &&
    (!filters.label_ids || filters.label_ids.length === 0) &&
    !filters.due_before &&
    !filters.due_after &&
    !filters.overdue &&
    (!filters.search || filters.search.trim() === '')
  )
}

/** Returns true when two filter states are deeply equal. */
export function filtersEqual(a: ProjectFilterState, b: ProjectFilterState): boolean {
  return JSON.stringify(sortedKeys(a as Record<string, unknown>)) === JSON.stringify(sortedKeys(b as Record<string, unknown>))
}

function sortedKeys(obj: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(obj)
      .filter(([, v]) => v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && v.length === 0))
      .sort(([a], [b]) => a.localeCompare(b)),
  )
}
