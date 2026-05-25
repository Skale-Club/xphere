export interface UTMParams {
  utm_source?: string | null
  utm_medium?: string | null
  utm_campaign?: string | null
  utm_content?: string | null
  utm_term?: string | null
}

export function buildUTMLink(baseUrl: string, params: UTMParams): string {
  try {
    const url = new URL(baseUrl)
    if (params.utm_source)   url.searchParams.set('utm_source',   params.utm_source)
    if (params.utm_medium)   url.searchParams.set('utm_medium',   params.utm_medium)
    if (params.utm_campaign) url.searchParams.set('utm_campaign', params.utm_campaign)
    if (params.utm_content)  url.searchParams.set('utm_content',  params.utm_content)
    if (params.utm_term)     url.searchParams.set('utm_term',     params.utm_term)
    return url.toString()
  } catch {
    return baseUrl
  }
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
    utm_source:   campaign.utm_source   ?? 'xphere',
    utm_medium:   campaign.utm_medium   ?? 'voice',
    utm_campaign: campaign.utm_campaign_tag ?? slugify(campaign.name),
    utm_content:  campaign.utm_content  ?? undefined,
    utm_term:     campaign.utm_term     ?? undefined,
  }
}

function slugify(str: string): string {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}
