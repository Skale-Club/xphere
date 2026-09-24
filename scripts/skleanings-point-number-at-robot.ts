// Point the Skleanings company line at the robot.
//
// The number is +1 508 812-7211 — the one Twilio labels "Skleanings | Cleaning".
// (Not +1 508 205-8044: Twilio labels that one "Xtimator | WhatsApp", and the
// label is right even though Xkedule still publishes 205-8044 as the business
// phone. That mismatch is worth fixing separately, on the Xkedule side.)
//
// TODAY it answers into a Twilio Studio Flow. Importing it into Vapi REWRITES
// that webhook, so the flow sid is recorded here and --revert rebuilds the URL
// from it. Only the flow sid is stored: the account sid is read from the
// tenant's own credentials at runtime, never written into the repo.
//
// A fallback number is set on the import: if Vapi cannot answer, Twilio sends
// the call to the human line instead of dropping it. A cleaning company's phone
// going silent is worse than a robot that did not pick up.
//
//   npx tsx --env-file=.env.local scripts/skleanings-point-number-at-robot.ts           # dry run
//   npx tsx --env-file=.env.local scripts/skleanings-point-number-at-robot.ts --apply
//   npx tsx --env-file=.env.local scripts/skleanings-point-number-at-robot.ts --revert

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { createServiceRoleClient } from '@/lib/supabase/admin'
import { decrypt } from '@/lib/crypto'

const ORG_ID = '24552ef3-de77-4fba-a2c3-148cd58d8750'
const NUMBER = '+15088127211'
const ASSISTANT_ID = '7dc23636-a684-48f7-a82f-37062c5b5d00'
/** Where a call goes when Vapi cannot take it. */
const FALLBACK = '+15087402109'
/**
 * The Twilio voice webhook as it was before --apply rewrote it, so --revert can
 * put it back. Written by --apply, read by --revert; never a constant in the
 * repo — Twilio resource ids look like secrets to a scanner, and the value
 * belongs to the account, not to the code.
 */
const STATE_FILE = 'scripts/.skleanings-number-state.json'

/** Strip line breaks before logging text that came from an API: a value with a newline in it can forge a log line. */
const oneLine = (v: unknown) => String(v ?? '').replace(/[\r\n]+/g, ' ')

/** A Twilio account sid, and nothing else, may be spliced into a Twilio URL. */
function assertTwilioAccountSid(sid: unknown): string {
  if (typeof sid !== 'string' || !/^AC[0-9a-f]{32}$/i.test(sid)) throw new Error('Twilio credential has no valid account sid')
  return sid
}

/** Only https webhooks on hosts we own or Twilio owns may be written back to the number. */
function assertWebhookUrl(u: unknown): string {
  try {
    const parsed = new URL(String(u))
    if (parsed.protocol === 'https:' && /(^|\.)(twilio\.com|xphere\.app)$/.test(parsed.hostname)) return parsed.toString()
  } catch {
    /* fall through */
  }
  throw new Error(`refusing to set a webhook outside twilio.com / xphere.app: ${oneLine(u).slice(0, 80)}`)
}

/** Twilio's own record for the number — its sid and current webhooks, looked up by E.164. */
async function twilioNumber(accountSid: string, basicAuth: string) {
  const res = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/IncomingPhoneNumbers.json?PhoneNumber=${encodeURIComponent(NUMBER)}`,
    { headers: { Authorization: `Basic ${basicAuth}` } },
  )
  const body = (await res.json()) as {
    incoming_phone_numbers?: { sid: string; phone_number: string; friendly_name: string; voice_url: string; sms_url: string }[]
  }
  const row = body.incoming_phone_numbers?.[0]
  if (!row) throw new Error(`${NUMBER} is not in Twilio account ${accountSid.slice(0, 6)}…`)
  return row
}

async function main() {
  const apply = process.argv.includes('--apply')
  const revert = process.argv.includes('--revert')
  const sb = createServiceRoleClient()

  const { data: vapiIntegration } = await sb
    .from('integrations')
    .select('encrypted_api_key')
    .eq('organization_id', ORG_ID)
    .eq('provider', 'vapi')
    .eq('is_active', true)
    .maybeSingle()
  const vapiKey = await decrypt(vapiIntegration!.encrypted_api_key!)

  const { data: twilioIntegration } = await sb
    .from('integrations')
    .select('encrypted_api_key')
    .eq('organization_id', ORG_ID)
    .eq('provider', 'twilio')
    .eq('is_active', true)
    .maybeSingle()
  const blob = JSON.parse(await decrypt(twilioIntegration!.encrypted_api_key!)) as Record<string, string>
  const accountSid = assertTwilioAccountSid(blob.account_sid)
  const twilioAuth = Buffer.from(`${accountSid}:${blob.auth_token}`).toString('base64')

  const tw = await twilioNumber(accountSid, twilioAuth)
  const numberUrl = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/IncomingPhoneNumbers/${encodeURIComponent(tw.sid)}.json`
  console.log(`twilio : ${oneLine(tw.phone_number)} "${oneLine(tw.friendly_name)}"`)
  console.log(`         voice_url now: ${oneLine(tw.voice_url)}`)

  const existing = (await (
    await fetch('https://api.vapi.ai/phone-number?limit=50', { headers: { Authorization: `Bearer ${vapiKey}` } })
  ).json()) as { id: string; number?: string; assistantId?: string }[]
  const alreadyOnVapi = existing.find((n) => n.number === NUMBER)
  console.log(`vapi   : ${alreadyOnVapi ? 'already imported (' + oneLine(alreadyOnVapi.id) + ')' : 'not imported'}`)

  if (revert) {
    if (alreadyOnVapi) {
      const del = await fetch(`https://api.vapi.ai/phone-number/${alreadyOnVapi.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${vapiKey}` },
      })
      console.log(`removed from Vapi -> ${del.status}`)
    }
    if (!existsSync(STATE_FILE)) throw new Error(`no ${STATE_FILE} — --apply never ran here, nothing to restore`)
    const saved = JSON.parse(readFileSync(STATE_FILE, 'utf8')) as { voiceUrl: unknown; smsUrl: unknown }
    // The state file is ours, but it is still a file: only webhooks on hosts
    // we or Twilio own go back onto the number.
    const voiceUrl = assertWebhookUrl(saved.voiceUrl)
    const smsUrl = assertWebhookUrl(saved.smsUrl)
    const put = await fetch(numberUrl, {
      method: 'POST',
      headers: { Authorization: `Basic ${twilioAuth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ VoiceUrl: voiceUrl, VoiceMethod: 'POST', SmsUrl: smsUrl, SmsMethod: 'POST' }),
    })
    console.log(`twilio webhooks restored -> ${put.status} (voice ${oneLine(voiceUrl)})`)
    await sb.from('twilio_phone_numbers').update({ vapi_phone_number_id: null, vapi_assistant_id: null, provider: 'twilio' }).eq('organization_id', ORG_ID).eq('e164', NUMBER)
    console.log('reverted.')
    return
  }

  if (!apply) {
    console.log(`\nWOULD import ${NUMBER} into Vapi, bound to ${ASSISTANT_ID}`)
    console.log(`WOULD set fallback to ${FALLBACK}`)
    console.log(`WOULD register the row in twilio_phone_numbers (it is not there today)`)
    console.log(`\nThis REWRITES the Twilio voice webhook away from the Studio Flow.`)
    console.log('DRY RUN — pass --apply.')
    return
  }

  // Remember what Twilio had BEFORE anything is rewritten, so --revert has a
  // target. Only on the first apply — a re-run must not overwrite the original
  // with the Vapi URLs it is about to set.
  if (!existsSync(STATE_FILE)) {
    writeFileSync(STATE_FILE, JSON.stringify({ voiceUrl: tw.voice_url, smsUrl: tw.sms_url, savedAt: new Date().toISOString() }, null, 1), 'utf8')
    console.log(`saved previous webhooks to ${STATE_FILE}`)
  }

  let vapiPhoneId = alreadyOnVapi?.id
  if (!vapiPhoneId) {
    const res = await fetch('https://api.vapi.ai/phone-number', {
      method: 'POST',
      headers: { Authorization: `Bearer ${vapiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        provider: 'twilio',
        number: NUMBER,
        twilioAccountSid: blob.account_sid,
        twilioAuthToken: blob.auth_token,
        name: 'Skleanings | Cleaning',
        assistantId: ASSISTANT_ID,
        fallbackDestination: { type: 'number', number: FALLBACK },
      }),
    })
    const body = await res.text()
    console.log(`vapi import -> ${res.status}`)
    if (!res.ok) {
      console.log(body.slice(0, 600))
      process.exit(1)
    }
    vapiPhoneId = (JSON.parse(body) as { id: string }).id
  } else {
    const res = await fetch(`https://api.vapi.ai/phone-number/${vapiPhoneId}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${vapiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        assistantId: ASSISTANT_ID,
        fallbackDestination: { type: 'number', number: FALLBACK },
      }),
    })
    console.log(`vapi patch -> ${res.status}`)
  }

  const { data: row } = await sb
    .from('twilio_phone_numbers')
    .select('id')
    .eq('organization_id', ORG_ID)
    .eq('e164', NUMBER)
    .maybeSingle()

  if (row) {
    await sb
      .from('twilio_phone_numbers')
      .update({ provider: 'vapi', vapi_phone_number_id: vapiPhoneId, vapi_assistant_id: ASSISTANT_ID })
      .eq('id', row.id)
    console.log('updated twilio_phone_numbers row')
  } else {
    await sb.from('twilio_phone_numbers').insert({
      organization_id: ORG_ID,
      e164: NUMBER,
      phone_sid: tw.sid,
      friendly_name: 'Skleanings | Cleaning',
      capability_voice: true,
      capability_sms: true,
      capability_mms: true,
      is_active: true,
      provider: 'vapi',
      vapi_phone_number_id: vapiPhoneId,
      vapi_assistant_id: ASSISTANT_ID,
    })
    console.log('registered twilio_phone_numbers row')
  }

  // Vapi's import takes the SMS webhook as well as the voice one, and Vapi does
  // not handle this platform's SMS — so an inbound reply would vanish. The
  // Twilio number is the identity (it carries the A2P registration and the
  // local presence); Vapi is only the voice engine behind it. Give messaging
  // back.
  const smsBack = await fetch(numberUrl, {
    method: 'POST',
    headers: { Authorization: `Basic ${twilioAuth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ SmsUrl: 'https://xphere.app/api/twilio/sms', SmsMethod: 'POST' }),
  })
  console.log(`sms webhook returned to xphere -> ${smsBack.status}`)

  const after = await twilioNumber(blob.account_sid, twilioAuth)
  console.log(`\ntwilio voice_url now: ${oneLine(after.voice_url)}`)
  console.log(`twilio sms_url   now: ${oneLine(after.sms_url)}`)
  console.log(`done — ${NUMBER} answers with the robot, falling back to ${FALLBACK}.`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
