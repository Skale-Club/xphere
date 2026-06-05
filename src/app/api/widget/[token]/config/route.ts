import { createServiceRoleClient } from '@/lib/supabase/admin'
import { rateLimit } from '@/lib/rate-limit'

export const runtime = 'nodejs'

// S11 — rate-limit public widget config lookup: 30/min per IP (token enumeration prevention)
const RL_LIMIT = 30
const RL_WINDOW = 60

const DEFAULT_WIDGET_CONFIG = {
  displayName: 'AI Assistant',
  primaryColor: '#18181B',
  welcomeMessage: 'Hi! How can I help?',
} as const

function normalizeWidgetValue(value: string | null | undefined, fallback: string): string {
  if (typeof value !== 'string') return fallback

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : fallback
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ token: string }> }
): Promise<Response> {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
  const rl = await rateLimit(`widget:config:${ip}`, RL_LIMIT, RL_WINDOW)
  if (!rl.allowed) {
    return Response.json({ error: 'Too many requests' }, { status: 429 })
  }

  const { token } = await params

  const supabase = createServiceRoleClient()
  const { data: org, error } = await supabase
    .from('organizations')
    .select('is_active, widget_display_name, widget_primary_color, widget_welcome_message, widget_avatar_url, accent_color, widget_greeting_enabled, widget_greeting_message, widget_greeting_delay_seconds')
    .eq('widget_token', token)
    .single()

  if (error || !org || !org.is_active) {
    return Response.json({ error: 'Invalid or inactive token' }, { status: 401 })
  }

  const welcomeMessage = normalizeWidgetValue(org.widget_welcome_message, DEFAULT_WIDGET_CONFIG.welcomeMessage)
  // Clamp the greeting delay to 0–30s so a bad value can't hide the composer forever.
  const rawDelay = typeof org.widget_greeting_delay_seconds === 'number' ? org.widget_greeting_delay_seconds : 3
  const greetingDelaySeconds = Math.max(0, Math.min(30, rawDelay))

  return Response.json({
    displayName: normalizeWidgetValue(org.widget_display_name, DEFAULT_WIDGET_CONFIG.displayName),
    // Fall back to the company's brand accent so the widget matches the brand
    // out of the box; an explicit widget_primary_color still overrides it.
    primaryColor: normalizeWidgetValue(
      org.widget_primary_color,
      normalizeWidgetValue(org.accent_color, DEFAULT_WIDGET_CONFIG.primaryColor),
    ),
    welcomeMessage,
    avatarUrl: org.widget_avatar_url || null,
    // Greeting composer config (migration 1148). Greeting text falls back to the
    // welcome message when not explicitly set.
    greetingEnabled: org.widget_greeting_enabled !== false,
    greetingMessage: normalizeWidgetValue(org.widget_greeting_message, welcomeMessage),
    greetingDelaySeconds,
  })
}
