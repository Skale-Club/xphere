'use server'

import { createClient, getUser } from '@/lib/supabase/server'
import {
  okResult,
  errResult,
  type ActionResult,
  type AccountRow,
} from '@/lib/accounts'
import type { Database } from '@/types/database'

export type ContactRow = Database['public']['Tables']['contacts']['Row']

type OpportunityRow = Database['public']['Tables']['opportunities']['Row']
type ActivityRow = Database['public']['Tables']['opportunity_activities']['Row']

export interface OpportunityWithStage extends OpportunityRow {
  stage: { id: string; name: string; color: string; is_won: boolean; is_lost: boolean } | null
  contact: { id: string; name: string | null } | null
}

export async function getAccountDetail(id: string): Promise<
  ActionResult<{
    account: AccountRow
    contacts: ContactRow[]
  }>
> {
  const user = await getUser()
  if (!user) return errResult('not_authenticated')

  const supabase = await createClient()

  const [accountResult, contactsResult] = await Promise.all([
    supabase.from('accounts').select('*').eq('id', id).maybeSingle(),
    supabase
      .from('contacts')
      .select('id, name, phone, email, company, created_at, org_id, notes, tags, custom_fields, source, external_id, account_id, created_by, updated_at')
      .eq('account_id', id)
      .order('name', { ascending: true }),
  ])

  if (accountResult.error) return errResult(accountResult.error.message, accountResult.error)
  if (!accountResult.data) return errResult('not_found')
  if (contactsResult.error) return errResult(contactsResult.error.message, contactsResult.error)

  return okResult({
    account: accountResult.data as AccountRow,
    contacts: (contactsResult.data ?? []) as ContactRow[],
  })
}

export async function getAccountOpportunities(
  accountId: string,
): Promise<ActionResult<OpportunityWithStage[]>> {
  const user = await getUser()
  if (!user) return errResult('not_authenticated')
  const supabase = await createClient()

  // 1. Get contact IDs linked to this account
  const { data: linkedContacts } = await supabase
    .from('contacts')
    .select('id')
    .eq('account_id', accountId)
  const contactIds = (linkedContacts ?? []).map((c) => c.id)

  // 2. Query opportunities: direct account link OR via linked contacts
  let query = supabase
    .from('opportunities')
    .select(
      '*, stage:pipeline_stages(id, name, color, is_won, is_lost), contact:contacts(id, name)',
    )
    .order('updated_at', { ascending: false })

  if (contactIds.length > 0) {
    query = query.or(
      `account_id.eq.${accountId},contact_id.in.(${contactIds.join(',')})`,
    )
  } else {
    query = query.eq('account_id', accountId)
  }

  const { data, error } = await query
  if (error) return errResult(error.message, error)
  return okResult((data ?? []) as unknown as OpportunityWithStage[])
}

export async function getAccountActivities(
  accountId: string,
): Promise<ActionResult<ActivityRow[]>> {
  const user = await getUser()
  if (!user) return errResult('not_authenticated')
  const supabase = await createClient()

  // 1. Collect all opportunity IDs linked to this account (direct + via contacts)
  const { data: linkedContacts } = await supabase
    .from('contacts')
    .select('id')
    .eq('account_id', accountId)
  const contactIds = (linkedContacts ?? []).map((c) => c.id)

  let oppQuery = supabase.from('opportunities').select('id')
  if (contactIds.length > 0) {
    oppQuery = oppQuery.or(
      `account_id.eq.${accountId},contact_id.in.(${contactIds.join(',')})`,
    )
  } else {
    oppQuery = oppQuery.eq('account_id', accountId)
  }
  const { data: opps } = await oppQuery
  const oppIds = (opps ?? []).map((o) => o.id)

  if (oppIds.length === 0) return okResult<ActivityRow[]>([])

  // 2. Fetch activities for all those opportunities, newest first
  const { data, error } = await supabase
    .from('opportunity_activities')
    .select('*')
    .in('opportunity_id', oppIds)
    .order('created_at', { ascending: false })
    .limit(100)

  if (error) return errResult(error.message, error)
  return okResult((data ?? []) as ActivityRow[])
}
