import type { ActionContext } from '@/lib/action-engine/execute-action'
import { resolveGoogleCredentials, callWithRefresh } from './credentials'

interface UpdateContactParams {
  email: string
  name?: string
  phone?: string
  company?: string
  notes?: string
  [key: string]: unknown
}

interface GooglePerson {
  resourceName: string
  etag: string
}

export async function updateGoogleContact(
  params: Record<string, unknown>,
  ctx: ActionContext
): Promise<string> {
  const tokens = await resolveGoogleCredentials(ctx)
  const { email, name, phone, company, notes } = params as UpdateContactParams

  if (!email) throw new Error('update_contact requires email param to locate the contact')

  // Step A | Search for the contact
  const searchUrl = new URL('https://people.googleapis.com/v1/people:searchContacts')
  searchUrl.searchParams.set('query', email)
  searchUrl.searchParams.set('readMask', 'names,emailAddresses,phoneNumbers,organizations,biographies')
  searchUrl.searchParams.set('pageSize', '1')

  const searchRes = await callWithRefresh(
    tokens.access_token,
    tokens.refresh_token,
    tokens.integrationId,
    ctx,
    (token) =>
      fetch(searchUrl.toString(), {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
      })
  )

  if (!searchRes.ok) throw new Error(`People API search error ${searchRes.status}`)

  const searchData = (await searchRes.json()) as { results?: Array<{ person: GooglePerson }> }

  if (!searchData.results?.length) {
    throw new Error(`Contact not found for update: ${email}`)
  }

  const { resourceName, etag } = searchData.results[0].person

  // Step B | Build update body with dynamic field mask
  const fieldMap: Record<string, string> = {
    name: 'names',
    email: 'emailAddresses',
    phone: 'phoneNumbers',
    company: 'organizations',
    notes: 'biographies',
  }

  const mask = Object.keys(params)
    .filter((k) => fieldMap[k] && params[k])
    .map((k) => fieldMap[k])
    .join(',')

  const updateBody: Record<string, unknown> = { etag }
  if (name) {
    const parts = name.trim().split(/\s+/)
    updateBody.names = [{ givenName: parts[0] ?? '', familyName: parts.slice(1).join(' ') }]
  }
  if (email) updateBody.emailAddresses = [{ value: email }]
  if (phone) updateBody.phoneNumbers = [{ value: phone }]
  if (company) updateBody.organizations = [{ name: company }]
  if (notes) updateBody.biographies = [{ value: notes }]

  // Step C | PATCH the contact (etag is mandatory to avoid 400 failedPrecondition)
  const patchUrl = `https://people.googleapis.com/v1/${resourceName}:updateContact?updatePersonFields=${mask}`

  const patchRes = await callWithRefresh(
    tokens.access_token,
    tokens.refresh_token,
    tokens.integrationId,
    ctx,
    (token) =>
      fetch(patchUrl, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(updateBody),
        cache: 'no-store',
      })
  )

  if (!patchRes.ok) {
    const text = await patchRes.text().catch(() => `status ${patchRes.status}`)
    throw new Error(`People API error ${patchRes.status}: ${text}`)
  }

  // Single-line result | no newlines (Vapi parser breaks on \n)
  return `Google contact updated. Resource: ${resourceName}`
}
