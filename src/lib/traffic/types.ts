export interface IngestPayload {
  token: string
  type: 'session_start' | 'pageview' | 'event' | 'session_end'
  visitor_id: string
  session_key: string
  url?: string
  path?: string
  title?: string
  referrer?: string
  utm_source?: string
  utm_medium?: string
  utm_campaign?: string
  utm_term?: string
  utm_content?: string
  // Meta click signals (captured by the browser script; used by the CAPI sender)
  fbclid?: string
  fbc?: string
  fbp?: string
  event_type?: string
  event_name?: string
  metadata?: Record<string, unknown>
  device_type?: 'desktop' | 'mobile' | 'tablet' | 'unknown'
  browser?: string
  os?: string
  duration_seconds?: number
}

export interface DateRange {
  from: Date
  to: Date
}

export interface TrafficMetrics {
  visitors: number
  unique_visitors: number
  sessions: number
  page_views: number
  conversions: number
  conversion_rate: number
  top_source: string | null
  top_campaign: string | null
  top_landing_page: string | null
  prev_visitors: number
  prev_sessions: number
  prev_page_views: number
  prev_conversions: number
}

export interface TimeSeriesPoint {
  date: string
  visitors: number
  sessions: number
  page_views: number
}

export interface SourceRow {
  source: string
  sessions: number
  conversions: number
}

export interface CampaignRow {
  campaign: string
  source: string | null
  medium: string | null
  sessions: number
  conversions: number
}

export interface PageRow {
  path: string
  views: number
  sessions: number
}

export interface GeoRow {
  country_name: string
  country_code: string | null
  sessions: number
}

export interface DeviceRow {
  device_type: string
  sessions: number
}

export interface RecentSession {
  id: string
  started_at: string
  landing_page: string | null
  utm_source: string | null
  utm_campaign: string | null
  device_type: string | null
  country_name: string | null
  is_converted: boolean
  page_view_count: number
}
