// src/lib/xkedule/actions/get-services.ts
// GET /api/v1/catalog — list bookable services (with a normalized starting
// price) and the tenant's staff, formatted for an AI agent.
import { xkeduleFetchJson, type XkeduleCredentials } from '../client'

interface CatalogService {
  id: number
  name: string
  description?: string | null
  durationMinutes?: number
  pricingType?: string
  priceFrom?: number | null
}

interface CatalogResponse {
  services: CatalogService[]
  staff: { id: number; name: string }[]
}

export async function getXkeduleServices(
  _params: Record<string, unknown>,
  credentials: XkeduleCredentials,
): Promise<string> {
  const data = await xkeduleFetchJson<CatalogResponse>('/api/v1/catalog', 'GET', null, credentials)

  if (!data.services || data.services.length === 0) {
    return 'No services available.'
  }

  const summary = data.services
    .map((s) => {
      const price = s.priceFrom != null ? ` | From $${s.priceFrom}` : ''
      const dur = s.durationMinutes ? ` | ${s.durationMinutes}min` : ''
      return `ID: ${s.id} | ${s.name}${price}${dur}`
    })
    .join('\n')

  const staff = data.staff?.length
    ? `\nStaff: ${data.staff.map((m) => `${m.name} (ID ${m.id})`).join(', ')}`
    : ''

  return `Available services:\n${summary}${staff}`
}
