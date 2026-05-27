import { z } from 'zod'
import { composeContactName, splitContactName } from '@/lib/contacts/names'

export const CONTACT_SOURCES = [
  'manual',
  'whatsapp',
  'sms',
  'instagram',
  'facebook',
  'messenger',
  'csv_import',
  'ghl_sync',
] as const
export type ContactSourceLiteral = (typeof CONTACT_SOURCES)[number]

/**
 * Normalises a phone string to a loose E.164-ish form: keeps a leading "+" and
 * strips everything that isn't a digit. The platform doesn't enforce strict
 * E.164 yet (legacy data may be inconsistent), but de-duplication relies on
 * the normalised form.
 */
export function normalisePhone(input: string | null | undefined): string | null {
  if (!input) return null
  const trimmed = input.trim()
  if (!trimmed) return null
  const plus = trimmed.startsWith('+') ? '+' : ''
  const digits = trimmed.replace(/[^0-9]/g, '')
  if (!digits) return null
  return plus + digits
}

const PLACEHOLDER_EMAILS = new Set([
  'noemail@email.com',
  'test@test.com',
  'none@none.com',
  'no@email.com',
  'fake@fake.com',
  'noreply@noreply.com',
  'example@example.com',
])

export function normaliseEmail(input: string | null | undefined): string | null {
  if (!input) return null
  const trimmed = input.trim().toLowerCase()
  return trimmed || null
}

export function isPlaceholderEmail(email: string | null | undefined): boolean {
  if (!email) return false
  return PLACEHOLDER_EMAILS.has(email.trim().toLowerCase())
}

export function isValidEmail(input: string | null | undefined): boolean {
  const trimmed = input?.trim()
  if (!trimmed) return false
  return z.string().email().safeParse(trimmed).success
}

/**
 * Form-facing schema: validates shape without transforming. Strings stay
 * strings (with trimming) so react-hook-form's input/output types line up.
 * Normalisation (phone → E.164-ish, email → lowercased) happens at the call
 * site via {@link normaliseContactInput} before we hit Supabase.
 */
export const contactSchema = z
  .object({
    first_name: z.string().trim().max(100).optional(),
    last_name: z.string().trim().max(100).optional(),
    name: z.string().trim().max(200).optional(),
    phone: z.string().trim().max(40).optional(),
    email: z
      .string()
      .trim()
      .max(200)
      .optional()
      .refine(
        (v) => !v || isValidEmail(v),
        'Enter a valid email address',
      ),
    company: z.string().trim().max(500).optional(),
    account_id: z.string().uuid().nullable().optional(),
    notes: z.string().trim().max(5000).optional(),
    tags: z.array(z.string().trim().min(1).max(40)).max(50).default([]),
    source: z.enum(CONTACT_SOURCES).default('manual'),
    custom_fields: z.record(z.string(), z.unknown()).optional().default({}),
  })
  // Intentionally stricter than the DB invariant. Forms always provide a
  // display name; this refine ensures form callers don't submit empty rows.
  // The DB-level constraint trigger `enforce_contact_identity_at_commit`
  // (Phase 109, migration 1061) enforces a looser invariant: phone OR email
  // OR at least one channel identity. Webhooks bypass this Zod schema and
  // rely on the DB invariant. Do NOT relax this refine to match the DB —
  // doing so would let users submit name-less form data.
  .refine(
    (v) => Boolean(v.first_name || v.last_name || v.name || v.phone || v.email),
    { message: 'Provide at least a name, phone, or email', path: ['first_name'] },
  )

export type ContactFormInput = z.input<typeof contactSchema>
export type ContactFormOutput = z.output<typeof contactSchema>

/**
 * Normalises a validated form value to the DB-ready shape:
 *   * empty strings → null
 *   * phone → E.164-loose
 *   * email → lowercased
 * Use after {@link contactSchema} has accepted the payload.
 */
export interface NormalisedContact {
  first_name: string | null
  last_name: string | null
  name: string | null
  phone: string | null
  email: string | null
  company: string | null
  account_id: string | null
  notes: string | null
  tags: string[]
  source: ContactSourceLiteral
}

export function normaliseContactInput(input: ContactFormOutput): NormalisedContact {
  const blank = (v: string | undefined): string | null =>
    v && v.trim().length > 0 ? v.trim() : null
  const legacyName = blank(input.name)
  const split = splitContactName(legacyName)
  const firstName = blank(input.first_name) ?? split.firstName
  const lastName = blank(input.last_name) ?? split.lastName
  return {
    first_name: firstName,
    last_name: lastName,
    name: composeContactName(firstName, lastName) ?? legacyName,
    phone: normalisePhone(input.phone ?? null),
    email: normaliseEmail(input.email ?? null),
    company: blank(input.company),
    account_id: input.account_id ?? null,
    notes: blank(input.notes),
    tags: input.tags,
    source: input.source,
  }
}

export const contactListFiltersSchema = z.object({
  q: z.string().trim().max(200).optional(),
  tag: z.string().trim().max(40).optional(),
  source: z.enum(CONTACT_SOURCES).optional(),
  sort: z.string().default('recent'),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(25),
})

export type ContactListFilters = z.output<typeof contactListFiltersSchema>
