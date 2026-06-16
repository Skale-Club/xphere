'use server'

import { createClient, getUser } from '@/lib/supabase/server'
import type { Database } from '@/types/database'

export type UnifiedCall = Database['public']['Tables']['unified_calls']['Row']

const PAGE_SIZE = 20

// ─── Unified Calls (SEED-014) ────────────────────────────────────────────────

export interface UnifiedCallFilters {
  page?: number
  pageSize?: number
  type?: 'all' | 'ai' | 'human'
  direction?: 'all' | 'inbound' | 'outbound'
  missed?: boolean
  q?: string
  from?: string
  to?: string
}

export interface UnifiedCallContact {
  id: string
  first_name: string | null
  last_name: string | null
  name: string | null
  phone: string | null
  email: string | null
}

export interface UnifiedCallWithContact extends UnifiedCall {
  contact: UnifiedCallContact | null
}

export interface UnifiedCallsResult {
  rows: UnifiedCallWithContact[]
  total: number
  page: number
  pageSize: number
}

export async function getUnifiedCalls(
  filters: UnifiedCallFilters = {},
): Promise<UnifiedCallsResult> {
  const page = Math.max(1, filters.page ?? 1)
  const pageSize = Math.min(100, filters.pageSize ?? PAGE_SIZE)
  const user = await getUser()
  if (!user) return { rows: [], total: 0, page, pageSize }

  const supabase = await createClient()
  let query = supabase
    .from('unified_calls')
    .select('*', { count: 'exact' })
    .order('started_at', { ascending: false, nullsFirst: false })

  if (filters.type && filters.type !== 'all') query = query.eq('call_type', filters.type)
  if (filters.direction && filters.direction !== 'all') query = query.eq('direction', filters.direction)
  if (filters.missed) query = query.in('status', ['no-answer', 'failed', 'busy', 'canceled'])
  if (filters.from) query = query.gte('started_at', filters.from)
  if (filters.to) query = query.lte('started_at', filters.to)
  if (filters.q) {
    const escaped = filters.q.replace(/[%_]/g, (m) => `\\${m}`)
    query = query.or(
      `counterpart_number.ilike.%${escaped}%,counterpart_name.ilike.%${escaped}%,notes.ilike.%${escaped}%`,
    )
  }

  const from = (page - 1) * pageSize
  query = query.range(from, from + pageSize - 1)

  const { data, count, error } = await query
  if (error || !data) return { rows: [], total: 0, page, pageSize }

  // Resolve contact info for rows that have contact_id
  const contactIds = [...new Set(data.map((r) => r.contact_id).filter((id): id is string => Boolean(id)))]
  let contactMap = new Map<string, UnifiedCallContact>()
  if (contactIds.length > 0) {
    const { data: contacts } = await supabase
      .from('contacts')
      .select('id, first_name, last_name, name, phone, email')
      .in('id', contactIds)
    contactMap = new Map((contacts ?? []).map((c) => [c.id, c]))
  }

  const rows: UnifiedCallWithContact[] = data.map((r) => ({
    ...r,
    contact: r.contact_id ? contactMap.get(r.contact_id) ?? null : null,
  }))

  return { rows, total: count ?? 0, page, pageSize }
}

export async function getUnifiedCall(id: string): Promise<UnifiedCallWithContact | null> {
  const user = await getUser()
  if (!user) return null
  const supabase = await createClient()
  const { data } = await supabase
    .from('unified_calls')
    .select('*')
    .eq('id', id)
    .maybeSingle()
  if (!data) return null

  let contact: UnifiedCallContact | null = null
  if (data.contact_id) {
    const { data: c } = await supabase
      .from('contacts')
      .select('id, first_name, last_name, name, phone, email')
      .eq('id', data.contact_id)
      .maybeSingle()
    contact = c ?? null
  }
  return { ...data, contact }
}

// ─── Dial-pad contact search ─────────────────────────────────────────────────

export interface DialPadContactHit {
  id: string
  first_name: string | null
  last_name: string | null
  name: string | null
  phone: string | null
  company: string | null
}

export async function searchContactsForDialPad(q: string): Promise<DialPadContactHit[]> {
  if (!q || q.trim().length < 3) return []
  const user = await getUser()
  if (!user) return []
  const supabase = await createClient()
  const escaped = q.trim().replace(/[%_]/g, (m) => `\\${m}`)
  const { data } = await supabase
    .from('contacts')
    .select('id, first_name, last_name, name, phone, company')
    .or(
      [
        `first_name.ilike.%${escaped}%`,
        `last_name.ilike.%${escaped}%`,
        `name.ilike.%${escaped}%`,
        `phone.ilike.%${escaped}%`,
        `company.ilike.%${escaped}%`,
      ].join(','),
    )
    .not('phone', 'is', null)
    .order('updated_at', { ascending: false })
    .limit(8)
  return data ?? []
}

export async function getAssistantOptions(): Promise<
  Array<{ vapi_assistant_id: string; name: string | null }>
> {
  const supabase = await createClient()
  // Get distinct assistant_ids that have calls, joined with assistant_mappings for names
  const { data, error } = await supabase
    .from('assistant_mappings')
    .select('vapi_assistant_id, name')
    .eq('is_active', true)
    .order('name', { ascending: true })
  if (error) {
    console.error('[calls:getAssistantOptions] failed to load assistant_mappings', error)
    return []
  }
  return data ?? []
}
