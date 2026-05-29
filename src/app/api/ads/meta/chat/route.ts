import { NextRequest } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { z } from 'zod'

import { decrypt } from '@/lib/crypto'
import {
  listCampaigns,
  listAdSets,
  getInsights,
  getAdAccountInfo,
  updateCampaignStatus,
  updateCampaignDailyBudget,
  MetaAdsError,
} from '@/lib/ads/meta-api'
import { createClient, getUser } from '@/lib/supabase/server'

export const runtime = 'nodejs'

// ─── Tool definitions ─────────────────────────────────────────────────────────

const READ_TOOLS: Anthropic.Tool[] = [
  {
    name: 'get_account_overview',
    description: 'Get high-level account stats: spend, impressions, clicks, reach for a date range.',
    input_schema: {
      type: 'object' as const,
      properties: {
        date_preset: {
          type: 'string',
          enum: ['today', 'yesterday', 'last_7d', 'last_14d', 'last_30d', 'last_90d', 'this_month', 'last_month'],
          description: 'The date range preset',
        },
      },
      required: [],
    },
  },
  {
    name: 'list_campaigns',
    description: 'List all campaigns with their status, budget, and performance metrics.',
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
    name: 'list_adsets',
    description: 'List ad sets, optionally filtered by campaign.',
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
    description: 'Pause a campaign (sets status to PAUSED). Requires user confirmation.',
    input_schema: {
      type: 'object' as const,
      properties: {
        campaign_id: { type: 'string', description: 'The campaign ID to pause' },
        campaign_name: { type: 'string', description: 'Human-readable name for confirmation' },
      },
      required: ['campaign_id', 'campaign_name'],
    },
  },
  {
    name: 'enable_campaign',
    description: 'Enable (unpause) a campaign (sets status to ACTIVE). Requires user confirmation.',
    input_schema: {
      type: 'object' as const,
      properties: {
        campaign_id: { type: 'string', description: 'The campaign ID to enable' },
        campaign_name: { type: 'string', description: 'Human-readable name for confirmation' },
      },
      required: ['campaign_id', 'campaign_name'],
    },
  },
  {
    name: 'set_daily_budget',
    description: 'Update the daily budget for a campaign. Requires user confirmation.',
    input_schema: {
      type: 'object' as const,
      properties: {
        campaign_id: { type: 'string', description: 'The campaign ID' },
        campaign_name: { type: 'string', description: 'Human-readable name for confirmation' },
        daily_budget_usd: { type: 'number', description: 'New daily budget in USD (e.g. 50.00)' },
      },
      required: ['campaign_id', 'campaign_name', 'daily_budget_usd'],
    },
  },
]

const ALL_TOOLS = [...READ_TOOLS, ...MUTATE_TOOLS]
const MUTATE_TOOL_NAMES = new Set(MUTATE_TOOLS.map((t) => t.name))

// ─── Schema ───────────────────────────────────────────────────────────────────

const MessageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string(),
})

const ChatRequestSchema = z.object({
  messages: z.array(MessageSchema).min(1),
  ad_account_id: z.string().min(1),
  approved_tool: z.object({
    tool_use_id: z.string(),
    tool_name: z.string(),
    input: z.record(z.unknown()),
    // Full response.content from Claude's turn — required to reconstruct the
    // tool_use block before the tool_result (Anthropic API requirement).
    assistant_content: z.array(z.unknown()).optional(),
  }).optional(),
})

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildSystemPrompt(): string {
  return `You are an expert Meta Ads analyst and manager embedded in the Xphere platform.
You have access to read tools (get_account_overview, list_campaigns, list_adsets) which you may call freely.
You also have access to mutation tools (pause_campaign, enable_campaign, set_daily_budget) which REQUIRE explicit user approval before execution.

When a user asks you to make a change:
1. Confirm what you intend to do and ask for confirmation if not already given.
2. Call the mutation tool — the system will intercept it and show the user an approval dialog.
3. After the user approves, the approved_tool will be sent back to you in the next message.

Always be specific about numbers, campaign names, and impacts. Never guess — use the read tools first.
Today: ${new Date().toISOString().split('T')[0]}`
}

function err(msg: string, status = 400) {
  return Response.json({ error: msg }, { status })
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function POST(request: NextRequest): Promise<Response> {
  const user = await getUser()
  if (!user) return err('Unauthorized', 401)
  if (user.email !== process.env.PLATFORM_ADMIN_EMAIL) return err('Forbidden', 403)

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return err('Invalid JSON')
  }

  const parsed = ChatRequestSchema.safeParse(body)
  if (!parsed.success) return err(parsed.error.message)

  const { messages, ad_account_id, approved_tool } = parsed.data

  const supabase = await createClient()
  const { data: orgId } = await supabase.rpc('get_current_org_id')
  if (!orgId) return err('No active org')

  const { data: conn } = await supabase
    .from('ads_connections')
    .select('encrypted_access_token')
    .eq('org_id', orgId as string)
    .eq('ad_account_id', ad_account_id)
    .eq('platform', 'meta')
    .eq('status', 'active')
    .maybeSingle()

  if (!conn) return err('No active Meta Ads connection', 404)

  const accessToken = await decrypt(conn.encrypted_access_token)
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

  // Build flat message array
  const apiMessages: Anthropic.MessageParam[] = messages.map((m) => ({
    role: m.role,
    content: m.content,
  }))

  // If the user just approved a mutation, reconstruct the proper tool_use + tool_result
  // turns. The Anthropic API requires a tool_use block in the assistant turn before
  // a tool_result can be provided.
  if (approved_tool) {
    let toolResultContent: string
    try {
      const result = await executeMutation(approved_tool.tool_name, approved_tool.input, ad_account_id, accessToken)
      toolResultContent = JSON.stringify(result)
    } catch (e) {
      const msg = e instanceof MetaAdsError ? e.message : 'Mutation failed'
      toolResultContent = JSON.stringify({ error: msg })
    }

    // Use the stored assistant_content (which includes TextBlock + ToolUseBlock) if
    // available; fall back to a minimal tool_use block so the API stays valid.
    const assistantContent = approved_tool.assistant_content?.length
      ? approved_tool.assistant_content as Anthropic.ContentBlock[]
      : [{ type: 'tool_use' as const, id: approved_tool.tool_use_id, name: approved_tool.tool_name, input: approved_tool.input }]

    apiMessages.push({ role: 'assistant', content: assistantContent })
    apiMessages.push({
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: approved_tool.tool_use_id, content: toolResultContent }],
    })
  }

  // Agentic loop — max 4 read-tool iterations, halts on mutating tool
  let iterCount = 0
  const MAX_READ_ITERATIONS = 4

  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      function write(event: string, data: string) {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${data}\n\n`))
      }

      try {
        let currentMessages = [...apiMessages]

        while (iterCount < MAX_READ_ITERATIONS) {
          iterCount++

          const response = await anthropic.messages.create({
            model: 'claude-opus-4-8',
            max_tokens: 4096,
            system: buildSystemPrompt(),
            tools: ALL_TOOLS,
            messages: currentMessages,
          })

          const textBlocks = response.content.filter((b): b is Anthropic.TextBlock => b.type === 'text')
          const toolBlocks = response.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')

          for (const block of textBlocks) {
            write('text', JSON.stringify({ text: block.text }))
          }

          if (toolBlocks.length > 0) {
            const toolBlock = toolBlocks[0]

            if (MUTATE_TOOL_NAMES.has(toolBlock.name)) {
              // Include the full response.content so the client can send it back
              // when the user approves, allowing proper conversation reconstruction.
              write('tool_approval_required', JSON.stringify({
                tool_use_id: toolBlock.id,
                tool_name: toolBlock.name,
                input: toolBlock.input,
                assistant_content: response.content,
              }))
              break
            }

            const toolResult = await resolveReadTool(toolBlock.name, toolBlock.input as Record<string, unknown>, ad_account_id, accessToken)
            write('tool_result', JSON.stringify({ tool_use_id: toolBlock.id, result: toolResult }))

            currentMessages = [
              ...currentMessages,
              { role: 'assistant', content: response.content },
              {
                role: 'user',
                content: [{ type: 'tool_result', tool_use_id: toolBlock.id, content: JSON.stringify(toolResult) }],
              },
            ]

            if (response.stop_reason === 'end_turn') break
            continue
          }

          break
        }

        write('done', '{}')
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'AI error'
        write('error', JSON.stringify({ error: msg }))
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  })
}

// ─── Tool resolution ──────────────────────────────────────────────────────────

async function resolveReadTool(
  name: string,
  input: Record<string, unknown>,
  adAccountId: string,
  accessToken: string,
): Promise<unknown> {
  const datePreset = (input.date_preset as string | undefined) ?? 'last_30d'

  switch (name) {
    case 'get_account_overview': {
      const [info, insights] = await Promise.all([
        getAdAccountInfo(adAccountId, accessToken),
        getInsights(adAccountId, accessToken, { level: 'account', datePreset: datePreset as never }),
      ])
      return { account: info, insights: insights.data[0] ?? null }
    }

    case 'list_campaigns': {
      const [campaigns, insights] = await Promise.all([
        listCampaigns(adAccountId, accessToken),
        getInsights(adAccountId, accessToken, { level: 'campaign', datePreset: datePreset as never }),
      ])
      const insightMap = new Map(insights.data.map((i) => [(i as unknown as Record<string, string>).campaign_id, i]))
      return campaigns.map((c) => ({ ...c, insights: insightMap.get(c.id) ?? null }))
    }

    case 'list_adsets': {
      const campaignId = input.campaign_id as string | undefined
      const [adsets, insights] = await Promise.all([
        listAdSets(adAccountId, accessToken, campaignId),
        getInsights(adAccountId, accessToken, { level: 'adset', datePreset: datePreset as never }),
      ])
      const insightMap = new Map(insights.data.map((i) => [(i as unknown as Record<string, string>).adset_id, i]))
      return adsets.map((s) => ({ ...s, insights: insightMap.get(s.id) ?? null }))
    }

    default:
      return { error: `Unknown tool: ${name}` }
  }
}

async function executeMutation(
  name: string,
  input: Record<string, unknown>,
  adAccountId: string,
  accessToken: string,
): Promise<unknown> {
  switch (name) {
    case 'pause_campaign':
      return updateCampaignStatus(input.campaign_id as string, 'PAUSED', accessToken)

    case 'enable_campaign':
      return updateCampaignStatus(input.campaign_id as string, 'ACTIVE', accessToken)

    case 'set_daily_budget': {
      const usd = (input.daily_budget_usd as number) ?? 0
      const cents = Math.round(usd * 100)
      return updateCampaignDailyBudget(input.campaign_id as string, cents, accessToken)
    }

    default:
      throw new Error(`Unknown mutation: ${name}`)
  }
}
