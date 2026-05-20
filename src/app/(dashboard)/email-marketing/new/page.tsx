import { redirect } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { getUser } from '@/lib/supabase/server'
import { AiGenerateForm } from '@/components/email-marketing/ai-generate-form'

export default async function NewEmailTemplatePage() {
  const user = await getUser()
  if (!user) redirect('/login')

  return (
    <div className="mx-auto w-full max-w-none px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      <Button asChild variant="ghost" size="sm">
        <Link href="/email-marketing">
          <ArrowLeft className="h-3.5 w-3.5 mr-1" /> Voltar
        </Link>
      </Button>

      <div className="rounded-lg border border-border bg-card p-6">
        <AiGenerateForm />
      </div>
    </div>
  )
}
