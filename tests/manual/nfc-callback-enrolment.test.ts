// End to end, without ringing anybody's phone.
//
// Sends a synthetic NFC keychain order at the public leads API exactly as the
// skaleclub site does, then follows it: lead_ingestions -> lead.captured ->
// the org's workflow -> campaign_contacts. Finally it asks the dialler itself
// whether it would place the call right now, so the dialling window is
// exercised rather than assumed.
//
// SAFETY: it never dials. The campaign's own window is what stops it — run
// this with today blacked out (or outside business hours) and the batch
// reports skippedDialWindow. Inside the window with a real number in PHONE,
// the next cron tick WILL call it.
//
//   LEAD_API_KEY=xph_… \
//   NFC_E2E_PHONE=+5511999990000 \
//   npx vitest run --config vitest.manual.config.ts tests/manual/nfc-callback-enrolment.test.ts
//
// Env:
//   LEAD_API_KEY   an xph_ key with leads:write for the org (required)
//   NFC_E2E_PHONE  who the order claims to be from. Default: a reserved
//                  Brazilian number that cannot be reached.
//   NFC_E2E_LANG   'pt-BR' (default) or 'en' — picks which campaign it lands in
//   LEADS_URL      override the endpoint (default production)
//   CLEANUP=1      delete the contact row this test enrols, afterwards

import { it, expect } from 'vitest'
import { createServiceRoleClient } from '@/lib/supabase/admin'
import { startCampaignBatch } from '@/lib/campaigns/engine'

const ORG_ID = 'b27e99cf-efcb-4b6b-a369-5a0d3ca7ffe5'
const API_KEY = process.env.LEAD_API_KEY
const PHONE = process.env.NFC_E2E_PHONE ?? '+5511999990000'
const LANG = process.env.NFC_E2E_LANG ?? 'pt-BR'
const LEADS_URL = process.env.LEADS_URL ?? 'https://xphere.app/api/v1/leads'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

it.skipIf(!API_KEY)(
  'an NFC order reaches the callback queue without being dialled',
  async () => {
    const eventId = `skaleclub:nfc-keychain-order:e2e-${Date.now()}`
    const payload = {
      schema_version: '1.0',
      event_id: eventId,
      occurred_at: new Date().toISOString(),
      source: { product: 'skaleclub', tenant_ref: 'skaleclub', site_domain: 'skale.club', form: 'nfc-keychain-order' },
      contact: { name: 'Pedido de Teste (E2E)', email: null, phone: PHONE },
      lead: {
        status: 'new',
        score: null,
        classification: null,
        page_url: LANG === 'pt-BR' ? 'https://skale.club/br/nfc-order' : 'https://skale.club/nfc-order',
        answers: {
          lang: LANG,
          telefone: PHONE,
          nome: 'Pedido de Teste (E2E)',
          nomeEmpresa: 'Barbearia Exemplo',
          tipoChaveiro: 'standard',
          quantidade: '60',
          enderecoEnvio: 'Rua Exemplo 123, Sao Paulo',
          objetivoChaveiro: 'google-reviews',
          observacoes: 'pedido sintetico de verificacao',
          countryCode: LANG === 'pt-BR' ? 'BR' : 'US',
          logo__filename: 'logo.png',
          nfcQuantity: '60',
          nfcTypeId: 'standard',
          nfcTypeLabel: 'Standard',
          nfcUnitPrice: '$9.00',
          nfcSubtotal: '$540.00',
          nfcArtFee: '$50.00',
          nfcTotal: '$590.00',
          nfcPricingVersion: '2026-09-22.1',
          nfcQuoteOnRequest: 'no',
          nfcPreviousOrders: '0',
          nfcDeclaredReturning: 'no',
        },
      },
      attribution: { utm_source: null, utm_medium: null, utm_campaign: null },
    }

    const res = await fetch(LEADS_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': eventId,
      },
      body: JSON.stringify(payload),
    })
    const body = (await res.json()) as { receipt_id?: string; contact_id?: string; error?: string }
    console.log(`### INGEST ${res.status} ${JSON.stringify(body)}`)
    expect(res.status).toBe(201)
    expect(body.contact_id).toBeTruthy()

    const supabase = createServiceRoleClient()

    // The flow runs in an after() hook on the leads route, so give it a moment.
    let contact: { id: string; campaign_id: string; status: string; custom_data: unknown } | null = null
    for (let attempt = 0; attempt < 10 && !contact; attempt++) {
      await sleep(1500)
      const { data } = await supabase
        .from('campaign_contacts')
        .select('id, campaign_id, status, custom_data')
        .eq('organization_id', ORG_ID)
        .eq('phone', PHONE)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      contact = data
    }

    if (!contact) {
      const { data: run } = await supabase
        .from('workflow_runs')
        .select('workflow_id, status, error')
        .order('started_at', { ascending: false })
        .limit(3)
      console.log(`### NO ENROLMENT. Recent runs: ${JSON.stringify(run)}`)
    }
    expect(contact, 'the order should have been queued for a callback').toBeTruthy()

    const variables = contact!.custom_data as Record<string, string>
    console.log(`### QUEUED ${contact!.id} status=${contact!.status}`)
    console.log(`### VARIABLES ${JSON.stringify(variables)}`)

    // The facts the robot reads out loud. A missing quoted_total is the whole
    // reason the skaleclub serializer had to change.
    expect(variables.quoted_total).toBe('$590.00')
    expect(variables.quantity).toBe('60')
    expect(variables.company_name).toBe('Barbearia Exemplo')
    expect(variables.lang).toBe(LANG)
    expect(variables.quote_on_request).toBe('no')
    expect(contact!.status).toBe('pending')

    // Would the dialler place this call right now? With today blacked out it
    // must decline, and — the part that is easy to get wrong — it must NOT
    // complete the campaign while it waits.
    const { data: campaignBefore } = await supabase
      .from('campaigns')
      .select('status, dial_window')
      .eq('id', contact!.campaign_id)
      .single()

    const batch = await startCampaignBatch(contact!.campaign_id, supabase, 'not-a-real-key')
    console.log(`### BATCH ${JSON.stringify(batch)}`)

    const { data: campaignAfter } = await supabase
      .from('campaigns')
      .select('status')
      .eq('id', contact!.campaign_id)
      .single()
    expect(campaignAfter!.status).toBe(campaignBefore!.status)

    if (batch.skippedDialWindow) {
      console.log('### outside the dialling window — nothing was dialled, as intended')
    } else {
      console.log('### INSIDE the dialling window: the next cron tick will dial this number')
    }

    if (process.env.CLEANUP === '1') {
      await supabase.from('campaign_contacts').delete().eq('id', contact!.id)
      console.log('### cleaned up the test enrolment')
    }
  },
  120000,
)
