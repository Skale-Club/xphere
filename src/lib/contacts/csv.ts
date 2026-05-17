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

export const CONTACT_FIELDS = ['name', 'phone', 'email', 'company', 'notes', 'tags'] as const
export type ContactField = (typeof CONTACT_FIELDS)[number]
