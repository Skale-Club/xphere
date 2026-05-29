'use client'

import { useSearchParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { MonitorPlay, AlertCircle, ChevronDown, HelpCircle } from 'lucide-react'

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
      <div className="flex w-full max-w-lg flex-col items-center gap-6 text-center">
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

        <details className="group w-full rounded-lg border border-border-subtle bg-bg-secondary text-left open:bg-bg-tertiary/40">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-2 p-4 text-[12.5px] font-medium text-text-primary [&::-webkit-details-marker]:hidden">
            <span className="flex items-center gap-2">
              <HelpCircle className="h-3.5 w-3.5 text-text-tertiary" />
              How to connect — step by step
            </span>
            <ChevronDown className="h-3.5 w-3.5 text-text-tertiary transition-transform group-open:rotate-180" />
          </summary>
          <div className="border-t border-border-subtle px-4 pb-4 pt-3 space-y-4">
            <div className="space-y-1.5">
              <p className="text-[11.5px] font-medium uppercase tracking-wide text-text-tertiary">Before you start</p>
              <ul className="space-y-1.5 text-[12px] text-text-secondary">
                <li className="flex gap-2"><span className="text-text-tertiary">•</span>You need a Google account that has access to a Google Ads account.</li>
                <li className="flex gap-2"><span className="text-text-tertiary">•</span>Manager accounts (MCC) work — Xphere will see the accounts you manage under it.</li>
                <li className="flex gap-2"><span className="text-text-tertiary">•</span>If you don&apos;t have one yet, create it at <a href="https://ads.google.com" target="_blank" rel="noreferrer" className="text-accent hover:underline">ads.google.com</a>.</li>
              </ul>
            </div>

            <div className="space-y-2">
              <p className="text-[11.5px] font-medium uppercase tracking-wide text-text-tertiary">Steps</p>
              <ol className="space-y-2 text-[12px] text-text-secondary">
                {[
                  ['Click ', <strong key="b" className="text-text-primary">Connect with Google</strong>, ' above. A Google OAuth window opens.'],
                  ['Sign in with the Google account that manages your ads.'],
                  ['Click ', <strong key="a" className="text-text-primary">Allow</strong>, ' when Google asks for access to view and manage your Google Ads campaigns.'],
                  ['Pick the ad account if Google asks. Xphere uses the first account in your list by default — you can switch later from the account picker.'],
                  ['You\'ll be redirected back here. The dashboard loads automatically once at least one campaign is found.'],
                ].map((parts, i) => (
                  <li key={i} className="flex gap-2.5">
                    <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-[#4285F4]/15 text-[10px] font-semibold text-[#4285F4]">{i + 1}</span>
                    <span className="flex-1 leading-snug">{parts}</span>
                  </li>
                ))}
              </ol>
            </div>

            <div className="space-y-2">
              <p className="text-[11.5px] font-medium uppercase tracking-wide text-text-tertiary">Troubleshooting</p>
              <dl className="space-y-2 text-[12px] text-text-secondary">
                <div>
                  <dt className="font-medium text-text-primary">&quot;No Google Ads accounts found&quot;</dt>
                  <dd className="mt-0.5">This Google account isn&apos;t linked to any Google Ads account. Sign in at <a href="https://ads.google.com" target="_blank" rel="noreferrer" className="text-accent hover:underline">ads.google.com</a> to create one or ask an admin to add you to an existing account.</dd>
                </div>
                <div>
                  <dt className="font-medium text-text-primary">&quot;Google did not return a refresh token&quot;</dt>
                  <dd className="mt-0.5">You already granted Xphere access on a previous attempt. Go to <a href="https://myaccount.google.com/permissions" target="_blank" rel="noreferrer" className="text-accent hover:underline">myaccount.google.com/permissions</a>, remove Xphere, then click Connect again.</dd>
                </div>
                <div>
                  <dt className="font-medium text-text-primary">&quot;Security check failed&quot;</dt>
                  <dd className="mt-0.5">CSRF token expired. Refresh this page and click Connect again — don&apos;t reopen the Google tab from history.</dd>
                </div>
                <div>
                  <dt className="font-medium text-text-primary">Need to revoke access</dt>
                  <dd className="mt-0.5">Open <a href="https://myaccount.google.com/permissions" target="_blank" rel="noreferrer" className="text-accent hover:underline">myaccount.google.com/permissions</a> and remove Xphere.</dd>
                </div>
              </dl>
            </div>
          </div>
        </details>
      </div>
    </div>
  )
}
