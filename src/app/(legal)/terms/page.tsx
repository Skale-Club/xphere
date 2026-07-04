import type { Metadata } from 'next'
import { APP_NAME } from '@/lib/config'

export const metadata: Metadata = {
  title: 'Terms of Service',
  description: `The terms that govern your use of ${APP_NAME}.`,
}

const LAST_UPDATED = 'June 2, 2026'
const CONTACT = 'skale.club@gmail.com'

export default function TermsPage() {
  return (
    <>
      <h1>Terms of Service</h1>
      <p className="text-text-tertiary">Last updated: {LAST_UPDATED}</p>

      <p>
        These Terms govern your access to and use of {APP_NAME} (the &ldquo;Service&rdquo;), operated by
        Skale Club. By using the Service, you agree to these Terms.
      </p>

      <h2>Use of the Service</h2>
      <p>
        {APP_NAME} lets you connect third-party accounts (such as Meta and Google Ads) to view analytics
        and manage campaigns. You may use the Service only for lawful purposes and in compliance with the
        terms of any platform you connect.
      </p>

      <h2>Accounts and access</h2>
      <p>
        You are responsible for maintaining the confidentiality of your account and for all activity
        that occurs under it. You must have authorization to connect and act on any advertising account
        you link to the Service.
      </p>

      <h2>Third-party platforms</h2>
      <p>
        The Service relies on third-party APIs. We are not responsible for the availability, accuracy,
        or actions of those platforms, and your use of them is governed by their own terms.
      </p>

      <h2>Disclaimer</h2>
      <p>
        The Service is provided &ldquo;as is&rdquo; without warranties of any kind. We do not guarantee
        that it will be uninterrupted, error-free, or that data shown will always be accurate.
      </p>

      <h2>Limitation of liability</h2>
      <p>
        To the maximum extent permitted by law, {APP_NAME} and Skale Club will not be liable for any
        indirect, incidental, or consequential damages arising from your use of the Service.
      </p>

      <h2>Changes</h2>
      <p>
        We may update these Terms from time to time. Continued use of the Service after changes take
        effect constitutes acceptance of the revised Terms.
      </p>

      <h2>Contact</h2>
      <p>
        Questions about these Terms? Email <a href={`mailto:${CONTACT}`}>{CONTACT}</a>.
      </p>
    </>
  )
}
