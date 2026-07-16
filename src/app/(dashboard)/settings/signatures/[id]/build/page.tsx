import { notFound, redirect } from 'next/navigation'
import { getUser } from '@/lib/supabase/server'
import { getSignature } from '../../actions'
import { SignatureVisualEditor } from '../../_components/signature-visual-editor'

export default async function SignatureVisualBuilderPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const user = await getUser()
  if (!user) redirect('/')

  const { id } = await params
  const result = await getSignature(id)
  if (!result.ok) notFound()

  return (
    <div className="flex h-full flex-col">
      <SignatureVisualEditor signature={result.data} />
    </div>
  )
}
