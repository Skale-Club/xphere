// src/lib/evolution/client.ts
// Typed wrapper around the Evolution Go (whatsmeow) REST API.
//
// Evolution Go is a self-hosted WhatsApp gateway | each org runs (or shares)
// its own Evolution Go server and creates one or more "instances" inside it.
// An instance maps to a single WhatsApp account (a phone number, connected via QR).
//
// The base URL + global API token are configured per-org in evolution_instances.
// Tokens are decrypted at call time via lib/evolution/credentials.ts.

const DEFAULT_TIMEOUT_MS = 15_000

export interface EvolutionConfig {
  baseUrl: string
  token: string
}

export interface EvolutionResponse<T = unknown> {
  ok: boolean
  status: number
  data?: T
  error?: string
}

// ---------------------------------------------------------------------------
// Low-level fetch helper | always JSON, never throws, always returns shape
// ---------------------------------------------------------------------------

async function evoFetch<T = unknown>(
  cfg: EvolutionConfig,
  method: 'GET' | 'POST' | 'DELETE',
  path: string,
  body?: unknown,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<EvolutionResponse<T>> {
  const url = `${cfg.baseUrl.replace(/\/$/, '')}${path}`
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const res = await fetch(url, {
      method,
      signal: controller.signal,
      headers: {
        apikey: cfg.token,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
      cache: 'no-store',
    })

    const text = await res.text()
    let parsed: unknown = undefined
    try {
      parsed = text ? JSON.parse(text) : undefined
    } catch {
      parsed = text
    }

    if (!res.ok) {
      const errMsg =
        typeof parsed === 'object' && parsed !== null && 'message' in parsed
          ? String((parsed as { message?: unknown }).message ?? `HTTP ${res.status}`)
          : `HTTP ${res.status}`
      return { ok: false, status: res.status, error: errMsg }
    }

    return { ok: true, status: res.status, data: parsed as T }
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      return { ok: false, status: 0, error: 'Evolution Go timeout' }
    }
    return { ok: false, status: 0, error: err instanceof Error ? err.message : String(err) }
  } finally {
    clearTimeout(timeout)
  }
}

// ---------------------------------------------------------------------------
// Instance lifecycle
// ---------------------------------------------------------------------------

export interface CreateInstanceResult {
  instance?: { instanceName: string; status: string }
  hash?: { apikey: string }
  qrcode?: { base64?: string; code?: string }
}

export async function createInstance(
  cfg: EvolutionConfig,
  instanceName: string,
  webhookUrl?: string,
  webhookByEvents = true,
): Promise<EvolutionResponse<CreateInstanceResult>> {
  return evoFetch<CreateInstanceResult>(cfg, 'POST', '/instance/create', {
    instanceName,
    qrcode: true,
    integration: 'WHATSAPP-BAILEYS',
    webhook: webhookUrl,
    webhook_by_events: webhookByEvents,
    events: [
      'MESSAGES_UPSERT',
      'CONNECTION_UPDATE',
      'QRCODE_UPDATED',
      'CONTACTS_UPSERT',
      'PRESENCE_UPDATE',
    ],
  })
}

export interface ConnectionState {
  state: 'open' | 'close' | 'connecting' | 'qr' | string
  instance?: { instanceName: string; state?: string }
}

export async function getInstanceStatus(
  cfg: EvolutionConfig,
  instanceName: string,
): Promise<EvolutionResponse<ConnectionState>> {
  return evoFetch<ConnectionState>(cfg, 'GET', `/instance/connectionState/${encodeURIComponent(instanceName)}`)
}

export interface QRCodeResult {
  base64?: string   // data:image/png;base64,...
  code?: string     // raw pairing code
  count?: number
}

export async function getQRCode(
  cfg: EvolutionConfig,
  instanceName: string,
): Promise<EvolutionResponse<QRCodeResult>> {
  return evoFetch<QRCodeResult>(cfg, 'GET', `/instance/qrcode/${encodeURIComponent(instanceName)}`)
}

export async function logoutInstance(
  cfg: EvolutionConfig,
  instanceName: string,
): Promise<EvolutionResponse<unknown>> {
  return evoFetch(cfg, 'DELETE', `/instance/logout/${encodeURIComponent(instanceName)}`)
}

export async function deleteInstance(
  cfg: EvolutionConfig,
  instanceName: string,
): Promise<EvolutionResponse<unknown>> {
  return evoFetch(cfg, 'DELETE', `/instance/delete/${encodeURIComponent(instanceName)}`)
}

// Server-level | verifies base_url + token by listing instances
export interface ListedInstance {
  instanceName: string
  status?: string
}
export async function listInstances(cfg: EvolutionConfig): Promise<EvolutionResponse<ListedInstance[]>> {
  return evoFetch<ListedInstance[]>(cfg, 'GET', '/instance/fetchInstances')
}

// ---------------------------------------------------------------------------
// Messaging
// ---------------------------------------------------------------------------

export interface SendTextOptions {
  delayMs?: number          // typing simulation
  quotedMessageId?: string  // reply-to
  mentionsEveryOne?: boolean
  mentioned?: string[]      // E.164 list or JIDs
}

export interface SendResult {
  key?: { id: string; remoteJid: string }
  messageTimestamp?: number
  status?: string
}

export async function sendText(
  cfg: EvolutionConfig,
  instanceName: string,
  to: string,
  text: string,
  opts: SendTextOptions = {},
): Promise<EvolutionResponse<SendResult>> {
  return evoFetch<SendResult>(cfg, 'POST', `/message/sendText/${encodeURIComponent(instanceName)}`, {
    number: to,
    text,
    delay: opts.delayMs ?? 0,
    quoted: opts.quotedMessageId ? { key: { id: opts.quotedMessageId } } : undefined,
    mentionsEveryOne: opts.mentionsEveryOne ?? false,
    mentioned: opts.mentioned,
  })
}

export interface SendMediaUrlOptions extends SendTextOptions {
  mediaType: 'image' | 'video' | 'document' | 'audio'
  fileName?: string
  caption?: string
}

export async function sendMediaUrl(
  cfg: EvolutionConfig,
  instanceName: string,
  to: string,
  mediaUrl: string,
  opts: SendMediaUrlOptions,
): Promise<EvolutionResponse<SendResult>> {
  return evoFetch<SendResult>(cfg, 'POST', `/message/sendMedia/${encodeURIComponent(instanceName)}`, {
    number: to,
    mediatype: opts.mediaType,
    media: mediaUrl,
    fileName: opts.fileName,
    caption: opts.caption,
    delay: opts.delayMs ?? 0,
    mentionsEveryOne: opts.mentionsEveryOne ?? false,
    mentioned: opts.mentioned,
  })
}

/**
 * Mention-all in a WhatsApp group.
 * `groupJid` must be the full group JID (e.g. "120363012345678901@g.us").
 * The `mentionsEveryOne: true` flag tells Evolution Go to ping every participant.
 */
export async function sendGroupMentionAll(
  cfg: EvolutionConfig,
  instanceName: string,
  groupJid: string,
  text: string,
  opts: { mediaUrl?: string; mediaType?: SendMediaUrlOptions['mediaType']; fileName?: string } = {},
): Promise<EvolutionResponse<SendResult>> {
  if (opts.mediaUrl) {
    return sendMediaUrl(cfg, instanceName, groupJid, opts.mediaUrl, {
      mediaType: opts.mediaType ?? 'image',
      fileName: opts.fileName,
      caption: text,
      mentionsEveryOne: true,
    })
  }
  return sendText(cfg, instanceName, groupJid, text, { mentionsEveryOne: true })
}

// ---------------------------------------------------------------------------
// Groups
// ---------------------------------------------------------------------------

export interface GroupParticipant {
  id: string        // JID
  admin?: 'admin' | 'superadmin' | null
}

export interface GroupMetadata {
  id: string
  subject: string
  participants: GroupParticipant[]
}

export async function getGroupParticipants(
  cfg: EvolutionConfig,
  instanceName: string,
  groupJid: string,
): Promise<EvolutionResponse<GroupMetadata>> {
  return evoFetch<GroupMetadata>(
    cfg,
    'GET',
    `/group/participants/${encodeURIComponent(instanceName)}?groupJid=${encodeURIComponent(groupJid)}`,
  )
}
