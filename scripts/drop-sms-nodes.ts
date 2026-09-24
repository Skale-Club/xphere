// Remove send_sms nodes from an organization's active workflows and rewire the
// flow around them.
//
// For an org with no number to send from, an SMS node does not just fail — when
// it is the FIRST node it takes everything behind it down with it. "Booking
// request received" is send_sms -> send_tenant_email: the owner never gets the
// email because the text to the customer failed a step earlier. Removing the
// node lets the half that can work, work.
//
// Publishes a new version per workflow; the old one stays in history.
// One organization per run.
//
//   npx tsx --env-file=.env.local scripts/drop-sms-nodes.ts --org=<uuid> [--apply]

import { createServiceRoleClient } from '@/lib/supabase/admin'

const ORG = process.argv.find((a) => a.startsWith('--org='))?.split('=')[1]
if (!ORG) throw new Error('pass --org=<uuid>')

interface FlowNode {
  id: string
  type: string
  data?: { action_type?: string; label?: string }
}
interface FlowEdge {
  id?: string
  source: string
  target: string
  sourceHandle?: string
}

/** Drop `remove` and join each of its inbound edges to each of its outbound ones. */
function spliceOut(nodes: FlowNode[], edges: FlowEdge[], remove: Set<string>) {
  let keptEdges = [...edges]
  for (const id of remove) {
    const incoming = keptEdges.filter((e) => e.target === id)
    const outgoing = keptEdges.filter((e) => e.source === id)
    const rest = keptEdges.filter((e) => e.source !== id && e.target !== id)
    const bridged: FlowEdge[] = []
    for (const i of incoming) {
      for (const o of outgoing) {
        bridged.push({ source: i.source, target: o.target, ...(i.sourceHandle ? { sourceHandle: i.sourceHandle } : {}) })
      }
    }
    keptEdges = [...rest, ...bridged]
  }
  // Re-id so nothing collides.
  keptEdges = keptEdges.map((e, i) => ({ ...e, id: `e${i + 1}` }))
  return { nodes: nodes.filter((n) => !remove.has(n.id)), edges: keptEdges }
}

async function main() {
  const apply = process.argv.includes('--apply')
  const sb = createServiceRoleClient()

  const { data: workflows } = await sb
    .from('workflows')
    .select('id, name, current_version_id')
    .eq('org_id', ORG)
    .eq('is_active', true)

  for (const wf of workflows ?? []) {
    const { data: version } = await sb
      .from('workflow_versions')
      .select('definition, version_number')
      .eq('id', wf.current_version_id!)
      .single()

    const def = structuredClone(version!.definition) as { nodes: FlowNode[]; edges: FlowEdge[] }
    const smsIds = new Set(
      (def.nodes ?? []).filter((n) => n.type === 'action' && n.data?.action_type === 'send_sms').map((n) => n.id),
    )
    if (smsIds.size === 0) continue

    const before = (def.nodes ?? []).filter((n) => n.type === 'action').map((n) => n.data?.action_type).join(' -> ')
    const { nodes, edges } = spliceOut(def.nodes ?? [], def.edges ?? [], smsIds)
    const after = nodes.filter((n) => n.type === 'action').map((n) => n.data?.action_type).join(' -> ') || '(nothing left)'

    console.log(`\n${wf.name}`)
    console.log(`   before: ${before}`)
    console.log(`   after : ${after}`)

    if (nodes.filter((n) => n.type === 'action').length === 0) {
      console.log('   !! nothing would remain — leaving it alone, switch it off instead')
      continue
    }
    if (!apply) continue

    const next = { ...def, nodes, edges }
    const { data: newVersion, error: vErr } = await sb
      .from('workflow_versions')
      .insert({
        workflow_id: wf.id,
        version_number: (version!.version_number ?? 0) + 1,
        definition: next as never,
        notes: `send_sms nodes removed — org moved off SMS ${new Date().toISOString()}`,
      })
      .select('id')
      .single()
    if (vErr) throw vErr
    const { error } = await sb.from('workflows').update({ current_version_id: newVersion.id }).eq('id', wf.id)
    if (error) throw error
    console.log('   published')
  }

  console.log(apply ? '\napplied.' : '\nDRY RUN — pass --apply.')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
