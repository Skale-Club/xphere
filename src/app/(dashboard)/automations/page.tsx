import { orgRedirect } from '@/lib/org/redirect'
export default async function AutomationsLegacyRedirect() {
  return orgRedirect('/workflows')
}
