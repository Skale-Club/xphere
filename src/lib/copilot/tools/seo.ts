// SEO tools: site audits and Google Search Console performance.
// Same operations as the MCP tools (src/lib/seo/service.ts). Handlers run in
// the user's request, so they honour seo.view / seo.manage and the plan.

import { can } from '@/lib/rbac/server'
import { requireFeature } from '@/lib/billing/guards'
import {
  SeoServiceError,
  getAuditReport,
  getSearchPerformance,
  listIssuePages,
  listSites,
  queueAudit,
} from '@/lib/seo/service'
import type { CopilotToolRegistry, ToolContext, ToolResult } from './types'

const SITE_PROP = { type: 'string', description: 'SEO site id, host (example.com) or URL' } as const

async function guard(permission: 'seo.view' | 'seo.manage'): Promise<ToolResult | null> {
  if (!(await can(permission))) return { success: false, error: `You need the ${permission} permission for this.` }
  if (permission === 'seo.manage') {
    const feature = await requireFeature('seo')
    if (!feature.ok) return { success: false, error: feature.error }
  }
  return null
}

function wrap(fn: (input: Record<string, unknown>, ctx: ToolContext) => Promise<unknown>, permission: 'seo.view' | 'seo.manage') {
  return async (input: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> => {
    const denied = await guard(permission)
    if (denied) return denied
    try {
      return { success: true, data: await fn(input, ctx) }
    } catch (err) {
      if (err instanceof SeoServiceError) return { success: false, error: err.message }
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  }
}

const site = (input: Record<string, unknown>) => {
  const v = input.site
  if (typeof v !== 'string' || !v.trim()) throw new SeoServiceError('site is required', 'not_found')
  return v
}

export const seoTools: CopilotToolRegistry = {
  seo_list_sites: {
    mode: 'read',
    definition: {
      name: 'seo_list_sites',
      description:
        'List websites tracked in the SEO module with health score (0-100), issue counts by severity, last audit time, whether an audit is running and the linked Search Console property.',
      input_schema: { type: 'object', properties: {} },
    },
    handler: wrap(async (_input, ctx) => ({ sites: await listSites(ctx.supabase, ctx.orgId) }), 'seo.view'),
  },
  seo_get_audit: {
    mode: 'read',
    definition: {
      name: 'seo_get_audit',
      description:
        'Latest completed technical SEO audit of a site: health score, every issue code with severity, affected-page count and how to fix it, and Core Web Vitals.',
      input_schema: { type: 'object', properties: { site: SITE_PROP }, required: ['site'] },
    },
    handler: wrap(async (input, ctx) => getAuditReport(ctx.supabase, ctx.orgId, site(input)), 'seo.view'),
  },
  seo_list_issue_pages: {
    mode: 'read',
    definition: {
      name: 'seo_list_issue_pages',
      description: 'URLs affected by one issue code (from seo_get_audit) in the latest audit of a site, with details per page.',
      input_schema: {
        type: 'object',
        properties: { site: SITE_PROP, code: { type: 'string' }, limit: { type: 'number' } },
        required: ['site', 'code'],
      },
    },
    handler: wrap(
      async (input, ctx) =>
        listIssuePages(ctx.supabase, ctx.orgId, site(input), String(input.code ?? ''), Math.min(Number(input.limit ?? 50), 200)),
      'seo.view',
    ),
  },
  seo_get_search_performance: {
    mode: 'read',
    definition: {
      name: 'seo_get_search_performance',
      description:
        'Google Search Console data for a site: clicks, impressions, CTR and average position vs the previous period, top queries and pages, quick-win queries (positions 4-20) and low-CTR results.',
      input_schema: {
        type: 'object',
        properties: { site: SITE_PROP, days: { type: 'number', description: 'Period length in days (default 28, max 480)' } },
        required: ['site'],
      },
    },
    handler: wrap(async (input, ctx) => getSearchPerformance(ctx.supabase, ctx.orgId, site(input), Number(input.days ?? 28)), 'seo.view'),
  },
  seo_run_audit: {
    mode: 'write',
    definition: {
      name: 'seo_run_audit',
      description:
        'Queue a technical SEO audit for a site. It starts within a minute; the result appears in seo_get_audit when done. Returns the running audit if one is already in progress.',
      input_schema: { type: 'object', properties: { site: SITE_PROP }, required: ['site'] },
    },
    handler: wrap(async (input, ctx) => queueAudit(ctx.supabase, ctx.orgId, site(input), 'manual', ctx.userId), 'seo.manage'),
  },
}
