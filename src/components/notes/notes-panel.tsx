import { getNotes } from '@/app/(dashboard)/notes/actions'
import { NotesGrid } from './notes-grid'
import type { CrmEntityType } from '@/types/database'

interface NotesPanelProps {
  entityType: CrmEntityType
  entityId: string
}

export async function NotesPanel({ entityType, entityId }: NotesPanelProps) {
  const result = await getNotes({ entity_type: entityType, entity_id: entityId })
  const notes = result.ok ? result.data : []

  return (
    <NotesGrid
      notes={notes}
      prefill={{ entity_type: entityType, entity_id: entityId }}
      compact
    />
  )
}
