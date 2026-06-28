# Notion as the Global Knowledge source of truth

Xphere can connect one Notion workspace to the super-admin Global Knowledge
corpus. After the first successful root sync, Notion becomes authoritative:
manual PDF/TXT/CSV sources remain stored but are excluded from retrieval.

## Notion connection setup

Create a Notion public connection with the **Read content** capability.

- OAuth redirect URI: `https://xphere.app/api/notion/callback`
- Webhook URL: `https://xphere.app/api/notion/webhook`
- Subscribe to page create, content update, property update, move, delete, and
  undelete events. Subscribe to the equivalent data-source events when
  database-backed content is shared.

Configure these application secrets:

```env
NOTION_CLIENT_ID=
NOTION_CLIENT_SECRET=
NOTION_WEBHOOK_VERIFICATION_TOKEN=
CRON_SECRET=
```

The webhook verification token is used to validate the
`X-Notion-Signature` HMAC-SHA256 header. OAuth access and refresh tokens are
stored encrypted with the existing `ENCRYPTION_SECRET` AES-256-GCM format.

## Synchronization behavior

1. A super admin connects Notion from `/admin/knowledge`.
2. The Notion OAuth page picker controls which pages Xphere may read.
3. The super admin chooses one or more root pages and assigns each root to
   Meta Ads, Google Ads, or All platforms.
4. Xphere recursively imports each root and its child pages.
5. Changed pages receive a new vector revision. The new revision is activated
   only after every chunk and embedding has been stored.
6. Deleted or moved-out pages are made inactive.

Webhook work is persisted in `global_knowledge_sync_jobs` before processing.
The webhook also starts an immediate worker. The scheduled
`global-knowledge-notion.yml` worker drains retries every five minutes and
enqueues an hourly full reconciliation, recovering missed or out-of-order
events.

If a refresh or embedding fails, the previous active revision remains
searchable. Repeated events are deduplicated by Notion event ID, and unchanged
pages are skipped using a SHA-256 content hash.

## Operations

- **Sync now:** queues a reconciliation for one root.
- **Remove root:** removes that root and its synchronized page sources.
- **Disconnect:** returns retrieval to manual sources without deleting either
  corpus.
- **Error status:** inspect the connection, root, and recent durable job errors
  in the Global Knowledge admin screen.

The Notion API is rate-limited. HTTP 429 responses honor `Retry-After`; other
failures use exponential backoff for up to eight attempts.

