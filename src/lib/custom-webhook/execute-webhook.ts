// src/lib/custom-webhook/execute-webhook.ts
// Executor for the custom_webhook action type.
//
// Fires a configurable HTTP request using settings from tool_config.config JSONB.
// {{param_name}} placeholders in the body template are replaced with matching
// tool call parameter values before the request is sent.
//
// Result strings never contain newlines — Vapi's response parser breaks on \n.

import type { Json } from '@/types/database'

interface WebhookConfig {
  url: string
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  headers?: Record<string, string>
  body?: string
}

function parseConfig(raw: Json): WebhookConfig {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error('custom_webhook: tool config must be a JSON object')
  }
  const cfg = raw as Record<string, Json | undefined>
  if (typeof cfg.url !== 'string' || !cfg.url) {
    throw new Error('custom_webhook: missing url in tool config')
  }
  const method = cfg.method
  const allowedMethods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const
  type Method = (typeof allowedMethods)[number]
  const resolvedMethod: Method =
    typeof method === 'string' && (allowedMethods as readonly string[]).includes(method)
      ? (method as Method)
      : 'POST'

  let headers: Record<string, string> | undefined
  if (cfg.headers !== undefined && cfg.headers !== null) {
    if (typeof cfg.headers === 'object' && !Array.isArray(cfg.headers)) {
      headers = Object.fromEntries(
        Object.entries(cfg.headers as Record<string, Json | undefined>)
          .filter(([, v]) => typeof v === 'string')
          .map(([k, v]) => [k, v as string])
      )
    }
  }

  return {
    url: cfg.url,
    method: resolvedMethod,
    headers,
    body: typeof cfg.body === 'string' ? cfg.body : undefined,
  }
}

function replacePlaceholders(template: string, params: Record<string, unknown>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
    const val = params[key]
    return val !== undefined && val !== null ? String(val) : ''
  })
}

function sanitize(text: string): string {
  return text.replace(/\r?\n|\r/g, ' ').trim()
}

function truncate(text: string, max = 200): string {
  if (text.length <= max) return text
  return text.slice(0, max) + '...(truncated)'
}

export async function executeWebhook(
  params: Record<string, unknown>,
  rawConfig: Json
): Promise<string> {
  const cfg = parseConfig(rawConfig)

  const body = cfg.body !== undefined ? replacePlaceholders(cfg.body, params) : undefined

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 10_000)

  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...cfg.headers,
    }

    const res = await fetch(cfg.url, {
      method: cfg.method,
      headers,
      body: body !== undefined ? body : undefined,
      signal: controller.signal,
      cache: 'no-store',
    })

    const responseText = await res.text().catch(() => '')
    const truncatedBody = sanitize(truncate(responseText))
    return `Webhook ${res.status}: ${truncatedBody}`
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      throw new Error(`custom_webhook timed out after 10 seconds (url: ${cfg.url})`)
    }
    throw err
  } finally {
    clearTimeout(timeoutId)
  }
}
