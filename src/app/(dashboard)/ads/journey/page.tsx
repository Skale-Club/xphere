import { createClient, getUser } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { AdsJourneyView } from '../_components/ads-journey'

export default async function AdsJourneyPage() {
  const user = await getUser()
  if (!user) redirect('/')

  const supabase = await createClient()

  const [
    { data: memories },
    { data: executions },
    { data: plans },
    { data: audits },
  ] = await Promise.all([
    supabase
      .from('ads_memories')
      .select('id, type, status, source, platform, title, content, campaign_name, confidence, proposed, created_at')
      .order('created_at', { ascending: false })
      .limit(50),
    supabase
      .from('ads_executions')
      .select('id, type, platform, title, description, campaign_name, before_value, after_value, executed_by_ai, executed_at')
      .order('executed_at', { ascending: false })
      .limit(30),
    supabase
      .from('ads_plans')
      .select('id, type, title, description, platform, metric, target_value, deadline, status, created_at')
      .order('created_at', { ascending: false })
      .limit(20),
    supabase
      .from('ads_audits')
      .select('id, period_type, period_from, period_to, title, spend_total, leads_total, opportunities_total, revenue_total, summary, status, created_at')
      .order('period_from', { ascending: false })
      .limit(10),
  ])

  return (
    <AdsJourneyView
      memories={memories ?? []}
      executions={executions ?? []}
      plans={plans ?? []}
      audits={audits ?? []}
    />
  )
}
