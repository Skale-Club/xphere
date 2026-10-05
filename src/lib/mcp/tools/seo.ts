// MCP tools for the SEO module: site audits and Search Console performance.
// Read tools are org-scoped; the write tool (seo_run_audit) also requires the
// caller to hold `seo.manage` — the MCP server itself does no RBAC, so the
// check lives here. Logic is shared with Copilot and workflows via
// src/lib/seo/service.ts.

import { z } from 'zod'
import { createServiceRoleClient } from '@/lib/supabase/admin'
import { userCanInOrg } from '@/lib/rbac/service-role'
import {
  SeoServiceError,
  getAuditReport,
  getSearchPerformance,
  listIssuePages,
  listSites,
  queueAudit,
} from '@/lib/seo/service'
import type { McpToolDef } from '../tool-types'

const siteRef = z.string().min(1).describe('SEO site id, host (example.com) or URL')

function asToolError(err: unknown) {
  if (err instanceof SeoServiceError) {
    return { error: err.code, detail: err.message, status: err.code === 'not_found' ? 404 : 500 }
  }
  throw err
}

export const seoTools: McpToolDef[] = [
  {
    name: 'seo_list_sites',
    title: 'List SEO sites',
    description:
      'List the websites tracked in the SEO module with their latest health score (0-100), issue counts by severity, last audit time, whether an audit is running and the linked Search Console property.',
    area: 'general_xphere',
    inputSchema: z.object({}).strict(),
    handler: async (_input, { auth }) => ({ sites: await listSites(createServiceRoleClient(), auth.orgId) }),
  },
  {
    name: 'seo_get_audit',
    title: 'Get latest SEO audit',
    description:
      'Latest completed technical SEO audit of a site: health score, pages crawled, every issue code with severity, affected-page count and how to fix it, plus Core Web Vitals. Use seo_list_issue_pages to see which URLs an issue affects.',
    area: 'general_xphere',
    inputSchema: z.object({ site: siteRef }).strict(),
    handler: async ({ site }, { auth }) => {
      try {
        return await getAuditReport(createServiceRoleClient(), auth.orgId, site)
      } catch (err) {
        return asToolError(err)
      }
    },
  },
  {
    name: 'seo_list_issue_pages',
    title: 'List pages affected by an SEO issue',
    description:
      'URLs affected by one issue code (e.g. http_4xx, title_missing, broken_internal_link) in the latest audit of a site, with per-page details (status codes, broken link targets, duplicate URLs…).',
    area: 'general_xphere',
    inputSchema: z
      .object({
        site: siteRef,
        code: z.string().min(2).max(60).describe('Issue code from seo_get_audit'),
        limit: z.number().int().positive().max(500).optional(),
      })
      .strict(),
    handler: async ({ site, code, limit }, { auth }) => {
      try {
        return await listIssuePages(createServiceRoleClient(), auth.orgId, site, code, limit ?? 50)
      } catch (err) {
        return asToolError(err)
      }
    },
  },
  {
    name: 'seo_get_search_performance',
    title: 'Get Google Search performance',
    description:
      'Google Search Console data for a site: clicks, impressions, CTR and average position for the last N days vs the previous N days, top queries and pages (last 28 days), queries close to page one (quick wins) and results with unusually low CTR.',
    area: 'general_xphere',
    inputSchema: z
      .object({ site: siteRef, days: z.number().int().min(1).max(480).optional().describe('Period length, default 28') })
      .strict(),
    handler: async ({ site, days }, { auth }) => {
      try {
        return await getSearchPerformance(createServiceRoleClient(), auth.orgId, site, days ?? 28)
      } catch (err) {
        return asToolError(err)
      }
    },
  },
  {
    name: 'seo_run_audit',
    title: 'Run an SEO audit',
    description:
      'Queue a technical SEO audit (crawl + checks) for a site. It starts within a minute and takes from one to several minutes depending on the page count; poll seo_list_sites / seo_get_audit for the result. If an audit is already running, returns it instead of starting another. Requires the seo.manage permission.',
    area: 'general_xphere',
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    inputSchema: z.object({ site: siteRef }).strict(),
    handler: async ({ site }, { auth }) => {
      if (!(await userCanInOrg(auth.userId, auth.orgId, 'seo.manage'))) {
        return { error: 'forbidden', detail: 'Running an audit requires the seo.manage permission.', status: 403 }
      }
      try {
        return await queueAudit(createServiceRoleClient(), auth.orgId, site, 'mcp', auth.userId)
      } catch (err) {
        return asToolError(err)
      }
    },
  },
]
