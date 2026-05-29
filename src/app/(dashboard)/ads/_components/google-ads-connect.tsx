'use client'

import { useSearchParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { MonitorPlay, AlertCircle } from 'lucide-react'

const ERROR_MESSAGES: Record<string, string> = {
  missing_code: 'Authorization code missing. Please try again.',
  csrf: 'Security check failed. Please try again.',
  no_org: 'No active organization found.',
  no_ad_accounts: 'No Google Ads accounts found. Make sure your Google account has access to a Google Ads account.',
  no_refresh_token: 'Google did not return a refresh token. Try connecting again.',
  oauth_exchange: 'Failed to connect to Google Ads. Please try again.',
}

export function GoogleAdsConnect() {
  const params = useSearchParams()
  const error = params.get('error')

  return (
    <div className="flex flex-1 items-center justify-center p-8">
      <div className="flex max-w-md flex-col items-center gap-6 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-[#4285F4]/10">
          <MonitorPlay className="h-8 w-8 text-[#4285F4]" />
        </div>

        <div className="space-y-2">
          <h1 className="text-xl font-semibold text-text-primary">Connect Google Ads</h1>
          <p className="text-[13.5px] text-text-secondary leading-relaxed">
            Connect your Google Ads account to view campaign performance, insights, and manage your ads directly from Xphere.
          </p>
        </div>

        {error && (
          <div className="flex items-center gap-2 rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-[13px] text-red-400">
            <AlertCircle className="h-4 w-4 shrink-0" />
            {ERROR_MESSAGES[error] ?? 'An error occurred. Please try again.'}
          </div>
        )}

        <div className="flex flex-col gap-3 w-full">
          <Button asChild className="w-full bg-[#4285F4] hover:bg-[#3367D6] text-white">
            <a href="/api/ads/google/connect">
              <MonitorPlay className="h-4 w-4 mr-2" />
              Connect with Google
            </a>
          </Button>
          <p className="text-[11.5px] text-text-tertiary">Requires: Google Ads account access</p>
        </div>

        <div className="w-full rounded-lg border border-border-subtle bg-bg-secondary p-4 text-left space-y-2">
          <p className="text-[12px] font-medium text-text-primary">What you&apos;ll get access to</p>
          <ul className="space-y-1.5 text-[12px] text-text-secondary">
            {[
              'Account-level spend, clicks, and conversions',
              'Campaign performance with GAQL-powered queries',
              'Ad group breakdown',
              'AI chat to analyze and manage campaigns',
              'Pause, enable, and adjust daily budgets',
            ].map((item) => (
              <li key={item} className="flex items-center gap-2">
                <span className="h-1 w-1 rounded-full bg-[#4285F4] shrink-0" />
                {item}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  )
}
