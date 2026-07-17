// src/lib/medusa/format.ts
// Money formatting for Medusa Store API responses. Medusa 2.x store endpoints
// (calculated_price.calculated_amount, cart item unit_price/total) return
// amounts in MAJOR currency units — do NOT divide by 100. See
// .planning/workstreams/medusa-commerce/phases/132-medusa-provider-read-tools/132-RESEARCH.md
// Pitfall 3.

export function formatMoney(amount: number, currency: string, locale = 'en-US'): string {
  return new Intl.NumberFormat(locale, { style: 'currency', currency: currency.toUpperCase() }).format(amount)
}
