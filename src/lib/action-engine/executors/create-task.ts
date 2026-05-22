import { createServiceRoleClient } from '@/lib/supabase/admin'

export async function executeCreateTask(
  params: Record<string, unknown>,
  orgId: string,
): Promise<string> {
  const title = String(params.title ?? params.name ?? '')
  if (!title) throw new Error('create_task: title is required')

  const supabase = createServiceRoleClient()
  const { data, error } = await supabase
    .from('tasks')
    .insert({
      org_id: orgId,
      title,
      description: params.description ? String(params.description) : null,
      due_date: params.due_date ? String(params.due_date) : null,
      priority: (['low', 'medium', 'high', 'urgent'].includes(String(params.priority))
        ? params.priority
        : 'medium') as 'low' | 'medium' | 'high' | 'urgent',
      status: 'todo',
      entity_type: (['contact', 'account', 'opportunity'].includes(String(params.entity_type))
        ? params.entity_type
        : null) as 'contact' | 'account' | 'opportunity' | null,
      entity_id: params.entity_id ? String(params.entity_id) : null,
    })
    .select('id')
    .single()

  if (error) throw new Error(`create_task failed: ${error.message}`)
  return `Task created: ${data.id}`
}

export async function executeCreateNote(
  params: Record<string, unknown>,
  orgId: string,
): Promise<string> {
  const content = String(params.content ?? params.text ?? '')
  if (!content) throw new Error('create_note: content is required')

  const supabase = createServiceRoleClient()
  const { data, error } = await supabase
    .from('notes')
    .insert({
      org_id: orgId,
      content,
      title: params.title ? String(params.title) : null,
      pinned: Boolean(params.pinned),
      entity_type: (['contact', 'account', 'opportunity'].includes(String(params.entity_type))
        ? params.entity_type
        : null) as 'contact' | 'account' | 'opportunity' | null,
      entity_id: params.entity_id ? String(params.entity_id) : null,
    })
    .select('id')
    .single()

  if (error) throw new Error(`create_note failed: ${error.message}`)
  return `Note created: ${data.id}`
}
