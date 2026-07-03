import { redirect } from 'next/navigation'

// Personal call preferences now open as the My Phone modal on the Calls page.
export default function CallsMyPhoneRedirect() {
  redirect('/calls?myphone=1')
}
