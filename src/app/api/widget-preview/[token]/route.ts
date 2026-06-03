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

  // Derive the widget script URL from the canonical production origin so the
  // preview always tests the real built artefact, not a dev bundle.
  const origin = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, '') ?? 'https://xphere.app'

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
    src="${origin}/widget.js"
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
      // Allow embedding in the dashboard iframe.
      'X-Frame-Options': 'SAMEORIGIN',
    },
  })
}
