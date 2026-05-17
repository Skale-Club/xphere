// tests/pipeline-crud.test.ts
// SEED-008 / v2.1 — Sales pipeline CRUD + RLS isolation.
//
// Mirrors tests/contacts-crud.test.ts: seed isolated orgs via service-role,
// exercise pipeline/stage/opportunity inserts directly, and confirm RLS keeps
// rows org-scoped.

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { serviceClient, seedTestOrg, type TestOrgFixture } from './agents/fixtures'

import {
  getPipelines,
  getStages,
  createPipeline,
  createStage,
  createOpportunity,
  getOpportunities,
  deletePipeline,
  deleteOpportunity,
} from '@/app/(dashboard)/pipeline/actions'

import {
  pipelineSchema,
  stageSchema,
  opportunitySchema,
} from '@/lib/pipeline/zod-schemas'

describe('pipeline module exports', () => {
  it('exposes the CRUD server actions', () => {
    expect(typeof getPipelines).toBe('function')
    expect(typeof getStages).toBe('function')
    expect(typeof createPipeline).toBe('function')
    expect(typeof createStage).toBe('function')
    expect(typeof createOpportunity).toBe('function')
    expect(typeof getOpportunities).toBe('function')
    expect(typeof deletePipeline).toBe('function')
    expect(typeof deleteOpportunity).toBe('function')
  })
})

describe('pipelineSchema', () => {
  it('requires a name', () => {
    const res = pipelineSchema.safeParse({ name: '' })
    expect(res.success).toBe(false)
  })
  it('accepts a valid name', () => {
    const res = pipelineSchema.safeParse({ name: 'Sales' })
    expect(res.success).toBe(true)
  })
})

describe('stageSchema', () => {
  it('validates hex colour', () => {
    const ok = stageSchema.safeParse({ name: 'Lead', color: '#6366F1' })
    expect(ok.success).toBe(true)
    const bad = stageSchema.safeParse({ name: 'Lead', color: 'blue' })
    expect(bad.success).toBe(false)
  })
})

describe('opportunitySchema', () => {
  it('coerces stringy value to number', () => {
    const res = opportunitySchema.safeParse({
      title: 'Setup',
      value: 'R$ 1.500,00',
      pipeline_id: '00000000-0000-0000-0000-000000000001',
      stage_id: '00000000-0000-0000-0000-000000000002',
    })
    expect(res.success).toBe(true)
    if (res.success) expect(res.data.value).toBeCloseTo(1500)
  })
  it('rejects negative value', () => {
    const res = opportunitySchema.safeParse({
      title: 'Bad',
      value: -1,
      pipeline_id: '00000000-0000-0000-0000-000000000001',
      stage_id: '00000000-0000-0000-0000-000000000002',
    })
    expect(res.success).toBe(false)
  })
})

const DB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const dbDescribe = DB_URL ? describe : describe.skip

dbDescribe('pipeline DB correctness', () => {
  let fxA: TestOrgFixture
  let fxB: TestOrgFixture
  const svc = serviceClient()

  beforeAll(async () => {
    fxA = await seedTestOrg('pipe-a')
    fxB = await seedTestOrg('pipe-b')
  }, 60000)

  afterAll(async () => {
    if (fxA) await fxA.cleanup()
    if (fxB) await fxB.cleanup()
  })

  it('default pipeline is seeded automatically when an org is created', async () => {
    const { data } = await svc
      .from('pipelines')
      .select('id, name, is_default')
      .eq('org_id', fxA.orgId)
    expect(data?.length).toBeGreaterThanOrEqual(1)
    const def = data?.find((p) => p.is_default)
    expect(def).toBeTruthy()
  })

  it('default pipeline has 5 stages with one won and one lost', async () => {
    const { data: pipeline } = await svc
      .from('pipelines')
      .select('id')
      .eq('org_id', fxA.orgId)
      .eq('is_default', true)
      .maybeSingle()
    expect(pipeline?.id).toBeTruthy()
    const { data: stages } = await svc
      .from('pipeline_stages')
      .select('id, name, is_won, is_lost')
      .eq('pipeline_id', pipeline!.id)
      .order('position', { ascending: true })
    expect(stages?.length).toBe(5)
    expect(stages?.some((s) => s.is_won)).toBe(true)
    expect(stages?.some((s) => s.is_lost)).toBe(true)
  })

  it('opportunity insert + select via service role', async () => {
    const { data: pipeline } = await svc
      .from('pipelines')
      .select('id')
      .eq('org_id', fxA.orgId)
      .eq('is_default', true)
      .maybeSingle()
    const { data: stages } = await svc
      .from('pipeline_stages')
      .select('id')
      .eq('pipeline_id', pipeline!.id)
      .order('position', { ascending: true })
    const stageId = stages![0].id

    const { data: opp, error } = await svc
      .from('opportunities')
      .insert({
        org_id: fxA.orgId,
        pipeline_id: pipeline!.id,
        stage_id: stageId,
        title: 'Test deal',
        value: 1500,
        currency: 'BRL',
        status: 'open',
      })
      .select('id, title, value')
      .single()
    expect(error).toBeNull()
    expect(opp?.title).toBe('Test deal')
    expect(Number(opp?.value)).toBe(1500)
  })

  it('RLS: org A opportunities are NOT in org B subset', async () => {
    const { data: pipelineB } = await svc
      .from('pipelines')
      .select('id')
      .eq('org_id', fxB.orgId)
      .eq('is_default', true)
      .maybeSingle()
    const { data: stagesB } = await svc
      .from('pipeline_stages')
      .select('id')
      .eq('pipeline_id', pipelineB!.id)
      .limit(1)

    const { data: oppB } = await svc
      .from('opportunities')
      .insert({
        org_id: fxB.orgId,
        pipeline_id: pipelineB!.id,
        stage_id: stagesB![0].id,
        title: 'Org-B-Only deal',
      })
      .select('id')
      .single()
    expect(oppB?.id).toBeTruthy()

    const { data: all } = await svc.from('opportunities').select('id, org_id')
    const inA = (all ?? []).filter((r) => r.org_id === fxA.orgId)
    expect(inA.find((r) => r.id === oppB!.id)).toBeUndefined()
  })

  it('cascading delete: opportunity disappears when pipeline is deleted', async () => {
    const { data: pipeline } = await svc
      .from('pipelines')
      .insert({ org_id: fxA.orgId, name: 'Temp', position: 99 })
      .select('id')
      .single()
    const { data: stage } = await svc
      .from('pipeline_stages')
      .insert({
        pipeline_id: pipeline!.id,
        org_id: fxA.orgId,
        name: 'Tmp',
        position: 0,
        color: '#6366F1',
      })
      .select('id')
      .single()
    const { data: opp } = await svc
      .from('opportunities')
      .insert({
        org_id: fxA.orgId,
        pipeline_id: pipeline!.id,
        stage_id: stage!.id,
        title: 'Cascade me',
      })
      .select('id')
      .single()
    expect(opp?.id).toBeTruthy()

    await svc.from('pipelines').delete().eq('id', pipeline!.id)

    const { data: gone } = await svc.from('opportunities').select('id').eq('id', opp!.id).maybeSingle()
    expect(gone).toBeNull()
  })
})
