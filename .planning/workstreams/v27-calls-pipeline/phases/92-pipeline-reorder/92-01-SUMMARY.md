---
plan: 92-01
status: complete
completed_at: "2026-05-19"
requirements_satisfied: [PIPE-07, PIPE-08]
---

# Summary: 92-01 — Pipeline Reorder

## What was done

Pre-implemented same-column kanban reorder with optimistic UI and server persistence. The `reorderOpportunities(stageId, orderedIds[])` server action iterates through `orderedIds` and issues individual Supabase `.update({ position: i })` calls scoped to both the opportunity ID and stageId. It returns `{ error: message }` on any failure and calls `revalidatePath('/pipeline')` on success.

In `kanban-board.tsx`, the `onDragEnd` handler detects a same-stage drop (`fromStageId === targetStageId`) and builds an `orderedIds` array using `Array.splice` to insert the dragged card at the new position. It applies an optimistic `setItems` update before awaiting the server action, and rolls back to the original `opportunities` prop on error via `toast.error` + `setItems(opportunities)`.

## Key files

- `src/app/(dashboard)/pipeline/actions.ts` — `reorderOpportunities(stageId, orderedIds[])` server action (line 476)
- `src/components/pipeline/kanban-board.tsx` — onDragEnd with same-column detection, optimistic reorder, rollback

## Deviations from Plan

None - implementation pre-existed and was confirmed correct.
