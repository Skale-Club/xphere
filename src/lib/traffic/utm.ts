export interface UTMParams {
  utm_source?: string | null
  utm_medium?: string | null
  utm_campaign?: string | null
  utm_content?: string | null
  utm_term?: string | null
}

export function buildUTMLink(baseUrl: string, params: UTMParams): string {
  let url: URL
  try {
    url = new URL(baseUrl.startsWith('http') ? baseUrl : `https://${baseUrl}`)
  } catch {
    return baseUrl
  }

  const map: Record<string, string | null | undefined> = {
    utm_source: params.utm_source,
    utm_medium: params.utm_medium,
    utm_campaign: params.utm_campaign,
    utm_content: params.utm_content,
    utm_term: params.utm_term,
  }

  for (const [key, value] of Object.entries(map)) {
    if (value) url.searchParams.set(key, value)
  }

  return url.toString()
}

export function campaignToUTMParams(campaign: {
  name: string
  utm_source?: string | null
  utm_medium?: string | null
  utm_campaign_tag?: string | null
  utm_content?: string | null
  utm_term?: string | null
}): UTMParams {
  return {
    utm_source: campaign.utm_source ?? 'outbound',
    utm_medium: campaign.utm_medium ?? 'call',
    utm_campaign: campaign.utm_campaign_tag ?? slugify(campaign.name),
    utm_content: campaign.utm_content ?? null,
    utm_term: campaign.utm_term ?? null,
  }
}

function slugify(str: string): string {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80)
}
