import 'server-only'

import { headers } from 'next/headers'
import { redirect } from 'next/navigation'

import { ORG_HEADER, isOrgId, orgPath } from '@/lib/org/request-org'

/**
 * `redirect()` to a dashboard route that keeps the tab's org in the URL.
 *
 * A full page load of `/o/<org-id>/settings` that redirects to a plain
 * `/settings/profile` is followed by the browser with no org signal at all (no
 * prefix, no header, no usable Referer), so the target would render the user's
 * default org instead of the tab's. Use it as `return orgRedirect('/x')` — the
 * `return` keeps TypeScript's narrowing that a bare `redirect()` call gives.
 */
export async function orgRedirect(path: string): Promise<never> {
  const orgId = (await headers()).get(ORG_HEADER)
  redirect(isOrgId(orgId) ? orgPath(orgId, path) : path)
}
