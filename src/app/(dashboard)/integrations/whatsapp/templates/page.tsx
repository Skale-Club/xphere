import { redirect } from 'next/navigation'
import Link from 'next/link'
import { RefreshCw } from 'lucide-react'

import { createClient, getUser } from '@/lib/supabase/server'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { SyncTemplatesButton } from './sync-templates-button'

interface TemplateRow {
  id: string
  meta_template_id: string
  name: string
  language: string
  category: 'MARKETING' | 'UTILITY' | 'AUTHENTICATION'
  status: 'APPROVED' | 'PENDING' | 'REJECTED' | 'PAUSED' | 'DISABLED'
  components: unknown
  body_variable_count: number
  header_variable_count: number
  synced_at: string
}

interface CloudAccount {
  id: string
  display_name: string
  phone_number_e164: string | null
  last_synced_at: string | null
}

export default async function WhatsAppTemplatesPage() {
  const user = await getUser()
  if (!user) redirect('/')
  const supabase = await createClient()
  const { data: orgId } = await supabase.rpc('get_current_org_id')
  if (!orgId) redirect('/')

  const { data: account } = await supabase
    .from('whatsapp_cloud_accounts')
    .select('id, display_name, phone_number_e164, last_synced_at')
    .eq('org_id', orgId)
    .eq('is_active', true)
    .maybeSingle<CloudAccount>()

  if (!account) {
    return (
      <div className="px-6 py-10 max-w-3xl">
        <h1 className="text-[18px] font-semibold text-text-primary mb-2">
          WhatsApp Templates
        </h1>
        <p className="text-[13px] text-text-secondary mb-4">
          You haven&apos;t connected WhatsApp Official yet.
        </p>
        <Button asChild>
          <Link href="/integrations">Go to Integrations</Link>
        </Button>
      </div>
    )
  }

  const { data: templates } = await supabase
    .from('whatsapp_templates')
    .select('*')
    .eq('cloud_account_id', account.id)
    .order('status', { ascending: true })
    .order('name', { ascending: true })
    .returns<TemplateRow[]>()

  const grouped = groupByStatus(templates ?? [])

  return (
    <div className="px-6 py-6 max-w-5xl">
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-[18px] font-semibold text-text-primary">WhatsApp Templates</h1>
          <p className="text-[13px] text-text-tertiary mt-0.5">
            {account.phone_number_e164 ?? account.display_name}
            {account.last_synced_at && (
              <span> · last synced {new Date(account.last_synced_at).toLocaleString()}</span>
            )}
          </p>
        </div>
        <SyncTemplatesButton />
      </div>

      {templates && templates.length > 0 ? (
        <div className="space-y-6">
          {(['APPROVED', 'PENDING', 'PAUSED', 'REJECTED', 'DISABLED'] as const).map((status) => {
            const list = grouped[status]
            if (!list || list.length === 0) return null
            return (
              <section key={status} className="space-y-2">
                <h2 className="text-[12px] font-medium uppercase tracking-wide text-text-tertiary">
                  {status} ({list.length})
                </h2>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                  {list.map((tpl) => (
                    <TemplateCard key={tpl.id} tpl={tpl} />
                  ))}
                </div>
              </section>
            )
          })}
        </div>
      ) : (
        <div className="rounded-[12px] border border-border-subtle bg-bg-secondary px-6 py-10 text-center">
          <RefreshCw className="h-8 w-8 mx-auto text-text-tertiary mb-3" />
          <h3 className="text-[14px] font-medium text-text-primary mb-1">No templates yet</h3>
          <p className="text-[12.5px] text-text-secondary max-w-md mx-auto">
            Create approved templates in Meta Business Manager, then click <strong>Sync from Meta</strong> above
            to pull them into xphere.
          </p>
        </div>
      )}
    </div>
  )
}

function TemplateCard({ tpl }: { tpl: TemplateRow }) {
  const body = extractBody(tpl.components)
  return (
    <div className="rounded-[10px] border border-border bg-bg-secondary p-4 space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[13px] font-medium text-text-primary">{tpl.name}</span>
        <Badge variant="outline" className="text-[10px] uppercase">
          {tpl.language}
        </Badge>
        <Badge variant="outline" className="text-[10px] uppercase">
          {tpl.category}
        </Badge>
        <Badge className={`ml-auto text-[10px] ${STATUS_COLOR[tpl.status]}`}>{tpl.status}</Badge>
      </div>
      {body && (
        <p className="text-[12.5px] text-text-secondary whitespace-pre-wrap leading-relaxed">
          {highlightVariables(body)}
        </p>
      )}
      <div className="flex items-center gap-3 pt-1 text-[11px] text-text-tertiary">
        <span>{tpl.body_variable_count} body var{tpl.body_variable_count !== 1 ? 's' : ''}</span>
        {tpl.header_variable_count > 0 && (
          <span>· {tpl.header_variable_count} header var{tpl.header_variable_count !== 1 ? 's' : ''}</span>
        )}
      </div>
    </div>
  )
}

const STATUS_COLOR: Record<TemplateRow['status'], string> = {
  APPROVED: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
  PENDING: 'bg-amber-500/20 text-amber-300 border-amber-500/30',
  REJECTED: 'bg-rose-500/20 text-rose-300 border-rose-500/30',
  PAUSED: 'bg-orange-500/20 text-orange-300 border-orange-500/30',
  DISABLED: 'bg-zinc-500/20 text-zinc-300 border-zinc-500/30',
}

function groupByStatus(rows: TemplateRow[]) {
  const out: Record<TemplateRow['status'], TemplateRow[]> = {
    APPROVED: [],
    PENDING: [],
    REJECTED: [],
    PAUSED: [],
    DISABLED: [],
  }
  for (const r of rows) out[r.status].push(r)
  return out
}

function extractBody(components: unknown): string | null {
  if (!Array.isArray(components)) return null
  const body = (components as Array<{ type?: string; text?: string }>).find(
    (c) => c.type === 'BODY',
  )
  return body?.text ?? null
}

function highlightVariables(text: string): React.ReactNode {
  const parts = text.split(/(\{\{\d+\}\})/)
  return parts.map((part, i) =>
    /^\{\{\d+\}\}$/.test(part) ? (
      <span key={i} className="px-1 rounded bg-accent/15 text-accent font-mono text-[11.5px]">
        {part}
      </span>
    ) : (
      <span key={i}>{part}</span>
    ),
  )
}
