# Phase 92: Pipeline Reorder - Context

**Gathered:** 2026-05-19
**Status:** Ready for planning
**Mode:** Pre-implemented (merged from claude branch before v2.7 milestone creation)

<domain>
Adds same-column kanban card reordering, persisted via a `reorderOpportunities` server action that batch-updates the `position` column in the `opportunities` table. The `onDragEnd` handler in KanbanBoard detects same-stage drops and calls the server action with optimistic rollback on error.
</domain>

<decisions>
## Implementation Decisions

### Claude's Discretion
All implementation choices already made — phase was built prior to milestone formalization.

- `reorderOpportunities(stageId, orderedIds[])` iterates through orderedIds and sets `position = index` for each row in the given stage
- Returns `{ error: string }` on any Supabase error; returns void on success
- `onDragEnd` in kanban-board.tsx: detects `sameStage` by comparing `fromStageId === targetStageId`
- Optimistic update via `setItems(prev => ...)` before the server action resolves; rollback to original `opportunities` on error
- `revalidatePath('/pipeline')` called after successful reorder
</decisions>

<specifics>
Key files implementing this phase:
- `src/app/(dashboard)/pipeline/actions.ts` — `reorderOpportunities(stageId, orderedIds[])` server action at line 476
- `src/components/pipeline/kanban-board.tsx` — `onDragEnd` handler with same-column detection, optimistic reorder, and rollback
</specifics>

<deferred>
None
</deferred>
