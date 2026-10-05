// MCP tools for Local SEO (geogrid rank tracking). Reads are org-scoped by
// hand (service-role client); localseo_trigger_scan goes through createScan,
// so the points quota and the platform kill switch apply exactly as in the UI.

import { z } from 'zod'

import { getQuotaSnapshot } from '@/lib/local-seo/quota'
import { createScan } from '@/lib/local-seo/scans'
import { GRID_SIZES } from '@/lib/local-seo/types'
import { createServiceRoleClient } from '@/lib/supabase/admin'

import type { McpToolDef } from '../tool-types'

const db = () => createServiceRoleClient()

export const localSeoTools: McpToolDef[] = [
  {
    name: 'localseo_list_locations',
    title: 'List Local SEO locations',
    description:
      'List the businesses this org tracks on Google Maps, with their keywords and the latest SoLV/average rank per keyword. Also returns the monthly scan-points quota.',
    area: 'general_xphere',
    inputSchema: z.object({}).strict(),
    handler: async (_input, { auth }) => {
      const admin = db()
      const [{ data: locations }, { data: keywords }, { data: scans }, quota] = await Promise.all([
        admin.from('local_seo_locations').select('id, name, business_name, address, place_id, is_active').eq('org_id', auth.orgId).order('created_at'),
        admin.from('local_seo_keywords').select('id, location_id, keyword, is_active').eq('org_id', auth.orgId),
        admin
          .from('local_seo_scans')
          .select('id, location_id, keyword_id, solv, arp, created_at')
          .eq('org_id', auth.orgId)
          .in('status', ['completed', 'partial'])
          .order('created_at', { ascending: false })
          .limit(500),
        getQuotaSnapshot(admin, auth.orgId),
      ])
      return {
        quota,
        locations: (locations ?? []).map((l) => ({
          ...l,
          keywords: (keywords ?? [])
            .filter((k) => k.location_id === l.id)
            .map((k) => {
              const last = (scans ?? []).find((s) => s.keyword_id === k.id)
              return { id: k.id, keyword: k.keyword, is_active: k.is_active, latest: last ? { scan_id: last.id, solv: last.solv, arp: last.arp, at: last.created_at } : null }
            }),
        })),
      }
    },
  },
  {
    name: 'localseo_list_scans',
    title: 'List geogrid scans',
    description: 'Recent geogrid scans of a location (optionally one keyword), newest first, with ARP/ATRP/SoLV/found%.',
    area: 'general_xphere',
    inputSchema: z
      .object({
        location_id: z.string().uuid(),
        keyword_id: z.string().uuid().optional(),
        limit: z.number().int().positive().max(100).optional(),
      })
      .strict(),
    handler: async ({ location_id, keyword_id, limit = 20 }, { auth }) => {
      let q = db()
        .from('local_seo_scans')
        .select('id, keyword_id, keyword, status, grid_size, spacing_m, shape, points_total, points_done, points_failed, arp, atrp, solv, found_pct, triggered_by, error, created_at, finished_at')
        .eq('org_id', auth.orgId)
        .eq('location_id', location_id)
        .order('created_at', { ascending: false })
        .limit(limit)
      if (keyword_id) q = q.eq('keyword_id', keyword_id)
      const { data } = await q
      return { scans: data ?? [] }
    },
  },
  {
    name: 'localseo_get_scan',
    title: 'Get a geogrid scan',
    description:
      'One scan in detail: metrics, every grid point with its rank (null = not in the top 20) and the competitors ranked by share of local voice.',
    area: 'general_xphere',
    inputSchema: z.object({ scan_id: z.string().uuid() }).strict(),
    handler: async ({ scan_id }, { auth }) => {
      const admin = db()
      const { data: scan } = await admin.from('local_seo_scans').select('*').eq('id', scan_id).eq('org_id', auth.orgId).maybeSingle()
      if (!scan) return { error: 'not_found', status: 404 }
      const [{ data: points }, { data: competitors }] = await Promise.all([
        admin.from('local_seo_scan_points').select('row_idx, col_idx, lat, lng, status, rank, top3').eq('scan_id', scan_id).order('row_idx').order('col_idx'),
        admin
          .from('local_seo_competitor_snapshots')
          .select('title, place_id, is_target, appearances, avg_rank, solv, rating, reviews, category')
          .eq('scan_id', scan_id)
          .order('solv', { ascending: false })
          .limit(20),
      ])
      return { scan, points: points ?? [], competitors: competitors ?? [] }
    },
  },
  {
    name: 'localseo_get_competitors',
    title: 'Get Local SEO competitors',
    description: "Competitors from a location's latest finished scan per keyword, ranked by share of local voice (SoLV = % of grid points in the top 3).",
    area: 'general_xphere',
    inputSchema: z.object({ location_id: z.string().uuid(), keyword_id: z.string().uuid().optional() }).strict(),
    handler: async ({ location_id, keyword_id }, { auth }) => {
      const admin = db()
      let q = admin
        .from('local_seo_scans')
        .select('id, keyword_id, keyword, created_at')
        .eq('org_id', auth.orgId)
        .eq('location_id', location_id)
        .in('status', ['completed', 'partial'])
        .order('created_at', { ascending: false })
        .limit(50)
      if (keyword_id) q = q.eq('keyword_id', keyword_id)
      const { data: scans } = await q
      const latest = new Map<string, { id: string; keyword: string; created_at: string }>()
      for (const s of scans ?? []) if (!latest.has(s.keyword)) latest.set(s.keyword, s)
      const out = []
      for (const s of latest.values()) {
        const { data } = await admin
          .from('local_seo_competitor_snapshots')
          .select('title, place_id, is_target, appearances, avg_rank, solv, rating, reviews')
          .eq('scan_id', s.id)
          .order('solv', { ascending: false })
          .limit(15)
        out.push({ keyword: s.keyword, scan_id: s.id, scanned_at: s.created_at, competitors: data ?? [] })
      }
      return { keywords: out }
    },
  },
  {
    name: 'localseo_trigger_scan',
    title: 'Run a geogrid scan',
    description:
      'Start a geogrid scan for one keyword of a location. Spends scan points (one per grid point, e.g. 49 for 7x7) from the monthly quota — tell the operator the cost before calling. Results arrive asynchronously; poll localseo_get_scan.',
    area: 'general_xphere',
    inputSchema: z
      .object({
        location_id: z.string().uuid(),
        keyword_id: z.string().uuid(),
        grid_size: z.number().int().refine((n) => (GRID_SIZES as readonly number[]).includes(n), 'grid_size must be 3, 5, 7, 9, 11 or 13').optional(),
        spacing_m: z.number().int().min(100).max(20000).optional(),
        shape: z.enum(['square', 'circle']).optional(),
      })
      .strict(),
    handler: async (input, { auth }) => {
      const res = await createScan(db(), {
        orgId: auth.orgId,
        locationId: input.location_id,
        keywordId: input.keyword_id,
        gridSize: input.grid_size,
        spacingM: input.spacing_m,
        shape: input.shape,
        triggeredBy: 'mcp',
        userId: auth.userId,
      })
      if (!res.ok) return { error: 'scan_not_started', detail: res.error, status: 422 }
      return { scan_id: res.scanId, points: res.estimate.points, quota_remaining_after: res.estimate.quota.remaining - (res.estimate.billable ? res.estimate.points : 0) }
    },
  },
]
