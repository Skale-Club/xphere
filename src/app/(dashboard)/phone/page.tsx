import { redirect } from 'next/navigation'

export default async function PhoneRedirect({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const params = await searchParams
  const tab = params.tab as string | undefined
  if (tab === 'campaigns') redirect('/campaigns?channel=calls')
  if (tab === 'assistants') redirect('/calls/assistants')
  redirect('/calls')
}
