'use client'

import { useRouter } from 'next/navigation'
import { BarChart3, Clock, RefreshCw } from 'lucide-react'

import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'

interface Props {
  setup: {
    script_token: string
    primary_website_url: string | null
    verified_at: string | null
  }
}

export function WaitingScreen({ setup }: Props) {
  const router = useRouter()

  return (
    <div className="mx-auto w-full max-w-2xl px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent/10">
          <BarChart3 className="h-5 w-5 text-accent" />
        </div>
        <div>
          <h1 className="text-lg font-semibold text-text-primary">Waiting for data</h1>
          <p className="text-sm text-text-tertiary">
            The tracking script is installed on{' '}
            <span className="font-medium text-text-secondary">{setup.primary_website_url}</span>.
          </p>
        </div>
      </div>

      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-col items-center gap-4 py-6 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-yellow-500/10">
              <Clock className="h-7 w-7 text-yellow-500" />
            </div>
            <div className="space-y-1">
              <p className="font-medium text-text-primary">Waiting for the first visit</p>
              <p className="text-sm text-text-tertiary max-w-sm">
                Visit your website in a browser to send the first tracking event. The dashboard will appear automatically once data arrives.
              </p>
            </div>
            {setup.verified_at && (
              <p className="text-xs text-text-tertiary">
                Script verified on {new Date(setup.verified_at).toLocaleDateString('en-US', { dateStyle: 'medium' })}
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      <div className="flex gap-3">
        <Button onClick={() => router.refresh()} variant="outline" className="flex-1">
          <RefreshCw className="h-4 w-4 mr-2" />
          Check for new data
        </Button>
        <Button variant="ghost" onClick={() => router.push('/traffic?reset=1')} className="text-text-tertiary">
          Reconfigure
        </Button>
      </div>
    </div>
  )
}
