// Shared Local SEO types. Pure — safe to import from client components.

export type GridShape = 'square' | 'circle'
export const GRID_SIZES = [3, 5, 7, 9, 11, 13] as const
export type GridSize = (typeof GRID_SIZES)[number]

export type ScanStatus = 'queued' | 'running' | 'partial' | 'completed' | 'failed' | 'cancelled'
export type PointStatus = 'queued' | 'in_flight' | 'done' | 'failed'
export type MatchMethod = 'place_id' | 'cid' | 'name'
export type ProviderId = 'dataforseo' | 'serpapi' | 'fake'
/** Whose provider account a scan runs on (migration 1323). */
export type CredentialSource = 'platform' | 'own'
export type ScanTrigger = 'manual' | 'schedule' | 'workflow' | 'mcp'

/** One business in one point's Maps results, normalised across providers. */
export type SerpResult = {
  position: number
  title: string
  placeId?: string | null
  cid?: string | null
  rating?: number | null
  reviews?: number | null
  category?: string | null
  address?: string | null
  phone?: string | null
  lat?: number | null
  lng?: number | null
}

/** What we know about the tracked business, for matching it in results. */
export type TargetIdentity = {
  placeId: string | null
  cid: string | null
  name: string
  address?: string | null
  phone?: string | null
}

export type Top3Entry = { position: number; title: string; placeId: string | null }

/** Default search depth: Maps shows ~20 results per query before "more". */
export const DEFAULT_DEPTH = 20
export const DEFAULT_ZOOM = 13

/** Pin colour band for a rank (null = not found within depth). */
export type RankBand = 'top3' | 'mid' | 'low' | 'none'
export function rankBand(rank: number | null): RankBand {
  if (rank === null) return 'none'
  if (rank <= 3) return 'top3'
  if (rank <= 10) return 'mid'
  return 'low'
}
