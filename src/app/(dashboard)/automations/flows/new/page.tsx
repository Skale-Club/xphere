import { orgRedirect } from '@/lib/org/redirect'
export default async function FlowNewLegacyRedirect() {
  return orgRedirect('/workflows/flows/new')
}
