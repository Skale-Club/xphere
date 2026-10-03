import { orgRedirect } from '@/lib/org/redirect'

export default async function CopilotIndex() {
  return orgRedirect('/copilot/conversations')
}
