import { orgRedirect } from '@/lib/org/redirect'

export default async function OutboundPage() {
  return orgRedirect('/campaigns?channel=calls')
}
