// src/app/api/twilio/voice/route.ts
// Main Twilio Voice webhook (SEED-007 / v2.1).
// Public URL: https://xphere.app/api/twilio/voice
//
// Reads call_settings for the org-of-record (resolved via the `To` number) and
// returns TwiML directing the call to:
//   * phone_forward → <Dial><Number>{phone}</Number></Dial>
//   * sip           → <Dial><Sip>{sip_uri}</Sip></Dial>
//   * browser       → <Dial><Client>{identity}</Client></Dial>
//
// Side-effect: inserts a row in call_logs with status='ringing' for the inbound
// call. The status webhook will fill in duration_seconds + ended_at when the
// call completes.

import { after } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/admin'
import {
  resolveTwilioOrgByToNumber,
  resolveTwilioCredentialsForOrg,
} from '@/lib/twilio/voice'
import {
  resolveRoutingForOrg,
  resolveRoutingForPhoneNumber,
  buildSipUri,
} from '@/lib/calls/resolve-routing'
import {
  getRoutingChainForOrg,
  getRecordCallsForOrg,
  renderChainStage,
  fireIncomingCallPush,
} from '@/lib/calls/routing-chain'
import {
  twimlForwardToPhone,
  twimlForwardToSip,
  twimlForwardToClient,
  twimlOutboundDial,
  twimlReject,
} from '@/lib/calls/twiml-builder'
import {
  verifyTwilioSignature,
  resolveWebhookUrl,
  publicBaseUrl,
} from '@/lib/twilio/webhook-signature'
import { emitInboundPhoneEvent } from '@/lib/twilio/events'
import { resolveLiveContactId } from '@/lib/contacts/server'

export const runtime = 'nodejs'

const TWIML_HEADERS = { 'Content-Type': 'text/xml; charset=utf-8' }

function twimlResponse(body: string, status = 200): Response {
  return new Response(body, { status, headers: TWIML_HEADERS })
}

export async function POST(request: Request): Promise<Response> {
  try {
    const rawBody = await request.text()
    let params: URLSearchParams
    try {
      params = new URLSearchParams(rawBody)
    } catch {
      return twimlResponse(twimlReject())
    }

    const from = params.get('From') ?? ''
    const to = params.get('To') ?? ''
    const callSid = params.get('CallSid') ?? ''
    const direction = (params.get('Direction') ?? 'inbound').toLowerCase()
    // For SDK-initiated outbound calls, Twilio puts the target number in `To`
    // and `Direction` is `outbound-api` / `outbound-dial`. Treat anything that
    // contains "outbound" as an outbound bridge.
    const isOutbound = direction.includes('outbound')

    if (!to) {
      console.warn('[twilio/voice] Missing To | rejecting')
      return twimlResponse(twimlReject('We could not route this call. Please try again later.'))
    }

    // For inbound calls, resolve org by the destination number. For outbound
    // SDK-bridged calls, the From is the SDK identity (`client:user-…`) and the
    // To is the dialed number | we resolve the org via the API-Key SID embedded
    // in the credentials. As a simpler MVP heuristic, we resolve via the
    // `Caller` parameter (Twilio passes the original From of the bridge).
    const baseUrl = publicBaseUrl(request)

    let orgId: string | null = null
    let phoneNumberId: string | null = null
    let authToken = ''
    // Contact to bridge to on a server-initiated phone_forward/sip call. Resolved
    // from the call_logs row by CallSid (NOT from the TwiML URL query string —
    // see below), so it doubles as the "is this a server bridge?" signal.
    let serverBridgeContact: string | null = null

    if (isOutbound) {
      const caller = params.get('Caller') ?? ''
      if (caller.startsWith('client:')) {
        // Browser Voice SDK call. The `Caller` comes through as the verified
        // Twilio client identity. Strip the `client:` prefix to recover the
        // identity used at token generation time, then look up the call_settings
        // row for that identity to resolve the org.
        const identity = caller.slice('client:'.length)
        const supabase = createServiceRoleClient()
        const { data: settings } = identity
          ? await supabase
              .from('call_settings')
              .select('org_id')
              .eq('twilio_client_identity', identity)
              .limit(1)
              .maybeSingle()
          : { data: null }
        if (settings) orgId = settings.org_id
        if (orgId) {
          const creds = await resolveTwilioCredentialsForOrg(orgId)
          authToken = creds?.authToken ?? ''
        }
      } else {
        // Server-initiated phone_forward / sip bridge (from /api/twilio/outbound).
        // We deliberately DON'T pass the contact in the TwiML URL query string:
        // Twilio signs the full request URL, and proxies (Coolify) can re-encode
        // the `+` in `?dialTo=%2B...`, breaking signature validation and silently
        // dropping the bridge (call connects with no audio). Instead we look up
        // the call_logs row we inserted when placing the call, keyed by this
        // operator-leg CallSid — giving a clean, reliably-signable URL.
        const supabase = createServiceRoleClient()
        const { data: row } = callSid
          ? await supabase
              .from('call_logs')
              .select('org_id, to_number, phone_number_id')
              .eq('call_sid', callSid)
              .maybeSingle()
          : { data: null }
        if (row) {
          orgId = row.org_id
          phoneNumberId = row.phone_number_id ?? null
          serverBridgeContact = row.to_number
          const creds = await resolveTwilioCredentialsForOrg(orgId)
          authToken = creds?.authToken ?? ''
        }
      }
    } else {
      const resolved = await resolveTwilioOrgByToNumber(to)
      if (resolved) {
        orgId = resolved.orgId
        phoneNumberId = resolved.phoneNumberId
        authToken = resolved.creds.authToken
      }
    }

    if (!orgId) {
      console.warn('[twilio/voice] No Twilio integration for To:', to)
      return twimlResponse(twimlReject('This number is not connected to a Xphere workspace.'))
    }

    // Validate signature against the org's auth_token. We do this AFTER org
    // resolution because the auth_token is keyed by integration.
    const receivedSignature = request.headers.get('x-twilio-signature')
    const requestUrl = resolveWebhookUrl(request)
    const isValid = verifyTwilioSignature(authToken, requestUrl, params, receivedSignature)
    if (!isValid) {
      console.warn('[twilio/voice] Invalid X-Twilio-Signature for org:', orgId)
      return new Response('Forbidden', { status: 403 })
    }

    // ── Outbound bridge ─────────────────────────────────────────────────────
    if (isOutbound) {
      // Server-initiated phone_forward bridge resolves the contact from the
      // call_logs row (serverBridgeContact, set above). Browser SDK calls have
      // no such row and bridge to the PSTN number stored in `To`.
      const isServerBridge = serverBridgeContact !== null
      const bridgeTarget = serverBridgeContact ?? to

      const routing = await resolveRoutingForOrg(orgId)
      const recordCalls = routing?.recordCalls ?? true
      // For server bridges keep the org number the operator dialed from (`From`)
      // as caller ID; browser SDK calls fall back to the org's default number.
      const callerId =
        (isServerBridge ? params.get('From') : null) ??
        (await resolveTwilioCredentialsForOrg(orgId))?.fromNumber ??
        undefined

      after(async () => {
        await logIncomingCall({
          orgId: orgId!,
          callSid,
          direction: 'outbound',
          routingMode: isServerBridge ? 'phone_forward' : (routing?.routingMode ?? null),
          from: callerId ?? from,
          to: bridgeTarget,
          status: 'ringing',
          phoneNumberId,
        })
      })

      return twimlResponse(
        twimlOutboundDial(bridgeTarget, { baseUrl, recordCalls, callerId }),
      )
    }

    // ── Inbound call routing ────────────────────────────────────────────────
    // Routing chain (simultaneous-ring + ordered fallback) takes precedence over
    // the legacy single-mode resolver whenever the org has an active chain. The
    // first stage rings here; unanswered stages advance via /voice/continue.
    const chainStages = await getRoutingChainForOrg(orgId)
    if (chainStages) {
      const ctx = {
        baseUrl,
        recordCalls: await getRecordCallsForOrg(orgId),
        callerId: from,
      }
      const rendered = await renderChainStage({
        orgId,
        stages: chainStages,
        startIndex: 0,
        ctx,
      })

      after(async () => {
        await logIncomingCall({
          orgId: orgId!,
          callSid,
          direction: 'inbound',
          routingMode: null,
          from,
          to,
          status: 'ringing',
          phoneNumberId,
        })
        if (rendered && rendered.pwaUserIds.length > 0) {
          await fireIncomingCallPush(orgId!, rendered.pwaUserIds, {
            caller_number: from,
            call_id: callSid,
          })
        }
      })

      if (rendered) return twimlResponse(rendered.twiml)
      return twimlResponse(
        twimlReject('No agent is currently available. Please leave a message after the tone.'),
      )
    }

    const routing = await resolveRoutingForPhoneNumber(orgId, phoneNumberId)
    if (!routing) {
      console.warn('[twilio/voice] No routing configured for org/number:', orgId, phoneNumberId)
      return twimlResponse(
        twimlReject('No agent is currently available. Please leave a message after the tone.'),
      )
    }

    after(async () => {
      await logIncomingCall({
        orgId: orgId!,
        callSid,
        direction: 'inbound',
        routingMode: routing.routingMode,
        from,
        to,
        status: 'ringing',
        phoneNumberId,
      })
    })

    const ctx = {
      baseUrl,
      recordCalls: routing.recordCalls,
      callerId: from,
    }

    if (routing.routingMode === 'phone_forward') {
      if (!routing.phoneForward) {
        return twimlResponse(twimlReject('Forwarding number not configured.'))
      }
      return twimlResponse(twimlForwardToPhone(routing.phoneForward, ctx))
    }
    if (routing.routingMode === 'sip') {
      // SIP domain stored in integration.config.sip_domain
      const supabase = createServiceRoleClient()
      const { data: integration } = await supabase
        .from('integrations')
        .select('config')
        .eq('organization_id', orgId)
        .eq('provider', 'twilio')
        .eq('is_active', true)
        .limit(1)
        .maybeSingle()
      const sipDomain = (integration?.config as { sip_domain?: string } | null)?.sip_domain ?? null
      const uri = buildSipUri(routing.sipUsername, sipDomain)
      if (!uri) return twimlResponse(twimlReject('SIP routing is not fully configured.'))
      return twimlResponse(twimlForwardToSip(uri, ctx))
    }
    if (routing.routingMode === 'browser') {
      if (!routing.twilioClientIdentity) {
        return twimlResponse(twimlReject('Browser client identity not set up.'))
      }
      return twimlResponse(twimlForwardToClient(routing.twilioClientIdentity, ctx))
    }

    return twimlResponse(twimlReject())
  } catch (err) {
    console.error('[twilio/voice] handler error:', err)
    return twimlResponse(twimlReject())
  }
}

async function logIncomingCall(input: {
  orgId: string
  callSid: string
  direction: 'inbound' | 'outbound'
  routingMode: 'phone_forward' | 'sip' | 'browser' | null
  from: string
  to: string
  status: string
  phoneNumberId: string | null
}): Promise<void> {
  if (!input.callSid) return
  const supabase = createServiceRoleClient()

  // Idempotent upsert by call_sid (UNIQUE) | Twilio may retry the webhook.
  const { data: existing } = await supabase
    .from('call_logs')
    .select('id, contact_id')
    .eq('call_sid', input.callSid)
    .maybeSingle()

  // Best-effort contact lookup by the inbound phone number.
  let contactId: string | null = existing?.contact_id ?? null
  if (!contactId) {
    const phoneToLookup = input.direction === 'inbound' ? input.from : input.to
    if (phoneToLookup) {
      const { data: contact } = await supabase
        .from('contacts')
        .select('id')
        .eq('org_id', input.orgId)
        .eq('phone', phoneToLookup)
        .limit(1)
        .maybeSingle()
      contactId = contact?.id ?? null
    }
  }

  const liveContactId = contactId ? await resolveLiveContactId(contactId) : null

  let callLogId: string | null = existing?.id ?? null
  const isFirstInsert = !existing

  if (existing) {
    await supabase
      .from('call_logs')
      .update({
        contact_id: liveContactId,
        status: input.status,
        ...(input.phoneNumberId ? { phone_number_id: input.phoneNumberId } : {}),
      })
      .eq('id', existing.id)
  } else {
    const { data: inserted } = await supabase
      .from('call_logs')
      .insert({
        org_id: input.orgId,
        contact_id: liveContactId,
        call_sid: input.callSid,
        direction: input.direction,
        routing_mode: input.routingMode,
        from_number: input.from,
        to_number: input.to,
        status: input.status,
        started_at: new Date().toISOString(),
        phone_number_id: input.phoneNumberId,
      })
      .select('id')
      .single()
    callLogId = inserted?.id ?? null
  }

  // Fire inbound_call_to_number workflow event only on the first insert for
  // this call_sid (avoid re-firing on Twilio webhook retries that hit the
  // existing-row path).
  if (isFirstInsert && input.direction === 'inbound' && callLogId) {
    await emitInboundPhoneEvent(input.orgId, 'inbound_call_to_number', {
      phoneNumberId: input.phoneNumberId,
      fromNumber: input.from,
      toNumber: input.to,
      callLogId,
      externalId: input.callSid,
    })
  }
}
