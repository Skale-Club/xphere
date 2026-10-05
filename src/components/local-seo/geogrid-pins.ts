import { rankBand, type PointStatus } from '@/lib/local-seo/types'

export type GridPin = {
  id: string
  row: number
  col: number
  lat: number
  lng: number
  status: PointStatus
  rank: number | null
}

/** Fill colours per band; same in light and dark (pins sit on map tiles). */
export const BAND_COLORS = {
  top3: '#16a34a',
  mid: '#f59e0b',
  low: '#ea580c',
  none: '#dc2626',
  pending: '#94a3b8',
  failed: '#64748b',
} as const

export function pinColor(p: Pick<GridPin, 'status' | 'rank'>): string {
  if (p.status === 'failed') return BAND_COLORS.failed
  if (p.status !== 'done') return BAND_COLORS.pending
  return BAND_COLORS[rankBand(p.rank)]
}

export function pinLabel(p: Pick<GridPin, 'status' | 'rank'>, depth = 20): string {
  if (p.status === 'failed') return '!'
  if (p.status !== 'done') return '·'
  return p.rank === null ? `${depth}+` : String(p.rank)
}

export function pinTitle(p: Pick<GridPin, 'status' | 'rank'>): string {
  if (p.status === 'failed') return 'This point could not be fetched'
  if (p.status !== 'done') return 'Waiting for results'
  return p.rank === null ? 'Not in the top 20 here' : `Rank ${p.rank} here`
}
