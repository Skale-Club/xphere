import { z } from 'zod'
import type { AccountSource } from '@/types/database'

/**
 * Size buckets per SEED-016. Free-text in the DB (CHECK list only on source),
 * but the form/UI restricts to these values. CSV import accepts arbitrary
 * strings | the v2.4 importer does not enforce size membership.
 */
export const ACCOUNT_SIZES = ['1-10', '11-50', '51-200', '201-1000', '1000+'] as const
export type AccountSizeLiteral = (typeof ACCOUNT_SIZES)[number]

/** Mirrors the source CHECK list in 064_accounts.sql. */
export const ACCOUNT_SOURCES = [
  'manual',
  'auto_from_contact_company',
  'csv_import',
  'ghl_sync',
] as const satisfies readonly AccountSource[]

const uuid = z.string().uuid()
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v && v.length > 0 ? v : null))

/**
 * Form-facing schema. `name` is required (non-empty after trim). Every other
 * attribute is optional/nullable. Tags constrained to <= 50 items; each tag
 * trimmed and 1..40 chars. custom_fields is a raw record | the structured
 * definitions layer lands in Phase 68 (SEED-017).
 */
export const accountSchema = z.object({
  name: z.string().trim().min(1, 'Account name is required').max(500),
  domain: optionalText(255),
  website: optionalText(500),
  industry: optionalText(200),
  size: optionalText(50), // free-text, UI restricts to ACCOUNT_SIZES
  phone: optionalText(40),
  address: optionalText(1000),
  notes: optionalText(5000),
  tags: z.array(z.string().trim().min(1).max(40)).max(50).optional().default([]),
  custom_fields: z.record(z.string(), z.unknown()).optional().default({}),
  external_id: optionalText(255),
  source: z.enum(ACCOUNT_SOURCES).optional().default('manual'),
  assigned_to: uuid.nullish().transform((v) => v ?? null),
})

export type AccountInput = z.input<typeof accountSchema>
export type AccountInputParsed = z.output<typeof accountSchema>

/**
 * List-filter schema for getAccounts. Mirrors contactListFiltersSchema's
 * pagination contract (1-indexed page, pageSize 1..100).
 */
export const accountListFiltersSchema = z.object({
  q: z.string().trim().max(200).optional(),
  industry: z.string().trim().max(200).optional(),
  size: z.string().trim().max(50).optional(),
  tag: z.string().trim().max(40).optional(),
  assignedTo: uuid.optional(),
  source: z.enum(ACCOUNT_SOURCES).optional(),
  sort: z.enum(['name', 'recent']).default('name'),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(25),
})

export type AccountListFilters = z.output<typeof accountListFiltersSchema>

/**
 * Merge schema. primaryId is the surviving account; secondaryIds are merged
 * into it and then deleted. Cannot merge an account into itself.
 */
export const mergeAccountsSchema = z
  .object({
    primaryId: uuid,
    secondaryIds: z.array(uuid).min(1, 'At least one secondaryId required').max(50),
  })
  .refine((v) => !v.secondaryIds.includes(v.primaryId), {
    message: 'primaryId cannot appear in secondaryIds',
    path: ['secondaryIds'],
  })

export type MergeAccountsInput = z.input<typeof mergeAccountsSchema>

/** Used by linkContactToAccount(contactId, accountId). */
export const linkContactToAccountSchema = z.object({
  contactId: uuid,
  accountId: uuid,
})

export type LinkContactToAccountInput = z.input<typeof linkContactToAccountSchema>

/** Used by createAccountFromContact(contactId). */
export const createAccountFromContactSchema = z.object({
  contactId: uuid,
})

export type CreateAccountFromContactInput = z.input<typeof createAccountFromContactSchema>
