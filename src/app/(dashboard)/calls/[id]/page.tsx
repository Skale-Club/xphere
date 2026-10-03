import { orgRedirect } from '@/lib/org/redirect'

// Call detail now opens as a sheet over the timeline (?call=). Redirect keeps
// old bookmarks and notification deep links working.
export default async function CallDetailRedirect({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  return orgRedirect(`/calls?call=${encodeURIComponent(id)}`)
}
