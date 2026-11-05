#!/usr/bin/env node
// Development-database seed.
//
// Since 2026-11-05 production runs on a self-hosted Postgres. The Supabase
// project in .env.local is the DEV database and must only ever hold obviously
// fake sample data. This script (re)builds that content and refuses to run
// against anything that is not the declared dev project.
//
// Usage:
//   npm run db:seed-dev -- --dry-run     # guard check + plan, no writes
//   npm run db:seed-dev                  # additive, idempotent seed (fixed UUIDs, upserts)
//   npm run db:seed-dev -- --reset       # wipe tenant data, keep the owner login, then seed
//
// Flags:
//   --dry-run          print guard result, wipe/keep table lists and the seed plan; a
//                      READ ONLY connection is used to list tables, nothing is written
//   --reset            wipe tenant data first (see "Wipe rules")
//   --skip-workflows   do not load the platform-default workflows at the end
//   --allow-no-owner   seed even though no DEV_KEEP_USER_EMAILS user exists (nobody can log in)
//
// Env (read from the process, then from .env.local without overriding):
//   DEV_SUPABASE_PROJECT_REF   ref of the dev project; the only project this script may touch
//   DEV_KEEP_USER_EMAILS       comma list; those users (+ their Google identities and sessions)
//                              survive --reset and become owner of every sample org
//   NEXT_PUBLIC_SUPABASE_URL, DATABASE_URL (pooler, port 6543), ENCRYPTION_SECRET,
//   SUPABASE_SERVICE_ROLE_KEY (only for the workflow loader)
//
// Safety guard (runs before any connection):
//   * DEV_SUPABASE_PROJECT_REF must be set,
//   * the host of NEXT_PUBLIC_SUPABASE_URL must start with "<ref>.",
//   * DATABASE_URL user or host must contain the ref as a dot-separated label and be a
//     supabase.com / supabase.co host,
//   * SUPABASE_REST_URL or DB_JWT_SECRET set means production mode: refuse.
//   Only the ref is ever printed, never a URL or a key.
//
// Wipe rules (--reset), discovered from the catalog at run time:
//   * WIPE   every base table in public with an org_id / organization_id column,
//            organizations, users, and tables with a user_id column and no org column,
//            plus any table that has a foreign key into one of those (computed
//            transitively, this replaces TRUNCATE ... CASCADE so nothing is wiped
//            by surprise: the full list is printed in --dry-run).
//   * KEEP   every other public table (plans, catalogs, landing/seo config, global
//            knowledge config, platform settings...) and the migration history
//            (supabase_migrations schema). Rows that must survive inside wiped tables
//            (kept users, their google identities / sessions, rows whose org column is
//            NULL, global knowledge documents, protected config reached through an FK)
//            are copied to temp tables before the TRUNCATE and put back after it.
//   * Supabase Storage objects are NOT touched.
//
// Everything runs in one transaction on the transaction-mode pooler (no SET outside a
// transaction). Each seed section runs under a SAVEPOINT: a failing section is rolled
// back, reported at the end, and the rest continues (exit code 1).

import { Client } from 'pg'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { encrypt } from '../src/lib/crypto'

type Row = Record<string, unknown>

// ─── CLI ──────────────────────────────────────────────────────────────────────

const KNOWN_FLAGS = new Set(['--dry-run', '--reset', '--skip-workflows', '--allow-no-owner'])
const argv = process.argv.slice(2)
const unknownFlags = argv.filter((a) => !KNOWN_FLAGS.has(a))
if (unknownFlags.length > 0) {
  console.error(`Unknown argument(s): ${unknownFlags.join(' ')}`)
  console.error(`Known: ${[...KNOWN_FLAGS].join(' ')}`)
  process.exit(2)
}
const DRY_RUN = argv.includes('--dry-run')
const DO_RESET = argv.includes('--reset')
const SKIP_WORKFLOWS = argv.includes('--skip-workflows')
const ALLOW_NO_OWNER = argv.includes('--allow-no-owner')

// ─── Env loading (no dotenv in this repo) ─────────────────────────────────────

function loadDotEnvLocal(): void {
  const path = resolve(process.cwd(), '.env.local')
  if (!existsSync(path)) return
  for (const raw of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq < 1) continue
    const key = line.slice(0, eq).trim()
    let value = line.slice(eq + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    if (process.env[key] === undefined) process.env[key] = value
  }
}

// ─── Safety guard ─────────────────────────────────────────────────────────────

interface GuardResult {
  ok: boolean
  ref: string
  problems: string[]
}

function hostnameOf(raw: string | undefined): string | null {
  if (!raw) return null
  try {
    return new URL(raw).hostname.toLowerCase()
  } catch {
    return null
  }
}

function dbUserAndHost(raw: string | undefined): { user: string; host: string } | null {
  if (!raw) return null
  try {
    const u = new URL(raw)
    return { user: decodeURIComponent(u.username).toLowerCase(), host: u.hostname.toLowerCase() }
  } catch {
    return null
  }
}

function evaluateGuard(): GuardResult {
  const problems: string[] = []
  const ref = (process.env.DEV_SUPABASE_PROJECT_REF ?? '').trim().toLowerCase()

  if (!ref) {
    problems.push('DEV_SUPABASE_PROJECT_REF is not set.')
  } else if (!/^[a-z0-9]{8,40}$/.test(ref)) {
    problems.push('DEV_SUPABASE_PROJECT_REF does not look like a Supabase project ref.')
  }

  const apiHost = hostnameOf(process.env.NEXT_PUBLIC_SUPABASE_URL)
  if (!apiHost) {
    problems.push('NEXT_PUBLIC_SUPABASE_URL is missing or not a URL.')
  } else if (ref && !apiHost.startsWith(`${ref}.`)) {
    problems.push('NEXT_PUBLIC_SUPABASE_URL does not belong to DEV_SUPABASE_PROJECT_REF.')
  }

  const db = dbUserAndHost(process.env.DATABASE_URL)
  if (!db) {
    problems.push('DATABASE_URL is missing or not a connection URL.')
  } else {
    const labels = [...db.user.split('.'), ...db.host.split('.')]
    if (ref && !labels.includes(ref)) {
      problems.push('DATABASE_URL user/host does not contain DEV_SUPABASE_PROJECT_REF.')
    }
    if (!/\.supabase\.(com|co)$/.test(db.host)) {
      problems.push('DATABASE_URL host is not a Supabase host.')
    }
  }

  if (process.env.SUPABASE_REST_URL) {
    problems.push('SUPABASE_REST_URL is set: this environment is in production mode.')
  }
  if (process.env.DB_JWT_SECRET) {
    problems.push('DB_JWT_SECRET is set: this environment is in production mode.')
  }

  return { ok: problems.length === 0, ref, problems }
}

// ─── Deterministic helpers ────────────────────────────────────────────────────

class Rng {
  private s: number
  constructor(seed: number) {
    this.s = seed >>> 0
  }
  next(): number {
    this.s = (this.s + 0x6d2b79f5) >>> 0
    let t = this.s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1))
  }
  chance(p: number): boolean {
    return this.next() < p
  }
  pick<T>(arr: readonly T[]): T {
    return arr[Math.floor(this.next() * arr.length)]
  }
  shuffleCopy<T>(arr: readonly T[]): T[] {
    const out = [...arr]
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1))
      const tmp = out[i]
      out[i] = out[j]
      out[j] = tmp
    }
    return out
  }
  weighted<T>(items: ReadonlyArray<readonly [T, number]>): T {
    const total = items.reduce((s, [, w]) => s + w, 0)
    let r = this.next() * total
    for (const [value, weight] of items) {
      r -= weight
      if (r < 0) return value
    }
    return items[items.length - 1][0]
  }
}

const HOUR = 3_600_000
const DAY = 86_400_000
// Anchored to the current hour so a re-run moves timestamps by hours, not randomly.
const NOW = Math.floor(Date.now() / HOUR) * HOUR
const iso = (ms: number): string => new Date(ms).toISOString()
const ago = (days: number, minutes = 0): string => iso(NOW - days * DAY - minutes * 60_000)
const ahead = (days: number, minutes = 0): string => iso(NOW + days * DAY + minutes * 60_000)
const dateOnly = (ms: number): string => iso(ms).slice(0, 10)
const TODAY_UTC = Math.floor(NOW / DAY) * DAY

const KIND = {
  org: 'a0a0', user: '05e0', member: '0b01', role: 'b01e', perm: '9e41', tag: '7a90',
  field: 'cfd0', pipeline: '91e0', stage: '5746', account: 'acc0', contact: 'c0c0',
  psource: '9570', plist: '9115', pmember: '9e30', wa: 'a9a0', opp: '0bb0', oppc: '0bc0',
  oact: '0ac0', label: '1abe', conv: 'c0a0', msg: 'de57', calllog: 'ca11', aicall: 'ca12',
  camp: 'ca00', cc: 'cac0', cr: 'ca0e', task: '7a54', note: '0e70', evt: 'e7e0',
  booking: 'b00c', avail: 'a7a0', notif: '90f1', ksrc: '4b50', integ: '1e70', tnum: '7011',
  tmpl: 'e707',
} as const

for (const [name, kind] of Object.entries(KIND)) {
  if (!/^[0-9a-f]{4}$/.test(kind)) throw new Error(`KIND.${name} is not 4 hex chars`)
}

/** Deterministic UUID: de5e0000-<kind>-4000-8<org>-<n>. Same inputs, same id, forever. */
function uid(kind: string, org: number, n: number): string {
  return `de5e0000-${kind}-4000-8${String(org).padStart(3, '0')}-${String(n).padStart(12, '0')}`
}

const SEED_ORG_IDS = [1, 2, 3].map((i) => uid(KIND.org, 0, i))

function slugify(s: string): string {
  return s.toLowerCase().replace(/\(dev\)/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}

function fnv1a(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/**
 * Deterministic 1536-d unit vector from hashed unigrams + bigrams. Texts that share
 * words land close together, so match_documents returns stable, plausible results.
 */
function embedText(text: string): number[] {
  const v = new Array<number>(1536).fill(0)
  const tokens = text.toLowerCase().match(/[a-z0-9']+/g) ?? []
  const add = (key: string, weight: number): void => {
    const idx = fnv1a(key) % 1536
    const sign = (fnv1a(`s:${key}`) & 1) === 1 ? 1 : -1
    v[idx] += sign * weight
  }
  tokens.forEach((t, i) => {
    add(t, 1)
    if (i > 0) add(`${tokens[i - 1]} ${t}`, 0.5)
  })
  if (tokens.length === 0) v[0] = 1
  const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1
  return v.map((x) => x / norm)
}

const vectorLiteral = (v: number[]): string => `[${v.map((x) => x.toFixed(8)).join(',')}]`

// ─── Sample-data vocabulary ───────────────────────────────────────────────────

const FIRST = ['Alex', 'Jordan', 'Taylor', 'Morgan', 'Casey', 'Riley', 'Avery', 'Quinn', 'Jamie', 'Skyler',
  'Dana', 'Robin', 'Sam', 'Kai', 'Reese', 'Rowan', 'Emerson', 'Harper', 'Logan', 'Blake',
  'Devon', 'Jules', 'Marlow', 'Noel', 'Parker', 'Sage', 'Tatum', 'Wren', 'Lane', 'Ellis']
const LAST = ['Testwell', 'Sampleton', 'Mockridge', 'Fixtureby', 'Placeholder', 'Examplesmith', 'Demoson',
  'Stubbs', 'Dummerfield', 'Fakeman', 'Seedley', 'Specimen', 'Fictson', 'Samplewood', 'Mockingbird',
  'Devlin', 'Testarossa', 'Exampleton', 'Faux', 'Trialby']
const ACCOUNT_ADJ = ['Northwind', 'Brightpath', 'Cedar Ridge', 'Harbor', 'Summit', 'Maple', 'Ironwood', 'Bluebird', 'Lakeside', 'Redwood']
const TAG_COLORS = ['#ef4444', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#ec4899', '#14b8a6', '#6b7280']

interface FieldDef {
  key: string
  label: string
  type: 'text' | 'currency' | 'select' | 'boolean' | 'integer'
  options?: string[]
}

interface OrgSpec {
  idx: number
  name: string
  slug: string
  legal: string
  timezone: string
  accent: string
  businessType: 'on_premises_shop' | 'mobile_service' | 'hybrid' | 'other'
  serviceMode: 'on_premises' | 'at_customer' | 'either'
  domain: string
  areaCodes: [string, string]
  address: { line1: string; city: string; state: string; zip: string }
  welcome: string
  stages: Array<{ name: string; color: string; won?: boolean; lost?: boolean }>
  oppTitles: string[]
  valueRange: [number, number]
  accountSuffixes: string[]
  accountIndustries: string[]
  tags: string[]
  contactFields: FieldDef[]
  accountFields: FieldDef[]
  oppFields: FieldDef[]
  eventTypes: Array<{ title: string; slug: string; minutes: number; location: 'video' | 'phone' | 'in_person'; color: string }>
  kb: Array<{ title: string; chunks: string[] }>
  prospectServices: string[]
  prospectPains: string[]
  labels: string[]
  inbound: string[]
  outbound: string[]
  emailSubjects: string[]
  callAsks: string[]
  callAnswers: string[]
  smsCampaign: { name: string; body: string }
  callCampaign: string
  taskTitles: string[]
  noteLines: string[]
  templates: Array<{ name: string; body: string }>
}

const SPECS: OrgSpec[] = [
  {
    idx: 1,
    name: 'Skale Club Agency (Dev)',
    slug: 'dev-skale-agency',
    legal: 'Skale Agency Dev LLC',
    timezone: 'America/New_York',
    accent: '#6366f1',
    businessType: 'other',
    serviceMode: 'either',
    domain: 'skale-agency.example',
    areaCodes: ['212', '646'],
    address: { line1: '100 Sample Street', city: 'New York', state: 'NY', zip: '10001' },
    welcome: 'Hi! Ask us about websites, SEO and ads. (Dev sample data)',
    stages: [
      { name: 'New Lead', color: '#64748b' },
      { name: 'Discovery Call', color: '#3b82f6' },
      { name: 'Proposal Sent', color: '#a855f7' },
      { name: 'Negotiation', color: '#f59e0b' },
      { name: 'Won', color: '#22c55e', won: true },
      { name: 'Lost', color: '#ef4444', lost: true },
    ],
    oppTitles: ['Website redesign', 'Local SEO retainer', 'Google Ads management', 'Meta Ads launch', 'Voice AI receptionist', 'CRM onboarding', 'Review automation', 'Landing page build'],
    valueRange: [1500, 18000],
    accountSuffixes: ['Plumbing', 'Roofing', 'HVAC', 'Landscaping', 'Law Office', 'Bakery', 'Auto Repair', 'Fitness Studio', 'Salon', 'Realty'],
    accountIndustries: ['Home Services', 'Legal', 'Food & Beverage', 'Automotive', 'Health & Fitness', 'Beauty', 'Real Estate'],
    tags: ['hot-lead', 'agency-client', 'seo', 'paid-ads', 'newsletter', 'referral', 'churn-risk', 'vip'],
    contactFields: [
      { key: 'budget_monthly', label: 'Monthly budget', type: 'currency' },
      { key: 'preferred_channel', label: 'Preferred channel', type: 'select', options: ['Email', 'Phone', 'WhatsApp', 'SMS'] },
      { key: 'decision_maker', label: 'Decision maker', type: 'boolean' },
    ],
    accountFields: [{ key: 'employee_count', label: 'Employees', type: 'integer' }],
    oppFields: [{ key: 'service_interest', label: 'Service interest', type: 'select', options: ['Website', 'SEO', 'Paid ads', 'Voice AI', 'CRM'] }],
    eventTypes: [
      { title: 'Discovery call', slug: 'discovery-call', minutes: 30, location: 'video', color: '#6366f1' },
      { title: 'Strategy session', slug: 'strategy-session', minutes: 60, location: 'video', color: '#8b5cf6' },
      { title: 'Quick check-in', slug: 'quick-check-in', minutes: 15, location: 'phone', color: '#14b8a6' },
    ],
    kb: [
      { title: 'Agency services and pricing', chunks: [
        'We offer website design, local SEO, Google Ads and Meta Ads management, and AI voice receptionists for small businesses.',
        'Retainers start at 1,500 dollars per month. Website projects are quoted per scope and usually take four to six weeks.',
        'Every plan includes a monthly performance report and a strategy call with an account manager.',
      ] },
      { title: 'Onboarding process', chunks: [
        'After signing, clients complete a short intake form and grant access to their Google Business Profile and ad accounts.',
        'We set up tracking, call tracking numbers and the CRM within the first week of onboarding.',
        'A kickoff call confirms goals, target areas, budgets and the reporting schedule.',
      ] },
      { title: 'Reporting and KPIs', chunks: [
        'Reports cover calls, form fills, booked appointments, cost per lead and ranking changes for tracked keywords.',
        'Dashboards refresh daily. A written summary with next steps is sent on the first business day of each month.',
        'Clients can ask for a custom KPI at any time; we add it to the next report.',
      ] },
      { title: 'Frequently asked questions', chunks: [
        'Contracts are month to month after the first ninety days. You can cancel with thirty days notice.',
        'We do not guarantee rankings, but we do guarantee transparent reporting and weekly optimisation work.',
        'Yes, we can work with your existing website and booking tools; we only rebuild what hurts conversions.',
      ] },
    ],
    prospectServices: ['Emergency repairs', 'Free estimates', 'Residential service', 'Commercial service', 'Online booking', 'Financing'],
    prospectPains: ['No online booking', 'Slow mobile load time', 'No clear call-to-action', 'Outdated design', 'No reviews widget', 'Missing service-area pages'],
    labels: ['New client', 'Needs quote', 'Billing', 'Support'],
    inbound: [
      'Hi {name}here, do you build websites for local businesses?',
      'How much does local SEO cost per month?',
      'Can you take over our Google Ads account?',
      'We want more calls from Google, what do you suggest?',
      'Is there a contract or is it month to month?',
      'Can I see a few examples of your work?',
      'Thanks, that makes sense. What are the next steps?',
      'Our website is slow on phones, can you fix that?',
    ],
    outbound: [
      'Thanks for reaching out! We build and optimise sites for local businesses. What is your industry?',
      'Local SEO retainers start at 1,500 dollars a month. Want me to put a proposal together?',
      'Yes, we can audit your ads account for free first.',
      'Happy to help. Could you share your website and service area?',
      'After 90 days it is month to month with thirty days notice.',
      'I will send a few case studies by email shortly.',
      'Next step is a 30 minute discovery call. Does this week work?',
      'Absolutely. A speed audit is part of every onboarding.',
    ],
    emailSubjects: ['Website redesign quote', 'Question about SEO packages', 'Ads account audit request', 'Proposal follow-up', 'Monthly report question'],
    callAsks: ['I want to know how much a new website costs.', 'Can someone call me about local SEO?', 'I need help with my Google Ads.'],
    callAnswers: ['We build websites for local businesses and a discovery call is free. I can book that now.', 'A strategist can walk you through packages. Let me find a time.', 'We can audit the account first at no cost. Shall I schedule it?'],
    smsCampaign: { name: 'Dev: Free SEO audit offer', body: 'Hi from Skale Club Agency (Dev): book a free local SEO audit this week. Reply YES to claim it.' },
    callCampaign: 'Dev: Lapsed lead re-engagement calls',
    taskTitles: ['Send proposal', 'Prepare discovery call notes', 'Follow up on audit', 'Review ad account access', 'Draft monthly report', 'Call back about website quote', 'Update CRM after kickoff', 'Check call tracking numbers'],
    noteLines: ['Prefers email, decides with a business partner.', 'Budget is flexible if ROI is shown in 60 days.', 'Already tried another agency, wants transparency.', 'Asked for references in the same industry.', 'Waiting on legal review of the agreement.'],
    templates: [
      { name: 'Dev: Intro after form fill', body: 'Hi {{first_name}}, thanks for contacting Skale Club Agency (Dev). When is a good time to talk?' },
      { name: 'Dev: Proposal ready', body: 'Hi {{first_name}}, your proposal is ready. I just emailed it over.' },
      { name: 'Dev: Meeting reminder', body: 'Reminder: our call is tomorrow. Reply here if you need to move it.' },
    ],
  },
  {
    idx: 2,
    name: 'Sparkle Home Cleaning (Dev)',
    slug: 'dev-sparkle-cleaning',
    legal: 'Sparkle Cleaning Dev Inc',
    timezone: 'America/Chicago',
    accent: '#10b981',
    businessType: 'mobile_service',
    serviceMode: 'at_customer',
    domain: 'sparkle-cleaning.example',
    areaCodes: ['312', '773'],
    address: { line1: '200 Example Avenue', city: 'Chicago', state: 'IL', zip: '60601' },
    welcome: 'Hello! Need a quote for a cleaning? (Dev sample data)',
    stages: [
      { name: 'New Request', color: '#64748b' },
      { name: 'Estimate Scheduled', color: '#3b82f6' },
      { name: 'Quote Sent', color: '#a855f7' },
      { name: 'Follow-up', color: '#f59e0b' },
      { name: 'Booked', color: '#22c55e', won: true },
      { name: 'Lost', color: '#ef4444', lost: true },
    ],
    oppTitles: ['Deep clean 3BR home', 'Weekly office cleaning', 'Move-out clean', 'Post-construction cleanup', 'Airbnb turnover contract', 'Carpet and upholstery', 'Window washing package', 'Monthly maintenance plan'],
    valueRange: [120, 2800],
    accountSuffixes: ['Property Group', 'Apartments', 'Offices', 'Rentals', 'Realty', 'Co-Working', 'Lofts', 'Suites', 'Medical Plaza', 'Retail Center'],
    accountIndustries: ['Property Management', 'Offices', 'Short-term Rentals', 'Healthcare', 'Retail', 'Real Estate'],
    tags: ['recurring', 'one-time', 'move-out', 'airbnb', 'commercial', 'referral', 'pet-friendly', 'vip'],
    contactFields: [
      { key: 'home_size_sqft', label: 'Home size (sqft)', type: 'integer' },
      { key: 'has_pets', label: 'Has pets', type: 'boolean' },
      { key: 'frequency', label: 'Cleaning frequency', type: 'select', options: ['One-time', 'Weekly', 'Bi-weekly', 'Monthly'] },
    ],
    accountFields: [{ key: 'units_managed', label: 'Units managed', type: 'integer' }],
    oppFields: [{ key: 'service_type', label: 'Service type', type: 'select', options: ['Standard', 'Deep clean', 'Move-out', 'Commercial'] }],
    eventTypes: [
      { title: 'In-home estimate', slug: 'in-home-estimate', minutes: 45, location: 'in_person', color: '#10b981' },
      { title: 'Phone consultation', slug: 'phone-consultation', minutes: 15, location: 'phone', color: '#3b82f6' },
      { title: 'Video walkthrough', slug: 'video-walkthrough', minutes: 30, location: 'video', color: '#f59e0b' },
    ],
    kb: [
      { title: 'Cleaning services', chunks: [
        'We offer standard cleanings, deep cleans, move-in and move-out cleans, post-construction cleanup and recurring office cleaning.',
        'A standard clean covers dusting, vacuuming, mopping, bathrooms and the kitchen surfaces. Inside appliances are part of a deep clean.',
        'Eco-friendly products are used by default and pet-safe options are available on request.',
      ] },
      { title: 'Pricing and estimates', chunks: [
        'Prices depend on home size and condition. A two bedroom standard clean usually starts at 140 dollars.',
        'Deep cleans are priced per room and start at 250 dollars. Recurring plans get a discount after the first visit.',
        'We give a firm quote after a short video walkthrough or an in-home estimate. Estimates are free.',
      ] },
      { title: 'Policies', chunks: [
        'Cancel or reschedule up to 24 hours before the visit at no charge. Later changes may incur a fee.',
        'All cleaners are background checked, insured and trained. If something is missed we re-clean within 48 hours.',
        'You do not need to be home as long as we have a way in, such as a lockbox or smart lock code.',
      ] },
      { title: 'Service area and hours', chunks: [
        'We serve Chicago and nearby suburbs within about 25 miles of downtown.',
        'Office hours are Monday to Saturday, 8am to 6pm Central time. Cleanings run between 8am and 5pm.',
        'Same-week appointments are often available. Weekend slots fill up quickly.',
      ] },
    ],
    prospectServices: ['Weekly janitorial', 'Move-out cleaning', 'Short-term rental turnover', 'Window cleaning', 'Floor care', 'Post-construction'],
    prospectPains: ['No online booking', 'No pricing information', 'Outdated site', 'No service-area page', 'No reviews on site', 'Slow page load'],
    labels: ['Estimate', 'Reschedule', 'Complaint', 'Recurring'],
    inbound: [
      'Hi {name}here, how much for a 2 bedroom apartment clean?',
      'Do you do move-out cleaning this weekend?',
      'Can I reschedule tomorrow\'s visit to Friday?',
      'Do you bring your own supplies?',
      'We have two cats, are your products safe?',
      'Can you send me a quote for weekly office cleaning?',
      'The kitchen looks great, thank you!',
      'Is there a discount for recurring service?',
    ],
    outbound: [
      'A two bedroom standard clean usually starts at 140 dollars. Want a firm quote?',
      'We have openings Saturday morning. Shall I hold one?',
      'Done, you are now booked for Friday at 10am.',
      'Yes, we bring everything. Eco-friendly products by default.',
      'All our products are pet safe. Just let the team know about the cats.',
      'Happy to quote it. How many square feet is the office?',
      'Thank you! We will pass that on to the team.',
      'Recurring plans save around 10 percent after the first visit.',
    ],
    emailSubjects: ['Quote for move-out clean', 'Reschedule request', 'Invoice question', 'Office cleaning proposal', 'Thank you'],
    callAsks: ['How much is a deep clean for a three bedroom house?', 'I need to reschedule my cleaning.', 'Do you clean offices on weekends?'],
    callAnswers: ['A three bedroom deep clean starts at 250 dollars. I can book an estimate now.', 'No problem, I can move it. What day works better?', 'Yes, weekend office cleaning is available. Let me check slots.'],
    smsCampaign: { name: 'Dev: Spring deep-clean promo', body: 'Sparkle Home Cleaning (Dev): 15% off deep cleans booked this week. Reply BOOK to reserve.' },
    callCampaign: 'Dev: Past customer rebooking calls',
    taskTitles: ['Send estimate', 'Confirm tomorrow\'s crew', 'Follow up on quote', 'Collect lockbox code', 'Call about recurring plan', 'Send invoice', 'Quality check call', 'Order eco supplies'],
    noteLines: ['Has two cats, avoid strong scents.', 'Key is in the lockbox, code shared by text.', 'Prefers Friday mornings.', 'Owns three rentals, wants turnover pricing.', 'Asked for the same crew each visit.'],
    templates: [
      { name: 'Dev: Estimate confirmation', body: 'Hi {{first_name}}, your estimate with Sparkle Home Cleaning (Dev) is confirmed.' },
      { name: 'Dev: Day-before reminder', body: 'Reminder: your cleaning is tomorrow. Reply here to reschedule.' },
      { name: 'Dev: Review request', body: 'Thanks for choosing us! Would you leave a quick review?' },
    ],
  },
  {
    idx: 3,
    name: 'Northwind Dental Clinic (Dev)',
    slug: 'dev-northwind-dental',
    legal: 'Northwind Dental Dev PC',
    timezone: 'America/Los_Angeles',
    accent: '#0ea5e9',
    businessType: 'on_premises_shop',
    serviceMode: 'on_premises',
    domain: 'northwind-dental.example',
    areaCodes: ['415', '628'],
    address: { line1: '300 Placeholder Road', city: 'San Francisco', state: 'CA', zip: '94103' },
    welcome: 'Welcome! Questions about appointments or treatments? (Dev sample data)',
    stages: [
      { name: 'Inquiry', color: '#64748b' },
      { name: 'Consult Booked', color: '#3b82f6' },
      { name: 'Plan Presented', color: '#a855f7' },
      { name: 'Financing', color: '#f59e0b' },
      { name: 'Accepted', color: '#22c55e', won: true },
      { name: 'Declined', color: '#ef4444', lost: true },
    ],
    oppTitles: ['Invisalign consult', 'Implant treatment plan', 'Whitening package', 'Family membership plan', 'Veneers consultation', 'Emergency visit follow-up', 'Corporate dental plan', 'Full-mouth rehabilitation'],
    valueRange: [250, 9500],
    accountSuffixes: ['Logistics', 'Software', 'Insurance Group', 'School District', 'Credit Union', 'Manufacturing', 'Hospitality', 'Staffing', 'Design Studio', 'Cooperative'],
    accountIndustries: ['Employer', 'Education', 'Finance', 'Technology', 'Hospitality', 'Manufacturing'],
    tags: ['new-patient', 'cleaning-due', 'invisalign', 'implants', 'insurance', 'family-plan', 'anxious-patient', 'vip'],
    contactFields: [
      { key: 'insurance_provider', label: 'Insurance provider', type: 'text' },
      { key: 'last_visit_note', label: 'Last visit note', type: 'text' },
      { key: 'recall_interval', label: 'Recall interval', type: 'select', options: ['3 months', '6 months', '12 months'] },
    ],
    accountFields: [{ key: 'covered_employees', label: 'Covered employees', type: 'integer' }],
    oppFields: [{ key: 'treatment_type', label: 'Treatment type', type: 'select', options: ['Orthodontics', 'Implants', 'Cosmetic', 'General'] }],
    eventTypes: [
      { title: 'New patient exam', slug: 'new-patient-exam', minutes: 60, location: 'in_person', color: '#0ea5e9' },
      { title: 'Cleaning', slug: 'cleaning', minutes: 45, location: 'in_person', color: '#10b981' },
      { title: 'Treatment consult', slug: 'treatment-consult', minutes: 30, location: 'video', color: '#8b5cf6' },
    ],
    kb: [
      { title: 'Treatments offered', chunks: [
        'The clinic offers general dentistry, cleanings, whitening, Invisalign, dental implants and veneers.',
        'Emergency visits are available the same day for severe pain, broken teeth and lost fillings.',
        'Sedation options are available for anxious patients; ask the front desk during booking.',
      ] },
      { title: 'Insurance and payment', chunks: [
        'We accept most major PPO plans and file claims on your behalf. Please bring your insurance card to the first visit.',
        'Without insurance, a membership plan covers two cleanings and exams per year at a flat monthly fee.',
        'Financing is available for larger treatments, with monthly plans from six to twenty-four months.',
      ] },
      { title: 'New patient information', chunks: [
        'New patients should arrive fifteen minutes early to complete forms. A first visit includes an exam, x-rays and a cleaning if time allows.',
        'Digital forms are sent by text after booking. Bring a photo ID and a list of current medications.',
        'The first visit takes about sixty minutes and ends with a clear treatment plan and cost estimate.',
      ] },
      { title: 'Hours and cancellations', chunks: [
        'The clinic is open Monday to Thursday 8am to 5pm and Friday 8am to 1pm Pacific time.',
        'Please cancel or reschedule at least 24 hours ahead so we can offer the slot to another patient.',
        'Late cancellations and no-shows may be charged a small fee after the second occurrence.',
      ] },
    ],
    prospectServices: ['Employee benefits', 'On-site events', 'Group plans', 'Family coverage', 'Wellness programs', 'Open enrollment'],
    prospectPains: ['No benefits page', 'Outdated contact form', 'No mobile layout', 'No online scheduling', 'No call-to-action', 'Slow load time'],
    labels: ['New patient', 'Insurance', 'Reschedule', 'Treatment plan'],
    inbound: [
      'Hi {name}here, are you accepting new patients?',
      'Do you take Delta Dental insurance?',
      'I have a toothache since last night, can I come in today?',
      'How much does Invisalign cost?',
      'Can I move my cleaning from Tuesday to Thursday?',
      'Do you offer payment plans for implants?',
      'Thank you, the appointment went great.',
      'What should I bring to my first visit?',
    ],
    outbound: [
      'Yes, we are welcoming new patients. Would you like to book a first exam?',
      'We accept most PPO plans including Delta. I can verify your coverage.',
      'Sorry to hear that. We have an emergency slot at 2pm today. Shall I hold it?',
      'Invisalign consults are free. Treatment typically ranges by case; we will give an exact quote.',
      'Done, you are moved to Thursday at 10am.',
      'Yes, financing plans from six to twenty-four months are available.',
      'Glad to hear it! See you at your next visit.',
      'Please bring a photo ID, your insurance card and a list of medications.',
    ],
    emailSubjects: ['New patient forms', 'Insurance question', 'Treatment plan estimate', 'Appointment reminder reply', 'Invoice copy request'],
    callAsks: ['I would like to book a cleaning.', 'Do you have any emergency appointments today?', 'Is Invisalign right for me?'],
    callAnswers: ['I can book a cleaning right away. Morning or afternoon?', 'We keep emergency slots daily. Let me check what is open.', 'A free consult will answer that. I can schedule one now.'],
    smsCampaign: { name: 'Dev: Cleaning recall reminder', body: 'Northwind Dental Clinic (Dev): it is time for your cleaning. Reply BOOK and we will find a slot.' },
    callCampaign: 'Dev: Overdue recall calls',
    taskTitles: ['Verify insurance', 'Call about treatment plan', 'Send new patient forms', 'Confirm tomorrow\'s schedule', 'Follow up on financing', 'Send x-rays to specialist', 'Recall call', 'Collect payment'],
    noteLines: ['Anxious patient, offer extra time.', 'Insurance verified, 80 percent coverage on crowns.', 'Prefers morning appointments.', 'Interested in whitening after cleaning.', 'Family of four, wants matching appointments.'],
    templates: [
      { name: 'Dev: Appointment confirmation', body: 'Hi {{first_name}}, your visit at Northwind Dental Clinic (Dev) is confirmed.' },
      { name: 'Dev: Recall reminder', body: 'It has been a while since your last cleaning. Want us to find a time?' },
      { name: 'Dev: Post-visit check-in', body: 'How are you feeling after your visit? Let us know if anything seems off.' },
    ],
  },
]

interface FakeUser {
  n: number
  name: string
  email: string
  memberships: Array<{ org: number; role: 'admin' | 'member' | 'viewer' }>
}

const FAKE_USERS: FakeUser[] = [
  { n: 1, name: 'Priya Admin (Dev)', email: 'priya.admin.dev@example.com', memberships: [{ org: 1, role: 'admin' }, { org: 3, role: 'admin' }] },
  { n: 2, name: 'Marcus Member (Dev)', email: 'marcus.member.dev@example.com', memberships: [{ org: 1, role: 'member' }, { org: 2, role: 'member' }] },
  { n: 3, name: 'Lena Viewer (Dev)', email: 'lena.viewer.dev@example.com', memberships: [{ org: 1, role: 'viewer' }, { org: 2, role: 'viewer' }, { org: 3, role: 'viewer' }] },
  { n: 4, name: 'Omar Admin (Dev)', email: 'omar.admin.dev@example.com', memberships: [{ org: 2, role: 'admin' }, { org: 3, role: 'member' }] },
]

// Read-only permission set for the "Viewer" custom role (member + this role).
const VIEWER_PERMISSIONS = [
  'dashboard.view', 'chat.view', 'calls.view', 'contacts.view', 'companies.view', 'prospects.view',
  'pipeline.view', 'tasks.view', 'calendar.view', 'campaigns.view', 'knowledge.view',
]

// ─── Plan model ───────────────────────────────────────────────────────────────

interface Step {
  scope: string // 'global' | 'org1' ...
  section: string // savepoint unit
  table: string
  rows: Row[]
  conflict?: string[] | 'nothing' // default ['id']
  before?: (db: Client) => Promise<void>
  exec?: (db: Client, step: Step) => Promise<number>
}

interface Plan {
  steps: Step[]
  notes: string[]
}

interface ContactGen {
  idx: number
  id: string
  first: string
  last: string
  name: string
  email: string | null
  phone: string | null
  accountId: string | null
  prospect: boolean
}

async function buildPlan(owners: string[]): Promise<Plan> {
  const steps: Step[] = []
  const notes: string[] = []
  const primaryOwner = owners[0] ?? null

  // Global: fake users (no identities, so none of them can log in).
  const fakeUserId = (n: number): string => uid(KIND.user, 0, n)
  steps.push({
    scope: 'global',
    section: 'global:users',
    table: 'users',
    rows: FAKE_USERS.map((u) => ({
      id: fakeUserId(u.n),
      email: u.email,
      user_metadata: { full_name: u.name, name: u.name, dev_seed: true },
      created_at: ago(118 - u.n),
      updated_at: ago(118 - u.n),
    })),
  })

  // Encrypted placeholder secret, one per integration row.
  let encryptionAvailable = true
  try {
    await encrypt('dev-placeholder')
  } catch (err) {
    encryptionAvailable = false
    notes.push(`integrations skipped: ${err instanceof Error ? err.message : 'encryption unavailable'}`)
  }

  for (const spec of SPECS) {
    const scope = `org${spec.idx}`
    const S = (name: string) => `${scope}:${name}`
    const orgId = uid(KIND.org, 0, spec.idx)
    const id = (kind: string, n: number): string => uid(kind, spec.idx, n)
    const rng = new Rng(0x5eed0000 + spec.idx * 7919)
    const push = (name: string, table: string, rows: Row[], extra: Partial<Step> = {}): void => {
      if (rows.length === 0) return
      steps.push({ scope, section: S(name), table, rows, ...extra })
    }

    const phoneFor = (i: number): string =>
      `+1${spec.areaCodes[Math.floor(i / 100) % 2]}55501${String(i % 100).padStart(2, '0')}`
    const orgLine = phoneFor(199)
    const orgLine2 = phoneFor(198)

    const fakeHere = FAKE_USERS.filter((u) => u.memberships.some((m) => m.org === spec.idx))
    const team: string[] = [...owners, ...fakeHere.map((u) => fakeUserId(u.n))]
    const teamPick = (): string | null => (team.length === 0 || rng.chance(0.15) ? null : rng.pick(team))
    const teamPickStrict = (): string | null => (team.length === 0 ? null : rng.pick(team))

    // ── organization ────────────────────────────────────────────────────────
    push('core', 'organizations', [{
      id: orgId,
      name: spec.name,
      slug: spec.slug,
      is_active: true,
      widget_token: `dev-widget-${spec.slug}`,
      widget_display_name: spec.name,
      widget_primary_color: spec.accent,
      widget_welcome_message: spec.welcome,
      accent_color: spec.accent,
      brand_name: spec.name,
      default_currency: 'USD',
      business_type: spec.businessType,
      service_location_mode: spec.serviceMode,
      legal_name: spec.legal,
      address_line1: spec.address.line1,
      address_city: spec.address.city,
      address_state: spec.address.state,
      address_postal_code: spec.address.zip,
      address_country: 'US',
      timezone: spec.timezone,
      created_at: ago(120),
      updated_at: ago(1),
    }])

    // ── members, viewer role, active org ────────────────────────────────────
    const viewerRoleId = id(KIND.role, 1)
    const memberRows: Row[] = owners.map((ownerId, i) => ({
      id: id(KIND.member, i + 1),
      user_id: ownerId,
      organization_id: orgId,
      role: 'owner',
      created_at: ago(120),
    }))
    for (const u of fakeHere) {
      const m = u.memberships.find((x) => x.org === spec.idx)
      if (!m) continue
      memberRows.push({
        id: id(KIND.member, 10 + u.n),
        user_id: fakeUserId(u.n),
        organization_id: orgId,
        role: m.role === 'admin' ? 'admin' : 'member',
        custom_role_id: m.role === 'viewer' ? viewerRoleId : null,
        created_at: ago(100 - u.n),
      })
    }
    push('members-roles', 'org_custom_roles', [{
      id: viewerRoleId, organization_id: orgId, name: 'Viewer', description: 'Read-only access (dev sample role)',
      created_at: ago(119), updated_at: ago(119),
    }])
    push('members-roles', 'custom_role_permissions', VIEWER_PERMISSIONS.map((key, i) => ({
      id: id(KIND.perm, i + 1), custom_role_id: viewerRoleId, permission_key: key, enabled: true,
    })))
    push('members-roles', 'org_members', memberRows, { conflict: 'nothing' })
    if (primaryOwner && spec.idx === 1) {
      push('members-roles', 'user_active_org', [{ user_id: primaryOwner, organization_id: orgId, updated_at: ago(0) }], { conflict: 'nothing' })
    }

    // ── pipeline (replaces the default one the org trigger creates) ─────────
    const pipelineId = id(KIND.pipeline, 1)
    push('pipeline', 'pipelines', [{
      id: pipelineId, org_id: orgId, name: `${spec.name.replace(' (Dev)', '')} Pipeline (Dev)`, is_default: true, position: 0,
    }], {
      before: async (db) => {
        await db.query('DELETE FROM public.pipelines WHERE org_id = $1::uuid AND id <> $2::uuid', [orgId, pipelineId])
      },
    })
    const stageIds = spec.stages.map((_, i) => id(KIND.stage, i + 1))
    push('pipeline', 'pipeline_stages', spec.stages.map((s, i) => ({
      id: stageIds[i], pipeline_id: pipelineId, org_id: orgId, name: s.name, position: i, color: s.color,
      is_won: s.won === true, is_lost: s.lost === true,
    })))

    // ── tags and custom fields ──────────────────────────────────────────────
    const tagIds = spec.tags.map((_, i) => id(KIND.tag, i + 1))
    push('tags-fields', 'tags', spec.tags.map((t, i) => ({
      id: tagIds[i], org_id: orgId, name: t, slug: slugify(t), color: TAG_COLORS[i % TAG_COLORS.length], created_at: ago(115),
    })))
    const fieldRows: Row[] = []
    let fieldSeq = 0
    const addFields = (entity: 'contact' | 'account' | 'opportunity', defs: FieldDef[]): void => {
      defs.forEach((f, i) => {
        fieldRows.push({
          id: id(KIND.field, ++fieldSeq), org_id: orgId, entity, key: f.key, label: f.label, type: f.type,
          options: f.options ? f.options.map((o) => ({ value: o.toLowerCase().replace(/[^a-z0-9]+/g, '_'), label: o })) : null,
          position: i, visible_in_list: i === 0, filterable: true, archived: false,
          created_at: ago(115), updated_at: ago(115),
        })
      })
    }
    addFields('contact', spec.contactFields)
    addFields('account', spec.accountFields)
    addFields('opportunity', spec.oppFields)
    push('tags-fields', 'custom_field_definitions', fieldRows)
    const fieldValue = (f: FieldDef): unknown => {
      switch (f.type) {
        case 'currency': return rng.int(5, 80) * 100
        case 'integer': return rng.int(2, 400)
        case 'boolean': return rng.chance(0.5)
        case 'select': return (f.options ?? ['n/a']).map((o) => o.toLowerCase().replace(/[^a-z0-9]+/g, '_'))[rng.int(0, (f.options ?? ['n/a']).length - 1)]
        default: return rng.pick(['Needs follow-up', 'Prefers mornings', 'Referred by a friend', 'Sample note', 'Delta PPO'])
      }
    }

    // ── prospect sources (before accounts/contacts: FK) ─────────────────────
    const sourceCsv = id(KIND.psource, 1)
    const sourceScrape = id(KIND.psource, 2)
    push('prospects-sources', 'prospect_sources', [
      { id: sourceCsv, org_id: orgId, source_type: 'csv', source_key: 'dev-import.csv', label: 'Dev CSV import', status: 'completed', total_count: 40, imported_count: 38, metadata: { dev_seed: true }, created_at: ago(40), updated_at: ago(40) },
      { id: sourceScrape, org_id: orgId, source_type: 'scraper', source_key: 'dev-scraper-run', label: 'Dev scraper run', status: 'completed', total_count: 25, imported_count: 25, metadata: { dev_seed: true }, created_at: ago(18), updated_at: ago(18) },
    ])

    // ── accounts (40; the first 10 are prospects) ───────────────────────────
    const ACCOUNTS = 40
    const PROSPECT_ACCOUNTS = 10
    interface AccountGen { idx: number; id: string; name: string; domain: string; prospect: boolean }
    const accounts: AccountGen[] = []
    const accountRows: Row[] = []
    for (let i = 0; i < ACCOUNTS; i++) {
      const a = i % 10
      const k = (7 * a + Math.floor(i / 10)) % 10
      const name = `${ACCOUNT_ADJ[a]} ${spec.accountSuffixes[k]} (Dev)`
      const domain = `${slugify(name)}.example`
      const prospect = i < PROSPECT_ACCOUNTS
      const created = rng.int(2, 118)
      accounts.push({ idx: i, id: id(KIND.account, i + 1), name, domain, prospect })
      accountRows.push({
        id: id(KIND.account, i + 1),
        org_id: orgId,
        name,
        domain,
        website: `https://${domain}`,
        industry: rng.pick(spec.accountIndustries),
        size: rng.pick(['1-10', '11-50', '51-200', '201-500']),
        phone: phoneFor(150 + i),
        address: `${rng.int(10, 990)} Sample Blvd, ${spec.address.city}, ${spec.address.state}`,
        tags: [rng.pick(spec.tags)],
        custom_fields: Object.fromEntries(spec.accountFields.map((f) => [f.key, fieldValue(f)])),
        source: prospect ? 'csv_import' : 'manual',
        lifecycle_stage: prospect ? 'prospect' : rng.weighted([['customer', 40], ['lead', 30], ['opportunity', 20], ['lost', 10]] as const),
        engagement_status: prospect ? rng.pick(['not_contacted', 'contacted', 'opened', 'replied'] as const) : rng.pick(['contacted', 'engaged', 'replied', 'interested'] as const),
        intent_level: rng.pick(['none', 'low', 'medium', 'high'] as const),
        qualification_status: rng.pick(['unqualified', 'needs_review', 'qualified'] as const),
        source_type: prospect ? 'csv' : null,
        source_payload: { dev_seed: true },
        prospect_source_id: prospect ? (i % 2 === 0 ? sourceCsv : sourceScrape) : null,
        assigned_to: teamPick(),
        score: rng.int(5, 98),
        recommended_channel: rng.pick(['email', 'sms', 'call', 'whatsapp'] as const),
        created_at: ago(created),
        updated_at: ago(Math.max(0, created - rng.int(0, 20))),
      })
    }
    push('accounts', 'accounts', accountRows)

    // ── opportunities first (so contact lifecycle can follow them) ──────────
    const OPPS = 25
    const CONTACTS = 150
    const PROSPECT_CONTACTS = 25
    const oppStageIdx: number[] = []
    const oppContactIdx: number[] = []
    const stageWeights = spec.stages.map((s, i) => [i, s.won ? 22 : s.lost ? 12 : [26, 22, 18, 14, 12][i] ?? 10] as const)
    for (let i = 0; i < OPPS; i++) {
      oppStageIdx.push(rng.weighted(stageWeights))
      oppContactIdx.push(PROSPECT_CONTACTS + i * 4)
    }
    const oppContactStatus = new Map<number, 'open' | 'won' | 'lost'>()
    oppContactIdx.forEach((ci, i) => {
      const st = spec.stages[oppStageIdx[i]]
      oppContactStatus.set(ci, st.won ? 'won' : st.lost ? 'lost' : 'open')
    })

    // ── contacts (150; the first 25 are prospects) ──────────────────────────
    const contacts: ContactGen[] = []
    const contactRows: Row[] = []
    const contactTagLinks: Row[] = []
    const nonProspectAccounts = accounts.filter((a) => !a.prospect)
    for (let i = 0; i < CONTACTS; i++) {
      const prospect = i < PROSPECT_CONTACTS
      const first = FIRST[(i * 7) % FIRST.length]
      const last = LAST[(i * 3 + Math.floor(i / 30)) % LAST.length]
      const email = rng.chance(0.92) ? `${first}.${last}.${i + 1}@example.com`.toLowerCase() : null
      const phone = rng.chance(0.92) || !email ? phoneFor(i) : null
      const account = prospect
        ? accounts[i % PROSPECT_ACCOUNTS]
        : rng.chance(0.6) ? nonProspectAccounts[i % nonProspectAccounts.length] : null
      const oppState = oppContactStatus.get(i)
      const lifecycle = prospect
        ? 'prospect'
        : oppState === 'won' ? 'customer'
        : oppState === 'open' ? 'opportunity'
        : oppState === 'lost' ? 'lost'
        : rng.weighted([['lead', 45], ['customer', 40], ['archived', 5], ['lost', 10]] as const)
      const tagCount = rng.int(1, 3)
      const tagNames = new Set<number>()
      while (tagNames.size < tagCount) tagNames.add(rng.int(0, spec.tags.length - 1))
      const created = rng.int(1, 119)
      const cid = id(KIND.contact, i + 1)
      contacts.push({ idx: i, id: cid, first, last, name: `${first} ${last}`, email, phone, accountId: account?.id ?? null, prospect })
      contactRows.push({
        id: cid,
        org_id: orgId,
        first_name: first,
        last_name: last,
        name: `${first} ${last}`,
        email,
        phone,
        company: account ? account.name : null,
        account_id: account?.id ?? null,
        tags: [...tagNames].map((t) => spec.tags[t]),
        custom_fields: Object.fromEntries(spec.contactFields.map((f) => [f.key, fieldValue(f)])),
        source: prospect ? 'csv_import' : rng.weighted([['manual', 30], ['api', 20], ['whatsapp', 15], ['sms', 15], ['voice_call', 10], ['instagram', 10]] as const),
        lifecycle_stage: lifecycle,
        engagement_status: prospect ? rng.pick(['not_contacted', 'contacted', 'opened', 'replied'] as const) : rng.pick(['contacted', 'engaged', 'replied', 'interested', 'needs_follow_up', 'not_interested'] as const),
        intent_level: rng.pick(['none', 'low', 'medium', 'high'] as const),
        qualification_status: rng.pick(['unqualified', 'needs_review', 'qualified'] as const),
        source_type: prospect ? (i % 2 === 0 ? 'csv' : 'scraper') : null,
        source_payload: { dev_seed: true },
        prospect_source_id: prospect ? (i % 2 === 0 ? sourceCsv : sourceScrape) : null,
        assigned_to: teamPick(),
        score: rng.int(5, 98),
        recommended_channel: rng.pick(['email', 'sms', 'whatsapp', 'call'] as const),
        last_contacted_at: rng.chance(0.7) ? ago(rng.int(0, created)) : null,
        created_at: ago(created),
        updated_at: ago(Math.max(0, created - rng.int(0, 30))),
      })
      for (const t of tagNames) {
        contactTagLinks.push({ contact_id: cid, tag_id: tagIds[t], tagged_at: ago(created), tagged_by: primaryOwner })
      }
    }
    push('contacts', 'contacts', contactRows)
    push('contacts', 'contact_tags', contactTagLinks, { conflict: ['contact_id', 'tag_id'] })

    // ── prospect lists + website analyses ───────────────────────────────────
    const list1 = id(KIND.plist, 1)
    const list2 = id(KIND.plist, 2)
    push('prospects-lists', 'prospect_lists', [
      { id: list1, org_id: orgId, name: 'Dev: Hot prospects', description: 'Sample list', color: '#ef4444', created_at: ago(30), updated_at: ago(30) },
      { id: list2, org_id: orgId, name: 'Dev: Cold outreach batch', description: 'Sample list', color: '#3b82f6', created_at: ago(20), updated_at: ago(20) },
    ])
    const memberRowsP: Row[] = []
    contacts.filter((c) => c.prospect).forEach((c, i) => {
      memberRowsP.push({ id: id(KIND.pmember, i + 1), org_id: orgId, list_id: i < 12 ? list1 : list2, contact_id: c.id, added_at: ago(25 - (i % 10)) })
    })
    accounts.filter((a) => a.prospect).forEach((a, i) => {
      memberRowsP.push({ id: id(KIND.pmember, 100 + i), org_id: orgId, list_id: i < 5 ? list1 : list2, account_id: a.id, added_at: ago(24 - (i % 10)) })
    })
    push('prospects-lists', 'prospect_list_members', memberRowsP)

    const waStatuses = ['completed', 'completed', 'completed', 'completed', 'completed', 'completed', 'completed', 'failed', 'pending', 'running'] as const
    const insight = (variant: number, provider: string): Record<string, string> => {
      if (variant === 0) {
        return {
          en: `I noticed your website sends clients to ${provider} to schedule. Bringing the branded site and booking flow together could make the journey more consistent.`,
          'pt-BR': `Notei que seu site envia os clientes para ${provider} para agendar. Unir o site e o agendamento pode deixar a jornada mais consistente.`,
          pt: `Notei que o seu site envia os clientes para ${provider} para marcar. Unir o site e a marcacao pode tornar a jornada mais consistente.`,
          es: `Note que el sitio envia a los clientes a ${provider} para reservar. Unir sitio y reservas podria hacer la experiencia mas consistente.`,
        }
      }
      if (variant === 1) {
        return {
          en: 'I noticed the site is hard to use on a phone. A lighter mobile layout could make calling or booking easier for new visitors.',
          'pt-BR': 'Notei que o site e dificil de usar no celular. Um layout mobile mais leve pode facilitar ligar ou agendar.',
          pt: 'Notei que o site e dificil de usar no telemovel. Um layout mais leve pode facilitar ligar ou marcar.',
          es: 'Note que el sitio es dificil de usar en el movil. Un diseno mas ligero podria facilitar llamar o reservar.',
        }
      }
      return {
        en: 'I noticed there is no clear call-to-action above the fold. A simple contact or booking button could turn more visits into inquiries.',
        'pt-BR': 'Notei que nao ha um botao de acao claro no topo da pagina. Um botao simples de contato ou agendamento pode gerar mais pedidos.',
        pt: 'Notei que nao ha um botao de acao claro no topo da pagina. Um botao simples de contacto ou marcacao pode gerar mais pedidos.',
        es: 'Note que no hay un boton de accion claro al inicio. Un boton simple de contacto o reserva podria generar mas consultas.',
      }
    }
    const waRows: Row[] = accounts.filter((a) => a.prospect).map((a, i) => {
      const status = waStatuses[i % waStatuses.length]
      const variant = i % 3
      const provider = rng.pick(['Booksy', 'Calendly', 'Square Appointments'])
      const completed = status === 'completed'
      const base: Row = {
        id: id(KIND.wa, i + 1),
        org_id: orgId,
        account_id: a.id,
        status,
        url: `https://${a.domain}`,
        attempts: status === 'pending' ? 0 : 1,
        created_at: ago(14 - (i % 10)),
        updated_at: ago(13 - (i % 10)),
      }
      if (completed) {
        return {
          ...base,
          lead_score: rng.int(35, 95),
          brand_colors: [rng.pick(['#1d4ed8', '#047857', '#b91c1c', '#7c3aed']), rng.pick(['#f59e0b', '#e5e7eb', '#111827'])],
          services: rng.shuffleCopy(spec.prospectServices).slice(0, rng.int(3, 5)),
          pain_points: rng.shuffleCopy(spec.prospectPains).slice(0, rng.int(2, 3)),
          outreach_insights: insight(variant, provider),
          raw_evidence: {
            resolvedUrl: `https://${a.domain}`,
            isMobileResponsive: variant !== 1,
            hasCTA: variant !== 2,
            hasContactInfo: true,
            loadMs: rng.int(900, 5200),
            booking: variant === 0 ? { mode: 'third_party', primaryProvider: provider } : { mode: rng.pick(['native', 'none']) },
          },
          analyzed_at: ago(13 - (i % 10)),
        }
      }
      if (status === 'failed') return { ...base, error_message: 'Dev sample: site did not respond within the timeout.' }
      return base
    })
    push('prospects-analyses', 'website_analyses', waRows)

    // ── opportunities ───────────────────────────────────────────────────────
    const oppRows: Row[] = []
    const oppContactRows: Row[] = []
    const actRows: Row[] = []
    const stagePos = new Map<number, number>()
    let actSeq = 0
    for (let i = 0; i < OPPS; i++) {
      const stage = spec.stages[oppStageIdx[i]]
      const contact = contacts[oppContactIdx[i]]
      const oppId = id(KIND.opp, i + 1)
      const created = rng.int(3, 110)
      const value = Math.round(rng.int(spec.valueRange[0], spec.valueRange[1]) / 50) * 50
      const status = stage.won ? 'won' : stage.lost ? 'lost' : 'open'
      const pos = stagePos.get(oppStageIdx[i]) ?? 0
      stagePos.set(oppStageIdx[i], pos + 1)
      const title = `${rng.pick(spec.oppTitles)} - ${contact.name}`
      oppRows.push({
        id: oppId, org_id: orgId, contact_id: contact.id, account_id: contact.accountId,
        pipeline_id: pipelineId, stage_id: stageIds[oppStageIdx[i]], title, value, currency: 'USD', status,
        expected_close_date: dateOnly(NOW + (status === 'open' ? rng.int(3, 45) : -rng.int(1, created)) * DAY),
        assigned_to: teamPick(), position: pos,
        custom_fields: Object.fromEntries(spec.oppFields.map((f) => [f.key, fieldValue(f)])),
        created_by: primaryOwner,
        created_at: ago(created), updated_at: ago(Math.max(0, created - rng.int(1, 20))),
      })
      oppContactRows.push({ id: id(KIND.oppc, i + 1), org_id: orgId, opportunity_id: oppId, contact_id: contact.id, is_primary: true, created_at: ago(created) })
      actRows.push({ id: id(KIND.oact, ++actSeq), org_id: orgId, opportunity_id: oppId, type: 'created', content: 'Opportunity created', created_by: primaryOwner, created_at: ago(created) })
      if (oppStageIdx[i] > 0) {
        actRows.push({
          id: id(KIND.oact, ++actSeq), org_id: orgId, opportunity_id: oppId, type: 'stage_change',
          content: `Moved to ${stage.name}`, metadata: { to_stage: stage.name }, created_by: primaryOwner,
          created_at: ago(Math.max(0, created - 2)),
        })
      }
      actRows.push({ id: id(KIND.oact, ++actSeq), org_id: orgId, opportunity_id: oppId, type: 'note', content: rng.pick(spec.noteLines), created_by: primaryOwner, created_at: ago(Math.max(0, created - 1)) })
      if (status !== 'open') {
        actRows.push({ id: id(KIND.oact, ++actSeq), org_id: orgId, opportunity_id: oppId, type: status, content: status === 'won' ? 'Closed won' : 'Closed lost', created_by: primaryOwner, created_at: ago(Math.max(0, created - 3)) })
      }
    }
    push('opportunities', 'opportunities', oppRows)
    push('opportunities', 'opportunity_contacts', oppContactRows)
    push('opportunities', 'opportunity_activities', actRows)

    // ── phone numbers, labels, conversations, messages ──────────────────────
    push('inbox-numbers', 'twilio_phone_numbers', [
      { id: id(KIND.tnum, 1), organization_id: orgId, e164: orgLine, provider: 'twilio', friendly_name: `${spec.name} main line`, capability_sms: true, capability_mms: true, capability_voice: true, default_routing_mode: 'browser', is_default: true, is_active: true, notes: 'Dev placeholder number, not a real Twilio resource.', inbox_label: 'Main line', created_at: ago(119), updated_at: ago(119) },
      { id: id(KIND.tnum, 2), organization_id: orgId, e164: orgLine2, provider: 'twilio', friendly_name: `${spec.name} second line`, capability_sms: true, capability_mms: false, capability_voice: true, default_routing_mode: 'forward', forward_to_number: phoneFor(197), is_default: false, is_active: true, notes: 'Dev placeholder number, not a real Twilio resource.', inbox_label: 'Second line', created_at: ago(110), updated_at: ago(110) },
    ])

    const labelIds = spec.labels.map((_, i) => id(KIND.label, i + 1))
    push('inbox', 'conversation_labels', spec.labels.map((l, i) => ({
      id: labelIds[i], org_id: orgId, name: l, color: TAG_COLORS[i % TAG_COLORS.length], position: i, created_at: ago(110),
    })))

    const CHANNELS = ['sms', 'whatsapp', 'messenger', 'instagram', 'widget', 'email'] as const
    const nonProspects = contacts.filter((c) => !c.prospect)
    const withPhone = nonProspects.filter((c) => c.phone)
    const withEmail = nonProspects.filter((c) => c.email)
    const convRows: Row[] = []
    const msgRows: Row[] = []
    const assignRows: Row[] = []
    const readRows: Row[] = []
    let convSeq = 0
    let msgSeq = 0
    for (let c = 0; c < CHANNELS.length; c++) {
      for (let k = 0; k < 8; k++) {
        const channel = CHANNELS[c]
        const n = ++convSeq
        const contact = rng.pick(channel === 'email' ? withEmail : channel === 'sms' || channel === 'whatsapp' ? withPhone : nonProspects)
        const convId = id(KIND.conv, n)
        const dayBack = Math.floor(118 * Math.pow(rng.next(), 1.6))
        const status = dayBack < 7
          ? rng.weighted([['open', 55], ['pending', 20], ['waiting', 10], ['resolved', 15]] as const)
          : dayBack < 30
            ? rng.weighted([['open', 25], ['pending', 10], ['resolved', 35], ['closed', 30]] as const)
            : rng.weighted([['resolved', 40], ['closed', 60]] as const)
        const messageCount = rng.int(3, 12)
        const subject = channel === 'email' ? rng.pick(spec.emailSubjects) : null
        let t = NOW - dayBack * DAY - rng.int(0, 600) * 60_000
        let role: 'user' | 'assistant' = rng.chance(0.9) ? 'user' : 'assistant'
        let lastInbound: string | null = null
        let lastTs = t
        let lastText = ''
        const times: number[] = []
        for (let i = 0; i < messageCount; i++) {
          times.push(t)
          t += (rng.chance(0.12) ? rng.int(8, 30) * 60 : rng.int(1, 90)) * 60_000
        }
        const overflow = times[times.length - 1] - (NOW - 60_000)
        const shift = overflow > 0 ? overflow + messageCount * 60_000 : 0
        for (let i = 0; i < messageCount; i++) {
          const ts = times[i] - shift
          const body = (role === 'user' ? rng.pick(spec.inbound) : rng.pick(spec.outbound)).replace('{name}', `${contact.first} `)
          const text = body.replace(/^Hi [^,]*here, /, 'Hi, ')
          const isMedia = channel !== 'widget' && channel !== 'email' && rng.chance(0.12)
          const old = NOW - ts > 95 * DAY
          const withExpiredMedia = channel !== 'widget' && channel !== 'email' && old && rng.chance(0.5)
          const metadata: Record<string, unknown> = {}
          if (isMedia || withExpiredMedia) {
            metadata.media = [{ url: 'https://media.xphere.app/dev/placeholder.png', mime_type: 'image/png', size: 48210, filename: 'placeholder.png', width: 640, height: 480 }]
            if (withExpiredMedia) metadata.media_expired_at = iso(ts + 91 * DAY)
          }
          if (role === 'assistant' && channel !== 'widget' && channel !== 'email') {
            metadata.delivery_status = rng.weighted([['read', 40], ['delivered', 35], ['sent', 20], ['failed', 5]] as const)
          }
          const row: Row = {
            id: id(KIND.msg, ++msgSeq),
            conversation_id: convId,
            org_id: orgId,
            role,
            content: channel === 'email' ? `<p>${text}</p>` : (isMedia || withExpiredMedia) ? `${text} (photo attached)` : text,
            created_at: iso(ts),
            metadata,
            // The check constraint allows text/image/audio/video/document/sticker/location/mixed;
            // email bodies are stored as text.
            message_type: (isMedia || withExpiredMedia) ? 'image' : 'text',
            channel,
          }
          if (channel === 'email') {
            const inbound = role === 'user'
            row.email_subject = subject
            row.email_from = inbound ? `${contact.name} <${contact.email}>` : `${spec.name} <hello@${spec.domain}>`
            row.email_to = inbound ? `hello@${spec.domain}` : contact.email
            row.email_message_id = `<dev-${spec.idx}-${n}-${i}@example.com>`
            row.email_delivery_status = 'delivered'
          }
          msgRows.push(row)
          if (role === 'user') lastInbound = iso(ts)
          lastTs = ts
          lastText = channel === 'email' ? (subject ?? text) : text
          role = role === 'user' ? (rng.chance(0.85) ? 'assistant' : 'user') : (rng.chance(0.75) ? 'user' : 'assistant')
        }
        const assigned = rng.chance(0.5) ? teamPickStrict() : null
        convRows.push({
          id: convId,
          org_id: orgId,
          widget_token: `dev-${spec.idx}-${n}`,
          status,
          channel,
          contact_id: contact.id,
          visitor_name: contact.name,
          visitor_phone: channel === 'sms' || channel === 'whatsapp' ? contact.phone : null,
          visitor_email: channel === 'email' || channel === 'widget' ? contact.email : null,
          first_page_url: channel === 'widget' ? `https://${spec.domain}/contact` : null,
          channel_metadata: channel === 'email' ? { inbound_address: `hello@${spec.domain}`, dev_seed: true } : { dev_seed: true },
          bot_status: rng.chance(0.7) ? 'paused' : 'active',
          priority: rng.weighted([['normal', 85], ['high', 10], ['urgent', 5]] as const),
          starred: rng.chance(0.08),
          pinned: rng.chance(0.05),
          assigned_user_id: assigned,
          wait_until: status === 'waiting' ? ahead(rng.int(1, 5)) : null,
          last_message: lastText.slice(0, 140),
          last_message_at: iso(lastTs),
          last_inbound_at: lastInbound,
          last_active_at: iso(lastTs),
          created_at: iso(times[0] - shift),
          updated_at: iso(lastTs),
        })
        if (rng.chance(0.4)) assignRows.push({ conversation_id: convId, label_id: rng.pick(labelIds), created_at: iso(lastTs) })
        if (primaryOwner && lastInbound && rng.chance(0.55)) {
          readRows.push({ conversation_id: convId, user_id: primaryOwner, read_at: iso(lastTs + 5 * 60_000 > NOW ? NOW : lastTs + 5 * 60_000) })
        }
      }
    }
    push('inbox', 'conversations', convRows)
    push('inbox', 'conversation_messages', msgRows)
    push('inbox-extras', 'conversation_label_assignments', assignRows, { conflict: ['conversation_id', 'label_id'] })
    // Inserted after the messages: an insert trigger clears read markers.
    push('inbox-extras', 'conversation_reads', readRows, { conflict: ['conversation_id', 'user_id'] })

    // ── call logs (human calls) and AI calls ────────────────────────────────
    const callRows: Row[] = []
    const callLogIds: string[] = []
    for (let i = 0; i < 26; i++) {
      const contact = rng.pick(withPhone)
      const inbound = rng.chance(0.6)
      const kind = rng.weighted([['completed', 60], ['missed', 20], ['voicemail', 10], ['busy', 5], ['failed', 5]] as const)
      const startedDays = Math.floor(118 * Math.pow(rng.next(), 1.4))
      const started = NOW - startedDays * DAY - rng.int(0, 600) * 60_000
      const duration = kind === 'completed' ? rng.int(30, 900) : kind === 'voicemail' ? rng.int(10, 60) : 0
      const callId = id(KIND.calllog, i + 1)
      callLogIds.push(callId)
      callRows.push({
        id: callId,
        org_id: orgId,
        contact_id: contact.id,
        call_sid: `CA${(spec.idx * 1000 + i + 1).toString(16).padStart(32, 'd')}`,
        direction: inbound ? 'inbound' : 'outbound',
        routing_mode: inbound ? rng.pick(['browser', 'phone_forward'] as const) : 'browser',
        from_number: inbound ? contact.phone : orgLine,
        to_number: inbound ? orgLine : contact.phone,
        status: kind === 'missed' || kind === 'voicemail' ? 'no-answer' : kind,
        duration_seconds: duration,
        recording_url: kind === 'voicemail' || (kind === 'completed' && rng.chance(0.5)) ? 'https://media.xphere.app/dev/placeholder.mp3' : null,
        recording_duration: kind === 'voicemail' || kind === 'completed' ? duration : null,
        started_at: iso(started),
        ended_at: iso(started + duration * 1000),
        notes: kind === 'voicemail' ? 'Voicemail left (dev sample).' : kind === 'completed' && rng.chance(0.4) ? 'Discussed next steps (dev sample).' : null,
        created_by: inbound ? null : primaryOwner,
        created_at: iso(started),
      })
    }
    push('calls', 'call_logs', callRows)

    const aiRows: Row[] = []
    for (let i = 0; i < 12; i++) {
      const contact = rng.pick(withPhone)
      const inbound = rng.chance(0.7)
      const startedDays = Math.floor(118 * Math.pow(rng.next(), 1.4))
      const started = NOW - startedDays * DAY - rng.int(0, 600) * 60_000
      const endedReason = rng.weighted([['customer-ended-call', 55], ['assistant-ended-call', 30], ['voicemail', 8], ['customer-did-not-answer', 7]] as const)
      const short = endedReason === 'voicemail' || endedReason === 'customer-did-not-answer'
      const ask = rng.pick(spec.callAsks)
      const turns = short
        ? [{ role: 'assistant', message: `Hello, this is the ${spec.name} assistant. We tried to reach you.`, secondsFromStart: 1 }]
        : [
          { role: 'assistant', message: `Thanks for calling ${spec.name}. How can I help you today?`, secondsFromStart: 1 },
          { role: 'user', message: ask, secondsFromStart: 6 },
          { role: 'assistant', message: rng.pick(spec.callAnswers), secondsFromStart: 12 },
          { role: 'user', message: 'That works. Can you book me in?', secondsFromStart: 24 },
          { role: 'assistant', message: 'Done. You will get a confirmation text shortly. Anything else?', secondsFromStart: 30 },
          { role: 'user', message: 'No, that is all. Thanks!', secondsFromStart: 38 },
        ]
      const duration = short ? rng.int(8, 30) : rng.int(45, 300)
      aiRows.push({
        id: id(KIND.aicall, i + 1),
        organization_id: orgId,
        vapi_call_id: `dev-vapi-${spec.idx}-${String(i + 1).padStart(3, '0')}`,
        call_type: inbound ? 'inboundPhoneCall' : 'outboundPhoneCall',
        status: 'ended',
        ended_reason: endedReason,
        started_at: iso(started),
        ended_at: iso(started + duration * 1000),
        cost: Math.round(rng.int(4, 60)) / 100,
        customer_number: contact.phone,
        customer_name: contact.name,
        org_number: orgLine,
        summary: short ? 'No conversation took place (dev sample).' : `Caller said: "${ask}" The assistant answered and offered to book. (dev sample)`,
        transcript: turns.map((t) => `${t.role === 'assistant' ? 'AI' : 'User'}: ${t.message}`).join('\n'),
        transcript_turns: turns,
        recording_url: short ? null : 'https://media.xphere.app/dev/placeholder.mp3',
        success_evaluation: short ? 'false' : 'true',
        structured_data: { intent: short ? 'none' : 'booking', dev_seed: true },
        created_at: iso(started),
      })
    }
    push('calls', 'calls', aiRows)

    // ── campaigns ───────────────────────────────────────────────────────────
    const callCampaignId = id(KIND.camp, 1)
    const smsCampaignId = id(KIND.camp, 2)
    const ccStatuses: string[] = [
      ...Array(6).fill('pending'), 'calling', ...Array(10).fill('completed'), ...Array(4).fill('no_answer'), ...Array(3).fill('failed'),
    ]
    const ccRows: Row[] = ccStatuses.map((status, i) => {
      const contact = nonProspects[(i * 5) % nonProspects.length]
      const called = status === 'pending' ? null : ago(rng.int(0, 6), rng.int(0, 600))
      return {
        id: id(KIND.cc, i + 1),
        campaign_id: callCampaignId,
        organization_id: orgId,
        name: contact.name,
        phone: contact.phone ?? phoneFor(i),
        custom_data: { contact_id: contact.id, dev_seed: true },
        status,
        error_detail: status === 'failed' ? 'busy (dev sample)' : null,
        called_at: called,
        completed_at: status === 'completed' ? called : null,
        // campaign_contacts_retry_count_check allows at most 2.
        retry_count: status === 'no_answer' || status === 'failed' ? rng.int(1, 2) : 0,
        created_at: ago(8),
        updated_at: ago(1),
      }
    })
    const countOf = (s: string): number => ccStatuses.filter((x) => x === s).length
    push('campaigns', 'campaigns', [
      {
        id: callCampaignId, organization_id: orgId, name: spec.callCampaign,
        description: 'Sample outbound calling campaign (dev data).', channel: 'calls', campaign_type: 'one_time', status: 'running',
        calls_per_minute: 3, started_at: ago(7), metrics: { total: ccStatuses.length, pending: countOf('pending'), calling: countOf('calling'), completed: countOf('completed'), no_answer: countOf('no_answer'), failed: countOf('failed') },
        created_by: primaryOwner, created_at: ago(8), updated_at: ago(1),
      },
      {
        id: smsCampaignId, organization_id: orgId, name: spec.smsCampaign.name,
        description: 'Sample SMS campaign (dev data).', channel: 'sms', campaign_type: 'one_time', status: 'completed',
        template_config: { body: spec.smsCampaign.body }, started_at: ago(30), completed_at: ago(30),
        metrics: { total: 20, sent: 6, delivered: 8, read: 2, failed: 2, skipped: 1, unsubscribed: 1 },
        created_by: primaryOwner, created_at: ago(31), updated_at: ago(30),
      },
    ])
    push('campaigns', 'campaign_contacts', ccRows)
    const recStatuses = [...Array(6).fill('sent'), ...Array(8).fill('delivered'), ...Array(2).fill('read'), ...Array(2).fill('failed'), 'skipped', 'unsubscribed']
    push('campaigns', 'campaign_recipients', recStatuses.map((status, i) => ({
      id: id(KIND.cr, i + 1),
      campaign_id: smsCampaignId,
      contact_id: nonProspects[(i * 3 + 1) % nonProspects.length].id,
      status,
      sent_at: status === 'skipped' ? null : ago(30),
      result: { dev_seed: true },
      error_message: status === 'failed' ? 'Carrier rejected the message (dev sample)' : null,
      cost_usd: status === 'skipped' ? 0 : 0.0079,
      created_at: ago(30),
      updated_at: ago(30),
    })))

    // ── tasks and notes ─────────────────────────────────────────────────────
    const taskRows: Row[] = []
    for (let i = 0; i < 20; i++) {
      const dueOffset = rng.int(-20, 14)
      const status = dueOffset < 0
        ? rng.weighted([['done', 60], ['todo', 25], ['cancelled', 15]] as const)
        : rng.weighted([['todo', 65], ['in_progress', 35]] as const)
      const entityKind = rng.weighted([['opportunity', 50], ['contact', 35], ['account', 15]] as const)
      const entityId = entityKind === 'opportunity' ? id(KIND.opp, rng.int(1, OPPS))
        : entityKind === 'contact' ? rng.pick(nonProspects).id : rng.pick(nonProspectAccounts).id
      taskRows.push({
        id: id(KIND.task, i + 1),
        org_id: orgId,
        title: rng.pick(spec.taskTitles),
        description: rng.chance(0.4) ? 'Created by the dev seed.' : null,
        due_date: ahead(dueOffset, rng.int(0, 600)),
        priority: rng.weighted([['low', 20], ['medium', 45], ['high', 25], ['urgent', 10]] as const),
        status,
        assigned_to: teamPick(),
        entity_type: entityKind,
        entity_id: entityId,
        created_by: primaryOwner,
        created_at: ago(rng.int(1, 40)),
        updated_at: ago(rng.int(0, 5)),
      })
    }
    push('tasks-notes', 'tasks', taskRows)
    const noteRows: Row[] = []
    for (let i = 0; i < 12; i++) {
      const entityKind = rng.weighted([['contact', 50], ['account', 25], ['opportunity', 25]] as const)
      const entityId = entityKind === 'opportunity' ? id(KIND.opp, rng.int(1, OPPS))
        : entityKind === 'contact' ? rng.pick(nonProspects).id : rng.pick(nonProspectAccounts).id
      noteRows.push({
        id: id(KIND.note, i + 1),
        org_id: orgId,
        title: i % 3 === 0 ? `Note ${i + 1} (dev)` : null,
        content: rng.pick(spec.noteLines),
        pinned: i % 6 === 0,
        entity_type: entityKind,
        entity_id: entityId,
        created_by: primaryOwner,
        created_at: ago(rng.int(1, 90)),
        updated_at: ago(rng.int(0, 5)),
      })
    }
    push('tasks-notes', 'notes', noteRows)

    // ── scheduling ──────────────────────────────────────────────────────────
    if (primaryOwner) {
      const etIds = spec.eventTypes.map((_, i) => id(KIND.evt, i + 1))
      push('calendar', 'event_types', spec.eventTypes.map((e, i) => ({
        id: etIds[i], org_id: orgId, user_id: primaryOwner, title: e.title, slug: e.slug,
        description: `${e.title} (dev sample)`, duration_minutes: e.minutes, color: e.color, location_type: e.location,
        location_value: e.location === 'video' ? 'https://meet.example/dev-room' : e.location === 'phone' ? orgLine : `${spec.address.line1}, ${spec.address.city}`,
        active: true, created_at: ago(110), updated_at: ago(110),
      })))
      push('calendar-extras', 'calendar_profiles', [{ user_id: primaryOwner, org_id: orgId, slug: spec.slug, timezone: spec.timezone }], { conflict: 'nothing' })
      push('calendar-extras', 'user_availability', [1, 2, 3, 4, 5].map((d) => ({
        id: id(KIND.avail, d), org_id: orgId, user_id: primaryOwner, day_of_week: d, start_time: '09:00', end_time: '17:00',
      })))

      const bookingRows: Row[] = []
      const bookerOf = (i: number) => nonProspects[(i * 7) % nonProspects.length]
      // Confirmed bookings share one organizer across all three orgs and are protected by an
      // overlap constraint: one per day, org-specific start hour, never longer than an hour.
      const hourUtc = 12 + 2 * (spec.idx - 1)
      const slot = (dayOffset: number): number => TODAY_UTC + dayOffset * DAY + hourUtc * HOUR
      let bookingSeq = 0
      const addBooking = (dayOffset: number, status: 'confirmed' | 'cancelled' | 'no_show' | 'showed', etIndex: number): void => {
        const et = spec.eventTypes[etIndex % spec.eventTypes.length]
        const who = bookerOf(bookingSeq + 1)
        const start = slot(dayOffset)
        bookingRows.push({
          id: id(KIND.booking, ++bookingSeq),
          org_id: orgId,
          event_type_id: etIds[etIndex % etIds.length],
          booker_name: who.name,
          booker_email: who.email ?? `guest.${bookingSeq}@example.com`,
          booker_phone: who.phone,
          booker_timezone: spec.timezone,
          start_at: iso(start),
          end_at: iso(start + Math.min(et.minutes, 60) * 60_000),
          notes: rng.chance(0.4) ? 'Booked through the dev seed.' : null,
          status,
          linked_contact_id: who.id,
          meeting_url: et.location === 'video' ? 'https://meet.example/dev-room' : null,
          created_at: iso(start - 4 * DAY),
          updated_at: iso(start - 4 * DAY),
        })
      }
      ;[-60, -48, -41, -33, -27, -19, -12, -6].forEach((d, i) => addBooking(d, i % 5 === 3 ? 'no_show' : 'showed', i))
      ;[-30, -9].forEach((d, i) => addBooking(d, 'cancelled', i))
      ;[1, 3, 6, 9, 13].forEach((d, i) => addBooking(d, 'confirmed', i))
      addBooking(4, 'cancelled', 1)
      push('calendar-bookings', 'bookings', bookingRows)
    } else {
      notes.push(`org${spec.idx}: event types and bookings skipped (no owner user)`)
    }

    // ── notifications ───────────────────────────────────────────────────────
    const notifRows: Row[] = []
    const recipients = [...new Set([...(primaryOwner ? [primaryOwner] : []), ...(fakeHere[0] ? [fakeUserId(fakeHere[0].n)] : [])])]
    recipients.forEach((userId, ri) => {
      for (let i = 0; i < (ri === 0 ? 10 : 6); i++) {
        const type = rng.weighted([['new_message', 35], ['new_conversation', 20], ['missed_call', 20], ['handoff_requested', 15], ['flow_failed', 10]] as const)
        const contact = rng.pick(nonProspects)
        const convId = id(KIND.conv, rng.int(1, convSeq))
        const payload: Record<string, unknown> =
          type === 'missed_call' ? { caller_name: contact.name, caller_number: contact.phone, call_log_id: rng.pick(callLogIds) }
          : type === 'handoff_requested' ? { contact_name: contact.name, reason: 'Customer asked for a person (dev sample)', conversation_id: convId }
          : type === 'flow_failed' ? { workflow_name: 'Dev welcome flow', error: 'Sample failure for the dev database' }
          : { contact_name: contact.name, message_preview: rng.pick(spec.inbound).replace('{name}', ''), conversation_id: convId }
        const created = rng.int(0, 14)
        notifRows.push({
          id: id(KIND.notif, ri * 100 + i + 1), org_id: orgId, user_id: userId, type, payload,
          read_at: rng.chance(0.5) ? ago(Math.max(0, created - 1)) : null,
          created_at: ago(created, rng.int(0, 600)),
        })
      }
    })
    push('notifications', 'notifications', notifRows)

    // ── knowledge base with deterministic embeddings ────────────────────────
    const ksIds = spec.kb.map((_, i) => id(KIND.ksrc, i + 1))
    push('knowledge', 'knowledge_sources', spec.kb.map((k, i) => ({
      id: ksIds[i], organization_id: orgId, name: `${k.title} (Dev)`, source_type: 'text', status: 'ready',
      chunk_count: k.chunks.length, created_at: ago(90 - i), updated_at: ago(90 - i),
    })))
    const docRows: Row[] = []
    spec.kb.forEach((k, i) => {
      k.chunks.forEach((chunk, j) => {
        docRows.push({
          content: chunk,
          metadata: { org_id: orgId, source_id: ksIds[i], source_type: 'text', knowledge_source_id: ksIds[i], loc: { chunk: j }, dev_seed: true },
          embedding: vectorLiteral(embedText(`${k.title} ${chunk}`)),
          knowledge_source_id: ksIds[i],
          created_at: ago(90 - i),
        })
      })
    })
    push('knowledge', 'documents', docRows, {
      exec: async (db, step) => {
        await db.query('DELETE FROM public.documents WHERE knowledge_source_id = ANY($1::uuid[])', [ksIds])
        for (const r of step.rows) {
          await db.query(
            'INSERT INTO public.documents (content, metadata, embedding, knowledge_source_id, created_at) VALUES ($1, $2::jsonb, $3::extensions.vector, $4::uuid, $5::timestamptz)',
            [r.content, JSON.stringify(r.metadata), r.embedding, r.knowledge_source_id, r.created_at],
          )
        }
        return step.rows.length
      },
    })

    // ── integrations (disabled, encrypted placeholder) and templates ────────
    if (encryptionAvailable) {
      const providers: Array<[string, string]> = [['openai', 'OpenAI'], ['resend', 'Resend'], ['twilio', 'Twilio'], ['vapi', 'Vapi']]
      const integRows: Row[] = []
      for (let i = 0; i < providers.length; i++) {
        integRows.push({
          id: id(KIND.integ, i + 1),
          organization_id: orgId,
          provider: providers[i][0],
          name: `${providers[i][1]} (dev placeholder)`,
          encrypted_api_key: await encrypt('dev-placeholder'),
          key_hint: 'lder',
          config: { dev_seed: true },
          is_active: false,
          health_status: 'unknown',
          failure_count: 0,
          created_at: ago(100),
          updated_at: ago(100),
        })
      }
      push('integrations', 'integrations', integRows)
    }
    push('templates', 'message_templates', spec.templates.map((tpl, i) => ({
      id: id(KIND.tmpl, i + 1), org_id: orgId, name: tpl.name, body: tpl.body, channel_overrides: {}, created_by: primaryOwner,
      created_at: ago(100), updated_at: ago(100),
    })))
  }

  return { steps, notes }
}

// ─── SQL helpers ──────────────────────────────────────────────────────────────

const q = (ident: string): string => `"${ident.replace(/"/g, '""')}"`
const UPSERT_CHUNK = 250

/**
 * Idempotent bulk upsert through jsonb_populate_recordset, so Postgres does the
 * type coercion (uuid, timestamptz, text[], jsonb...). Rows are grouped by key set
 * because a missing key would otherwise be inserted as NULL instead of the default.
 */
async function upsertRows(db: Client, table: string, rows: Row[], conflict: string[] | 'nothing'): Promise<number> {
  const groups = new Map<string, Row[]>()
  for (const raw of rows) {
    const clean: Row = {}
    for (const [k, v] of Object.entries(raw)) if (v !== undefined) clean[k] = v
    const sig = Object.keys(clean).sort().join('|')
    const g = groups.get(sig)
    if (g) g.push(clean)
    else groups.set(sig, [clean])
  }
  let total = 0
  for (const [sig, group] of groups) {
    const cols = sig.split('|')
    const colList = cols.map(q).join(', ')
    let tail: string
    if (conflict === 'nothing') {
      tail = 'ON CONFLICT DO NOTHING'
    } else {
      const target = conflict.map(q).join(', ')
      const updates = cols.filter((c) => !conflict.includes(c))
      tail = updates.length > 0
        ? `ON CONFLICT (${target}) DO UPDATE SET ${updates.map((c) => `${q(c)} = EXCLUDED.${q(c)}`).join(', ')}`
        : `ON CONFLICT (${target}) DO NOTHING`
    }
    for (let i = 0; i < group.length; i += UPSERT_CHUNK) {
      const res = await db.query(
        `INSERT INTO public.${q(table)} (${colList}) ` +
        `SELECT ${colList} FROM jsonb_populate_recordset(NULL::public.${q(table)}, $1::jsonb) ${tail}`,
        [JSON.stringify(group.slice(i, i + UPSERT_CHUNK))],
      )
      total += res.rowCount ?? 0
    }
  }
  return total
}

async function runStep(db: Client, step: Step): Promise<number> {
  if (step.before) await step.before(db)
  if (step.exec) return step.exec(db, step)
  return upsertRows(db, step.table, step.rows, step.conflict ?? ['id'])
}

// ─── Catalog + wipe planning ──────────────────────────────────────────────────

interface ColInfo {
  name: string
  nullable: boolean
  generated: boolean
}

interface Catalog {
  tables: string[]
  cols: Map<string, ColInfo[]>
  fks: Array<{ childSchema: string; child: string; parent: string }>
}

async function loadCatalog(db: Client): Promise<Catalog> {
  const t = await db.query<{ relname: string }>(
    `SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND NOT c.relispartition ORDER BY c.relname`,
  )
  const tables = t.rows.map((r) => r.relname)
  const tableSet = new Set(tables)
  const c = await db.query<{ table_name: string; column_name: string; is_nullable: string; is_generated: string }>(
    `SELECT table_name, column_name, is_nullable, is_generated FROM information_schema.columns
      WHERE table_schema = 'public' ORDER BY table_name, ordinal_position`,
  )
  const cols = new Map<string, ColInfo[]>()
  for (const r of c.rows) {
    if (!tableSet.has(r.table_name)) continue
    const list = cols.get(r.table_name) ?? []
    list.push({ name: r.column_name, nullable: r.is_nullable === 'YES', generated: r.is_generated === 'ALWAYS' })
    cols.set(r.table_name, list)
  }
  const f = await db.query<{ child_schema: string; child: string; parent: string }>(
    `SELECT cn.nspname AS child_schema, cc.relname AS child, pc.relname AS parent
       FROM pg_constraint k
       JOIN pg_class cc ON cc.oid = k.conrelid
       JOIN pg_namespace cn ON cn.oid = cc.relnamespace
       JOIN pg_class pc ON pc.oid = k.confrelid
       JOIN pg_namespace pn ON pn.oid = pc.relnamespace
      WHERE k.contype = 'f' AND pn.nspname = 'public'`,
  )
  return {
    tables,
    cols,
    fks: f.rows.map((r) => ({ childSchema: r.child_schema, child: r.child, parent: r.parent })),
  }
}

interface WipeEntry {
  table: string
  why: string
  keep: string | null // SQL predicate: rows that survive the wipe
  keepWhy: string | null
  collateral: boolean
}

interface WipePlan {
  wipe: WipeEntry[]
  keepTables: string[]
  blockers: string[]
}

const ORG_COLS = ['org_id', 'organization_id']
// Rows of these tables that belong to a kept user survive the wipe (column that holds the user id).
const KEEP_OWNER_TABLES: Record<string, string> = {
  users: 'id',
  auth_google_identities: 'user_id',
  app_sessions: 'user_id',
  platform_admins: 'user_id',
  user_tour_progress: 'user_id',
}
// Platform configuration that can be dragged into the wipe only through an FK (created_by -> users...).
const PROTECTED_CONFIG = /^(platform_|global_knowledge_|landing_config$|seo_config$|agent_model_pricing$|plans?$|billing_plans?$|.*_catalog$)/
const SPECIAL_KEEP: Record<string, { predicate: string; why: string }> = {
  documents: {
    predicate: `knowledge_source_id IS NULL AND NOT (metadata ? 'org_id')`,
    why: 'global knowledge chunks (no knowledge_source_id, no org_id in metadata)',
  },
}

function planWipe(cat: Catalog, keptIds: string[]): WipePlan {
  for (const id of keptIds) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) throw new Error('Unexpected user id format')
  }
  const idList = keptIds.map((i) => `'${i}'::uuid`).join(', ')
  const hasCol = (t: string, c: string): boolean => (cat.cols.get(t) ?? []).some((x) => x.name === c)
  const orgCol = (t: string): string | null => ORG_COLS.find((c) => hasCol(t, c)) ?? null

  const entries = new Map<string, WipeEntry>()
  const add = (table: string, why: string, collateral = false): void => {
    entries.set(table, { table, why, keep: null, keepWhy: null, collateral })
  }
  for (const t of cat.tables) {
    const oc = orgCol(t)
    if (t === 'organizations' || t === 'users') add(t, 'root')
    else if (oc) add(t, `tenant (${oc})`)
    else if (hasCol(t, 'user_id')) add(t, 'per-user (user_id)')
  }

  const blockers: string[] = []
  const queue = [...entries.keys()]
  while (queue.length > 0) {
    const parent = queue.shift() as string
    for (const fk of cat.fks) {
      if (fk.parent !== parent || entries.has(fk.child)) continue
      if (fk.childSchema !== 'public') {
        blockers.push(`${fk.childSchema}.${fk.child} references public.${parent}`)
        continue
      }
      if (!cat.tables.includes(fk.child)) continue
      add(fk.child, `FK-collateral (references ${parent})`, true)
      queue.push(fk.child)
    }
  }

  for (const e of entries.values()) {
    const ownerCol = KEEP_OWNER_TABLES[e.table]
    const oc = orgCol(e.table)
    const ocNullable = oc ? (cat.cols.get(e.table) ?? []).find((c) => c.name === oc)?.nullable === true : false
    if (ownerCol && keptIds.length > 0) {
      e.keep = `${q(ownerCol)} IN (${idList})`
      e.keepWhy = 'rows of kept users'
    } else if (oc && ocNullable) {
      e.keep = `${q(oc)} IS NULL`
      e.keepWhy = `rows with no ${oc} (global)`
    } else if (SPECIAL_KEEP[e.table]) {
      e.keep = SPECIAL_KEEP[e.table].predicate
      e.keepWhy = SPECIAL_KEEP[e.table].why
    } else if (e.collateral && PROTECTED_CONFIG.test(e.table)) {
      e.keep = 'true'
      e.keepWhy = 'protected platform config (all rows)'
    }
  }

  return {
    wipe: [...entries.values()].sort((a, b) => a.table.localeCompare(b.table)),
    keepTables: cat.tables.filter((t) => !entries.has(t)),
    blockers,
  }
}

function printWrapped(label: string, names: string[]): void {
  console.log(`${label} (${names.length})`)
  let line = '   '
  for (const n of names) {
    if (line.length + n.length + 2 > 110) {
      console.log(line)
      line = '   '
    }
    line += ` ${n},`
  }
  if (line.trim()) console.log(line.replace(/,$/, ''))
}

function printWipePlan(plan: WipePlan): void {
  const group = (pred: (e: WipeEntry) => boolean): string[] => plan.wipe.filter(pred).map((e) => e.table)
  console.log('\nWIPE list (truncated by --reset):')
  printWrapped(' tenant tables (org_id / organization_id)', group((e) => e.why.startsWith('tenant')))
  printWrapped(' root and per-user tables', group((e) => e.why === 'root' || e.why.startsWith('per-user')))
  const collateral = plan.wipe.filter((e) => e.collateral)
  printWrapped(' FK-collateral (reached through foreign keys; review these)', collateral.map((e) => `${e.table}<-${e.why.replace('FK-collateral (references ', '').replace(')', '')}`))
  const preserved = plan.wipe.filter((e) => e.keep)
  console.log(`\nRows preserved inside wiped tables (${preserved.length})`)
  for (const e of preserved) console.log(`   ${e.table}: ${e.keepWhy}`)
  printWrapped('\nKEEP list (untouched: platform/config/catalog tables, no org column)', plan.keepTables)
  console.log('\nAlso untouched: supabase_migrations history, auth schema, Supabase Storage objects.')
  if (plan.blockers.length > 0) {
    console.log('\nBLOCKERS (foreign keys from other schemas into wiped tables):')
    for (const b of plan.blockers) console.log(`   ${b}`)
  }
}

const insertCols = (cat: Catalog, table: string): string =>
  (cat.cols.get(table) ?? []).filter((c) => !c.generated).map((c) => q(c.name)).join(', ')

async function findOwners(db: Client, emails: string[]): Promise<string[]> {
  if (emails.length === 0) return []
  const r = await db.query<{ id: string }>(
    `SELECT id FROM public.users WHERE lower(email) = ANY($1::text[])
      ORDER BY array_position($1::text[], lower(email))`,
    [emails],
  )
  return r.rows.map((x) => x.id)
}

async function executeWipe(db: Client, cat: Catalog, plan: WipePlan): Promise<void> {
  if (plan.blockers.length > 0) {
    throw new Error(`Refusing to wipe: ${plan.blockers.length} foreign key(s) from other schemas into wiped tables (run --dry-run to list them).`)
  }
  await db.query('BEGIN')
  try {
    // Restoring kept rows should not trip over FKs to rows that were wiped. Best effort.
    await db.query('SAVEPOINT repl')
    let replica = false
    try {
      await db.query(`SET LOCAL session_replication_role = 'replica'`)
      replica = true
    } catch {
      await db.query('ROLLBACK TO SAVEPOINT repl')
    }
    await db.query('RELEASE SAVEPOINT repl')

    const snaps: Array<{ table: string; tmp: string; cols: string; rows: number }> = []
    for (const e of plan.wipe) {
      if (!e.keep) continue
      const cols = insertCols(cat, e.table)
      const tmp = `_dev_keep_${snaps.length}`
      await db.query(`CREATE TEMP TABLE ${tmp} ON COMMIT DROP AS SELECT ${cols} FROM public.${q(e.table)} WHERE ${e.keep}`)
      const n = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${tmp}`)
      snaps.push({ table: e.table, tmp, cols, rows: n.rows[0].n })
    }

    // No CASCADE on purpose: planWipe already followed every foreign key, and anything it
    // missed makes Postgres refuse the statement instead of silently emptying the table.
    await db.query(`TRUNCATE TABLE ${plan.wipe.map((e) => `public.${q(e.table)}`).join(', ')}`)

    const rank = (t: string): number => (t === 'users' ? 0 : t === 'documents' ? 2 : 1)
    for (const s of [...snaps].sort((a, b) => rank(a.table) - rank(b.table))) {
      if (s.rows === 0) continue
      await db.query(`INSERT INTO public.${q(s.table)} (${s.cols}) OVERRIDING SYSTEM VALUE SELECT ${s.cols} FROM ${s.tmp}`)
    }
    await db.query('COMMIT')

    console.log(`\nWipe done: ${plan.wipe.length} tables truncated${replica ? '' : ' (FK checks were not relaxed)'}.`)
    for (const s of snaps) if (s.rows > 0) console.log(`   restored ${s.rows} row(s) in ${s.table}`)
  } catch (err) {
    await db.query('ROLLBACK').catch(() => undefined)
    throw err
  }
}

// ─── Seed execution ───────────────────────────────────────────────────────────

interface Failure {
  section: string
  message: string
}

async function executeSeed(db: Client, steps: Step[]): Promise<{ counts: Map<string, Map<string, number>>; failures: Failure[] }> {
  const counts = new Map<string, Map<string, number>>()
  const failures: Failure[] = []
  const sections: Array<{ name: string; steps: Step[] }> = []
  for (const s of steps) {
    const last = sections[sections.length - 1]
    if (last && last.name === s.section) last.steps.push(s)
    else sections.push({ name: s.section, steps: [s] })
  }
  await db.query('BEGIN')
  try {
    for (const section of sections) {
      await db.query('SAVEPOINT seed_section')
      const local: Array<{ scope: string; table: string; n: number }> = []
      try {
        for (const step of section.steps) {
          local.push({ scope: step.scope, table: step.table, n: await runStep(db, step) })
        }
        await db.query('RELEASE SAVEPOINT seed_section')
        for (const l of local) {
          const m = counts.get(l.scope) ?? new Map<string, number>()
          m.set(l.table, (m.get(l.table) ?? 0) + l.n)
          counts.set(l.scope, m)
        }
      } catch (err) {
        await db.query('ROLLBACK TO SAVEPOINT seed_section')
        await db.query('RELEASE SAVEPOINT seed_section')
        failures.push({ section: section.name, message: err instanceof Error ? err.message : String(err) })
      }
    }
    await db.query('COMMIT')
  } catch (err) {
    await db.query('ROLLBACK').catch(() => undefined)
    throw err
  }
  return { counts, failures }
}

function printCounts(counts: Map<string, Map<string, number>>, verb: string): void {
  let total = 0
  for (const [scope, tables] of counts) {
    console.log(`\n${scope}`)
    for (const [table, n] of tables) {
      console.log(`   ${table}: ${n}`)
      total += n
    }
  }
  console.log(`\n${verb} ${total} row(s) in total.`)
}

function plannedCounts(steps: Step[]): Map<string, Map<string, number>> {
  const counts = new Map<string, Map<string, number>>()
  for (const s of steps) {
    const m = counts.get(s.scope) ?? new Map<string, number>()
    m.set(s.table, (m.get(s.table) ?? 0) + s.rows.length)
    counts.set(s.scope, m)
  }
  return counts
}

function runWorkflowLoader(): void {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.log('\nWorkflows: skipped (SUPABASE_SERVICE_ROLE_KEY not set; the loader talks to PostgREST).')
    return
  }
  console.log('\nLoading platform-default workflows into the sample orgs (scripts/load-workflow-seeds.ts)...')
  for (const orgId of SEED_ORG_IDS) {
    const res = spawnSync('npx', ['tsx', 'scripts/load-workflow-seeds.ts', `--org=${orgId}`], {
      stdio: 'inherit',
      shell: true,
      env: process.env,
    })
    if (res.status !== 0) {
      console.warn(`Workflow loader exited with status ${res.status} for ${orgId}. Re-run: npm run seed -- --org=${orgId}`)
      process.exitCode = 1
    }
  }
}

// ─── Entry points ─────────────────────────────────────────────────────────────

function newClient(): Client {
  const url = process.env.DATABASE_URL as string
  return new Client({
    connectionString: url,
    ssl: url.includes('sslmode=disable') ? false : { rejectUnauthorized: false },
    application_name: 'xphere-seed-dev',
  })
}

async function dryRun(db: Client, keepEmails: string[]): Promise<void> {
  await db.query('BEGIN READ ONLY')
  try {
    const cat = await loadCatalog(db)
    const owners = await findOwners(db, keepEmails)
    console.log(`\nKept owner accounts found: ${owners.length} of ${keepEmails.length} listed in DEV_KEEP_USER_EMAILS.`)
    if (keepEmails.length === 0) console.log('WARNING: DEV_KEEP_USER_EMAILS is empty; --reset will refuse unless --allow-no-owner is given.')
    const wipe = planWipe(cat, owners)
    printWipePlan(wipe)

    const plan = await buildPlan(owners.length > 0 ? owners : [uid(KIND.user, 0, 900)])
    console.log(`\nSeed plan (${DO_RESET ? 'after --reset' : 'additive, no --reset'}):`)
    printCounts(plannedCounts(plan.steps), 'Would seed')
    for (const n of plan.notes) console.log(`NOTE: ${n}`)
    console.log(SKIP_WORKFLOWS ? '\nWorkflows: skipped (--skip-workflows).' : '\nWorkflows: would run scripts/load-workflow-seeds.ts once per sample org.')
    console.log('\n--dry-run: nothing was written.')
  } finally {
    await db.query('ROLLBACK')
  }
}

async function realRun(db: Client, keepEmails: string[]): Promise<void> {
  let owners = await findOwners(db, keepEmails)
  if (owners.length < keepEmails.length) {
    console.warn(`WARNING: only ${owners.length} of ${keepEmails.length} DEV_KEEP_USER_EMAILS exist in public.users.`)
  }
  if (owners.length === 0 && !ALLOW_NO_OWNER) {
    console.error('\nRefusing to continue: no user from DEV_KEEP_USER_EMAILS exists, so nobody could log in to the seeded orgs.')
    console.error('Sign in once with the owner account (or fix DEV_KEEP_USER_EMAILS), or pass --allow-no-owner.')
    process.exitCode = 1
    return
  }

  if (DO_RESET) {
    const cat = await loadCatalog(db)
    const wipe = planWipe(cat, owners)
    printWipePlan(wipe)
    await executeWipe(db, cat, wipe)
    owners = await findOwners(db, keepEmails)
  } else {
    const r = await db.query<{ n: number }>('SELECT count(*)::int AS n FROM public.organizations WHERE id <> ALL($1::uuid[])', [SEED_ORG_IDS])
    if (r.rows[0].n > 0) {
      console.warn(`\nWARNING: ${r.rows[0].n} organization(s) that are not part of the seed exist. Run with --reset to remove them.`)
    }
  }

  const plan = await buildPlan(owners)
  for (const n of plan.notes) console.log(`NOTE: ${n}`)
  const { counts, failures } = await executeSeed(db, plan.steps)
  printCounts(counts, 'Seeded')

  if (failures.length > 0) {
    console.error(`\n${failures.length} section(s) FAILED and were rolled back:`)
    for (const f of failures) console.error(`   ${f.section}: ${f.message}`)
    process.exitCode = 1
  }
  console.log('\nSupabase Storage was not touched (objects from the old copy are still there).')

  if (!SKIP_WORKFLOWS) runWorkflowLoader()
}

async function main(): Promise<void> {
  loadDotEnvLocal()
  console.log('Xphere development-database seed')

  const guard = evaluateGuard()
  if (!guard.ok) {
    console.error('\nSAFETY GUARD: refusing to run.')
    for (const p of guard.problems) console.error(`   - ${p}`)
    process.exit(1)
  }
  console.log(`Guard OK. This run will touch Supabase project ref: ${guard.ref}`)
  const keepEmails = (process.env.DEV_KEEP_USER_EMAILS ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
  console.log(`Mode: ${DRY_RUN ? 'dry-run' : DO_RESET ? 'reset + seed' : 'seed'}`)

  const db = newClient()
  await db.connect()
  try {
    if (DRY_RUN) await dryRun(db, keepEmails)
    else await realRun(db, keepEmails)
  } finally {
    await db.end()
  }
}

main().catch((err) => {
  console.error('Unhandled error:', err instanceof Error ? err.message : err)
  process.exit(99)
})
