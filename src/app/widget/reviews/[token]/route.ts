// Public iframe entry point for the reviews widget.
// Serves a self-contained HTML page that loads /reviews-widget.js and passes
// the route token + query params through to the bundle.
//
// Usage:
//   <iframe src="https://xphere.app/widget/reviews/{token}?layout=grid&min_rating=4">

export const runtime = 'nodejs'

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ token: string }> }
): Promise<Response> {
  const { token } = await params
  const url = new URL(request.url)
  const sp = url.searchParams
  // Ensure the bundle's getConfig() finds ?token=
  sp.set('token', token)
  const theme = sp.get('theme') === 'dark' ? 'dark' : 'light'
  const origin = url.origin

  const html = `<!doctype html>
<html lang="en" data-theme="${theme}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="robots" content="noindex, nofollow">
  <title>Reviews</title>
  <style>
    html, body { margin: 0; padding: 0; }
    body { padding: 12px; background: ${theme === 'dark' ? '#0a0a0a' : '#fafaf7'}; }
  </style>
</head>
<body>
  <script>
    // Rewrite the URL so the bundle's URL parser sees ?token=...
    (function () {
      try {
        var u = new URL(window.location.href);
        u.searchParams.set('token', ${JSON.stringify(token)});
        window.history.replaceState(null, '', u.toString());
      } catch (e) {}
    })();
  </script>
  <script src="${escapeHtml(origin)}/reviews-widget.js" defer></script>
</body>
</html>`

  return new Response(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=60',
      'X-Frame-Options': 'ALLOWALL',
      'Content-Security-Policy': "frame-ancestors *",
    },
  })
}
