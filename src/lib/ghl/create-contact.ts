// src/lib/ghl/create-contact.ts
import { ghlFetchJson, type GhlCredentials } from './client'

interface CreateContactParams {
  firstName?: string
  lastName?: string
  phone?: string
  email?: string
  [key: string]: unknown  // allow extra fields from Vapi arguments
}

interface GhlContactResponse {
  contact: {
    id: string
    [key: string]: unknown
  }
}

export async function createContact(
  params: Record<string, unknown>,
  credentials: GhlCredentials
): Promise<string> {
  const { firstName, lastName, phone, email } = params as CreateContactParams

  const body = {
    locationId: credentials.locationId,
    ...(firstName && { firstName }),
    ...(lastName && { lastName }),
    ...(phone && { phone }),
    ...(email && { email }),
  }

  const data = await ghlFetchJson<GhlContactResponse>(
    '/contacts/',
    'POST',
    body,
    credentials
  )

  // Single-line result | no newlines (Vapi parser breaks on \n)
  return `Contact created. ID: ${data.contact.id}`
}
