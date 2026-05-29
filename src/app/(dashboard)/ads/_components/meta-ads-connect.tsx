'use client'

import { useSearchParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { MonitorPlay, AlertCircle, ChevronDown, HelpCircle } from 'lucide-react'

const ERROR_MESSAGES: Record<string, string> = {
  missing_code: 'Authorization code missing. Please try again.',
  csrf: 'Security check failed. Please try again.',
  no_org: 'No active organization found.',
  no_ad_accounts: 'No ad accounts found. Make sure your Facebook account has access to an ad account.',
  oauth_exchange: 'Failed to connect to Meta. Please try again.',
}

export function MetaAdsConnect() {
  const params = useSearchParams()
  const error = params.get('error')

  return (
    <div className="flex flex-1 items-center justify-center p-8">
      <div className="flex w-full max-w-lg flex-col items-center gap-6 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-[#1877F2]/10">
          <MonitorPlay className="h-8 w-8 text-[#1877F2]" />
        </div>

        <div className="space-y-2">
          <h1 className="text-xl font-semibold text-text-primary">Connect Meta Ads</h1>
          <p className="text-[13.5px] text-text-secondary leading-relaxed">
            Connect your Meta Ads account to view campaign performance, insights, and manage your ads directly from Xphere.
          </p>
        </div>

        {error && (
          <div className="flex items-center gap-2 rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-[13px] text-red-400">
            <AlertCircle className="h-4 w-4 shrink-0" />
            {ERROR_MESSAGES[error] ?? 'An error occurred. Please try again.'}
          </div>
        )}

        <div className="flex flex-col gap-3 w-full">
          <Button
            asChild
            className="w-full bg-[#1877F2] hover:bg-[#1877F2]/90 text-white"
          >
            <a href="/api/ads/meta/connect">
              <MonitorPlay className="h-4 w-4 mr-2" />
              Connect with Meta
            </a>
          </Button>

          <p className="text-[11.5px] text-text-tertiary">
            Requires: ads_read, ads_management, business_management
          </p>
        </div>

        <div className="w-full rounded-lg border border-border-subtle bg-bg-secondary p-4 text-left space-y-2">
          <p className="text-[12px] font-medium text-text-primary">What you&apos;ll get access to</p>
          <ul className="space-y-1.5 text-[12px] text-text-secondary">
            {[
              'Campaign performance overview',
              'Ad sets and audience insights',
              'Spend, impressions, clicks, and ROAS',
              'AI chat to analyze and manage campaigns',
              'Pause, enable, and adjust budgets',
            ].map((item) => (
              <li key={item} className="flex items-center gap-2">
                <span className="h-1 w-1 rounded-full bg-accent shrink-0" />
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
                <li className="flex gap-2"><span className="text-text-tertiary">•</span>You need a Facebook account with admin access to the ad account.</li>
                <li className="flex gap-2"><span className="text-text-tertiary">•</span>The ad account must be inside a Meta Business Manager (<a href="https://business.facebook.com" target="_blank" rel="noreferrer" className="text-accent hover:underline">business.facebook.com</a>) you belong to.</li>
              </ul>
            </div>

            <div className="space-y-2">
              <p className="text-[11.5px] font-medium uppercase tracking-wide text-text-tertiary">Steps</p>
              <ol className="space-y-2 text-[12px] text-text-secondary">
                {[
                  ['Click', <strong key="b" className="text-text-primary">Connect with Meta</strong>, ' above. A Facebook OAuth window opens.'],
                  ['Sign in with the Facebook account that manages your business.'],
                  ['When asked, grant ', <code key="p" className="rounded bg-bg-primary px-1 py-0.5 text-[11px] text-text-primary">ads_read</code>, ', ', <code key="m" className="rounded bg-bg-primary px-1 py-0.5 text-[11px] text-text-primary">ads_management</code>, ', and ', <code key="b" className="rounded bg-bg-primary px-1 py-0.5 text-[11px] text-text-primary">business_management</code>, '. Leaving any of these unchecked will block the connection.'],
                  ['Pick the ad account if Facebook asks. Xphere uses the first active account by default — you can switch later from the account picker.'],
                  ['You\'ll be redirected back here. The dashboard loads automatically once at least one campaign is found.'],
                ].map((parts, i) => (
                  <li key={i} className="flex gap-2.5">
                    <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-[#1877F2]/15 text-[10px] font-semibold text-[#1877F2]">{i + 1}</span>
                    <span className="flex-1 leading-snug">{parts}</span>
                  </li>
                ))}
              </ol>
            </div>

            <div className="space-y-2">
              <p className="text-[11.5px] font-medium uppercase tracking-wide text-text-tertiary">Troubleshooting</p>
              <dl className="space-y-2 text-[12px] text-text-secondary">
                <div>
                  <dt className="font-medium text-text-primary">&quot;No ad accounts found&quot;</dt>
                  <dd className="mt-0.5">Your Facebook user has no ad accounts visible. Ask a Business Manager admin to add you to the ad account, then try again.</dd>
                </div>
                <div>
                  <dt className="font-medium text-text-primary">&quot;Security check failed&quot;</dt>
                  <dd className="mt-0.5">CSRF token expired. Refresh this page and click Connect again — don&apos;t reopen the Facebook tab from history.</dd>
                </div>
                <div>
                  <dt className="font-medium text-text-primary">Need to revoke access</dt>
                  <dd className="mt-0.5">Open <a href="https://www.facebook.com/settings?tab=business_tools" target="_blank" rel="noreferrer" className="text-accent hover:underline">Facebook Settings → Business Integrations</a> and remove Xphere.</dd>
                </div>
              </dl>
            </div>
          </div>
        </details>
      </div>
    </div>
  )
}
