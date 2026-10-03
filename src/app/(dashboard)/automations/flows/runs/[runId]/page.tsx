import { orgRedirect } from '@/lib/org/redirect'
export default async function RunDetailLegacyRedirect({
  params,
}: {
  params: Promise<{ runId: string }>
}) {
  const { runId } = await params
  return orgRedirect(`/workflows/flows/runs/${runId}`)
}
