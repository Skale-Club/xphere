import { orgRedirect } from '@/lib/org/redirect'

export default async function VoiceDetailRedirect({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  return orgRedirect(`/calls?call=${encodeURIComponent(id)}`)
}
