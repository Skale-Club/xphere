import type { Metadata } from 'next'
import { APP_NAME } from '@/lib/config'

export const metadata: Metadata = {
  title: 'Data Deletion',
  description: `How to delete your data from ${APP_NAME}.`,
}

const LAST_UPDATED = 'June 2, 2026'
const CONTACT = 'skale.club@gmail.com'

export default function DataDeletionPage() {
  return (
    <>
      <h1>Data Deletion</h1>
      <p className="text-text-tertiary">Last updated: {LAST_UPDATED}</p>

      <p>
        You can delete the data {APP_NAME} (operated by Skale Club) holds about you at any time. This
        page explains how, in line with Meta Platform requirements.
      </p>

      <h2>Disconnect a single integration</h2>
      <p>
        In the app, open the integration (for example, Meta Ads) and choose to disconnect it. This
        immediately revokes and deletes the access tokens we stored for that platform and stops any
        further data access.
      </p>

      <h2>Delete all of your data</h2>
      <p>
        To request deletion of all data associated with your account, email{' '}
        <a href={`mailto:${CONTACT}?subject=Data%20Deletion%20Request`}>{CONTACT}</a> from the address
        associated with your account, with the subject &ldquo;Data Deletion Request&rdquo;. We will
        permanently delete your account data within 30 days and confirm once complete.
      </p>

      <h2>What gets deleted</h2>
      <ul>
        <li>Stored access tokens for every connected platform.</li>
        <li>Cached advertising data and reports tied to your account.</li>
        <li>Your account profile and associated records.</li>
      </ul>

      <p>
        Some records may be retained only where required by law, after which they are deleted as well.
        Questions? Contact <a href={`mailto:${CONTACT}`}>{CONTACT}</a>.
      </p>
    </>
  )
}
