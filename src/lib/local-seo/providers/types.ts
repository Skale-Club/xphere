// Rank provider contract. A provider answers "what does Google Maps show for
// <keyword> from <lat,lng>". Sync providers answer inline; async providers
// accept a batch of tasks and deliver results later (postback or polling).

import type { ProviderId, SerpResult } from '../types'

export type PointQuery = {
  pointId: string
  keyword: string
  lat: number
  lng: number
  zoom: number
  depth: number
  language: string
  country: string
}

/**
 * auth / quota are permanent for the whole scan (retrying will not help);
 * invalid is permanent for one point; transient is retried with backoff.
 */
export type ProviderErrorKind = 'auth' | 'quota' | 'invalid' | 'transient'

export class RankProviderError extends Error {
  constructor(
    readonly kind: ProviderErrorKind,
    message: string,
  ) {
    super(message)
    this.name = 'RankProviderError'
  }
}

export type SubmitOutcome = { pointId: string; taskId: string } | { pointId: string; error: RankProviderError }

export type TaskOutcome =
  | { status: 'pending' }
  | { status: 'done'; results: SerpResult[] }
  | { status: 'error'; error: RankProviderError }

type ProviderBase = {
  id: ProviderId
  /** Cost the platform pays per point at the given depth, in USD. */
  costPerPointUsd(depth: number): number
}

export type SyncRankProvider = ProviderBase & {
  mode: 'sync'
  fetchPoint(q: PointQuery): Promise<SerpResult[]>
}

export type AsyncRankProvider = ProviderBase & {
  mode: 'async'
  /** Max tasks per submit call. */
  batchSize: number
  submit(qs: PointQuery[], postbackUrl: string | null): Promise<SubmitOutcome[]>
  getTask(taskId: string): Promise<TaskOutcome>
  /** Parse a pushed result (postback body) into task outcomes keyed by task id. */
  parsePostback(body: unknown): { taskId: string; outcome: TaskOutcome }[]
}

export type RankProvider = SyncRankProvider | AsyncRankProvider

export function isRankProviderError(e: unknown): e is RankProviderError {
  return e instanceof RankProviderError
}
