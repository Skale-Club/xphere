// Geogrid geometry. Pure and deterministic: the same inputs always yield the
// same points, which is what makes two scans of the same grid comparable.

import type { GridShape } from './types'

export type GridPoint = { row: number; col: number; lat: number; lng: number }

export type GridInput = {
  centerLat: number
  centerLng: number
  /** Odd number of points per side (3..13). */
  size: number
  /** Distance between neighbouring points, in metres. */
  spacingM: number
  shape: GridShape
}

const METRES_PER_DEGREE_LAT = 111_320
// cos(lat) reaches 0 at the poles; clamp so the longitude step stays finite.
const MIN_COS_LAT = 0.01

export function buildGrid(input: GridInput): GridPoint[] {
  const { centerLat, centerLng, size, spacingM, shape } = input
  if (!Number.isInteger(size) || size < 1 || size % 2 === 0) {
    throw new Error(`Grid size must be a positive odd integer, got ${size}`)
  }
  if (!(spacingM > 0)) throw new Error(`Grid spacing must be positive, got ${spacingM}`)
  if (Math.abs(centerLat) > 90) throw new Error(`Latitude out of range: ${centerLat}`)

  const half = (size - 1) / 2
  const dLat = spacingM / METRES_PER_DEGREE_LAT
  const cosLat = Math.max(Math.cos((centerLat * Math.PI) / 180), MIN_COS_LAT)
  const dLng = spacingM / (METRES_PER_DEGREE_LAT * cosLat)

  const points: GridPoint[] = []
  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      const dy = half - row // row 0 is the northern edge
      const dx = col - half
      if (shape === 'circle' && Math.hypot(dx, dy) > half + 1e-9) continue
      points.push({
        row,
        col,
        lat: round6(clampLat(centerLat + dy * dLat)),
        lng: round6(wrapLng(centerLng + dx * dLng)),
      })
    }
  }
  return points
}

/** Number of points a grid would produce — what a scan costs before it runs. */
export function gridPointCount(size: number, shape: GridShape): number {
  return buildGrid({ centerLat: 0, centerLng: 0, size, spacingM: 1000, shape }).length
}

/** Radius of the grid in metres (centre to edge), for the UI. */
export function gridRadiusM(size: number, spacingM: number): number {
  return ((size - 1) / 2) * spacingM
}

function clampLat(lat: number): number {
  return Math.max(-90, Math.min(90, lat))
}

/** Normalise to [-180, 180) so grids crossing the antimeridian stay valid. */
function wrapLng(lng: number): number {
  const wrapped = ((((lng + 180) % 360) + 360) % 360) - 180
  return Object.is(wrapped, -0) ? 0 : wrapped
}

function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6
}
