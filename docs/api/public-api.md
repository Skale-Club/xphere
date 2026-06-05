# Xphere Public REST API

Base URL: `https://xphere.app/api/v1`

All endpoints support **CORS** — you can call them directly from browser JavaScript on any domain.

---

## Authentication

Every request must include a Bearer token in the `Authorization` header:

```
Authorization: Bearer xph_<token>
```

Tokens are generated in **Settings → API Keys** inside the Xphere dashboard. Each token is scoped to one organization. The full token is shown only once at creation time — copy and store it securely.

**Token format:** `xph_` prefix followed by 64 hex characters (32 random bytes).

**Security:** Only the SHA-256 hash is stored in the database. A lost token cannot be recovered — revoke it and generate a new one.

---

## Endpoints

### POST /api/v1/contacts

Creates or updates a contact in your CRM. Deduplicates automatically:
1. If a live contact with the same phone (E.164) exists → updates it
2. Else if a live contact with the same email exists → updates it
3. Otherwise → creates a new contact

**Request**

```http
POST https://xphere.app/api/v1/contacts
Authorization: Bearer xph_...
Content-Type: application/json
```

**Body**

```json
{
  "name": "João Silva",
  "phone": "+5511987654321",
  "email": "joao@empresa.com",
  "company": "Cleaning Co",
  "source_label": "skaleclub",
  "tags": ["lead-quente"],
  "custom_fields": {
    "score": 72,
    "classificacao": "QUENTE",
    "tipo_negocio": "Cleaning Services",
    "utm_campaign": "black-friday"
  }
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | — | Full name (1–200 chars) |
| `phone` | string | — | Phone number — any format, normalized to E.164 |
| `email` | string | — | Email address — normalized to lowercase |
| `company` | string | — | Company name |
| `source_label` | string | — | Label identifying the originating system (e.g. `"skaleclub"`, `"typeform"`). Stored in `custom_fields._api_source`. |
| `tags` | string[] | — | Tags to assign to the contact |
| `custom_fields` | object | — | Free-form key/value pairs stored in `contacts.custom_fields`. Merged into existing fields on update (not replaced). |

At least one of `phone`, `email`, or `name` must be provided.

**Response — 201 Created**

```json
{ "id": "uuid", "action": "created" }
```

**Response — 200 OK** (existing contact updated)

```json
{ "id": "uuid", "action": "updated" }
```

**Error responses**

| Status | Body | Cause |
|--------|------|-------|
| 401 | `{ "error": "Missing Bearer token" }` | No `Authorization` header |
| 401 | `{ "error": "Invalid or revoked API key" }` | Token not found or revoked |
| 422 | `{ "error": "Invalid request body", "details": [...] }` | Zod validation failed |
| 422 | `{ "error": "Provide at least one of: phone, email, name" }` | Empty payload |
| 500 | `{ "error": "Failed to create contact" }` | Database error |

---

## Code Examples

### JavaScript / fetch

```js
const res = await fetch('https://xphere.app/api/v1/contacts', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer xph_...',
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    name: 'João Silva',
    phone: '+5511987654321',
    email: 'joao@empresa.com',
    source_label: 'meu-site',
    tags: ['lead'],
    custom_fields: { origem: 'formulario-home' },
  }),
})
const { id, action } = await res.json()
console.log(action, id) // "created" or "updated"
```

### cURL

```bash
curl -X POST https://xphere.app/api/v1/contacts \
  -H "Authorization: Bearer xph_..." \
  -H "Content-Type: application/json" \
  -d '{
    "name": "João Silva",
    "phone": "+5511987654321",
    "source_label": "skaleclub",
    "tags": ["lead-quente"],
    "custom_fields": { "score": 72, "classificacao": "QUENTE" }
  }'
```

### PHP

```php
$response = file_get_contents('https://xphere.app/api/v1/contacts', false, stream_context_create([
  'http' => [
    'method' => 'POST',
    'header' => implode("\r\n", [
      'Authorization: Bearer xph_...',
      'Content-Type: application/json',
    ]),
    'content' => json_encode([
      'name'         => 'João Silva',
      'phone'        => '+5511987654321',
      'source_label' => 'meu-site',
    ]),
  ],
]));
$data = json_decode($response, true);
```

### Python

```python
import requests

res = requests.post(
    'https://xphere.app/api/v1/contacts',
    headers={'Authorization': 'Bearer xph_...'},
    json={
        'name': 'João Silva',
        'phone': '+5511987654321',
        'source_label': 'typeform',
        'custom_fields': {'score': 72},
    },
)
print(res.json())  # {'id': '...', 'action': 'created'}
```

---

## Skaleclub Integration (reference implementation)

After a form is submitted in Skaleclub, call this endpoint in `runLeadPostProcessing()`:

```ts
// server/lib/xphere-sync.ts
export async function syncLeadToXphere(lead: FormLead) {
  const url = process.env.XPHERE_API_URL ?? 'https://xphere.app/api/v1/contacts'
  const token = process.env.XPHERE_API_KEY
  if (!token) return

  await fetch(url + '/contacts', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: lead.nome,
      phone: lead.telefone,
      email: lead.email,
      company: lead.tipoNegocio,
      source_label: 'skaleclub',
      tags: lead.classificacao === 'QUENTE' ? ['lead-quente'] : ['lead'],
      custom_fields: {
        score: lead.scoreTotal,
        classificacao: lead.classificacao,
        tipo_negocio: lead.tipoNegocio,
        tempo_negocio: lead.tempoNegocio,
        orcamento: lead.orcamentoAnuncios,
        utm_source: lead.utmSource,
        utm_campaign: lead.utmCampaign,
        url_origem: lead.urlOrigem,
      },
    }),
  }).catch(err => console.error('[xphere-sync] error:', err))
  // fire-and-forget — does not block lead flow
}
```

Required env vars on Skaleclub:
```
XPHERE_API_KEY=xph_...   # generated in Xphere Settings → API Keys
XPHERE_API_URL=https://xphere.app/api/v1  # optional override
```

---

## Managing API Keys

Keys are managed in the Xphere dashboard at **Settings → API Keys**.

- Each key has a **name** (e.g. "Skaleclub Forms", "Typeform") and a **prefix** visible in the list for identification
- The full token is only shown once at creation — copy it immediately
- Revoke a key at any time; revoked keys return 401 immediately
- Multiple keys per org are supported — use separate keys per integration for auditability

---

## Data Model

When a contact arrives via the API:

- `contacts.source` is set to `'api'`
- `contacts.custom_fields._api_source` is set to the `source_label` value
- `contacts.phone_e164` and `contacts.email_normalized` are auto-generated (indexed)
- `contacts.tags` is set if provided (on create) or merged (on update when `tags` is non-empty)
- `custom_fields` from the request are **merged** into existing fields on update — existing keys not present in the request are preserved

---

## Extending the API

To add a new endpoint (e.g. `POST /api/v1/accounts`):

1. Create `src/app/api/v1/<resource>/route.ts`
2. Copy the Bearer auth pattern from [`src/app/api/v1/contacts/route.ts`](../../src/app/api/v1/contacts/route.ts)
3. Export an `OPTIONS` handler for CORS preflight
4. Return proper HTTP status codes (not always-200)
5. Add the endpoint to the table above in this document

The `api_keys` table schema is in `supabase/migrations/1147_public_api_keys.sql`.
