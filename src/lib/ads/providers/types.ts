// The contract every ad-platform adapter implements.
//
// The engine owns the lifecycle (ledger, policy, approval, retries); the
// adapter owns everything platform-specific: how to read a resource, what a
// command changes, how to write it, how to confirm it stuck, and how to undo
// it. Adapters never touch the database and never decide whether a change is
// allowed — they only answer "what is" and "do this".

import type { AdsCommand } from '../commands/catalog'
import type { AdsPlatform, PlanResult, ResourceSnapshot } from '../commands/types'

export type AdapterContext = {
  orgId: string
  adAccountId: string
  /** Decrypted credential: Meta access token, or Google refresh token. */
  credential: string
}

export type ExecuteResult = {
  /** Provider identifier of the written resource (resourceName / object id). */
  providerRef: string | null
  raw: unknown
}

export type VerifyResult = {
  ok: boolean
  /** Field-level mismatches between the intended and the read-back state. */
  mismatches: Array<{ field: string; expected: unknown; actual: unknown }>
  observed: Record<string, unknown> | null
}

export type ErrorClass = {
  code: string
  message: string
  /** Rate limit, timeout, 5xx — safe to retry the same command. */
  transient: boolean
  /** The stored credential is dead — reconnect needed, never retry. */
  auth: boolean
}

export type Capability = {
  type: AdsCommand['type']
  label: string
  risk: number
}

export interface AdsProviderAdapter {
  readonly platform: AdsPlatform

  /** Commands this adapter implements, for the capability listing. */
  capabilities(): Capability[]

  /** Current state of exactly what `command` reads or writes. null = not found. */
  snapshot(ctx: AdapterContext, command: AdsCommand): Promise<ResourceSnapshot | null>

  /** Pure: intended state + diff + warnings, or why the command can't apply. */
  plan(command: AdsCommand, before: ResourceSnapshot): PlanResult

  /** Ask the provider to validate without writing (Google validateOnly, Meta validate_only). */
  validate(ctx: AdapterContext, command: AdsCommand, before: ResourceSnapshot): Promise<void>

  execute(ctx: AdapterContext, command: AdsCommand, before: ResourceSnapshot): Promise<ExecuteResult>

  /** Re-read the resource and compare against the planned state. */
  verify(
    ctx: AdapterContext,
    command: AdsCommand,
    intended: Record<string, unknown>,
    providerRef: string | null,
  ): Promise<VerifyResult>

  /**
   * The command that undoes a succeeded change, built from the stored "before"
   * state — or null when the change has no safe inverse.
   */
  buildRollback(
    command: AdsCommand,
    before: ResourceSnapshot,
    providerRef: string | null,
  ): AdsCommand | null

  classifyError(error: unknown): ErrorClass
}
