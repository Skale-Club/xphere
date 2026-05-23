'use server'

import { createClient, getUser } from '@/lib/supabase/server'
import type { ConversationPriority } from '@/types/chat'

export async function toggleBotStatus(
  conversationId: string,
  currentStatus: string
): Promise<{ botStatus: string } | { error: string }> {
  const user = await getUser()
  if (!user) return { error: 'Unauthorized' }

  const newStatus = currentStatus === 'active' ? 'paused' : 'active'
  const supabase = await createClient()
  const { error } = await supabase
    .from('conversations')
    .update({ bot_status: newStatus, updated_at: new Date().toISOString() })
    .eq('id', conversationId)

  if (error) return { error: 'Failed to update bot status' }

  // System message in the conversation feed so admins can see who toggled what.
  // Best-effort | failures are silent (don't block the toggle). Wrapped in
  // try/catch so test mocks that don't stub rpc/insert remain happy.
  try {
    const { data: orgId } = await supabase.rpc('get_current_org_id')
    if (orgId) {
      await supabase.from('conversation_messages').insert({
        conversation_id: conversationId,
        org_id: orgId as string,
        role: 'system',
        content: newStatus === 'paused' ? 'Bot paused by admin' : 'Bot resumed by admin',
        metadata: { type: 'bot_toggle', by: user.id, new_status: newStatus },
      })
    }
  } catch {
    // ignore | system message is best-effort UX
  }

  return { botStatus: newStatus }
}

/**
 * v2.2 | Pin/unpin a conversation. Pinned conversations always render first
 * in the inbox list (see /api/chat/conversations ordering).
 */
export async function pinConversation(
  conversationId: string,
  pinned: boolean,
): Promise<{ pinned: boolean } | { error: string }> {
  const user = await getUser()
  if (!user) return { error: 'Unauthorized' }

  const supabase = await createClient()
  const { error } = await supabase
    .from('conversations')
    .update({ pinned, updated_at: new Date().toISOString() })
    .eq('id', conversationId)

  if (error) return { error: 'Failed to pin conversation' }
  return { pinned }
}

/**
 * SEED-035 | Star/unstar a conversation. Starred is a lightweight favorite
 * marker and is independent of pinned.
 */
export async function starConversation(
  conversationId: string,
  starred: boolean,
): Promise<{ starred: boolean } | { error: string }> {
  const user = await getUser()
  if (!user) return { error: 'Unauthorized' }

  const supabase = await createClient()
  const { error } = await supabase
    .from('conversations')
    .update({ starred, updated_at: new Date().toISOString() })
    .eq('id', conversationId)

  if (error) return { error: 'Failed to star conversation' }
  return { starred }
}

/**
 * v2.2 | Set conversation priority. Triggers a colored left border on the
 * conversation card. 'normal' is the default and shows no decoration.
 */
export async function setConversationPriority(
  conversationId: string,
  priority: ConversationPriority,
): Promise<{ priority: ConversationPriority } | { error: string }> {
  const user = await getUser()
  if (!user) return { error: 'Unauthorized' }
  if (!['normal', 'high', 'urgent'].includes(priority)) {
    return { error: 'Invalid priority' }
  }

  const supabase = await createClient()
  const { error } = await supabase
    .from('conversations')
    .update({ priority, updated_at: new Date().toISOString() })
    .eq('id', conversationId)

  if (error) return { error: 'Failed to update priority' }
  return { priority }
}

/**
 * v2.2 | Assign or unassign a conversation to a user in the same org.
 * Pass `null` to clear the assignment.
 */
export async function assignConversation(
  conversationId: string,
  userId: string | null,
): Promise<{ assignedUserId: string | null } | { error: string }> {
  const user = await getUser()
  if (!user) return { error: 'Unauthorized' }

  const supabase = await createClient()
  const { error } = await supabase
    .from('conversations')
    .update({ assigned_user_id: userId, updated_at: new Date().toISOString() })
    .eq('id', conversationId)

  if (error) return { error: 'Failed to assign conversation' }
  return { assignedUserId: userId }
}

export interface OrgMember {
  userId: string
  email: string
  displayName: string | null
}

/**
 * Returns the list of users in the active org. Used by the "Assign to..."
 * dropdown in the chat header. RLS scopes to the active org automatically.
 */
export async function listOrgMembers(): Promise<OrgMember[]> {
  const user = await getUser()
  if (!user) return []

  const supabase = await createClient()
  const { data: orgId } = await supabase.rpc('get_current_org_id')
  if (!orgId) return []

  // RLS on org_members only returns rows the caller can see (i.e., their org).
  // The `users` join is RLS-restricted too | we keep this best-effort. If the
  // join fails (e.g., no display_name on the join target), we still return the
  // user_id list with `?` placeholders so the dropdown is usable.
  const { data: members } = await supabase
    .from('org_members')
    .select('user_id')
    .eq('organization_id', orgId as string)

  if (!members || members.length === 0) return []

  const userIds = members.map((m) => m.user_id)
  // auth.users isn't readable via the user client | best we can do is return
  // user_id placeholders. Callers can resolve names from a separate fetch if
  // needed. For now we return user_id as both fields so the UI is functional.
  return userIds.map((id) => ({
    userId: id,
    email: id === user.id ? (user.email ?? id) : id,
    displayName: id === user.id ? (user.email ?? null) : null,
  }))
}

/**
 * Link an existing contact to a conversation. Used from the chat panel
 * when the visitor isn't tracked yet but matches a contact already in
 * the CRM (e.g. recurring customer reaching out from a new device).
 */
export async function linkContactToConversation(
  conversationId: string,
  contactId: string,
): Promise<{ error?: string }> {
  const user = await getUser()
  if (!user) return { error: 'Not authenticated' }
  const supabase = await createClient()

  // RLS will reject cross-org updates | both rows must belong to the current org.
  const { error } = await supabase
    .from('conversations')
    .update({ contact_id: contactId })
    .eq('id', conversationId)

  if (error) {
    // eslint-disable-next-line no-console
    console.error('[chat:link-contact]', error)
    return { error: error.message }
  }
  return {}
}

/**
 * Lightweight contact search for the link-contact picker. Returns up to 10
 * matches by name / phone / email. Excludes the result count for speed |
 * the picker is single-select, not a paginated list.
 */
export async function searchContactsForLink(query: string): Promise<Array<{
  id: string
  first_name: string | null
  last_name: string | null
  name: string | null
  phone: string | null
  email: string | null
  company: string | null
}>> {
  const user = await getUser()
  if (!user) return []
  const supabase = await createClient()

  const q = query.trim()
  let builder = supabase
    .from('contacts')
    .select('id, first_name, last_name, name, phone, email, company')
    .order('updated_at', { ascending: false })
    .limit(10)

  if (q) {
    const safe = q.replace(/[%_]/g, ' ')
    builder = builder.or(
      `first_name.ilike.%${safe}%,last_name.ilike.%${safe}%,name.ilike.%${safe}%,phone.ilike.%${safe}%,email.ilike.%${safe}%,company.ilike.%${safe}%`,
    )
  }

  const { data, error } = await builder
  if (error) {
    // eslint-disable-next-line no-console
    console.error('[chat:search-contacts]', error)
    return []
  }
  return data ?? []
}
