/**
 * CSV helpers for the accounts importer (ACC-17).
 *
 * Re-exports the canonical parser from @/lib/contacts/csv | do NOT
 * duplicate the parsing implementation. Defines the account-specific
 * field list and the heuristic header→field mapper used by the import
 * wizard UI (Phase 66) and the server action below.
 */

export { parseCsv, type ParsedCsv } from '@/lib/contacts/csv'

export const ACCOUNT_CSV_FIELDS = [
  'name',
  'domain',
  'website',
  'industry',
  'size',
  'phone',
  'address',
  'notes',
  'tags',
  'source',
] as const

export type AccountCsvField = (typeof ACCOUNT_CSV_FIELDS)[number]

/**
 * Heuristic suggestion: given a CSV's headers, map each one to either an
 * AccountCsvField or null (skip). The UI lets the user override before
 * importing. Returns a Record keyed by the ORIGINAL header (so case and
 * punctuation are preserved in the UI).
 */
export function suggestAccountColumnMapping(
  headers: string[],
): Record<string, AccountCsvField | null> {
  const map: Record<string, AccountCsvField | null> = {}
  for (const h of headers) {
    const key = h.toLowerCase().trim()
    if (/^(name|company[_ ]?name|company|account[_ ]?name|empresa|nome)$/.test(key)) {
      map[h] = 'name'
    } else if (/^(domain|email[_ ]?domain|dominio)$/.test(key)) {
      map[h] = 'domain'
    } else if (/^(website|site|url|web|homepage)$/.test(key)) {
      map[h] = 'website'
    } else if (/^(industry|sector|vertical|setor|industria)$/.test(key)) {
      map[h] = 'industry'
    } else if (/^(size|company[_ ]?size|employees|tamanho|funcionarios)$/.test(key)) {
      map[h] = 'size'
    } else if (/^(phone|telephone|tel|telefone)$/.test(key)) {
      map[h] = 'phone'
    } else if (/^(address|street|endereco|endereço)$/.test(key)) {
      map[h] = 'address'
    } else if (/^(notes?|observation|obs|notas|observacao)$/.test(key)) {
      map[h] = 'notes'
    } else if (/^(tags?|labels?|rotulos)$/.test(key)) {
      map[h] = 'tags'
    } else if (/^source$/.test(key)) {
      map[h] = 'source'
    } else {
      map[h] = null
    }
  }
  return map
}
