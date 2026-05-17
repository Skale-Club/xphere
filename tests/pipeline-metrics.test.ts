// tests/pipeline-metrics.test.ts
// SEED-008 / v2.1 — Pipeline metrics aggregation.

import { describe, it, expect } from 'vitest'
import { formatCurrency, daysSince, ageTone, initialsOf } from '@/lib/pipeline/format'

describe('formatCurrency', () => {
  it('formats BRL with pt-BR locale', () => {
    const f = formatCurrency(1234.56, 'BRL')
    // Some Node ICU builds use NBSP / NNBSP, just confirm key tokens are there.
    expect(f).toContain('R$')
    expect(f).toContain('1.234,56')
  })
  it('returns em-dash for null', () => {
    expect(formatCurrency(null)).toBe('—')
  })
})

describe('daysSince + ageTone', () => {
  it('returns 0 for now', () => {
    expect(daysSince(new Date().toISOString())).toBe(0)
  })
  it('neutral under 7d, warning 7-30d, danger over 30d', () => {
    const days = (n: number) => new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString()
    expect(ageTone(daysSince(days(2)))).toBe('neutral')
    expect(ageTone(daysSince(days(10)))).toBe('warning')
    expect(ageTone(daysSince(days(45)))).toBe('danger')
  })
})

describe('initialsOf', () => {
  it('returns first+last initial', () => {
    expect(initialsOf('Jane Doe')).toBe('JD')
  })
  it('handles single names', () => {
    expect(initialsOf('Alice')).toBe('AL')
  })
  it('falls back to ?', () => {
    expect(initialsOf(null)).toBe('?')
    expect(initialsOf('')).toBe('?')
  })
})

const DB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const dbDescribe = DB_URL ? describe : describe.skip

dbDescribe('PipelineMetrics aggregation', async () => {
  const { serviceClient, seedTestOrg } = await import('./agents/fixtures')
  const svc = serviceClient()

  it('totals open value and counts won this month', async () => {
    const fx = await seedTestOrg('metrics')

    const { data: pipeline } = await svc
      .from('pipelines')
      .select('id')
      .eq('org_id', fx.orgId)
      .eq('is_default', true)
      .maybeSingle()
    const { data: stages } = await svc
      .from('pipeline_stages')
      .select('id, is_won, is_lost')
      .eq('pipeline_id', pipeline!.id)
    const lead = stages!.find((s) => !s.is_won && !s.is_lost)!.id
    const won = stages!.find((s) => s.is_won)!.id

    await svc.from('opportunities').insert([
      { org_id: fx.orgId, pipeline_id: pipeline!.id, stage_id: lead, title: 'Open A', value: 1000, status: 'open' },
      { org_id: fx.orgId, pipeline_id: pipeline!.id, stage_id: lead, title: 'Open B', value: 2500, status: 'open' },
      { org_id: fx.orgId, pipeline_id: pipeline!.id, stage_id: won, title: 'Won A', value: 500, status: 'won' },
    ])

    const { data: opps } = await svc
      .from('opportunities')
      .select('value, status')
      .eq('pipeline_id', pipeline!.id)

    const open = (opps ?? []).filter((o) => o.status === 'open')
    const wonRows = (opps ?? []).filter((o) => o.status === 'won')
    const openTotal = open.reduce((acc, o) => acc + Number(o.value ?? 0), 0)
    const wonTotal = wonRows.reduce((acc, o) => acc + Number(o.value ?? 0), 0)

    expect(openTotal).toBe(3500)
    expect(wonTotal).toBe(500)

    await fx.cleanup()
  })
})
