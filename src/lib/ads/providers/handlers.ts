// Command handlers: the extension point for new ad-platform capabilities.
//
// The original adapters (google-adapter.ts, meta-adapter.ts) implement every
// command in one switch per lifecycle step. New capabilities live instead in
// small modules under providers/google/ and providers/meta/, each owning a
// few command types end to end. `withHandlers` composes them over the base
// adapter: a command with a registered handler goes to it, everything else
// to the base adapter. The engine sees one AdsProviderAdapter either way.

import type { AdsCommand, AdsCommandType } from '../commands/catalog'
import { COMMAND_CATALOG } from '../commands/catalog'
import type { AdsPlatform, PlanResult, ResourceSnapshot } from '../commands/types'
import type { AdapterContext, AdsProviderAdapter, Capability, ExecuteResult, VerifyResult } from './types'

export interface CommandHandler {
  readonly platform: AdsPlatform
  /** Command types this module implements end to end. */
  readonly types: readonly AdsCommandType[]
  snapshot(ctx: AdapterContext, command: AdsCommand): Promise<ResourceSnapshot | null>
  plan(command: AdsCommand, before: ResourceSnapshot): PlanResult
  /** Provider-side dry run. Throw to reject; resolve to accept. */
  validate(ctx: AdapterContext, command: AdsCommand, before: ResourceSnapshot): Promise<void>
  execute(ctx: AdapterContext, command: AdsCommand, before: ResourceSnapshot): Promise<ExecuteResult>
  verify(
    ctx: AdapterContext,
    command: AdsCommand,
    intended: Record<string, unknown>,
    providerRef: string | null,
  ): Promise<VerifyResult>
  buildRollback(command: AdsCommand, before: ResourceSnapshot, providerRef: string | null): AdsCommand | null
}

/**
 * Compose handlers over a base adapter. A command type claimed by two
 * handlers — or by a handler and a mismatched platform — is a programming
 * error and fails loudly at module load, not at 3am on a customer's account.
 */
export function withHandlers(base: AdsProviderAdapter, handlers: readonly CommandHandler[]): AdsProviderAdapter {
  const byType = new Map<string, CommandHandler>()
  for (const h of handlers) {
    if (h.platform !== base.platform) throw new Error(`Handler for ${h.types.join(', ')} is ${h.platform}, adapter is ${base.platform}`)
    for (const t of h.types) {
      if (byType.has(t)) throw new Error(`Command ${t} is claimed by two handlers`)
      if (COMMAND_CATALOG[t]?.platform !== base.platform) throw new Error(`Command ${t} is not a ${base.platform} catalog entry`)
      byType.set(t, h)
    }
  }
  const handlerFor = (command: AdsCommand) => byType.get(command.type)

  return {
    platform: base.platform,

    capabilities(): Capability[] {
      const own = base.capabilities()
      const seen = new Set(own.map((c) => c.type))
      const extra = [...byType.keys()]
        .filter((t) => !seen.has(t as AdsCommandType))
        .map((t) => {
          const entry = COMMAND_CATALOG[t as AdsCommandType]
          return { type: t as AdsCommandType, label: entry.label, risk: entry.risk }
        })
      return [...own, ...extra]
    },

    snapshot: (ctx, command) => (handlerFor(command) ?? base).snapshot(ctx, command),
    plan: (command, before) => (handlerFor(command) ?? base).plan(command, before),
    validate: (ctx, command, before) => (handlerFor(command) ?? base).validate(ctx, command, before),
    execute: (ctx, command, before) => (handlerFor(command) ?? base).execute(ctx, command, before),
    verify: (ctx, command, intended, providerRef) =>
      (handlerFor(command) ?? base).verify(ctx, command, intended, providerRef),
    buildRollback: (command, before, providerRef) =>
      (handlerFor(command) ?? base).buildRollback(command, before, providerRef),
    // Error taxonomy is per platform, not per command.
    classifyError: (error) => base.classifyError(error),
  }
}

/** Shared helper for handler modules: an empty-diff plan is a no-op, not a change. */
export function noOp(): PlanResult {
  return { ok: false, code: 'no_op', message: 'The resource already has this value — nothing to change.' }
}

export type { ExecuteResult, VerifyResult }
