// The white-label report body. Server-renderable (no hooks, no client
// libraries) so the public link and the PDF render the same markup; grids use
// the map-free SVG so a shared link never depends on a Maps key.

import type { ReportData, ReportKeyword, ReportLocation } from '@/lib/local-seo/reports'
import { PILLAR_LABEL, type Pillar } from '@/lib/local-seo/audit-checks'

import { GeoGridSvg } from './geogrid-svg'

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

function Delta({ now, before, lowerIsBetter, suffix = '' }: { now: number | null; before: number | null | undefined; lowerIsBetter?: boolean; suffix?: string }) {
  if (now === null || before === null || before === undefined) return null
  const d = Math.round((now - before) * 10) / 10
  if (d === 0) return <span style={{ color: '#64748b', fontSize: 12 }}> (no change)</span>
  const better = lowerIsBetter ? d < 0 : d > 0
  return (
    <span style={{ color: better ? '#16a34a' : '#dc2626', fontSize: 12, fontWeight: 600 }}>
      {' '}
      {d > 0 ? '▲' : '▼'} {Math.abs(d)}
      {suffix}
    </span>
  )
}

function Sparkline({ values, color }: { values: (number | null)[]; color: string }) {
  const v = values.map((x) => x ?? 0)
  if (v.length < 2) return null
  const w = 160
  const h = 36
  const step = w / (v.length - 1)
  const d = v.map((x, i) => `${i ? 'L' : 'M'}${(i * step).toFixed(1)},${(h - (x / 100) * h).toFixed(1)}`).join(' ')
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width={w} height={h} aria-hidden>
      <path d={d} fill="none" stroke={color} strokeWidth={2} />
    </svg>
  )
}

function KeywordBlock({ k, data, accent }: { k: ReportKeyword; data: ReportData; accent: string }) {
  return (
    <div className="report-avoid-break rounded-xl border border-slate-200 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h4 className="text-[15px] font-semibold text-slate-900">“{k.keyword}”</h4>
        {k.scanAt && <span className="text-[12px] text-slate-500">Scanned {fmtDate(k.scanAt)}</span>}
      </div>
      <div className="mt-3 grid gap-4 sm:grid-cols-[minmax(0,320px)_1fr]">
        {data.sections.includes('rankings') && k.gridSize && k.points.length > 0 && (
          <GeoGridSvg
            size={k.gridSize}
            pins={k.points.map((p, i) => ({ id: String(i), row: p.row, col: p.col, lat: 0, lng: 0, status: p.status as 'done', rank: p.rank }))}
          />
        )}
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-3">
            <div>
              <div className="text-[11px] uppercase tracking-wide text-slate-500">Top-3 share</div>
              <div className="text-xl font-semibold text-slate-900">
                {k.solv ?? '—'}%
                <Delta now={k.solv} before={k.previous?.solv} suffix="pp" />
              </div>
            </div>
            <div>
              <div className="text-[11px] uppercase tracking-wide text-slate-500">Average rank</div>
              <div className="text-xl font-semibold text-slate-900">
                {k.arp ?? '—'}
                <Delta now={k.arp} before={k.previous?.arp} lowerIsBetter />
              </div>
            </div>
            <div>
              <div className="text-[11px] uppercase tracking-wide text-slate-500">Visible at</div>
              <div className="text-xl font-semibold text-slate-900">{k.foundPct ?? '—'}%</div>
            </div>
          </div>
          {data.sections.includes('trends') && k.trend.length > 1 && (
            <div>
              <div className="text-[11px] uppercase tracking-wide text-slate-500">Top-3 share over the period</div>
              <Sparkline values={k.trend.map((t) => t.solv)} color={accent} />
            </div>
          )}
          {data.sections.includes('competitors') && k.competitors.length > 0 && (
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="text-left text-slate-500">
                  <th className="py-1 font-medium">Business</th>
                  <th className="py-1 text-right font-medium">Top-3 share</th>
                  <th className="py-1 text-right font-medium">Avg rank</th>
                  <th className="py-1 text-right font-medium">Rating</th>
                </tr>
              </thead>
              <tbody>
                {k.competitors.map((c) => (
                  <tr key={c.title} className="border-t border-slate-100" style={c.isTarget ? { fontWeight: 600, color: accent } : undefined}>
                    <td className="py-1 pr-2">{c.title}</td>
                    <td className="py-1 text-right">{c.solv ?? '—'}%</td>
                    <td className="py-1 text-right">{c.avgRank ?? '—'}</td>
                    <td className="py-1 text-right">
                      {c.rating ?? '—'}
                      {c.reviews !== null ? ` (${c.reviews})` : ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  )
}

function LocationSection({ loc, data, accent }: { loc: ReportLocation; data: ReportData; accent: string }) {
  return (
    <section className="space-y-4">
      <div className="border-b border-slate-200 pb-2">
        <h2 className="text-xl font-semibold text-slate-900">{loc.name}</h2>
        <p className="text-[13px] text-slate-500">
          {loc.address}
          {loc.rating !== null ? ` · ${loc.rating}★${loc.reviewsCount !== null ? ` (${loc.reviewsCount} reviews)` : ''}` : ''}
        </p>
      </div>

      {(loc.performance || loc.reviews) && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {loc.performance?.map((p) => (
            <div key={p.label} className="rounded-xl border border-slate-200 p-3">
              <div className="text-[12px] text-slate-500">{p.label}</div>
              <div className="text-lg font-semibold text-slate-900">
                {p.current.toLocaleString()}
                <Delta now={p.current} before={p.previous || null} />
              </div>
            </div>
          ))}
          {loc.reviews && (
            <div className="rounded-xl border border-slate-200 p-3">
              <div className="text-[12px] text-slate-500">New reviews</div>
              <div className="text-lg font-semibold text-slate-900">
                {loc.reviews.newInPeriod}
                {loc.reviews.avgRatingInPeriod !== null && <span className="text-[13px] font-normal text-slate-500"> · {loc.reviews.avgRatingInPeriod}★</span>}
              </div>
              {loc.reviews.replyRate !== null && <div className="text-[12px] text-slate-500">{loc.reviews.replyRate}% answered</div>}
            </div>
          )}
        </div>
      )}

      {loc.keywords.length === 0 ? (
        <p className="text-[13px] text-slate-500">No ranking scans in this period.</p>
      ) : (
        loc.keywords.map((k) => <KeywordBlock key={k.keyword} k={k} data={data} accent={accent} />)
      )}

      {loc.audit && (
        <div className="report-avoid-break rounded-xl border border-slate-200 p-4">
          <div className="flex items-baseline justify-between">
            <h4 className="text-[15px] font-semibold text-slate-900">Audit score: {loc.audit.score}/100</h4>
            <span className="text-[12px] text-slate-500">{fmtDate(loc.audit.at)}</span>
          </div>
          <div className="mt-2 flex flex-wrap gap-4 text-[12.5px] text-slate-600">
            {(Object.keys(PILLAR_LABEL) as Pillar[]).map((p) => (
              <span key={p}>
                {PILLAR_LABEL[p]}: <strong>{loc.audit!.pillars[p] ?? '—'}</strong>
              </span>
            ))}
          </div>
          {loc.audit.top.length > 0 && (
            <ul className="mt-3 list-disc space-y-1 pl-5 text-[13px] text-slate-700">
              {loc.audit.top.map((c) => (
                <li key={c.label}>
                  <strong>{c.label}</strong>
                  {c.action ? ` — ${c.action}` : ''}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  )
}

export function ReportDocument({ data }: { data: ReportData }) {
  const accent = data.branding.accent
  return (
    <article className="mx-auto max-w-4xl space-y-8 bg-white px-6 py-8 text-slate-900">
      <header className="flex items-center justify-between gap-4 border-b-4 pb-4" style={{ borderColor: accent }}>
        <div>
          <h1 className="text-2xl font-bold">{data.title}</h1>
          <p className="text-[13px] text-slate-500">
            {fmtDate(data.from)} – {fmtDate(data.to)} · {data.orgName}
          </p>
        </div>
        {data.branding.logoUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={data.branding.logoUrl} alt={data.orgName} className="h-12 w-auto" />
        )}
      </header>
      {data.intro && <p className="whitespace-pre-wrap text-[14px] leading-relaxed text-slate-700">{data.intro}</p>}
      <p className="text-[12px] text-slate-500">
        Rankings are simulated Google Maps searches from each point of a grid around the business. “Top-3 share” is the
        share of points where it appears in the map pack.
      </p>
      {data.locations.map((loc) => (
        <LocationSection key={loc.id} loc={loc} data={data} accent={accent} />
      ))}
    </article>
  )
}
