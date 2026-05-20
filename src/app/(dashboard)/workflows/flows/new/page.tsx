import { redirect } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { getUser } from '@/lib/supabase/server'
import { NewFlowForm } from '@/components/flows/new-flow-form'
import { DesktopOnly } from '@/components/layout/desktop-only'

export default async function NewFlowPage() {
  const user = await getUser()
  if (!user) redirect('/login')

  return (
    <DesktopOnly message="Creating a visual flow requires the desktop canvas editor.">
      <div className="mx-auto w-full max-w-none px-4 sm:px-6 lg:px-8 py-8 space-y-6">
        <Button asChild variant="ghost" size="sm">
          <Link href="/workflows/flows">
            <ArrowLeft className="h-3.5 w-3.5 mr-1" /> Flows
          </Link>
        </Button>

        <div className="rounded-lg border border-border bg-card p-6">
          <NewFlowForm />
        </div>
      </div>
    </DesktopOnly>
  )
}
