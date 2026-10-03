import { orgRedirect } from '@/lib/org/redirect'

// Personal call preferences now open as the My Phone modal on the Calls page.
export default async function CallsMyPhoneRedirect() {
  return orgRedirect('/calls?myphone=1')
}
