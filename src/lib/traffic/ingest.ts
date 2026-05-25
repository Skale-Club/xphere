import { createServiceRoleClient } from '@/lib/supabase/admin'
import type { IngestPayload } from './types'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function db() { return createServiceRoleClient() as any }

export async function processIngest(
  payload: IngestPayload,
  ip: string | null,
  geoCountryCode: string | null,
  geoCountryName: string | null,
  geoCity: string | null,
): Promise<void> {
  const supabase = db()

  // Resolve org from script_token
  const { data: setup } = await supabase
    .from('traffic_setups')
    .select('organization_id')
    .eq('script_token', payload.token)
    .maybeSingle()

  if (!setup) return

  const orgId: string = setup.organization_id
  void ip // stored in future geo enrichment if needed

  // Upsert visitor
  const { data: visitor } = await supabase
    .from('traffic_visitors')
    .upsert(
      { organization_id: orgId, visitor_key: payload.visitor_id, last_seen_at: new Date().toISOString() },
      { onConflict: 'organization_id,visitor_key', ignoreDuplicates: false }
    )
    .select('id, session_count, page_view_count')
    .single()

  if (!visitor) return
  const visitorId: string = visitor.id

  if (payload.type === 'session_start') {
    // Insert session (ignore duplicates — duplicate session_start is harmless)
    const { data: session } = await supabase
      .from('traffic_sessions')
      .upsert(
        {
          organization_id: orgId,
          visitor_id: visitorId,
          session_key: payload.session_key,
          landing_page: payload.url ?? null,
          referrer: payload.referrer ?? null,
          utm_source: payload.utm_source ?? null,
          utm_medium: payload.utm_medium ?? null,
          utm_campaign: payload.utm_campaign ?? null,
          utm_term: payload.utm_term ?? null,
          utm_content: payload.utm_content ?? null,
          country_code: geoCountryCode,
          country_name: geoCountryName,
          city: geoCity,
          device_type: payload.device_type ?? 'unknown',
          browser: payload.browser ?? null,
          os: payload.os ?? null,
        },
        { onConflict: 'organization_id,session_key', ignoreDuplicates: true }
      )
      .select('id')
      .single()

    if (!session) return

    // Update visitor session count
    await supabase
      .from('traffic_visitors')
      .update({ session_count: (visitor.session_count ?? 0) + 1 })
      .eq('id', visitorId)

    // Mark setup as having received events (transition from no_events_yet → verified if pending)
    await supabase
      .from('traffic_setups')
      .update({ verification_state: 'verified', verified_at: new Date().toISOString() })
      .eq('organization_id', orgId)
      .in('verification_state', ['pending', 'no_events_yet'])

    // Upsert attributions
    const attribution = {
      organization_id: orgId,
      visitor_id: visitorId,
      utm_source: payload.utm_source ?? null,
      utm_medium: payload.utm_medium ?? null,
      utm_campaign: payload.utm_campaign ?? null,
      utm_term: payload.utm_term ?? null,
      utm_content: payload.utm_content ?? null,
      landing_page: payload.url ?? null,
      referrer: payload.referrer ?? null,
      session_id: session.id,
      occurred_at: new Date().toISOString(),
    }

    // First touch: insert only if none exists
    await supabase
      .from('traffic_attributions')
      .upsert({ ...attribution, touch_type: 'first' }, { onConflict: 'visitor_id,touch_type', ignoreDuplicates: true })

    // Last touch: always update
    await supabase
      .from('traffic_attributions')
      .upsert({ ...attribution, touch_type: 'last' }, { onConflict: 'visitor_id,touch_type', ignoreDuplicates: false })

    return
  }

  // Resolve session ID from session_key
  const { data: session } = await supabase
    .from('traffic_sessions')
    .select('id, page_view_count')
    .eq('organization_id', orgId)
    .eq('session_key', payload.session_key)
    .maybeSingle()

  const sessionId: string | null = session?.id ?? null

  if (payload.type === 'pageview' && sessionId) {
    await supabase.from('traffic_pageviews').insert({
      organization_id: orgId,
      session_id: sessionId,
      visitor_id: visitorId,
      url: payload.url ?? '',
      path: payload.path ?? '/',
      title: payload.title ?? null,
      referrer: payload.referrer ?? null,
      occurred_at: new Date().toISOString(),
    })

    const newPvCount = (session.page_view_count ?? 0) + 1
    await supabase
      .from('traffic_sessions')
      .update({ page_view_count: newPvCount, exit_page: payload.url ?? null })
      .eq('id', sessionId)

    await supabase
      .from('traffic_visitors')
      .update({ page_view_count: (visitor.page_view_count ?? 0) + 1, last_seen_at: new Date().toISOString() })
      .eq('id', visitorId)

    return
  }

  if (payload.type === 'event') {
    const isConversion = isConversionEvent(payload.event_type)

    await supabase.from('traffic_events').insert({
      organization_id: orgId,
      session_id: sessionId,
      visitor_id: visitorId,
      event_type: payload.event_type ?? 'custom_conversion',
      event_name: payload.event_name ?? null,
      url: payload.url ?? null,
      metadata: payload.metadata ?? {},
      occurred_at: new Date().toISOString(),
    })

    if (isConversion && sessionId) {
      await supabase
        .from('traffic_sessions')
        .update({ is_converted: true })
        .eq('id', sessionId)
    }

    return
  }

  if (payload.type === 'session_end' && sessionId) {
    await supabase
      .from('traffic_sessions')
      .update({
        ended_at: new Date().toISOString(),
        duration_seconds: payload.duration_seconds ?? null,
        exit_page: payload.url ?? null,
      })
      .eq('id', sessionId)
  }
}

function isConversionEvent(type?: string): boolean {
  return [
    'form_submit', 'call_started', 'chat_started', 'booking_completed',
    'contact_created', 'opportunity_created', 'deal_won',
  ].includes(type ?? '')
}
