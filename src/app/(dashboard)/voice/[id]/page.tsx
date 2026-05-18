import { redirect } from 'next/navigation'

export default async function VoiceDetailRedirect({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  redirect(`/calls/${id}`)
}
