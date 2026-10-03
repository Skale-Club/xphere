import { orgRedirect } from '@/lib/org/redirect'

export default async function PhoneRedirect({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const params = await searchParams
  const tab = params.tab as string | undefined
  if (tab === 'campaigns') return orgRedirect('/campaigns?channel=calls')
  if (tab === 'assistants') return orgRedirect('/calls?settings=assistants')
  return orgRedirect('/calls')
}
