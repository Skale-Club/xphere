import { redirect } from 'next/navigation'

interface Props {
  params: Promise<{ id: string }>
}

export default async function SettingsPhoneNumberDetailRedirect({ params }: Props) {
  await params
  redirect('/calls?settings=numbers')
}
