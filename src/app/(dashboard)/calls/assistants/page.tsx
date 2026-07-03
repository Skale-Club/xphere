import { redirect } from 'next/navigation'

// Voice assistants now live in the Voice Settings modal on the Calls page.
export default function CallsAssistantsRedirect() {
  redirect('/calls?settings=assistants')
}
