import { orgRedirect } from '@/lib/org/redirect'

interface Props {
  params: Promise<{ id: string }>
}

export default async function SettingsPhoneNumberDetailRedirect({ params }: Props) {
  await params
  return orgRedirect('/calls?settings=numbers')
}
