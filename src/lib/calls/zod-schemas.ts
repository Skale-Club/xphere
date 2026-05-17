// src/lib/calls/zod-schemas.ts
// Zod schemas + helpers shared between server actions, forms, and tests for the
// call system (SEED-007).

import { z } from 'zod'

export const CALL_ROUTING_MODES = ['phone_forward', 'sip', 'browser'] as const
export type CallRoutingModeZ = (typeof CALL_ROUTING_MODES)[number]

// E.164 — basic shape check. Accepts +1 234 567 8901 with non-digit separators.
const E164_RE = /^\+\d{6,16}$/

export function normaliseE164(raw: string | null | undefined): string | null {
  if (!raw) return null
  const trimmed = raw.replace(/[\s\-().]/g, '')
  if (!trimmed) return null
  if (!trimmed.startsWith('+')) return null
  return E164_RE.test(trimmed) ? trimmed : null
}

export const callSettingsFormSchema = z
  .object({
    routing_mode: z.enum(CALL_ROUTING_MODES),
    phone_forward: z.string().nullable().optional(),
    record_calls: z.boolean().default(true),
  })
  .superRefine((data, ctx) => {
    if (data.routing_mode === 'phone_forward') {
      const norm = normaliseE164(data.phone_forward ?? null)
      if (!norm) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['phone_forward'],
          message: 'Phone forward requires a valid E.164 number (+15551234567).',
        })
      }
    }
  })

export type CallSettingsFormInput = z.infer<typeof callSettingsFormSchema>

export const dialerSchema = z.object({
  to: z.string().refine((v) => normaliseE164(v) !== null, {
    message: 'Use a valid E.164 number, e.g. +14155551234.',
  }),
})
export type DialerInput = z.infer<typeof dialerSchema>

export function generateSipUsername(orgSlug: string, userId: string): string {
  // Deterministic-ish: org slug + first 8 chars of user UUID
  const safe = orgSlug.replace(/[^a-z0-9]/gi, '').slice(0, 16).toLowerCase()
  return `${safe || 'op'}_${userId.slice(0, 8)}`
}

export function generateClientIdentity(userId: string): string {
  return `user-${userId.slice(0, 8)}`
}

/**
 * Generate a 24-char alphanumeric password. Used for SIP — never exposed in
 * plaintext after creation (encrypted at rest + revealed once in the UI).
 */
export function generateSipPassword(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'
  const out = new Uint8Array(24)
  crypto.getRandomValues(out)
  let s = ''
  for (let i = 0; i < out.length; i++) s += alphabet[out[i] % alphabet.length]
  return s
}
