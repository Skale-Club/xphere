import type { Database } from '@/types/database'

/**
 * Discriminated-union return shape for every Phase 65 server action.
 * Locked by phase brief §4 | do NOT switch to the contacts pattern
 * (which uses ad-hoc { id?, error? } objects).
 */
export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; details?: unknown }

export const okResult = <T>(data: T): ActionResult<T> => ({ ok: true, data })

export const errResult = <T = never>(
  error: string,
  details?: unknown,
): ActionResult<T> =>
  details === undefined ? { ok: false, error } : { ok: false, error, details }

/** Account row as returned by Supabase. */
export type AccountRow = Database['public']['Tables']['accounts']['Row']
export type AccountInsert = Database['public']['Tables']['accounts']['Insert']
export type AccountUpdate = Database['public']['Tables']['accounts']['Update']

/** Account + lightweight counts for getAccount detail action. */
export interface AccountWithCounts extends AccountRow {
  contact_count: number
  open_opportunity_count: number
  pipeline_value: number
}

/** Paginated list response. */
export interface AccountListResult {
  rows: AccountWithCounts[]
  total: number
  page: number
  pageSize: number
}

/** Returned by mergeAccounts | counts of records moved + accounts removed. */
export interface MergeAccountsResult {
  moved_contacts: number
  moved_opportunities: number
  deleted_accounts: number
}

/** Returned by importAccountsCsv. */
export interface AccountImportSummary {
  inserted: number
  skipped: number
  errors: Array<{ row: number; field?: string; message: string }>
}

/** Returned by deleteAccount when the account has FK references. */
export interface AccountReferenceCounts {
  contacts: number
  opportunities: number
}

import type { AccountCsvField } from './csv'

/**
 * Returned by previewAccountsCsv. Lives here (NOT inline in the 'use server'
 * actions.ts file) so the server-action module only exports async functions |
 * non-async exports from 'use server' files can be fragile in Next.js.
 */
export interface AccountCsvPreview {
  headers: string[]
  rows: string[][]
  suggestedMapping: Record<string, AccountCsvField | null>
  totalRows: number
}
