// src/lib/telegram/notification-templates.ts
// Pre-built HTML templates used by the platform-default Telegram notification
// workflows (supabase/seeds/workflows/notify-*.yaml). These templates expect
// the workflow runtime to inject the variables | they're plain JS helpers
// callable from anywhere (executors, server actions, ad-hoc).
//
// Telegram HTML supports: <b>, <i>, <u>, <s>, <code>, <pre>, <a href="…">.
// We always escape user-supplied strings to avoid breaking the parse_mode.
// SEED-034.

export function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function safe(value: string | null | undefined, fallback = '-'): string {
  if (value === null || value === undefined) return fallback
  const trimmed = String(value).trim()
  return trimmed.length === 0 ? fallback : escapeHtml(trimmed)
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '-'
  try {
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return '-'
    return d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
  } catch {
    return '-'
  }
}

function relativeTime(iso: string | null | undefined): string {
  if (!iso) return '-'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '-'
  const diffMs = Date.now() - d.getTime()
  const minutes = Math.round(diffMs / 60000)
  if (minutes < 1) return 'agora há pouco'
  if (minutes < 60) return `há ${minutes} min`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `há ${hours} h`
  const days = Math.round(hours / 24)
  return `há ${days} d`
}

export interface NewLeadContact {
  name?: string | null
  phone?: string | null
  email?: string | null
}

export interface PendingTask {
  title: string
  assigned_to_name?: string | null
  due_at?: string | null
}

export interface WorkflowRun {
  workflow_name: string
  error_detail?: string | null
}

export interface NewConversation {
  visitor_name?: string | null
  visitor_phone?: string | null
  channel: string
  last_message?: string | null
}

export interface MissedCall {
  caller_name?: string | null
  customer_number?: string | null
  created_at?: string | null
}

export const TELEGRAM_TEMPLATES = {
  new_lead: (contact: NewLeadContact): string =>
    [
      `🆕 <b>Novo Lead</b>`,
      `👤 ${safe(contact.name, 'Sem nome')}`,
      `📱 ${safe(contact.phone)}`,
      `📧 ${safe(contact.email)}`,
    ].join('\n'),

  pending_task: (task: PendingTask): string =>
    [
      `⏰ <b>Task Pendente</b>`,
      `📋 ${safe(task.title)}`,
      `👤 ${safe(task.assigned_to_name, 'Sem responsável')}`,
      `📅 Vence: ${escapeHtml(formatDate(task.due_at))}`,
    ].join('\n'),

  workflow_failed: (wf: WorkflowRun): string =>
    [
      `❌ <b>Workflow Falhou</b>`,
      `⚡ ${safe(wf.workflow_name)}`,
      `🔴 Erro: ${safe(wf.error_detail, 'Erro desconhecido')}`,
    ].join('\n'),

  new_conversation: (conv: NewConversation): string => {
    const preview = (conv.last_message ?? '').slice(0, 120)
    return [
      `💬 <b>Nova Conversa</b>`,
      `👤 ${safe(conv.visitor_name ?? conv.visitor_phone)}`,
      `📲 ${escapeHtml(conv.channel.toUpperCase())}`,
      `💬 ${safe(preview)}`,
    ].join('\n')
  },

  missed_call: (call: MissedCall): string =>
    [
      `📞 <b>Ligação Perdida</b>`,
      `👤 ${safe(call.caller_name ?? call.customer_number)}`,
      `🕐 ${escapeHtml(relativeTime(call.created_at))}`,
    ].join('\n'),
}
