#!/usr/bin/env node
// Seeds the public demo organization with coherent, obviously-fake sample data
// so the /demo experience never looks empty. Idempotent: every row uses a fixed
// UUID and is upserted, so re-running is a no-op beyond updates.
//
// Uses the service-role key, which bypasses RLS — including the demo write-block
// from migration 1114 — so seeding works while the demo *user* stays read-only.
//
// Usage:
//   tsx scripts/seed-demo-org.ts                 # seed (upsert)
//   tsx scripts/seed-demo-org.ts --dry-run       # print plan only
//   tsx scripts/seed-demo-org.ts --reset         # delete demo data, then seed
//
// Env: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, DEMO_ORG_ID

import { createClient } from '@supabase/supabase-js'
import type { Database } from '../src/types/database'

const DEMO_ORG_ID = process.env.DEMO_ORG_ID || '0000de00-0000-4000-8000-000000000001'

// Deterministic ids → idempotent upserts. Readable hex prefixes per entity type.
const id = (kind: string, n: number) =>
  `0000de00-${kind}-4000-8000-${String(n).padStart(12, '0')}`

const A = (n: number) => id('acc0', n) // accounts
const C = (n: number) => id('c0c0', n) // contacts
const O = (n: number) => id('0bb0', n) // opportunities
const S = (n: number) => id('5746', n) // stages
const V = (n: number) => id('c0a0', n) // conversations
const M = (n: number) => id('de57', n) // messages
const T = (n: number) => id('7a54', n) // tasks
const N = (n: number) => id('0e70', n) // notes
const CC = (n: number) => id('cac0', n) // campaign contacts
const PIPELINE_ID = id('9170', 1)
const CAMPAIGN_ID = id('ca00', 1)

const daysAgo = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString()

// ─── Demo data ────────────────────────────────────────────────────────────────
const accounts = [
  { id: A(1), org_id: DEMO_ORG_ID, name: 'Northwind Trading (Demo)', domain: 'northwind.example', industry: 'Wholesale', size: '51-200', website: 'https://northwind.example', source: 'manual' as const },
  { id: A(2), org_id: DEMO_ORG_ID, name: 'Acme Robotics (Demo)', domain: 'acme-robotics.example', industry: 'Manufacturing', size: '201-500', website: 'https://acme-robotics.example', source: 'manual' as const },
  { id: A(3), org_id: DEMO_ORG_ID, name: 'Lumen Health (Demo)', domain: 'lumenhealth.example', industry: 'Healthcare', size: '11-50', website: 'https://lumenhealth.example', source: 'manual' as const },
]

const contacts = [
  { id: C(1), org_id: DEMO_ORG_ID, name: 'Maria Demo', first_name: 'Maria', last_name: 'Demo', email: 'maria.demo@northwind.example', phone: '+15555550101', account_id: A(1), company: 'Northwind Trading (Demo)', source: 'manual' as const, tags: ['lead', 'newsletter'] },
  { id: C(2), org_id: DEMO_ORG_ID, name: 'John Sample', first_name: 'John', last_name: 'Sample', email: 'john.sample@northwind.example', phone: '+15555550102', account_id: A(1), company: 'Northwind Trading (Demo)', source: 'manual' as const, tags: ['customer'] },
  { id: C(3), org_id: DEMO_ORG_ID, name: 'Priya Example', first_name: 'Priya', last_name: 'Example', email: 'priya.example@acme-robotics.example', phone: '+15555550103', account_id: A(2), company: 'Acme Robotics (Demo)', source: 'manual' as const, tags: ['lead'] },
  { id: C(4), org_id: DEMO_ORG_ID, name: 'Tomás Mostra', first_name: 'Tomás', last_name: 'Mostra', email: 'tomas.mostra@acme-robotics.example', phone: '+15555550104', account_id: A(2), company: 'Acme Robotics (Demo)', source: 'manual' as const, tags: ['vip'] },
  { id: C(5), org_id: DEMO_ORG_ID, name: 'Grace Placeholder', first_name: 'Grace', last_name: 'Placeholder', email: 'grace@lumenhealth.example', phone: '+15555550105', account_id: A(3), company: 'Lumen Health (Demo)', source: 'manual' as const, tags: ['lead', 'demo'] },
  { id: C(6), org_id: DEMO_ORG_ID, name: 'Carlos Teste', first_name: 'Carlos', last_name: 'Teste', email: 'carlos.teste@lumenhealth.example', phone: '+15555550106', account_id: A(3), company: 'Lumen Health (Demo)', source: 'manual' as const, tags: ['customer'] },
  { id: C(7), org_id: DEMO_ORG_ID, name: 'Ana Amostra', first_name: 'Ana', last_name: 'Amostra', email: 'ana.amostra@northwind.example', phone: '+15555550107', account_id: A(1), company: 'Northwind Trading (Demo)', source: 'manual' as const, tags: ['lead'] },
  { id: C(8), org_id: DEMO_ORG_ID, name: 'Sven Fixture', first_name: 'Sven', last_name: 'Fixture', email: 'sven.fixture@acme-robotics.example', phone: '+15555550108', account_id: A(2), company: 'Acme Robotics (Demo)', source: 'manual' as const, tags: ['newsletter'] },
]

const pipeline = { id: PIPELINE_ID, org_id: DEMO_ORG_ID, name: 'Sales Pipeline (Demo)', is_default: true, position: 0 }
const stages = [
  { id: S(1), pipeline_id: PIPELINE_ID, org_id: DEMO_ORG_ID, name: 'New', position: 0, color: '#64748b' },
  { id: S(2), pipeline_id: PIPELINE_ID, org_id: DEMO_ORG_ID, name: 'Qualified', position: 1, color: '#3b82f6' },
  { id: S(3), pipeline_id: PIPELINE_ID, org_id: DEMO_ORG_ID, name: 'Proposal', position: 2, color: '#a855f7' },
  { id: S(4), pipeline_id: PIPELINE_ID, org_id: DEMO_ORG_ID, name: 'Won', position: 3, color: '#22c55e', is_won: true },
  { id: S(5), pipeline_id: PIPELINE_ID, org_id: DEMO_ORG_ID, name: 'Lost', position: 4, color: '#ef4444', is_lost: true },
]

const opportunities = [
  { id: O(1), org_id: DEMO_ORG_ID, pipeline_id: PIPELINE_ID, stage_id: S(1), contact_id: C(1), account_id: A(1), title: 'Northwind — annual supply contract', value: 24000, currency: 'USD', status: 'open' as const, position: 0, expected_close_date: daysAgo(-21) },
  { id: O(2), org_id: DEMO_ORG_ID, pipeline_id: PIPELINE_ID, stage_id: S(2), contact_id: C(3), account_id: A(2), title: 'Acme — robotics line automation', value: 88000, currency: 'USD', status: 'open' as const, position: 0, expected_close_date: daysAgo(-30) },
  { id: O(3), org_id: DEMO_ORG_ID, pipeline_id: PIPELINE_ID, stage_id: S(3), contact_id: C(4), account_id: A(2), title: 'Acme — support retainer', value: 15000, currency: 'USD', status: 'open' as const, position: 0, expected_close_date: daysAgo(-10) },
  { id: O(4), org_id: DEMO_ORG_ID, pipeline_id: PIPELINE_ID, stage_id: S(4), contact_id: C(6), account_id: A(3), title: 'Lumen — onboarding package', value: 12500, currency: 'USD', status: 'won' as const, position: 0, expected_close_date: daysAgo(5) },
  { id: O(5), org_id: DEMO_ORG_ID, pipeline_id: PIPELINE_ID, stage_id: S(2), contact_id: C(7), account_id: A(1), title: 'Northwind — pilot program', value: 6000, currency: 'USD', status: 'open' as const, position: 1, expected_close_date: daysAgo(-14) },
  { id: O(6), org_id: DEMO_ORG_ID, pipeline_id: PIPELINE_ID, stage_id: S(5), contact_id: C(5), account_id: A(3), title: 'Lumen — legacy migration', value: 30000, currency: 'USD', status: 'lost' as const, position: 0, expected_close_date: daysAgo(20) },
]

const opportunityActivities = [
  { id: id('0ac0', 1), org_id: DEMO_ORG_ID, opportunity_id: O(1), type: 'note' as const, content: 'Intro call booked. Strong interest in annual pricing.', created_at: daysAgo(6) },
  { id: id('0ac0', 2), org_id: DEMO_ORG_ID, opportunity_id: O(2), type: 'note' as const, content: 'Sent automation scoping doc; awaiting feedback.', created_at: daysAgo(3) },
  { id: id('0ac0', 3), org_id: DEMO_ORG_ID, opportunity_id: O(4), type: 'won' as const, content: 'Closed-won 🎉 onboarding scheduled.', created_at: daysAgo(5) },
]

const conversations = [
  { id: V(1), org_id: DEMO_ORG_ID, widget_token: 'demo-conv-1', channel: 'whatsapp', status: 'open', contact_id: C(1), visitor_name: 'Maria Demo', last_message: 'Perfect, talk soon!', last_message_at: daysAgo(1), bot_status: 'paused' },
  { id: V(2), org_id: DEMO_ORG_ID, widget_token: 'demo-conv-2', channel: 'widget', status: 'open', contact_id: C(3), visitor_name: 'Priya Example', last_message: 'Can you send a quote?', last_message_at: daysAgo(2), bot_status: 'paused' },
  { id: V(3), org_id: DEMO_ORG_ID, widget_token: 'demo-conv-3', channel: 'instagram', status: 'closed', contact_id: C(6), visitor_name: 'Carlos Teste', last_message: 'Thanks for the help!', last_message_at: daysAgo(4), bot_status: 'paused' },
]

const messages = [
  { id: M(1), conversation_id: V(1), org_id: DEMO_ORG_ID, role: 'user', content: 'Hi! Do you offer annual contracts?', created_at: daysAgo(1) },
  { id: M(2), conversation_id: V(1), org_id: DEMO_ORG_ID, role: 'assistant', content: 'Absolutely — I can put together annual pricing for you.', created_at: daysAgo(1) },
  { id: M(3), conversation_id: V(1), org_id: DEMO_ORG_ID, role: 'user', content: 'Perfect, talk soon!', created_at: daysAgo(1) },
  { id: M(4), conversation_id: V(2), org_id: DEMO_ORG_ID, role: 'user', content: 'Can you send a quote?', created_at: daysAgo(2) },
  { id: M(5), conversation_id: V(2), org_id: DEMO_ORG_ID, role: 'assistant', content: 'Sure! What volume are you expecting this quarter?', created_at: daysAgo(2) },
  { id: M(6), conversation_id: V(3), org_id: DEMO_ORG_ID, role: 'user', content: 'Thanks for the help!', created_at: daysAgo(4) },
]

const tasks = [
  { id: T(1), org_id: DEMO_ORG_ID, title: 'Follow up with Northwind on annual contract', status: 'todo' as const, priority: 'high' as const, due_date: daysAgo(-2), entity_type: 'opportunity' as const, entity_id: O(1) },
  { id: T(2), org_id: DEMO_ORG_ID, title: 'Prepare automation proposal for Acme', status: 'in_progress' as const, priority: 'medium' as const, due_date: daysAgo(-1), entity_type: 'opportunity' as const, entity_id: O(2) },
  { id: T(3), org_id: DEMO_ORG_ID, title: 'Schedule Lumen onboarding kickoff', status: 'todo' as const, priority: 'medium' as const, due_date: daysAgo(-4), entity_type: 'opportunity' as const, entity_id: O(4) },
  { id: T(4), org_id: DEMO_ORG_ID, title: 'Send welcome sequence to new leads', status: 'done' as const, priority: 'low' as const, due_date: daysAgo(3) },
]

const notes = [
  { id: N(1), org_id: DEMO_ORG_ID, title: 'Account brief: Northwind', content: 'Wholesale distributor, price-sensitive, decision by Q3.', pinned: true, entity_type: 'account' as const, entity_id: A(1) },
  { id: N(2), org_id: DEMO_ORG_ID, title: 'Acme priorities', content: 'Cares about uptime and integration with existing ERP.', entity_type: 'account' as const, entity_id: A(2) },
  { id: N(3), org_id: DEMO_ORG_ID, content: 'Reminder: demo data is fictional — for showcase only.' },
]

const campaign = {
  id: CAMPAIGN_ID,
  organization_id: DEMO_ORG_ID,
  name: 'Q2 Re-engagement (Demo)',
  description: 'Sample completed outbound campaign for the demo.',
  channel: 'calls' as const,
  campaign_type: 'one_time' as const,
  status: 'completed' as const,
  calls_per_minute: 5,
  started_at: daysAgo(9),
  completed_at: daysAgo(8),
  metrics: { total: 5, completed: 3, no_answer: 1, failed: 1 },
}
const campaignContacts = [
  { id: CC(1), campaign_id: CAMPAIGN_ID, organization_id: DEMO_ORG_ID, name: 'Maria Demo', phone: '+15555550101', status: 'completed' as const, called_at: daysAgo(9), completed_at: daysAgo(9) },
  { id: CC(2), campaign_id: CAMPAIGN_ID, organization_id: DEMO_ORG_ID, name: 'John Sample', phone: '+15555550102', status: 'completed' as const, called_at: daysAgo(9), completed_at: daysAgo(9) },
  { id: CC(3), campaign_id: CAMPAIGN_ID, organization_id: DEMO_ORG_ID, name: 'Priya Example', phone: '+15555550103', status: 'no_answer' as const, called_at: daysAgo(9) },
  { id: CC(4), campaign_id: CAMPAIGN_ID, organization_id: DEMO_ORG_ID, name: 'Grace Placeholder', phone: '+15555550105', status: 'completed' as const, called_at: daysAgo(9), completed_at: daysAgo(9) },
  { id: CC(5), campaign_id: CAMPAIGN_ID, organization_id: DEMO_ORG_ID, name: 'Sven Fixture', phone: '+15555550108', status: 'failed' as const, called_at: daysAgo(9), error_detail: 'busy' },
]

type Supa = ReturnType<typeof createClient<Database>>
// Loose view for dynamic (string-keyed) table access in the generic seed loop.
type DynDb = { from: (t: string) => {
  upsert: (rows: Record<string, unknown>[], opts?: { onConflict?: string }) => Promise<{ error: { message: string } | null }>
  delete: () => { eq: (c: string, v: string) => Promise<{ error: { message: string } | null }> }
} }

// Order matters for FKs (parents first); reverse for deletion.
const SEED_PLAN: { table: string; rows: Record<string, unknown>[] }[] = [
  { table: 'accounts', rows: accounts },
  { table: 'contacts', rows: contacts },
  { table: 'pipelines', rows: [pipeline] },
  { table: 'pipeline_stages', rows: stages },
  { table: 'opportunities', rows: opportunities },
  { table: 'opportunity_activities', rows: opportunityActivities },
  { table: 'conversations', rows: conversations },
  { table: 'conversation_messages', rows: messages },
  { table: 'tasks', rows: tasks },
  { table: 'notes', rows: notes },
  { table: 'campaigns', rows: [campaign] },
  { table: 'campaign_contacts', rows: campaignContacts },
]

async function reset(supabase: Supa) {
  const db = supabase as unknown as DynDb
  const orgCol = (t: string) =>
    t === 'campaigns' || t === 'campaign_contacts' ? 'organization_id' : 'org_id'
  // Children first.
  for (const { table } of [...SEED_PLAN].reverse()) {
    const { error } = await db.from(table).delete().eq(orgCol(table), DEMO_ORG_ID)
    if (error) console.warn(`[reset] ${table}: ${error.message}`)
    else console.log(`[reset] cleared ${table}`)
  }
}

async function seed(supabase: Supa) {
  const db = supabase as unknown as DynDb
  for (const { table, rows } of SEED_PLAN) {
    const { error } = await db.from(table).upsert(rows, { onConflict: 'id' })
    if (error) {
      console.error(`[seed] ${table} FAILED: ${error.message}`)
      process.exitCode = 1
    } else {
      console.log(`[seed] ${table}: ${rows.length} row(s) upserted`)
    }
  }
}

async function main() {
  const args = new Set(process.argv.slice(2))
  const dryRun = args.has('--dry-run')
  const doReset = args.has('--reset')

  console.log(`Demo org: ${DEMO_ORG_ID}`)
  if (dryRun) {
    for (const { table, rows } of SEED_PLAN) console.log(`  would upsert ${rows.length} → ${table}`)
    console.log('\n--dry-run: no writes performed.')
    console.log('Workflows: run `tsx scripts/load-workflow-seeds.ts --org=' + DEMO_ORG_ID + '` separately.')
    return
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    console.error('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.')
    process.exit(2)
  }
  const supabase = createClient<Database>(url, key, { auth: { persistSession: false } })

  if (doReset) await reset(supabase)
  await seed(supabase)

  console.log('\nDone. Seed demo workflows with:')
  console.log(`  tsx scripts/load-workflow-seeds.ts --org=${DEMO_ORG_ID}`)
}

main().catch((err) => {
  console.error('Unhandled error:', err)
  process.exit(99)
})
