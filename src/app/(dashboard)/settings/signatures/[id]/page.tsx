import { notFound, redirect } from 'next/navigation'
import { getUser } from '@/lib/supabase/server'
import { getSignature } from '../actions'
import { SignatureEditor } from '../_components/signature-editor'

export default async function SignatureEditorPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const user = await getUser()
  if (!user) redirect('/')

  const { id } = await params
  const result = await getSignature(id)
  if (!result.ok) notFound()

  return <SignatureEditor signature={result.data} />
}
