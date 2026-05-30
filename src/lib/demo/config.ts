import 'server-only'

/**
 * Public read-only demo configuration.
 *
 * The `/demo` route signs visitors into a single shared demo account (held only
 * on the server) and scopes them to the dedicated demo organization. All values
 * come from server-only env vars — never expose them to the client.
 *
 * Required env:
 *   DEMO_ORG_ID       UUID of the demo organization (see migration 1113_demo_org.sql)
 *   DEMO_USER_EMAIL   email of the shared demo auth user
 *   DEMO_USER_PASSWORD password of the shared demo auth user
 */

export function getDemoOrgId(): string {
  return process.env.DEMO_ORG_ID ?? ''
}

export function getDemoUserEmail(): string {
  return (process.env.DEMO_USER_EMAIL ?? '').toLowerCase().trim()
}

/** True when the given org id is the configured demo organization. */
export function isDemoOrg(orgId: string | null | undefined): boolean {
  const demo = getDemoOrgId()
  return Boolean(demo) && orgId === demo
}

/** Server-held credentials for the shared demo user, or null if unconfigured. */
export function getDemoCredentials(): { email: string; password: string } | null {
  const email = process.env.DEMO_USER_EMAIL
  const password = process.env.DEMO_USER_PASSWORD
  if (!email || !password) return null
  return { email, password }
}
