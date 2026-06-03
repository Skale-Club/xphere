export const runtime = 'nodejs'

/**
 * GET /api/widget-preview/[token]
 *
 * Returns a bare HTML page with the chat widget injected via the production
 * script tag. Used as the src of the playground iframe on the Widget settings
 * page so operators can test a real conversation (including open/closed states)
 * without leaving the dashboard.
 *
 * Public & unauthenticated — the token itself gates access to the org's config.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params

  // Root-relative URL so the script loads from whatever origin the iframe is
  // served from — works in dev (any IP/port) and in production without env-var issues.
  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Widget preview</title>
  <style>
    html, body {
      margin: 0;
      padding: 0;
      width: 100%;
      height: 100%;
      background: #0f0f11;
      overflow: hidden;
    }
  </style>
</head>
<body>
  <script
    src="/widget.js"
    data-token="${token}"
    async
  ></script>
</body>
</html>`

  return new Response(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  })
}
