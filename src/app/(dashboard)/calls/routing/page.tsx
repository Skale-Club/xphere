import { orgRedirect } from '@/lib/org/redirect'

// Call routing now lives in the Voice Settings modal on the Calls page.
export default async function CallsRoutingRedirect() {
  return orgRedirect('/calls?settings=routing')
}
