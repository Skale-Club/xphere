import type { ActionContext } from '@/lib/action-engine/execute-action'
import { resolveGoogleCredentials, callWithRefresh } from './credentials'

interface GooglePerson {
  resourceName: string
  etag: string
  names?: Array<{ displayName: string; givenName: string; familyName: string }>
  emailAddresses?: Array<{ value: string }>
  phoneNumbers?: Array<{ value: string }>
}

export async function findGoogleContact(
  params: Record<string, unknown>,
  ctx: ActionContext
): Promise<string> {
  const tokens = await resolveGoogleCredentials(ctx)

  const query = String(params.email ?? params.phone ?? '')
  if (!query) throw new Error('find_contact requires email or phone param')

  const url = new URL('https://people.googleapis.com/v1/people:searchContacts')
  url.searchParams.set('query', query)
  url.searchParams.set('readMask', 'names,emailAddresses,phoneNumbers')
  url.searchParams.set('pageSize', '10')

  const res = await callWithRefresh(
    tokens.access_token,
    tokens.refresh_token,
    tokens.integrationId,
    ctx,
    (token) =>
      fetch(url.toString(), {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
      })
  )

  if (!res.ok) throw new Error(`People API error ${res.status}`)

  const data = (await res.json()) as { results?: Array<{ person: GooglePerson }> }
  const results = data.results ?? []

  if (results.length === 0) return 'No contact found matching that query.'

  const person = results[0].person
  const displayName = person.names?.[0]?.displayName ?? ''
  const email = person.emailAddresses?.[0]?.value ?? ''
  const phone = person.phoneNumbers?.[0]?.value ?? ''

  const parts = [displayName, email, phone].filter(Boolean)
  const summary = parts.join(' | ')
  const suffix = results.length > 1 ? ` (1 of ${results.length} matches)` : ''

  // Single-line result — no newlines (Vapi parser breaks on \n)
  return `Found: ${summary}${suffix}`
}
