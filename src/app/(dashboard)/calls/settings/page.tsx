import { redirect } from 'next/navigation'

// The old "Call setup" hub was retired — Voice Settings modal replaces it.
export default function CallsSettingsRedirect() {
  redirect('/calls?settings=numbers')
}
