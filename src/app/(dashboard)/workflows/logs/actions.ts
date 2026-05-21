'use server'

import { createClient } from '@/lib/supabase/server'
import type { Database } from '@/types/database'

export type ActionLogRow = Database['public']['Tables']['action_logs']['Row']
export type LogStatus = ActionLogRow['status']

export type LogWithCall = ActionLogRow & {
  call: {
    id: string
    customer_name: string | null
    customer_number: string | null
  } | null
  workflow_id: string | null
  workflow_name: string | null
}

export type GetLogsParams = {
  workflowId?: string
  toolConfigId?: string
  status?: LogStatus | 'all'
  from?: string
  to?: string
  q?: string
  page?: number
  pageSize?: number
}

export type GetLogsResult = {
  logs: LogWithCall[]
  total: number
  pageCount: number
}

export type WorkflowLogOption = {
  id: string
  name: string
  tool_name: string | null
  legacy_tool_config_id: string | null
}

type WorkflowLogLookup = WorkflowLogOption

async function getWorkflowLookupById(
  workflowId: string,
  supabase: Awaited<ReturnType<typeof createClient>>
): Promise<WorkflowLogLookup | null> {
  const { data } = await supabase
    .from('workflows')
    .select('id, name, tool_name, legacy_tool_config_id')
    .eq('id', workflowId)
    .is('deleted_at', null)
    .maybeSingle()

  return (data ?? null) as WorkflowLogLookup | null
}

async function buildWorkflowMap(
  logs: ActionLogRow[],
  supabase: Awaited<ReturnType<typeof createClient>>
): Promise<{
  byId: Map<string, WorkflowLogLookup>
  byToolName: Map<string, WorkflowLogLookup>
}> {
  const toolConfigIds = [...new Set(logs.map((log) => log.tool_config_id).filter(Boolean))] as string[]
  const toolNames = [...new Set(logs.map((log) => log.tool_name).filter(Boolean))]

  const [workflowIdsRes, workflowLegacyIdsRes, workflowNamesRes] = await Promise.all([
    toolConfigIds.length > 0
      ? supabase
          .from('workflows')
          .select('id, name, tool_name, legacy_tool_config_id')
          .in('id', toolConfigIds)
      : Promise.resolve({ data: [] }),
    toolConfigIds.length > 0
      ? supabase
          .from('workflows')
          .select('id, name, tool_name, legacy_tool_config_id')
          .in('legacy_tool_config_id', toolConfigIds)
      : Promise.resolve({ data: [] }),
    toolNames.length > 0
      ? supabase
          .from('workflows')
          .select('id, name, tool_name, legacy_tool_config_id')
          .in('tool_name', toolNames)
      : Promise.resolve({ data: [] }),
  ])

  const byId = new Map<string, WorkflowLogLookup>()
  const byToolName = new Map<string, WorkflowLogLookup>()
  const rows = [
    ...(workflowIdsRes.data ?? []),
    ...(workflowLegacyIdsRes.data ?? []),
    ...(workflowNamesRes.data ?? []),
  ] as WorkflowLogLookup[]

  for (const workflow of rows) {
    byId.set(workflow.id, workflow)
    if (workflow.legacy_tool_config_id) byId.set(workflow.legacy_tool_config_id, workflow)
    if (workflow.tool_name) byToolName.set(workflow.tool_name, workflow)
  }

  return { byId, byToolName }
}

export async function getLogs({
  workflowId,
  toolConfigId,
  status,
  from,
  to,
  q,
  page = 1,
  pageSize = 50,
}: GetLogsParams): Promise<GetLogsResult> {
  const supabase = await createClient()
  const offset = (page - 1) * pageSize

  let query = supabase
    .from('action_logs')
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(offset, offset + pageSize - 1)

  if (workflowId) {
    const workflow = await getWorkflowLookupById(workflowId, supabase)
    if (!workflow) return { logs: [], total: 0, pageCount: 0 }

    const logToolConfigIds = [workflow.legacy_tool_config_id, workflow.id].filter(Boolean) as string[]
    if (logToolConfigIds.length > 0) {
      query = query.in('tool_config_id', logToolConfigIds)
    } else if (workflow.tool_name) {
      query = query.eq('tool_name', workflow.tool_name)
    } else {
      return { logs: [], total: 0, pageCount: 0 }
    }
  } else if (toolConfigId) {
    query = query.eq('tool_config_id', toolConfigId)
  }

  if (status && status !== 'all') query = query.eq('status', status)
  if (from) query = query.gte('created_at', from)
  if (to) {
    const toEnd = new Date(to)
    if (!isNaN(toEnd.getTime())) {
      toEnd.setDate(toEnd.getDate() + 1)
      query = query.lt('created_at', toEnd.toISOString())
    }
  }
  if (q) query = query.ilike('vapi_call_id', `${q}%`)

  const { data, count, error } = await query
  if (error) return { logs: [], total: 0, pageCount: 0 }

  const logs = (data ?? []) as ActionLogRow[]
  const callIds = [...new Set(logs.map((l) => l.vapi_call_id))]
  const workflowMap = await buildWorkflowMap(logs, supabase)

  let callMap = new Map<string, { id: string; customer_name: string | null; customer_number: string | null }>()
  if (callIds.length > 0) {
    const { data: calls } = await supabase
      .from('calls')
      .select('id, vapi_call_id, customer_name, customer_number')
      .in('vapi_call_id', callIds)
    callMap = new Map(
      (calls ?? []).map((c) => [
        c.vapi_call_id,
        { id: c.id, customer_name: c.customer_name, customer_number: c.customer_number },
      ])
    )
  }

  const total = count ?? 0
  return {
    logs: logs.map((log) => {
      const workflow =
        (log.tool_config_id ? workflowMap.byId.get(log.tool_config_id) : undefined) ??
        workflowMap.byToolName.get(log.tool_name) ??
        null

      return {
        ...log,
        call: callMap.get(log.vapi_call_id) ?? null,
        workflow_id: workflow?.id ?? null,
        workflow_name: workflow?.name ?? null,
      }
    }),
    total,
    pageCount: Math.ceil(total / pageSize),
  }
}

export async function getWorkflowOptions(): Promise<WorkflowLogOption[]> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('workflows')
    .select('id, name, tool_name, legacy_tool_config_id')
    .is('deleted_at', null)
    .is('archived_at', null)
    .order('name', { ascending: true })
  return (data ?? []) as WorkflowLogOption[]
}

// Average is computed over the most recent AVG_SAMPLE_SIZE executions so the
// query is bounded as the log table grows; counts stay exact via head:true.
const AVG_SAMPLE_SIZE = 500

export async function getLogStats(toolConfigId: string): Promise<{
  total: number
  successCount: number
  averageMs: number | null
}> {
  const supabase = await createClient()

  const [totalRes, successRes, recentRes] = await Promise.all([
    supabase
      .from('action_logs')
      .select('*', { count: 'exact', head: true })
      .eq('tool_config_id', toolConfigId),
    supabase
      .from('action_logs')
      .select('*', { count: 'exact', head: true })
      .eq('tool_config_id', toolConfigId)
      .eq('status', 'success'),
    supabase
      .from('action_logs')
      .select('execution_ms')
      .eq('tool_config_id', toolConfigId)
      .order('created_at', { ascending: false })
      .limit(AVG_SAMPLE_SIZE),
  ])

  const recent = recentRes.data ?? []
  const averageMs =
    recent.length > 0
      ? Math.round(recent.reduce((s, l) => s + l.execution_ms, 0) / recent.length)
      : null

  return {
    total: totalRes.count ?? 0,
    successCount: successRes.count ?? 0,
    averageMs,
  }
}
