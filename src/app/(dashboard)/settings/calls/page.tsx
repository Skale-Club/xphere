import { redirect } from 'next/navigation'

export default function SettingsCallsRedirect() {
  redirect('/calls?settings=routing')
}
