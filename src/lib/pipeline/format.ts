/**
 * Locale-aware formatting helpers for the sales pipeline UI.
 *
 * Currency defaults to BRL (R$ 1.234,56) | matches the rest of the product.
 */

const numberFormatters = new Map<string, Intl.NumberFormat>()
function fmt(currency: string): Intl.NumberFormat {
  const key = currency.toUpperCase()
  let f = numberFormatters.get(key)
  if (!f) {
    f = new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: key,
      maximumFractionDigits: 2,
    })
    numberFormatters.set(key, f)
  }
  return f
}

export function formatCurrency(value: number | null | undefined, currency = 'USD'): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '|'
  try {
    return fmt(currency).format(value)
  } catch {
    return `${currency} ${value.toFixed(2)}`
  }
}

/**
 * Days between now and an ISO timestamp. Returns whole days (>= 0).
 */
export function daysSince(iso: string | null | undefined): number {
  if (!iso) return 0
  const ms = Date.now() - new Date(iso).getTime()
  return Math.max(0, Math.floor(ms / (24 * 60 * 60 * 1000)))
}

export type AgeTone = 'neutral' | 'warning' | 'danger'

export function ageTone(days: number): AgeTone {
  if (days < 7) return 'neutral'
  if (days <= 30) return 'warning'
  return 'danger'
}

export function relativeTime(iso: string | null | undefined): string {
  if (!iso) return ''
  const ms = Date.now() - new Date(iso).getTime()
  const m = Math.round(ms / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.round(h / 24)
  if (d < 30) return `${d}d ago`
  return new Date(iso).toLocaleDateString('pt-BR')
}

export function initialsOf(name: string | null | undefined, fallback = '?'): string {
  if (!name) return fallback
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return fallback
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}
