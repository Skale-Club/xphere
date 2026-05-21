import type { ActionContext } from '@/lib/action-engine/execute-action'
import { resolveGoogleCredentials, callWithRefresh } from './credentials'

interface CreateContactParams {
  name?: string
  email?: string
  phone?: string
  company?: string
  notes?: string
  [key: string]: unknown
}

export async function createGoogleContact(
  params: Record<string, unknown>,
  ctx: ActionContext
): Promise<string> {
  const tokens = await resolveGoogleCredentials(ctx)
  const { name, email, phone, company, notes } = params as CreateContactParams

  const parts = (name ?? '').trim().split(/\s+/)
  const givenName = parts[0] ?? ''
  const familyName = parts.slice(1).join(' ')

  const body: Record<string, unknown> = {}
  if (name) body.names = [{ givenName, familyName }]
  if (email) body.emailAddresses = [{ value: email }]
  if (phone) body.phoneNumbers = [{ value: phone }]
  if (company) body.organizations = [{ name: company }]
  if (notes) body.biographies = [{ value: notes }]

  const res = await callWithRefresh(
    tokens.access_token,
    tokens.refresh_token,
    tokens.integrationId,
    ctx,
    (token) =>
      fetch('https://people.googleapis.com/v1/people:createContact?personFields=names,emailAddresses', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        cache: 'no-store',
      })
  )

  if (!res.ok) {
    const text = await res.text().catch(() => `status ${res.status}`)
    throw new Error(`People API error ${res.status}: ${text}`)
  }

  const data = (await res.json()) as { resourceName: string }
  // Single-line result | no newlines (Vapi parser breaks on \n)
  return `Google contact created. Resource: ${data.resourceName}`
}
