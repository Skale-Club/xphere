// src/lib/zernio/whatsapp-templates.ts
//
// WhatsApp template messaging via Zernio (official Meta Cloud API under the
// hood, so the 24h customer-service window applies — outside it only an
// approved TEMPLATE can be delivered).
//
// Zernio has no single-call template send. The documented flow is a 3-step
// broadcast targeting one recipient:
//   1. POST /broadcasts                       -> create (needs profileId+accountId+template)
//   2. POST /broadcasts/{id}/recipients       -> { phones: [E.164] }
//   3. POST /broadcasts/{id}/send             -> { sent, failed }
//
// Template library:  GET /whatsapp/templates?accountId=...
//
// Docs: https://docs.zernio.com/platforms/whatsapp

import { zernioFetchJson } from './client'

export interface ZernioTemplateComponent {
  type: string // BODY | HEADER | FOOTER | BUTTONS
  text?: string
  format?: string // for HEADER: TEXT | IMAGE | ...
}

export interface ZernioWhatsappTemplate {
  name: string
  status: string // APPROVED | PENDING | REJECTED
  language: string
  category?: string
  components?: ZernioTemplateComponent[]
}

/** Count `{{n}}` placeholders in a component's text. */
function countPlaceholders(text: string | undefined | null): number {
  if (!text) return 0
  const matches = text.match(/\{\{\s*\d+\s*\}\}/g)
  if (!matches) return 0
  // Distinct indices, so "{{1}} ... {{1}}" counts once.
  const indices = new Set(matches.map((m) => m.replace(/[^\d]/g, '')))
  return indices.size
}

export function zernioBodyComponent(t: ZernioWhatsappTemplate): ZernioTemplateComponent | undefined {
  return t.components?.find((c) => c.type?.toUpperCase() === 'BODY')
}

export function zernioHeaderTextComponent(t: ZernioWhatsappTemplate): ZernioTemplateComponent | undefined {
  return t.components?.find(
    (c) => c.type?.toUpperCase() === 'HEADER' && (c.format ?? 'TEXT').toUpperCase() === 'TEXT',
  )
}

export function zernioTemplateBodyVarCount(t: ZernioWhatsappTemplate): number {
  return countPlaceholders(zernioBodyComponent(t)?.text)
}

export function zernioTemplateHeaderVarCount(t: ZernioWhatsappTemplate): number {
  return countPlaceholders(zernioHeaderTextComponent(t)?.text)
}

// ── Account discovery ────────────────────────────────────────────────────────

export interface ZernioAccount {
  id: string
  name: string
  platform: string
  username?: string
}

/**
 * GET /accounts — list all accounts in the workspace, filtered to WhatsApp.
 * Used to discover the accountId required for template operations.
 */
export async function listZernioWhatsAppAccounts(
  apiKey: string,
): Promise<ZernioAccount[]> {
  const data = await zernioFetchJson<{
    accounts?: Array<Record<string, unknown>>
  }>('/accounts', 'GET', null, apiKey)
  const all = data.accounts ?? []
  return all
    .filter((a) => {
      const p = ((a.platform ?? a.type ?? '') as string).toLowerCase()
      return p === 'whatsapp'
    })
    .map((a) => ({
      id: ((a._id ?? a.id) as string | undefined) ?? '',
      name: ((a.name ?? a.username ?? a._id ?? a.id) as string | undefined) ?? '',
      platform: 'whatsapp',
      username: (a.username as string | undefined) ?? undefined,
    }))
    .filter((a) => Boolean(a.id))
}

// ── Template creation ─────────────────────────────────────────────────────────

export interface ZernioCreateTemplateInput {
  name: string
  category: 'UTILITY' | 'MARKETING' | 'AUTHENTICATION'
  language: string
  headerText?: string | null
  bodyText: string
  footerText?: string | null
  buttons?: Array<{ type: 'URL' | 'QUICK_REPLY'; text: string; url?: string }>
  libraryTemplateName?: string | null
}

/**
 * POST /whatsapp/templates — submit a new template for Meta/WhatsApp review.
 * Returns the template name and initial status (usually PENDING).
 */
export async function createZernioWhatsappTemplateApi(
  accountId: string,
  apiKey: string,
  input: ZernioCreateTemplateInput,
): Promise<{ ok: true; name: string; status: string } | { ok: false; error: string }> {
  const components: Array<Record<string, unknown>> = []

  if (input.headerText?.trim()) {
    components.push({ type: 'HEADER', format: 'TEXT', text: input.headerText.trim() })
  }

  components.push({ type: 'BODY', text: input.bodyText })

  if (input.footerText?.trim()) {
    components.push({ type: 'FOOTER', text: input.footerText.trim() })
  }

  if (input.buttons && input.buttons.length > 0) {
    components.push({
      type: 'BUTTONS',
      buttons: input.buttons.map((b) =>
        b.type === 'URL'
          ? { type: 'URL', text: b.text, url: b.url ?? '' }
          : { type: 'QUICK_REPLY', text: b.text },
      ),
    })
  }

  const body: Record<string, unknown> = {
    accountId,
    name: input.name,
    category: input.category,
    language: input.language,
    components,
  }

  if (input.libraryTemplateName?.trim()) {
    body.library_template_name = input.libraryTemplateName.trim()
  }

  try {
    const data = await zernioFetchJson<Record<string, unknown>>(
      '/whatsapp/templates',
      'POST',
      body,
      apiKey,
    )
    const name = (data.name ?? input.name) as string
    const status = (data.status ?? 'PENDING') as string
    return { ok: true, name, status }
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Zernio template creation failed.',
    }
  }
}

// ── Template list ─────────────────────────────────────────────────────────────

/** GET /whatsapp/templates?accountId=... — returns the account's templates. */
export async function listZernioWhatsappTemplates(
  accountId: string,
  apiKey: string,
): Promise<ZernioWhatsappTemplate[]> {
  const data = await zernioFetchJson<{ templates?: ZernioWhatsappTemplate[] }>(
    `/whatsapp/templates?accountId=${encodeURIComponent(accountId)}`,
    'GET',
    null,
    apiKey,
  )
  return data.templates ?? []
}

/**
 * Resolve the profileId that owns `accountId` (broadcasts require it, but the
 * inbound webhook never carries it). Defensive against the documented response
 * shape ambiguity: try the account's own profile field, else fall back to the
 * sole profile when the workspace has exactly one.
 */
export async function resolveZernioProfileId(
  accountId: string,
  apiKey: string,
): Promise<string | null> {
  // 1) Accounts list may expose the owning profile id.
  try {
    const data = await zernioFetchJson<{ accounts?: Array<Record<string, unknown>> }>(
      '/accounts',
      'GET',
      null,
      apiKey,
    )
    const match = (data.accounts ?? []).find(
      (a) => (a._id ?? a.id) === accountId,
    )
    if (match) {
      const profile = match.profile as Record<string, unknown> | undefined
      const pid =
        (match.profileId as string | undefined) ??
        (match.profile_id as string | undefined) ??
        (profile?._id as string | undefined) ??
        (profile?.id as string | undefined)
      if (typeof pid === 'string' && pid) return pid
    }
  } catch {
    // fall through to single-profile resolution
  }

  // 2) Single-profile workspace — use the only profile.
  try {
    const data = await zernioFetchJson<{ profiles?: Array<Record<string, unknown>> }>(
      '/profiles',
      'GET',
      null,
      apiKey,
    )
    const profiles = data.profiles ?? []
    if (profiles.length === 1) {
      const pid = (profiles[0]._id ?? profiles[0].id) as string | undefined
      if (typeof pid === 'string' && pid) return pid
    }
  } catch {
    // ignore
  }

  return null
}

export interface SendZernioTemplateInput {
  apiKey: string
  profileId: string
  accountId: string
  /** Recipient phone in E.164 (with or without leading +). */
  phone: string
  templateName: string
  language: string
  /** Positional body variable values (replace {{1}}, {{2}}, …). */
  bodyVariables?: string[]
  /** Positional header text variable values. */
  headerVariables?: string[]
  /** Optional human label for the broadcast (defaults to a re-engage label). */
  broadcastName?: string
}

export type SendZernioTemplateResult =
  | { ok: true; broadcastId: string; sent: number; failed: number }
  | { ok: false; error: string }

/** Build Meta-style template components from positional variable values. */
function buildComponents(
  bodyVariables: string[] = [],
  headerVariables: string[] = [],
): Array<Record<string, unknown>> {
  const components: Array<Record<string, unknown>> = []
  if (headerVariables.length > 0) {
    components.push({
      type: 'header',
      parameters: headerVariables.map((text) => ({ type: 'text', text })),
    })
  }
  if (bodyVariables.length > 0) {
    components.push({
      type: 'body',
      parameters: bodyVariables.map((text) => ({ type: 'text', text })),
    })
  }
  return components
}

/**
 * Send an approved WhatsApp template to a single recipient via the Zernio
 * broadcast flow. Used to re-open a conversation after the 24h window closes.
 */
export async function sendZernioWhatsappTemplate(
  input: SendZernioTemplateInput,
): Promise<SendZernioTemplateResult> {
  const {
    apiKey,
    profileId,
    accountId,
    phone,
    templateName,
    language,
    bodyVariables = [],
    headerVariables = [],
    broadcastName,
  } = input

  const components = buildComponents(bodyVariables, headerVariables)

  try {
    // 1. Create the broadcast with the approved template.
    const created = await zernioFetchJson<{
      broadcast?: { _id?: string; id?: string }
      _id?: string
      id?: string
    }>(
      '/broadcasts',
      'POST',
      {
        profileId,
        accountId,
        platform: 'whatsapp',
        name: broadcastName ?? `Re-engage ${phone}`,
        template: {
          name: templateName,
          language,
          ...(components.length > 0 ? { components } : {}),
        },
      },
      apiKey,
    )
    const broadcastId =
      created.broadcast?._id ?? created.broadcast?.id ?? created._id ?? created.id
    if (!broadcastId) {
      return { ok: false, error: 'Zernio did not return a broadcast id.' }
    }

    // 2. Add the single recipient.
    await zernioFetchJson(
      `/broadcasts/${encodeURIComponent(broadcastId)}/recipients`,
      'POST',
      { phones: [phone] },
      apiKey,
    )

    // 3. Send.
    const result = await zernioFetchJson<{ sent?: number; failed?: number }>(
      `/broadcasts/${encodeURIComponent(broadcastId)}/send`,
      'POST',
      {},
      apiKey,
    )
    const sent = result.sent ?? 0
    const failed = result.failed ?? 0
    if (sent === 0 && failed > 0) {
      return { ok: false, error: 'Zernio reported the template delivery failed.' }
    }
    return { ok: true, broadcastId, sent, failed }
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Zernio template send failed.',
    }
  }
}
