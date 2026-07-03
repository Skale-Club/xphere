import { redirect } from 'next/navigation'

// Call routing now lives in the Voice Settings modal on the Calls page.
export default function CallsRoutingRedirect() {
  redirect('/calls?settings=routing')
}
