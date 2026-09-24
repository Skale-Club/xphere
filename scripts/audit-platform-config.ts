// Read-only audit of the platform's live configuration.
//
// Written after a day in which every problem found was a CONFIGURATION problem
// that no code path could have caught: a cleaning company's calendar in the
// wrong timezone, a barbershop's vocabulary on a cleaner's phone line, one
// tenant's marketing playbook running inside eight others, a number labelled
// one thing in Twilio and another here. RLS separates data. Nothing separates
// meaning. This does the proof-reading.
//
// It reads Supabase, every Twilio account we hold credentials for, and every
// Vapi account, then cross-checks them. It writes nothing. Findings are ranked
// so the first line is the worst thing.
//
//   npx tsx --env-file=.env.local scripts/audit-platform-config.ts
//   npx tsx --env-file=.env.local scripts/audit-platform-config.ts --org=<uuid>

import { createServiceRoleClient } from '@/lib/supabase/admin'
import { decrypt } from '@/lib/crypto'

type Severity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW'
interface Finding {
  severity: Severity
  area: string
  org: string
  what: string
  detail?: string
}

const findings: Finding[] = []
const add = (severity: Severity, area: string, org: string, what: string, detail?: string) =>
  findings.push({ severity, area, org, what, detail })

/** Orgs created by test suites; not tenants. Their names carry a fixture prefix and a timestamp. */
const isTestOrg = (name: string) =>
  /^(metrics|contacts|test|rls|p36|pipe|opp-move|ZZ )/i.test(name) || /-\d{13}-[a-z0-9]{5}$/.test(name)

const BRANDS = [
  'Skleanings', 'Skale Club', 'Cuts & Culture', 'VitaCell', 'GT Home', 'WG Construction',
  'Fluenverse', 'XmartMenu', 'Xareable', 'Xtimator', 'Bigode',
]

async function main() {
  const onlyOrg = process.argv.find((a) => a.startsWith('--org='))?.split('=')[1]
  const sb = createServiceRoleClient()

  const { data: orgRows } = await sb.from('organizations').select('id, name, timezone, service_location_mode')
  const orgs = (orgRows ?? []).filter((o) => !isTestOrg(o.name) && (!onlyOrg || o.id === onlyOrg))
  const orgName = Object.fromEntries((orgRows ?? []).map((o) => [o.id, o.name]))
  console.log(`auditing ${orgs.length} organization(s)\n`)

  // ─── Credentials: every Twilio and Vapi account reachable ───────────────
  const { data: integrations } = await sb
    .from('integrations')
    .select('id, organization_id, provider, name, is_active, encrypted_api_key, location_id, health_status, last_error')

  const twilioNumbers = new Map<string, { account: string; friendly: string; voiceUrl: string; smsUrl: string; sms: boolean }>()
  const twilioAccountsSeen = new Set<string>()
  for (const i of integrations ?? []) {
    if (i.provider !== 'twilio' || !i.is_active || !i.encrypted_api_key) continue
    if (isTestOrg(orgName[i.organization_id] ?? '')) continue
    try {
      const blob = JSON.parse(await decrypt(i.encrypted_api_key)) as Record<string, string>
      if (!blob.account_sid || !blob.auth_token || twilioAccountsSeen.has(blob.account_sid)) continue
      twilioAccountsSeen.add(blob.account_sid)
      const auth = Buffer.from(`${blob.account_sid}:${blob.auth_token}`).toString('base64')
      const H = { Authorization: `Basic ${auth}` }
      const accounts = (await (await fetch('https://api.twilio.com/2010-04-01/Accounts.json?PageSize=100', { headers: H })).json()) as {
        accounts?: { sid: string; friendly_name: string; auth_token?: string }[]
      }
      for (const acct of accounts.accounts ?? [{ sid: blob.account_sid, friendly_name: '?' }]) {
        const subAuth = acct.auth_token
          ? Buffer.from(`${acct.sid}:${acct.auth_token}`).toString('base64')
          : auth
        const nums = (await (
          await fetch(`https://api.twilio.com/2010-04-01/Accounts/${acct.sid}/IncomingPhoneNumbers.json?PageSize=100`, {
            headers: { Authorization: `Basic ${subAuth}` },
          })
        ).json()) as { incoming_phone_numbers?: Record<string, unknown>[] }
        for (const n of nums.incoming_phone_numbers ?? []) {
          twilioNumbers.set(String(n.phone_number), {
            account: acct.friendly_name,
            friendly: String(n.friendly_name ?? ''),
            voiceUrl: String(n.voice_url ?? ''),
            smsUrl: String(n.sms_url ?? ''),
            sms: Boolean((n.capabilities as Record<string, boolean> | undefined)?.sms),
          })
        }
      }
    } catch (e) {
      add('HIGH', 'integrations', orgName[i.organization_id], 'Twilio credential does not decrypt or does not authenticate', String(e).slice(0, 120))
    }
  }
  console.log(`twilio: ${twilioAccountsSeen.size} account tree(s), ${twilioNumbers.size} number(s)`)

  interface VapiAssistant {
    id: string
    name?: string
    serverMessages?: string[] | null
    model?: { tools?: unknown[]; toolIds?: string[]; messages?: { role: string; content: string }[] }
    server?: { url?: string }
  }
  const vapiAssistants = new Map<string, VapiAssistant & { key: string }>()
  const vapiNumbers = new Map<string, { assistantId?: string; fallback?: string; serverUrl?: string; hasSecret: boolean }>()
  const vapiKeysSeen = new Set<string>()
  for (const i of integrations ?? []) {
    if (i.provider !== 'vapi' || !i.is_active || !i.encrypted_api_key) continue
    if (isTestOrg(orgName[i.organization_id] ?? '')) continue
    try {
      const key = await decrypt(i.encrypted_api_key)
      if (vapiKeysSeen.has(key)) continue
      vapiKeysSeen.add(key)
      const H = { Authorization: `Bearer ${key}` }
      const list = (await (await fetch('https://api.vapi.ai/assistant?limit=100', { headers: H })).json()) as VapiAssistant[]
      for (const a of Array.isArray(list) ? list : []) vapiAssistants.set(a.id, { ...a, key })
      const nums = (await (await fetch('https://api.vapi.ai/phone-number?limit=100', { headers: H })).json()) as {
        number?: string
        assistantId?: string
        fallbackDestination?: { number?: string }
        server?: { url?: string; secret?: string; headers?: Record<string, string> }
      }[]
      for (const n of Array.isArray(nums) ? nums : []) {
        if (n.number) {
          vapiNumbers.set(n.number, {
            assistantId: n.assistantId,
            fallback: n.fallbackDestination?.number,
            serverUrl: n.server?.url,
            hasSecret: Boolean(n.server?.secret || n.server?.headers?.['x-vapi-secret']),
          })
        }
      }
    } catch (e) {
      add('HIGH', 'integrations', orgName[i.organization_id], 'Vapi credential does not decrypt or does not authenticate', String(e).slice(0, 120))
    }
  }
  console.log(`vapi: ${vapiKeysSeen.size} account(s), ${vapiAssistants.size} assistant(s), ${vapiNumbers.size} number(s)\n`)

  // ─── Per-org checks ──────────────────────────────────────────────────────
  for (const org of orgs) {
    const O = org.name

    // Integrations: dead or misleading
    const mine = (integrations ?? []).filter((i) => i.organization_id === org.id)
    for (const i of mine) {
      if (i.provider === 'gohighlevel' && i.is_active) {
        add('MEDIUM', 'integrations', O, 'GoHighLevel marked active but GHL is legacy — stale row that misleads', i.name ?? undefined)
      }
      if (i.is_active && i.health_status === 'error') {
        add('HIGH', 'integrations', O, `${i.provider} integration active but in error`, i.last_error ?? undefined)
      }
    }
    const hasXkedule = mine.some((i) => i.provider === 'xkedule' && i.is_active)

    // Timezone: org vs calendar profile
    const { data: profiles } = await sb.from('calendar_profiles').select('slug, timezone').eq('org_id', org.id)
    for (const p of profiles ?? []) {
      if (p.timezone && org.timezone && p.timezone !== org.timezone) {
        add('HIGH', 'calendar', O, `calendar profile "${p.slug}" is in ${p.timezone} but the org is in ${org.timezone}`, 'every slot it offers is off by the difference')
      }
    }

    // Service location vs what Xkedule says the business actually does
    if (hasXkedule) {
      const xk = mine.find((i) => i.provider === 'xkedule' && i.is_active)!
      try {
        const key = await decrypt(xk.encrypted_api_key!)
        const info = (await (
          await fetch(`${String(xk.location_id).replace(/\/$/, '')}/api/v1/business-info`, { headers: { 'X-Xkedule-Key': key } })
        ).json()) as { policies?: { serviceDeliveryModel?: string }; timezone?: string; phone?: string }
        const model = info.policies?.serviceDeliveryModel
        const expected = model === 'at-customer' ? 'at_customer' : model === 'on-premises' || model === 'at-business' ? 'on_premises' : null
        if (expected && org.service_location_mode !== expected) {
          add('HIGH', 'voice', O, `service_location_mode is ${org.service_location_mode} but Xkedule says ${model}`, 'the robot tells callers the opposite of how the business works')
        }
        if (info.timezone && org.timezone && info.timezone !== org.timezone) {
          add('MEDIUM', 'calendar', O, `Xkedule tenant timezone ${info.timezone} ≠ org timezone ${org.timezone}`)
        }
      } catch (e) {
        add('HIGH', 'integrations', O, 'Xkedule integration does not answer business-info', String(e).slice(0, 100))
      }
    }

    // Phone numbers
    const { data: numbers } = await sb
      .from('twilio_phone_numbers')
      .select('e164, friendly_name, is_default, provider, vapi_phone_number_id, vapi_assistant_id, default_routing_mode, forward_to_number, is_active, business_purpose, capability_sms')
      .eq('organization_id', org.id)
      .eq('is_active', true)
    const defaults = (numbers ?? []).filter((n) => n.is_default)
    if (defaults.length > 1) add('HIGH', 'numbers', O, `${defaults.length} numbers marked is_default`, defaults.map((d) => d.e164).join(', '))
    for (const n of numbers ?? []) {
      const tw = twilioNumbers.get(n.e164)
      if (n.provider === 'twilio' && !tw) {
        add('HIGH', 'numbers', O, `${n.e164} registered as Twilio but not found in any Twilio account we hold`, 'stale row, or a credential is missing')
      }
      if (tw && n.friendly_name && !n.friendly_name.includes(tw.friendly.split('|')[0].trim().slice(0, 8))) {
        add('MEDIUM', 'numbers', O, `${n.e164} is "${n.friendly_name}" here but "${tw.friendly}" in Twilio`, 'the Twilio label is the truth')
      }
      if (n.provider === 'vapi') {
        const v = vapiNumbers.get(n.e164)
        if (!v) add('HIGH', 'numbers', O, `${n.e164} marked provider=vapi but not present in any Vapi account`)
        else if (!v.assistantId && !v.serverUrl) add('HIGH', 'voice', O, `${n.e164} is on Vapi with no assistant and no assistant-request server — inbound calls have nothing to answer`)
        else if (!v.assistantId && v.serverUrl && !v.hasSecret) {
          add('MEDIUM', 'security', O, `${n.e164} asks ${v.serverUrl} which assistant to use, with NO shared secret`, 'anyone who finds the URL can answer as Vapi and pick the assistant')
        }
        if (tw && tw.smsUrl && !tw.smsUrl.includes('xphere.app')) {
          add('HIGH', 'numbers', O, `${n.e164} SMS webhook points at ${tw.smsUrl}`, 'Vapi import took the SMS webhook; replies to this number vanish')
        }
      }
      if (n.default_routing_mode === 'forward' && !n.forward_to_number) {
        add('HIGH', 'numbers', O, `${n.e164} routes to forward with no forward_to_number — calls drop`)
      }
    }
    // Shared notifications number used as a real tenant's default sender
    const sharedDefault = defaults.find((d) => d.business_purpose === 'notifications')
    if (sharedDefault && !/demo|cuts & culture/i.test(O)) {
      add('MEDIUM', 'numbers', O, `default SMS sender is the shared notifications number ${sharedDefault.e164}`, 'customer replies land in a box three companies share')
    }

    // Workflows
    const { data: workflows } = await sb
      .from('workflows')
      .select('id, name, kind, tool_name, is_active, current_version_id, trigger_config')
      .eq('org_id', org.id)
      .is('deleted_at', null)
    const active = (workflows ?? []).filter((w) => w.is_active)
    let sendsSms = false
    for (const w of active) {
      if (!w.current_version_id) {
        add('MEDIUM', 'workflows', O, `"${w.name}" is active with no current version`)
        continue
      }
      const { data: v } = await sb.from('workflow_versions').select('definition').eq('id', w.current_version_id).single()
      const def = (v?.definition ?? {}) as { nodes?: { type: string; data?: Record<string, unknown> }[] }
      const text = JSON.stringify(def)

      // Another org's brand in this org's copy
      for (const brand of BRANDS) {
        if (O.includes(brand) || brand.includes(O)) continue
        // 'Xkedule' legitimately appears as action_type xkedule_*; only flag prose.
        const prose = text.replace(/"action_type":"[^"]*"/g, '').replace(/xkedule_[a-z_]+/g, '')
        if (new RegExp(`\\b${brand.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(prose)) {
          add('CRITICAL', 'tenancy', O, `active workflow "${w.name}" carries another company's brand: ${brand}`, 'customers of this org are messaged in someone else\'s name')
        }
      }

      for (const n of def.nodes ?? []) {
        if (n.type !== 'action') continue
        const cfg = (n.data?.config ?? {}) as Record<string, unknown>
        const type = String(n.data?.action_type ?? '')
        if (type === 'send_sms') sendsSms = true
        const to = cfg.to ?? cfg.chat_id
        if (typeof to === 'string' && /^\+\d{8,}$/.test(to)) {
          add('HIGH', 'tenancy', O, `"${w.name}" sends to a hardcoded number ${to}`, 'if this number is in more than one org, one person collects several companies\' data')
        }
        // Currency hardcoded in a multi-tenant default
        if (/R\$\s*\{\{/.test(JSON.stringify(cfg))) add('LOW', 'i18n', O, `"${w.name}" hardcodes R$ in a message`)
        // Portuguese copy going to an end customer in an English-first org
        const body = typeof cfg.body === 'string' ? cfg.body : typeof cfg.text === 'string' ? cfg.text : ''
        if (body && /\b(olá|obrigad|agendamento|reagendar|você)\b/i.test(body) && !/bigode|portugu/i.test(O) && typeof to === 'string' && to.includes('{{')) {
          add('MEDIUM', 'i18n', O, `"${w.name}" sends Portuguese copy to a customer of an English-first org`, body.slice(0, 80))
        }
        // credential_ref pointing nowhere
        const cred = n.data?.credential_ref
        if (typeof cred === 'string' && !(integrations ?? []).some((i) => i.id === cred && i.organization_id === org.id)) {
          add('HIGH', 'workflows', O, `"${w.name}" references credential ${cred.slice(0, 8)}… that is not one of this org's integrations`)
        }
      }
      // Tool workflows must have an input schema somewhere
      if (w.kind === 'tool') {
        const tc = (w.trigger_config ?? {}) as { input_schema?: unknown }
        const inDef = /"input_schema"/.test(text)
        if (!tc.input_schema && !inDef) add('MEDIUM', 'voice', O, `tool "${w.tool_name}" has no input_schema — renders with no parameters`)
      }
    }
    if (sendsSms && defaults.length === 0) {
      add('HIGH', 'numbers', O, 'active workflows send SMS but the org has no default sender number', 'every send fails')
    }

    // Agents and assistants
    const { data: agents } = await sb
      .from('agents')
      .select('id, slug, name, is_active, active_prompt_version_id, system_prompt')
      .eq('organization_id', org.id)
    for (const a of agents ?? []) {
      if (a.is_active && !a.active_prompt_version_id) add('MEDIUM', 'agents', O, `agent "${a.slug}" is active with no published prompt version`)
      if (/\{\{\s*(PERSONA|now|timezone)\s*\}\}/.test(a.system_prompt ?? '')) {
        add('MEDIUM', 'agents', O, `agent "${a.slug}" prompt carries an unrendered placeholder`, (a.system_prompt ?? '').match(/\{\{\s*(PERSONA|now|timezone)\s*\}\}/)?.[0])
      }
      if (/[áéíóúãõçÁÉÍÓÚÃÕÇ]/.test(a.slug) || /^(voz|agente)-/.test(a.slug)) add('LOW', 'i18n', O, `agent slug "${a.slug}" is not English`)
    }

    const { data: mappings } = await sb
      .from('assistant_mappings')
      .select('vapi_assistant_id, entry_agent_id')
      .eq('organization_id', org.id)
    for (const m of mappings ?? []) {
      const a = vapiAssistants.get(m.vapi_assistant_id)
      if (!a) {
        add('MEDIUM', 'voice', O, `mapping to assistant ${m.vapi_assistant_id.slice(0, 8)}… that no Vapi account we hold contains`, 'stale mapping, or deleted assistant')
        continue
      }
      const toolCount = (a.model?.tools?.length ?? 0) + (a.model?.toolIds?.length ?? 0)
      if (toolCount > 0 && Array.isArray(a.serverMessages) && !a.serverMessages.includes('tool-calls')) {
        add('HIGH', 'voice', O, `assistant "${a.name}" has ${toolCount} tool(s) but serverMessages is narrowed to ${JSON.stringify(a.serverMessages)}`, 'the only configuration with real calls behind it is Vapi\'s default')
      }
      for (const tid of a.model?.toolIds ?? []) {
        const r = await fetch(`https://api.vapi.ai/tool/${tid}`, { headers: { Authorization: `Bearer ${a.key}` } })
        if (r.status === 404) add('CRITICAL', 'voice', O, `assistant "${a.name}" references tool ${tid.slice(0, 8)}… which returns 404`, 'the prompt describes a tool the robot cannot call')
      }
      const sys = a.model?.messages?.find((x) => x.role === 'system')?.content ?? ''
      const bad = sys.match(/\{\{\s*(PERSONA|now|timezone)\s*\}\}/)
      if (bad) add('HIGH', 'voice', O, `assistant "${a.name}" live prompt contains ${bad[0]} unrendered`, 'the robot is told "You are {{PERSONA}}"')
      const declared = [...new Set([...sys.matchAll(/^###\s+([a-z_][a-z0-9_]*)\s*$/gim)].map((x) => x[1]))]
      const real = new Set((a.model?.tools ?? []).map((t) => (t as { function?: { name?: string } }).function?.name))
      for (const d of declared) {
        if (!real.has(d) && (a.model?.toolIds?.length ?? 0) === 0) add('HIGH', 'voice', O, `assistant "${a.name}" prompt documents tool "${d}" which it does not have`)
      }
      if (m.entry_agent_id) {
        const ag = (agents ?? []).find((x) => x.id === m.entry_agent_id)
        if (!ag) add('HIGH', 'voice', O, `mapping ${m.vapi_assistant_id.slice(0, 8)}… points at an agent that does not exist`)
        else if (!ag.active_prompt_version_id) add('HIGH', 'voice', O, `assistant "${a.name}" bound to agent "${ag.slug}" which has no published prompt`, 'push hard-errors')
      }
    }

    // Campaigns
    const { data: campaigns } = await sb
      .from('campaigns')
      .select('name, status, channel, vapi_assistant_id, vapi_phone_number_id, is_evergreen')
      .eq('organization_id', org.id)
      .eq('channel', 'calls')
    for (const c of campaigns ?? []) {
      if (['in_progress', 'scheduled'].includes(c.status) && (!c.vapi_assistant_id || !c.vapi_phone_number_id)) {
        add('HIGH', 'campaigns', O, `campaign "${c.name}" is ${c.status} with no assistant or caller-id`, 'the dialler no-ops silently')
      }
    }
    const { data: stuck } = await sb
      .from('campaign_contacts')
      .select('id, called_at')
      .eq('organization_id', org.id)
      .eq('status', 'calling')
      .lt('called_at', new Date(Date.now() - 60 * 60 * 1000).toISOString())
    if ((stuck ?? []).length) add('MEDIUM', 'campaigns', O, `${stuck!.length} campaign_contacts stuck in 'calling' for over an hour`, 'end-of-call report never arrived')
  }

  // ─── Cross-org checks ───────────────────────────────────────────────────
  // Conversations for the same visitor phone in more than one org (shared-number residue)
  const { data: convos } = await sb.from('conversations').select('org_id, visitor_phone').eq('channel', 'sms').limit(2000)
  const byPhone = new Map<string, Set<string>>()
  for (const c of convos ?? []) {
    if (!c.visitor_phone) continue
    if (!byPhone.has(c.visitor_phone)) byPhone.set(c.visitor_phone, new Set())
    byPhone.get(c.visitor_phone)!.add(orgName[c.org_id] ?? c.org_id)
  }
  for (const [phone, set] of byPhone) {
    if (set.size > 1) add('MEDIUM', 'tenancy', [...set].join(' / '), `SMS conversation with ${phone.slice(0, 5)}… exists in ${set.size} orgs`, 'residue of the shared number before the 2026-09-05 routing fix')
  }

  // Assistants in Vapi that no org maps
  const mappedIds = new Set<string>()
  const { data: allMappings } = await sb.from('assistant_mappings').select('vapi_assistant_id')
  for (const m of allMappings ?? []) mappedIds.add(m.vapi_assistant_id)
  for (const [id, a] of vapiAssistants) {
    if (!mappedIds.has(id)) add('LOW', 'voice', '(unmapped)', `Vapi assistant "${a.name}" (${id.slice(0, 8)}…) has no assistant_mappings row`, 'end-of-call reports for it resolve to no org')
  }

  // ─── Report ─────────────────────────────────────────────────────────────
  const order: Severity[] = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']
  findings.sort((a, b) => order.indexOf(a.severity) - order.indexOf(b.severity) || a.area.localeCompare(b.area) || a.org.localeCompare(b.org))
  const counts = Object.fromEntries(order.map((s) => [s, findings.filter((f) => f.severity === s).length]))
  console.log(`\n${'═'.repeat(78)}\n${findings.length} finding(s): ${order.map((s) => `${counts[s]} ${s}`).join(' · ')}\n${'═'.repeat(78)}`)
  let last = ''
  for (const f of findings) {
    if (f.severity !== last) {
      console.log(`\n── ${f.severity} ${'─'.repeat(70 - f.severity.length)}`)
      last = f.severity
    }
    console.log(`[${f.area}] ${f.org}\n   ${f.what}${f.detail ? `\n   ↳ ${f.detail}` : ''}`)
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
