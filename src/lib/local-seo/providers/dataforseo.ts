// DataForSEO Google Maps SERP as an async rank provider (standard queue).
//
//   submit   POST /v3/serp/google/maps/task_post   up to 100 tasks per call
//   push     postback_url receives each finished task (gzip JSON)
//   pull     GET  /v3/serp/google/maps/task_get/advanced/{id}   (fallback)
//
// Each task carries `tag` = our point id, so a result can always be routed
// back even if the task id was never persisted.

import type { SerpResult } from '../types'
import {
  RankProviderError,
  type AsyncRankProvider,
  type PointQuery,
  type SubmitOutcome,
  type TaskOutcome,
} from './types'

const API = 'https://api.dataforseo.com/v3/serp/google/maps'
// Standard queue, per task of up to 100 results (Oct 2026). Verify the
// parameter multipliers before launch — see SPEC 4.6.
const COST_PER_TASK_USD = 0.0006

type DfsItem = {
  type?: string
  rank_group?: number
  rank_absolute?: number
  title?: string
  place_id?: string
  cid?: string
  rating?: { value?: number; votes_count?: number } | null
  category?: string
  address?: string
  phone?: string
  latitude?: number
  longitude?: number
}

type DfsTask = {
  id?: string
  status_code?: number
  status_message?: string
  cost?: number
  data?: { tag?: string }
  result?: { items?: DfsItem[] | null }[] | null
}

type DfsEnvelope = { status_code?: number; status_message?: string; tasks?: DfsTask[] }

/** Account-level codes that make every further call pointless. */
function envelopeError(env: DfsEnvelope): RankProviderError | null {
  const code = env.status_code ?? 0
  if (code === 20000) return null
  const msg = `DataForSEO ${code}: ${env.status_message ?? 'error'}`
  if (code === 40100 || code === 40101 || code === 40104) return new RankProviderError('auth', msg)
  if (code === 40200 || code === 40210) return new RankProviderError('quota', msg)
  if (code === 40202 || code === 50000 || code === 50301) return new RankProviderError('transient', msg)
  return new RankProviderError('invalid', msg)
}

/** Status codes on a single task. */
function taskOutcome(task: DfsTask, depth = 700): TaskOutcome {
  const code = task.status_code ?? 0
  if (code === 20000) return { status: 'done', results: parseDfsItems(task, depth) }
  // 40601 Task Handed / 40602 Task In Queue: not finished yet.
  if (code === 40601 || code === 40602 || code === 20100) return { status: 'pending' }
  const msg = `DataForSEO task ${code}: ${task.status_message ?? 'error'}`
  // 40102 "No Search Results" is a legitimately empty point.
  if (code === 40102) return { status: 'done', results: [] }
  if (code === 40200 || code === 40210) return { status: 'error', error: new RankProviderError('quota', msg) }
  if (code >= 50000) return { status: 'error', error: new RankProviderError('transient', msg) }
  return { status: 'error', error: new RankProviderError('invalid', msg) }
}

export function parseDfsItems(task: DfsTask, depth: number): SerpResult[] {
  const items = task.result?.[0]?.items ?? []
  return items
    .filter((it) => it.type === 'maps_search')
    .map((it, i): SerpResult => ({
      position: it.rank_group ?? i + 1,
      title: it.title ?? '',
      placeId: it.place_id ?? null,
      cid: it.cid ?? null,
      rating: it.rating?.value ?? null,
      reviews: it.rating?.votes_count ?? null,
      category: it.category ?? null,
      address: it.address ?? null,
      phone: it.phone ?? null,
      lat: it.latitude ?? null,
      lng: it.longitude ?? null,
    }))
    .filter((r) => r.title && r.position <= depth)
}

/** A postback body is a task_get envelope with the finished task(s). */
export function parseDataForSeoPostback(body: unknown): { taskId: string; outcome: TaskOutcome }[] {
  const env = (body ?? {}) as DfsEnvelope
  return (env.tasks ?? [])
    .filter((t): t is DfsTask & { id: string } => typeof t.id === 'string')
    .map((t) => ({ taskId: t.id, outcome: taskOutcome(t) }))
}

export function createDataForSeoProvider(login: string, password: string): AsyncRankProvider {
  const auth = `Basic ${Buffer.from(`${login}:${password}`).toString('base64')}`

  async function call(path: string, init: RequestInit = {}): Promise<DfsEnvelope> {
    let res: Response
    try {
      res = await fetch(`${API}${path}`, {
        ...init,
        headers: { Authorization: auth, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
        signal: AbortSignal.timeout(30_000),
      })
    } catch (err) {
      throw new RankProviderError('transient', `DataForSEO request failed: ${(err as Error).message}`)
    }
    if (res.status === 401) throw new RankProviderError('auth', 'DataForSEO rejected the credentials.')
    if (res.status === 402) throw new RankProviderError('quota', 'DataForSEO balance is exhausted.')
    if (res.status === 429 || res.status >= 500) {
      throw new RankProviderError('transient', `DataForSEO returned HTTP ${res.status}`)
    }
    const env = (await res.json().catch(() => null)) as DfsEnvelope | null
    if (!env) throw new RankProviderError('transient', 'DataForSEO returned an unreadable body')
    const err = envelopeError(env)
    if (err) throw err
    return env
  }

  return {
    id: 'dataforseo',
    mode: 'async',
    batchSize: 100,
    costPerPointUsd: (depth) => COST_PER_TASK_USD * Math.max(1, Math.ceil(depth / 100)),

    async submit(qs: PointQuery[], postbackUrl: string | null): Promise<SubmitOutcome[]> {
      if (qs.length === 0) return []
      const body = qs.map((q) => ({
        keyword: q.keyword,
        location_coordinate: `${q.lat},${q.lng},${q.zoom}z`,
        language_code: q.language,
        depth: q.depth,
        tag: q.pointId,
        ...(postbackUrl ? { postback_url: postbackUrl, postback_data: 'advanced' } : {}),
      }))
      const env = await call('/task_post', { method: 'POST', body: JSON.stringify(body) })
      const byTag = new Map<string, DfsTask>()
      for (const t of env.tasks ?? []) if (t.data?.tag) byTag.set(t.data.tag, t)
      return qs.map((q, i): SubmitOutcome => {
        const t = byTag.get(q.pointId) ?? env.tasks?.[i]
        if (t?.id && t.status_code === 20100) return { pointId: q.pointId, taskId: t.id }
        const code = t?.status_code ?? 0
        const msg = `DataForSEO task_post ${code}: ${t?.status_message ?? 'no task returned'}`
        const kind = code === 40200 || code === 40210 ? 'quota' : code >= 50000 || !t ? 'transient' : 'invalid'
        return { pointId: q.pointId, error: new RankProviderError(kind, msg) }
      })
    },

    async getTask(taskId: string): Promise<TaskOutcome> {
      const env = await call(`/task_get/advanced/${encodeURIComponent(taskId)}`)
      const task = env.tasks?.[0]
      if (!task) return { status: 'pending' }
      return taskOutcome(task)
    },

    parsePostback: parseDataForSeoPostback,
  }
}
