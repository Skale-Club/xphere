import type { ActionContext } from '@/lib/action-engine/execute-action'
import { resolveGoogleCredentials, callWithRefresh } from './credentials'

export async function deleteGoogleContact(
  params: Record<string, unknown>,
  ctx: ActionContext
): Promise<string> {
  const tokens = await resolveGoogleCredentials(ctx)
  const email = String(params.email ?? '')

  if (!email) throw new Error('delete_contact requires email param to locate the contact')

  // Step A | Search for the contact
  const searchUrl = new URL('https://people.googleapis.com/v1/people:searchContacts')
  searchUrl.searchParams.set('query', email)
  searchUrl.searchParams.set('readMask', 'names,emailAddresses')
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

  const searchData = (await searchRes.json()) as {
    results?: Array<{ person: { resourceName: string; etag: string } }>
  }

  if (!searchData.results?.length) {
    throw new Error(`Contact not found for delete: ${email}`)
  }

  const { resourceName } = searchData.results[0].person

  // Step B | DELETE the contact (no etag required for delete)
  const deleteUrl = `https://people.googleapis.com/v1/${resourceName}:deleteContact`

  const deleteRes = await callWithRefresh(
    tokens.access_token,
    tokens.refresh_token,
    tokens.integrationId,
    ctx,
    (token) =>
      fetch(deleteUrl, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
      })
  )

  if (!deleteRes.ok) {
    const text = await deleteRes.text().catch(() => `status ${deleteRes.status}`)
    throw new Error(`People API error ${deleteRes.status}: ${text}`)
  }

  // Single-line result | no newlines (Vapi parser breaks on \n)
  return `Google contact deleted. Resource: ${resourceName}`
}
