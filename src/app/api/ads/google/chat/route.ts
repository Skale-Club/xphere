import { NextRequest } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { z } from 'zod'

import { decrypt } from '@/lib/crypto'
import {
  parseTokens,
  getAccountOverview,
  listCampaigns,
  listAdGroups,
  updateCampaignStatus,
  updateCampaignBudget,
  toGaqlDuration,
  GoogleAdsError,
} from '@/lib/ads/google-api'
import { getCustomerInfo, refreshAccessToken } from '@/lib/ads/google-oauth'
import { createClient, getUser } from '@/lib/supabase/server'
import { recordMutationExecution, fetchRecentMemories } from '@/lib/ads/journey-db'

export const runtime = 'nodejs'

// ─── Tools ────────────────────────────────────────────────────────────────────

const READ_TOOLS: Anthropic.Tool[] = [
  {
    name: 'get_account_overview',
    description: 'Get account-level spend, impressions, clicks, conversions for a date range.',
    input_schema: {
      type: 'object' as const,
      properties: {
        date_preset: {
          type: 'string',
          enum: ['today', 'yesterday', 'last_7d', 'last_14d', 'last_30d', 'last_90d', 'this_month', 'last_month'],
        },
      },
      required: [],
    },
  },
  {
    name: 'list_campaigns',
    description: 'List all campaigns with status, budget, impressions, clicks, cost, and conversions.',
    input_schema: {
      type: 'object' as const,
      properties: {
        date_preset: {
          type: 'string',
          enum: ['today', 'yesterday', 'last_7d', 'last_14d', 'last_30d', 'last_90d', 'this_month', 'last_month'],
        },
      },
      required: [],
    },
  },
  {
    name: 'list_ad_groups',
    description: 'List ad groups with performance metrics, optionally filtered by campaign.',
    input_schema: {
      type: 'object' as const,
      properties: {
        campaign_id: { type: 'string', description: 'Filter by campaign ID (optional)' },
        date_preset: {
          type: 'string',
          enum: ['today', 'yesterday', 'last_7d', 'last_14d', 'last_30d', 'last_90d', 'this_month', 'last_month'],
        },
      },
      required: [],
    },
  },
]

const MUTATE_TOOLS: Anthropic.Tool[] = [
  {
    name: 'pause_campaign',
    description: 'Pause a Google Ads campaign. Requires user approval before execution.',
    input_schema: {
      type: 'object' as const,
      properties: {
        campaign_id: { type: 'string' },
        campaign_name: { type: 'string', description: 'Human-readable name for confirmation' },
      },
      required: ['campaign_id', 'campaign_name'],
    },
  },
  {
    name: 'enable_campaign',
    description: 'Enable (unpause) a Google Ads campaign. Requires user approval.',
    input_schema: {
      type: 'object' as const,
      properties: {
        campaign_id: { type: 'string' },
        campaign_name: { type: 'string' },
      },
      required: ['campaign_id', 'campaign_name'],
    },
  },
  {
    name: 'set_daily_budget',
    description: 'Update the daily budget for a campaign. Requires user approval.',
    input_schema: {
      type: 'object' as const,
      properties: {
        campaign_id: { type: 'string' },
        budget_id: { type: 'string', description: 'Budget resource ID (from list_campaigns)' },
        campaign_name: { type: 'string' },
        daily_budget_usd: { type: 'number', description: 'New daily budget in USD' },
      },
      required: ['campaign_id', 'budget_id', 'campaign_name', 'daily_budget_usd'],
    },
  },
]

const ALL_TOOLS = [...READ_TOOLS, ...MUTATE_TOOLS]
const MUTATE_NAMES = new Set(MUTATE_TOOLS.map((t) => t.name))

// ─── Schema ───────────────────────────────────────────────────────────────────

const ChatSchema = z.object({
  messages: z.array(z.object({ role: z.enum(['user', 'assistant']), content: z.string() })).min(1),
  customer_id: z.string().min(1),
  account_snapshot: z.string().optional(),
  approved_tool: z.object({
    tool_use_id: z.string(),
    tool_name: z.string(),
    input: z.record(z.unknown()),
    assistant_content: z.array(z.unknown()).optional(),
  }).optional(),
})

function err(msg: string, status = 400) {
  return Response.json({ error: msg }, { status })
}

async function buildSystemPrompt(orgId: string, snapshot?: string): Promise<string> {
  const memories = await fetchRecentMemories(orgId, 'google', 8).catch(() => [])

  let snapshotSection = ''
  if (snapshot) {
    snapshotSection = `\n\n${snapshot}`
  }

  let memorySection = ''
  if (memories.length > 0) {
    memorySection = '\n\n## Context from Previous Conversations\n'
    for (const m of memories) {
      memorySection += `- [${m.type.toUpperCase()}] ${m.title}: ${m.content}\n`
    }
    memorySection += '\nUse this context to continue previous analyses and decisions.'
  }

  return `You are an expert Google Ads analyst and manager embedded in the Xphere platform.
Use read tools freely to fetch data. Mutation tools (pause, enable, set_daily_budget) require explicit user approval — when you call one, the system will intercept it and show an approval dialog.
After the user approves, the approved_tool is sent back and you should complete the response.
Amounts in the API are in micros (1,000,000 micros = $1 USD). Always present budgets and costs in USD to the user.

The account snapshot below reflects the current state (last 30 days). Use it to answer overview questions directly without calling tools. Call tools only when you need fresher data or deeper detail.${snapshotSection}${memorySection}

Today: ${new Date().toISOString().split('T')[0]}`
}

// ─── Route ────────────────────────────────────────────────────────────────────

export async function POST(request: NextRequest): Promise<Response> {
  const user = await getUser()
  if (!user) return err('Unauthorized', 401)
  if (user.email !== process.env.PLATFORM_ADMIN_EMAIL) return err('Forbidden', 403)

  let body: unknown
  try { body = await request.json() } catch { return err('Invalid JSON') }

  const parsed = ChatSchema.safeParse(body)
  if (!parsed.success) return err(parsed.error.message)

  const { messages, customer_id, account_snapshot, approved_tool } = parsed.data

  const supabase = await createClient()
  const { data: orgId } = await supabase.rpc('get_current_org_id')
  if (!orgId) return err('No active org')

  const { data: conn } = await supabase
    .from('ads_connections')
    .select('encrypted_access_token')
    .eq('org_id', orgId as string)
    .eq('ad_account_id', customer_id)
    .eq('platform', 'google')
    .eq('status', 'active')
    .maybeSingle()

  if (!conn) return err('No active Google Ads connection', 404)

  const tokens = parseTokens(await decrypt(conn.encrypted_access_token))
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

  const apiMessages: Anthropic.MessageParam[] = messages.map((m) => ({ role: m.role, content: m.content }))

  // Reconstruct the proper tool_use + tool_result turns for the approved mutation.
  // The Anthropic API requires a tool_use block in the assistant turn immediately
  // before any tool_result — it cannot appear alone.
  if (approved_tool) {
    let resultContent: string
    try {
      const result = await executeMutation(approved_tool.tool_name, approved_tool.input, customer_id, tokens.refresh_token)
      resultContent = JSON.stringify(result)
      // After successful mutation, record execution in journey (non-blocking)
      void recordMutationExecution({
        toolName: approved_tool.tool_name,
        input: approved_tool.input as Record<string, unknown>,
        orgId: orgId as string,
        platform: 'google',
      })
    } catch (e) {
      resultContent = JSON.stringify({ error: e instanceof Error ? e.message : 'Mutation failed' })
    }

    const assistantContent = approved_tool.assistant_content?.length
      ? approved_tool.assistant_content as Anthropic.ContentBlock[]
      : [{ type: 'tool_use' as const, id: approved_tool.tool_use_id, name: approved_tool.tool_name, input: approved_tool.input }]

    apiMessages.push({ role: 'assistant', content: assistantContent })
    apiMessages.push({
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: approved_tool.tool_use_id, content: resultContent }],
    })
  }

  const systemPrompt = await buildSystemPrompt(orgId as string, account_snapshot)
  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      function write(event: string, data: string) {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${data}\n\n`))
      }
      try {
        let currentMessages = [...apiMessages]
        let iters = 0
        while (iters < 4) {
          iters++
          const response = await anthropic.messages.create({
            model: 'claude-opus-4-8',
            max_tokens: 4096,
            system: systemPrompt,
            tools: ALL_TOOLS,
            messages: currentMessages,
          })

          const textBlocks = response.content.filter((b): b is Anthropic.TextBlock => b.type === 'text')
          const toolBlocks = response.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')

          for (const b of textBlocks) write('text', JSON.stringify({ text: b.text }))

          if (toolBlocks.length > 0) {
            const tool = toolBlocks[0]
            if (MUTATE_NAMES.has(tool.name)) {
              // Include full response.content so the client can reconstruct the
              // tool_use turn on approval without an extra round-trip.
              write('tool_approval_required', JSON.stringify({
                tool_use_id: tool.id,
                tool_name: tool.name,
                input: tool.input,
                assistant_content: response.content,
              }))
              break
            }
            const result = await resolveReadTool(tool.name, tool.input as Record<string, unknown>, customer_id, tokens.refresh_token)
            write('tool_result', JSON.stringify({ tool_use_id: tool.id, result }))
            currentMessages = [
              ...currentMessages,
              { role: 'assistant', content: response.content },
              { role: 'user', content: [{ type: 'tool_result', tool_use_id: tool.id, content: JSON.stringify(result) }] },
            ]
            if (response.stop_reason === 'end_turn') break
            continue
          }
          break
        }
        write('done', '{}')
      } catch (e) {
        write('error', JSON.stringify({ error: e instanceof Error ? e.message : 'AI error' }))
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' },
  })
}

async function resolveReadTool(name: string, input: Record<string, unknown>, customerId: string, refreshToken: string): Promise<unknown> {
  const duration = toGaqlDuration((input.date_preset as string | undefined) ?? 'last_30d')
  switch (name) {
    case 'get_account_overview': {
      const [info, metrics] = await Promise.all([
        refreshAccessToken(refreshToken)
          .then((at) => getCustomerInfo(customerId, at))
          .catch(() => ({ id: customerId, name: customerId, currency_code: 'USD', manager: false, test_account: false })),
        getAccountOverview(customerId, refreshToken, duration),
      ])
      return { customer: info, metrics }
    }
    case 'list_campaigns':
      return listCampaigns(customerId, refreshToken, duration)
    case 'list_ad_groups':
      return listAdGroups(customerId, refreshToken, duration, input.campaign_id as string | undefined)
    default:
      return { error: `Unknown tool: ${name}` }
  }
}

async function executeMutation(name: string, input: Record<string, unknown>, customerId: string, refreshToken: string): Promise<unknown> {
  switch (name) {
    case 'pause_campaign':
      await updateCampaignStatus(customerId, input.campaign_id as string, 'PAUSED', refreshToken)
      return { ok: true }
    case 'enable_campaign':
      await updateCampaignStatus(customerId, input.campaign_id as string, 'ENABLED', refreshToken)
      return { ok: true }
    case 'set_daily_budget': {
      const micros = Math.round((input.daily_budget_usd as number) * 1_000_000)
      await updateCampaignBudget(customerId, input.budget_id as string, micros, refreshToken)
      return { ok: true }
    }
    default:
      throw new GoogleAdsError(`Unknown mutation: ${name}`)
  }
}
