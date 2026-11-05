import 'server-only'

/**
 * Public read-only demo configuration.
 *
 * The `/demo` route opens a session for a single shared demo account (found by
 * email, server-side) and scopes visitors to the dedicated demo organization. All values
 * come from server-only env vars — never expose them to the client.
 *
 * Required env:
 *   DEMO_ORG_ID       UUID of the demo organization (see migration 1113_demo_org.sql)
 *   DEMO_USER_EMAIL   email of the shared demo user (a row in public.users)
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
