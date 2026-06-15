import 'server-only'

/**
 * Global kill-switch for billing ENFORCEMENT (access gating + credit blocking).
 *
 * Default OFF: the billing data layer (entitlements, credit debit/telemetry) runs
 * regardless, but nothing actually BLOCKS a user until this is explicitly turned on
 * — after plans are configured in Stripe and existing orgs are provisioned/granted
 * (see plan Phase 7). This lets us ship and observe the system without risking a
 * lockout of live customers.
 */
export function isBillingEnforced(): boolean {
  return process.env.BILLING_ENFORCEMENT_ENABLED === 'true'
}
