// tests/analytics-game-widgets.test.tsx
// BS-ANALYTICS-001: the shared presentational widgets render their empty states
// and real data without throwing (server-rendered to static markup).

import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  BarList,
  DailyAreaChart,
  FunnelBars,
  GameStat,
  GameTable,
  MatchupHeatmap,
  RetentionTable,
  TrendLines,
} from '@/components/analytics/game-widgets'
import { buildMatchupMatrix } from '@/lib/analytics/game-panels'

describe('empty states', () => {
  it('every widget shows a message instead of an empty box when there is no data', () => {
    expect(renderToStaticMarkup(<BarList rows={[]} />)).toContain('No data for this period')
    expect(renderToStaticMarkup(<BarList rows={[]} empty="Nothing yet" />)).toContain('Nothing yet')
    expect(renderToStaticMarkup(<FunnelBars rows={[]} />)).toContain('No game sessions reached the first screen')
    expect(renderToStaticMarkup(<DailyAreaChart data={[]} series={[{ key: 'a', label: 'A' }]} />)).toContain('No data for this period')
    expect(renderToStaticMarkup(<TrendLines trend={{ items: [], points: [] }} />)).toContain('No data for this period')
    expect(renderToStaticMarkup(<GameTable rows={[]} rowKey={() => 'x'} columns={[]} />)).toContain('No data for this period')
    expect(renderToStaticMarkup(<RetentionTable rows={[]} />)).toContain('No cohorts in this period')
    expect(renderToStaticMarkup(<MatchupHeatmap matrix={buildMatchupMatrix([])} />)).toContain('No completed matches with a winner yet')
  })

  it('a funnel whose first step has no sessions is empty, not a row of zero bars', () => {
    const html = renderToStaticMarkup(
      <FunnelBars rows={[{ screen: 'title', game_sessions: 0, pct_of_previous: null, pct_of_first: null }]} />,
    )
    expect(html).toContain('No game sessions reached the first screen')
  })
})

describe('with data', () => {
  it('BarList scales bars to the largest value and keeps the label text', () => {
    const html = renderToStaticMarkup(
      <BarList rows={[
        { key: 'a', label: 'Lula', value: 10, display: '10 (50%)' },
        { key: 'b', label: 'Dilma', value: 5 },
      ]} />,
    )
    expect(html).toContain('Lula')
    expect(html).toContain('10 (50%)')
    expect(html).toContain('width:100%')
    expect(html).toContain('width:50%')
  })

  it('FunnelBars shows the step-to-step conversion', () => {
    const html = renderToStaticMarkup(
      <FunnelBars rows={[
        { screen: 'title', game_sessions: 100, pct_of_previous: null, pct_of_first: 1 },
        { screen: 'fighter_select', game_sessions: 60, pct_of_previous: 0.6, pct_of_first: 0.6 },
      ]} />,
    )
    expect(html).toContain('Fighter select')
    expect(html).toContain('60%')
  })

  it('MatchupHeatmap colours above-50 cells green and below-50 red, and fades small samples', () => {
    const matrix = buildMatchupMatrix([
      { fighter_id: 'lula', opponent_id: 'dilma', matches: 20, wins: 16, win_rate: 0.8 },
      { fighter_id: 'dilma', opponent_id: 'lula', matches: 20, wins: 4, win_rate: 0.2 },
    ])
    const html = renderToStaticMarkup(<MatchupHeatmap matrix={matrix} />)
    expect(html).toContain('80%')
    expect(html).toContain('20%')
    expect(html).toContain('rgba(34, 197, 94')
    expect(html).toContain('rgba(239, 68, 68')

    const small = renderToStaticMarkup(
      <MatchupHeatmap matrix={buildMatchupMatrix([
        { fighter_id: 'a', opponent_id: 'b', matches: 2, wins: 2, win_rate: 1 },
      ])} />,
    )
    expect(small).toContain('small sample')
  })

  it('RetentionTable leaves a rate blank while the cohort is too young', () => {
    const html = renderToStaticMarkup(
      <RetentionTable rows={[
        { cohort_day: '2026-10-07', cohort_size: 9, d1_retained: 0, d7_retained: 0, d30_retained: 0, d1_rate: null, d7_rate: null, d30_rate: null },
      ]} />,
    )
    expect(html).toContain('2026-10-07')
    expect(html).not.toContain('0%')
  })

  it('GameStat renders label, value and hint', () => {
    const html = renderToStaticMarkup(<GameStat label="DAU" value="12" hint="last day" />)
    expect(html).toContain('DAU')
    expect(html).toContain('12')
    expect(html).toContain('last day')
  })
})
