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
  contact: { id: string; first_name: string | null; last_name: string | null; name: string | null } | null
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
    supabase
      .from('accounts')
      .select('*')
      .eq('id', id)
      .neq('lifecycle_stage', 'prospect')
      .maybeSingle(),
    supabase
      .from('contacts')
      .select('id, first_name, last_name, name, phone, email, company, created_at, org_id, notes, tags, custom_fields, source, lifecycle_stage, engagement_status, intent_level, qualification_status, source_type, source_id, source_payload, external_id, account_id, created_by, updated_at')
      .eq('account_id', id)
      .neq('lifecycle_stage', 'prospect')
      .order('first_name', { ascending: true, nullsFirst: false })
      .order('last_name', { ascending: true, nullsFirst: false }),
  ])

  if (accountResult.error) return errResult(accountResult.error.message, accountResult.error)
  if (!accountResult.data) return errResult('not_found')
  if (contactsResult.error) return errResult(contactsResult.error.message, contactsResult.error)

  return okResult({
    account: accountResult.data as AccountRow,
    contacts: (contactsResult.data ?? []) as ContactRow[],
  })
}

/**
 * Contact ids linked to this account, excluding prospects. Shared by
 * getAccountOpportunities/getAccountActivities (and the combined loader
 * below) so each caller doesn't re-run the exact same query independently
 * (SEED-048 Phase D). Not module-cached — each invocation is scoped to the
 * `supabase` client passed in, so it stays request/call safe.
 */
async function getLinkedContactIds(
  supabase: Awaited<ReturnType<typeof createClient>>,
  accountId: string,
): Promise<string[]> {
  const { data: linkedContacts } = await supabase
    .from('contacts')
    .select('id')
    .eq('account_id', accountId)
    .neq('lifecycle_stage', 'prospect')
  return (linkedContacts ?? []).map((c) => c.id)
}

export async function getAccountOpportunities(
  accountId: string,
): Promise<ActionResult<OpportunityWithStage[]>> {
  const user = await getUser()
  if (!user) return errResult('not_authenticated')
  const supabase = await createClient()

  const contactIds = await getLinkedContactIds(supabase, accountId)

  // Query opportunities: direct account link OR via linked contacts
  let query = supabase
    .from('opportunities')
    .select(
      '*, stage:pipeline_stages(id, name, color, is_won, is_lost), contact:contacts(id, first_name, last_name, name)',
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

  const contactIds = await getLinkedContactIds(supabase, accountId)

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

  // Fetch activities for all those opportunities, newest first
  const { data, error } = await supabase
    .from('opportunity_activities')
    .select('*')
    .in('opportunity_id', oppIds)
    .order('created_at', { ascending: false })
    .limit(100)

  if (error) return errResult(error.message, error)
  return okResult((data ?? []) as ActivityRow[])
}

/**
 * Combined opportunities + activities loader for the company detail page.
 * Resolves the linked-contact ids and the opportunity ids exactly once and
 * reuses them for both result sets, instead of the page-level Promise.all
 * calling getAccountOpportunities/getAccountActivities independently (each
 * of which re-derives the same contactIds from scratch) (SEED-048 Phase D).
 */
export async function getAccountOpportunitiesAndActivities(
  accountId: string,
): Promise<
  ActionResult<{ opportunities: OpportunityWithStage[]; activities: ActivityRow[] }>
> {
  const user = await getUser()
  if (!user) return errResult('not_authenticated')
  const supabase = await createClient()

  const contactIds = await getLinkedContactIds(supabase, accountId)

  let oppQuery = supabase
    .from('opportunities')
    .select(
      '*, stage:pipeline_stages(id, name, color, is_won, is_lost), contact:contacts(id, first_name, last_name, name)',
    )
    .order('updated_at', { ascending: false })

  if (contactIds.length > 0) {
    oppQuery = oppQuery.or(
      `account_id.eq.${accountId},contact_id.in.(${contactIds.join(',')})`,
    )
  } else {
    oppQuery = oppQuery.eq('account_id', accountId)
  }

  const { data: oppData, error: oppError } = await oppQuery
  if (oppError) return errResult(oppError.message, oppError)
  const opportunities = (oppData ?? []) as unknown as OpportunityWithStage[]
  const oppIds = opportunities.map((o) => o.id)

  if (oppIds.length === 0) {
    return okResult({ opportunities, activities: [] as ActivityRow[] })
  }

  const { data: actData, error: actError } = await supabase
    .from('opportunity_activities')
    .select('*')
    .in('opportunity_id', oppIds)
    .order('created_at', { ascending: false })
    .limit(100)

  if (actError) return errResult(actError.message, actError)
  return okResult({ opportunities, activities: (actData ?? []) as ActivityRow[] })
}
