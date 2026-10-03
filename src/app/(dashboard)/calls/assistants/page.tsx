import { orgRedirect } from '@/lib/org/redirect'

// Voice assistants now live in the Voice Settings modal on the Calls page.
export default async function CallsAssistantsRedirect() {
  return orgRedirect('/calls?settings=assistants')
}
