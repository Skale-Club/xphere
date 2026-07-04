import type { Metadata } from 'next'
import { APP_NAME } from '@/lib/config'

export const metadata: Metadata = {
  title: 'Privacy Policy',
  description: `How ${APP_NAME} collects, uses, and protects your data.`,
}

const LAST_UPDATED = 'June 2, 2026'
const CONTACT = 'skale.club@gmail.com'

export default function PrivacyPage() {
  return (
    <>
      <h1>Privacy Policy</h1>
      <p className="text-text-tertiary">Last updated: {LAST_UPDATED}</p>

      <p>
        {APP_NAME} (&ldquo;{APP_NAME}&rdquo;, &ldquo;we&rdquo;, &ldquo;us&rdquo;), operated by Skale Club,
        is an integration and orchestration platform that connects to third-party services on your
        behalf so you can view analytics and manage campaigns from one place. This policy explains what
        we collect, how we use it, and the choices you have.
      </p>

      <h2>Information we collect</h2>
      <ul>
        <li><strong>Account information</strong> — the email and profile details you use to sign in.</li>
        <li>
          <strong>Connected platform data</strong> — when you connect an account such as Meta (Facebook
          &amp; Instagram) Ads or Google Ads, we access advertising data including ad accounts, campaigns,
          ad sets, ads, and performance insights (spend, impressions, clicks, reach, conversions).
        </li>
        <li>
          <strong>Access tokens</strong> — to keep your connections working, we store the access tokens
          issued by those platforms. Tokens are encrypted at rest using AES-256.
        </li>
        <li>
          <strong>Usage data</strong> — basic logs needed to operate, secure, and debug the service.
        </li>
      </ul>

      <h2>How we use information</h2>
      <ul>
        <li>To display analytics and reports for the accounts you connect.</li>
        <li>To perform actions you initiate, such as pausing campaigns or adjusting budgets.</li>
        <li>To maintain, secure, and improve the service.</li>
      </ul>
      <p>
        We do <strong>not</strong> sell your data, and we do not use your advertising data for any
        purpose other than providing the features you request.
      </p>

      <h2>How we store and protect data</h2>
      <p>
        Data is stored in our managed PostgreSQL database (Supabase) with row-level security that
        isolates each organization&rsquo;s data. Access tokens and other secrets are encrypted before
        being written to the database. Access is restricted to the authenticated owner of the data.
      </p>

      <h2>Third-party services</h2>
      <p>
        We integrate with third parties solely to provide our features. These may include Meta
        Platforms (Facebook &amp; Instagram), Google, and our infrastructure provider Supabase. Your use
        of those platforms is also governed by their respective privacy policies.
      </p>

      <h2>Data retention and deletion</h2>
      <p>
        We retain your data only while your account or a connection is active. You can disconnect any
        integration at any time, which revokes and deletes the stored tokens for that platform. To
        request deletion of all your data, see our{' '}
        <a href="/data-deletion">Data Deletion</a> page.
      </p>

      <h2>Your rights</h2>
      <p>
        You may request access to, correction of, or deletion of your personal data at any time by
        contacting us at <a href={`mailto:${CONTACT}`}>{CONTACT}</a>.
      </p>

      <h2>Changes to this policy</h2>
      <p>
        We may update this policy from time to time. Material changes will be reflected by the
        &ldquo;Last updated&rdquo; date above.
      </p>

      <h2>Contact</h2>
      <p>
        Questions about this policy? Email <a href={`mailto:${CONTACT}`}>{CONTACT}</a>.
      </p>
    </>
  )
}
