/**
 * Tiny RFC-4180-ish CSV parser used by the contact import flow.
 *
 * Why not papaparse? The CSV import is the only place we parse CSV today, the
 * inputs are small (<5MB) and well-formed, and this keeps the install diet
 * lean. Handles quoted fields, embedded commas, escaped quotes ("") and CRLF.
 */
export interface ParsedCsv {
  headers: string[]
  rows: string[][]
}

export function parseCsv(text: string): ParsedCsv {
  const rows: string[][] = []
  let field = ''
  let row: string[] = []
  let inQuotes = false
  let i = 0

  while (i < text.length) {
    const ch = text[i]
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i += 2
          continue
        }
        inQuotes = false
        i++
        continue
      }
      field += ch
      i++
      continue
    }
    if (ch === '"') {
      inQuotes = true
      i++
      continue
    }
    if (ch === ',') {
      row.push(field)
      field = ''
      i++
      continue
    }
    if (ch === '\r') {
      i++
      continue
    }
    if (ch === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
      i++
      continue
    }
    field += ch
    i++
  }
  // Tail row
  if (field.length > 0 || row.length > 0) {
    row.push(field)
    rows.push(row)
  }

  // Drop blank trailing rows
  while (rows.length && rows[rows.length - 1].every((c) => c.trim() === '')) {
    rows.pop()
  }

  if (rows.length === 0) return { headers: [], rows: [] }
  const headers = rows[0].map((h) => h.trim())
  return { headers, rows: rows.slice(1) }
}

/**
 * Like parseCsv but stops after maxDataRows data rows (header always parsed).
 * Use this in server actions to avoid processing 200k rows when only a handful
 * are needed for preview or dry-run.
 */
export function parseCsvLimit(text: string, maxDataRows: number): ParsedCsv {
  const rows: string[][] = []
  let field = ''
  let row: string[] = []
  let inQuotes = false
  let dataRows = 0
  let i = 0

  while (i < text.length) {
    const ch = text[i]
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue }
        inQuotes = false; i++; continue
      }
      field += ch; i++; continue
    }
    if (ch === '"') { inQuotes = true; i++; continue }
    if (ch === ',') { row.push(field); field = ''; i++; continue }
    if (ch === '\r') { i++; continue }
    if (ch === '\n') {
      row.push(field)
      rows.push(row)
      row = []; field = ''; i++
      if (rows.length > 1) { // rows[0] is the header
        dataRows++
        if (dataRows >= maxDataRows) break
      }
      continue
    }
    field += ch; i++
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row) }
  while (rows.length && rows[rows.length - 1].every((c) => c.trim() === '')) rows.pop()
  if (rows.length === 0) return { headers: [], rows: [] }
  return { headers: rows[0].map((h) => h.trim()), rows: rows.slice(1) }
}

/** Fast newline-based row count approximation (does not handle embedded newlines). */
export function countCsvDataRows(text: string): number {
  let n = 0
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\n') n++
  }
  return Math.max(0, n - 1) // subtract header row
}

/**
 * Heuristic column-name → contact field mapping. Lets us auto-pick mappings
 * when the CSV headers are obvious, but the UI lets the user override.
 */
export function suggestColumnMapping(
  headers: string[],
): Record<string, ContactField | null> {
  const map: Record<string, ContactField | null> = {}
  for (const h of headers) {
    const key = h.toLowerCase().trim()
    if (/^(name|full[_ ]?name|contact|nome)$/.test(key)) map[h] = 'name'
    else if (/^(phone|telephone|mobile|whatsapp|tel|telefone|celular)$/.test(key))
      map[h] = 'phone'
    else if (/^(email|e[-_ ]?mail)$/.test(key)) map[h] = 'email'
    else if (/^(company|organization|empresa)$/.test(key)) map[h] = 'company'
    else if (/^(notes?|observation|obs)$/.test(key)) map[h] = 'notes'
    else if (/^(tags?|labels?)$/.test(key)) map[h] = 'tags'
    else map[h] = null
  }
  return map
}

/**
 * Enhanced mapping suggestion that combines header-regex (same as suggestColumnMapping)
 * with value sampling for columns not matched by header.
 * Also suggests custom-field keys via label fuzzy match.
 */
export function suggestColumnMappingEnhanced(
  headers: string[],
  sampleRows: string[][],
  customDefs: { key: string; label: string }[] = [],
): Record<string, string | null> {
  const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  const phoneRe = /^[+\d\s\-().]{7,20}$/

  const base = suggestColumnMapping(headers) as Record<string, string | null>

  for (const h of headers) {
    if (base[h]) continue // already matched by header regex
    const colIdx = headers.indexOf(h)
    const vals = sampleRows.map((r) => (r[colIdx] ?? '').trim()).filter(Boolean)
    if (vals.length > 0) {
      const emailHits = vals.filter((v) => emailRe.test(v)).length
      const phoneHits = vals.filter((v) => phoneRe.test(v)).length
      if (emailHits / vals.length > 0.5) { base[h] = 'email'; continue }
      if (phoneHits / vals.length > 0.5) { base[h] = 'phone'; continue }
    }
    // Custom field label fuzzy match (case-insensitive substring)
    const hl = h.toLowerCase()
    for (const def of customDefs) {
      if (hl.includes(def.label.toLowerCase()) || def.label.toLowerCase().includes(hl)) {
        base[h] = `cf:${def.key}`
        break
      }
    }
  }

  return base
}

export const CONTACT_FIELDS = ['name', 'phone', 'email', 'company', 'notes', 'tags'] as const
export type ContactField = (typeof CONTACT_FIELDS)[number]
