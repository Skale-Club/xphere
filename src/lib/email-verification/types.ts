// Shared types for the email-verification service.
//
// Verification status lives ON the prospect (contacts/accounts rows, migration
// 1264) — not per-campaign — so it's paid for once and every outreach channel
// benefits. See src/lib/email-verification/verify.ts for the orchestrator.

/** Normalized verification status, persisted in contacts/accounts.email_status. */
export type EmailStatus = 'ok' | 'catch_all' | 'unknown' | 'disposable' | 'invalid' | 'bounced'

/** Deliverability risk bucket, persisted in contacts/accounts.email_risk. */
export type EmailRisk = 'low' | 'medium' | 'high'

/**
 * 'platform_rule' is not a vendor: it marks an email decided by our own rule (the address belongs
 * to a booking platform, see src/lib/prospects/platform-emails.ts) without calling any provider.
 * `email_verification_provider` is an unconstrained text column, so no migration is needed.
 */
export type VerificationProvider = 'millionverifier' | 'neverbounce' | 'platform_rule'

/** Typed failure reasons a provider call can degrade to — never a thrown error. */
export type VerifyFailureReason = 'no_credits' | 'unauthorized' | 'unreachable' | 'rate_limited'

export interface VerifySuccess {
  status: EmailStatus
  risk: EmailRisk
  provider: VerificationProvider
  raw: unknown
}

export interface VerifyFailure {
  error: VerifyFailureReason
  detail?: string
}

export type VerifyOutcome = VerifySuccess | VerifyFailure

export function isVerifyFailure(outcome: VerifyOutcome): outcome is VerifyFailure {
  return 'error' in outcome
}
