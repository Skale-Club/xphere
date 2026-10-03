import { orgRedirect } from '@/lib/org/redirect'

export default async function AssistantsPage() {
  return orgRedirect('/calls?settings=assistants')
}
