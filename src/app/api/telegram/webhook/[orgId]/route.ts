// src/app/api/telegram/webhook/[orgId]/route.ts
// Telegram webhook receiver | always returns HTTP 200.
// One URL per org: https://xphere.app/api/telegram/webhook/{orgId}
// SEED-034.

import { after } from 'next/server'

import { createServiceRoleClient } from '@/lib/supabase/admin'
import {
  processTelegramUpdate,
  type TelegramBotContext,
} from '@/lib/telegram/process-update'
import type { TelegramUpdate } from '@/lib/telegram/types'
import { captureApiError } from '@/lib/api-error'

export const runtime = 'nodejs'

export async function POST(
  request: Request,
  { params }: { params: Promise<{ orgId: string }> },
): Promise<Response> {
  try {
    const { orgId } = await params

    // Parse update body | bail out (still 200) on malformed JSON
    let update: TelegramUpdate | null = null
    try {
      update = (await request.json()) as TelegramUpdate
    } catch {
      return Response.json({ ok: true })
    }
    if (!update || typeof update !== 'object') {
      return Response.json({ ok: true })
    }

    // Resolve the active Telegram bot for this org
    const supabase = createServiceRoleClient()
    const { data: bot, error } = await supabase
      .from('telegram_bots')
      .select('id, org_id, bot_token_encrypted, automation_enabled, agent_id')
      .eq('org_id', orgId)
      .eq('is_active', true)
      .maybeSingle()

    if (error || !bot) {
      return Response.json({ ok: true })
    }

    const botContext: TelegramBotContext = {
      id: bot.id,
      org_id: bot.org_id,
      bot_token_encrypted: bot.bot_token_encrypted,
      automation_enabled: bot.automation_enabled,
      agent_id: bot.agent_id,
    }

    // Hand off processing to the background after responding
    after(() =>
      processTelegramUpdate(update as TelegramUpdate, botContext).catch((err) => {
        console.error('[telegram/webhook] processUpdate error:', err)
        captureApiError(err)
      }),
    )

    return Response.json({ ok: true })
  } catch (err) {
    console.error('[telegram/webhook] outer error:', err)
    captureApiError(err)
    return Response.json({ ok: true })
  }
}
