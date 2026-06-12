// src/lib/calls/twiml-builder.ts
// TwiML response generators (SEED-007).
//
// Twilio expects an XML response with <Response>…</Response>. We build it as a
// string (TwiML has a tiny, fixed surface | no need for a builder library) and
// escape user-controlled values defensively.

const RECORDING_STATUS_PATH = '/api/twilio/recording'
const CALL_STATUS_PATH = '/api/twilio/status'

/** XML-escape a value before inlining into TwiML. */
export function xmlEscape(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

export interface TwimlContext {
  /** Public base URL (e.g. https://xphere.app) | used for recording/status callbacks */
  baseUrl: string
  recordCalls: boolean
  callerId?: string
}

function recordingAttrs(record: boolean, baseUrl: string): string {
  if (!record) return ''
  const cb = xmlEscape(`${baseUrl.replace(/\/$/, '')}${RECORDING_STATUS_PATH}`)
  return ` record="record-from-answer" recordingStatusCallback="${cb}" recordingStatusCallbackMethod="POST" recordingStatusCallbackEvent="completed"`
}

function dialAttrs(record: boolean, baseUrl: string, callerId?: string): string {
  const parts: string[] = [`timeout="30"`]
  if (callerId) parts.push(`callerId="${xmlEscape(callerId)}"`)
  parts.push(`action="${xmlEscape(`${baseUrl.replace(/\/$/, '')}${CALL_STATUS_PATH}`)}"`)
  parts.push(recordingAttrs(record, baseUrl).trim())
  return parts.filter(Boolean).join(' ')
}

/**
 * Mode A | phone_forward: dial a real phone number.
 *   <Response><Dial><Number>{phone}</Number></Dial></Response>
 */
export function twimlForwardToPhone(
  phone: string,
  ctx: TwimlContext,
): string {
  const number = xmlEscape(phone)
  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<Response>`,
    `  <Dial ${dialAttrs(ctx.recordCalls, ctx.baseUrl, ctx.callerId)}>`,
    `    <Number>${number}</Number>`,
    `  </Dial>`,
    `</Response>`,
  ].join('\n')
}

/**
 * Mode B | sip: route to a Twilio SIP domain (Zoiper/softphone).
 *   <Response><Dial><Sip>{sip_uri}</Sip></Dial></Response>
 */
export function twimlForwardToSip(
  sipUri: string,
  ctx: TwimlContext,
): string {
  const uri = xmlEscape(sipUri)
  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<Response>`,
    `  <Dial ${dialAttrs(ctx.recordCalls, ctx.baseUrl, ctx.callerId)}>`,
    `    <Sip>${uri}</Sip>`,
    `  </Dial>`,
    `</Response>`,
  ].join('\n')
}

/**
 * Mode C | browser: route to a Twilio Voice SDK Client identity.
 *   <Response><Dial><Client>{identity}</Client></Dial></Response>
 */
export function twimlForwardToClient(
  identity: string,
  ctx: TwimlContext,
): string {
  const id = xmlEscape(identity)
  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<Response>`,
    `  <Dial ${dialAttrs(ctx.recordCalls, ctx.baseUrl, ctx.callerId)}>`,
    `    <Client>${id}</Client>`,
    `  </Dial>`,
    `</Response>`,
  ].join('\n')
}

/**
 * Multi-target stage dial (routing chains). Rings every noun in parallel inside
 * a single <Dial> (first to answer wins, the rest stop). On no-answer the
 * `action` callback (POST) hits the chain-continue endpoint which advances to
 * the next stage. `timeoutSeconds` controls how long the stage rings (~5 rings).
 */
export function twimlDialStage(
  nouns: { clients: string[]; numbers: string[]; sips: string[] },
  ctx: TwimlContext,
  opts: { timeoutSeconds: number; actionUrl: string },
): string {
  const inner: string[] = []
  for (const c of nouns.clients) inner.push(`    <Client>${xmlEscape(c)}</Client>`)
  for (const n of nouns.numbers) inner.push(`    <Number>${xmlEscape(n)}</Number>`)
  for (const s of nouns.sips) inner.push(`    <Sip>${xmlEscape(s)}</Sip>`)

  const timeout = Math.max(5, Math.min(120, Math.floor(opts.timeoutSeconds || 30)))
  const parts: string[] = [`timeout="${timeout}"`]
  if (ctx.callerId) parts.push(`callerId="${xmlEscape(ctx.callerId)}"`)
  parts.push(`action="${xmlEscape(opts.actionUrl)}"`)
  parts.push(`method="POST"`)
  const rec = recordingAttrs(ctx.recordCalls, ctx.baseUrl).trim()
  if (rec) parts.push(rec)

  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<Response>`,
    `  <Dial ${parts.filter(Boolean).join(' ')}>`,
    ...inner,
    `  </Dial>`,
    `</Response>`,
  ].join('\n')
}

/**
 * Empty acknowledgement TwiML | used when we can't find a routing target and
 * want to drop the call gracefully without 4xx-ing Twilio (which would trigger
 * retries).
 */
export function twimlReject(message?: string): string {
  if (message) {
    return [
      `<?xml version="1.0" encoding="UTF-8"?>`,
      `<Response>`,
      `  <Say voice="alice">${xmlEscape(message)}</Say>`,
      `  <Hangup/>`,
      `</Response>`,
    ].join('\n')
  }
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>`
}

/**
 * Outbound dialer TwiML | used when the Twilio Voice SDK initiates a call from
 * the browser. The TwiML App points at /api/twilio/voice with `To=<E.164>` and
 * routes that number out via the connected number.
 */
export function twimlOutboundDial(
  to: string,
  ctx: TwimlContext,
): string {
  const number = xmlEscape(to)
  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<Response>`,
    `  <Dial ${dialAttrs(ctx.recordCalls, ctx.baseUrl, ctx.callerId)}>`,
    `    <Number>${number}</Number>`,
    `  </Dial>`,
    `</Response>`,
  ].join('\n')
}
