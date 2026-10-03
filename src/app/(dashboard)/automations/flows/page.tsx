import { orgRedirect } from '@/lib/org/redirect'
export default async function FlowsLegacyRedirect() {
  return orgRedirect('/workflows/flows')
}
