// src/lib/xkedule/actions/get-services.ts
import { xkeduleFetchJson, type XkeduleCredentials } from '../client'

interface XkeduleService {
  id: number
  name: string
  description?: string | null
  basePrice?: string | number | null
  pricingType?: string
  [key: string]: unknown
}

export async function getXkeduleServices(
  params: Record<string, unknown>,
  credentials: XkeduleCredentials
): Promise<string> {
  const services = await xkeduleFetchJson<XkeduleService[]>(
    '/api/services',
    'GET',
    null,
    credentials
  )

  if (!services || services.length === 0) {
    return 'No services available.'
  }

  const summary = services
    .map(s => `ID: ${s.id} | ${s.name}${s.basePrice ? ` | From $${s.basePrice}` : ''}`)
    .join('\n')

  return `Available services:\n${summary}`
}
