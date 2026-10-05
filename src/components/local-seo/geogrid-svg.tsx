import { pinColor, pinLabel, pinTitle, type GridPin } from './geogrid-pins'

/**
 * Map-free geogrid: the same numbered pins laid out by row/column. Used when
 * no Maps browser key is configured and in public reports, so a shared link
 * never depends on a map key.
 */
export function GeoGridSvg({
  pins,
  size,
  depth = 20,
  onSelect,
  selectedId,
}: {
  pins: GridPin[]
  size: number
  depth?: number
  onSelect?: (pin: GridPin) => void
  selectedId?: string | null
}) {
  const cell = 40
  const pad = 24
  const dim = size * cell + pad * 2
  const center = (size - 1) / 2
  return (
    <svg viewBox={`0 0 ${dim} ${dim}`} className="h-auto w-full max-w-[560px]" role="img" aria-label="Geogrid ranking">
      <rect x={0} y={0} width={dim} height={dim} rx={12} className="fill-bg-secondary" />
      {Array.from({ length: size }, (_, i) => (
        <g key={i} className="stroke-border-subtle">
          <line x1={pad + cell / 2} x2={dim - pad - cell / 2} y1={pad + i * cell + cell / 2} y2={pad + i * cell + cell / 2} />
          <line y1={pad + cell / 2} y2={dim - pad - cell / 2} x1={pad + i * cell + cell / 2} x2={pad + i * cell + cell / 2} />
        </g>
      ))}
      <circle cx={pad + center * cell + cell / 2} cy={pad + center * cell + cell / 2} r={17} className="fill-none stroke-accent" strokeWidth={2} strokeDasharray="3 3" />
      {pins.map((p) => {
        const cx = pad + p.col * cell + cell / 2
        const cy = pad + p.row * cell + cell / 2
        const label = pinLabel(p, depth)
        return (
          <g
            key={p.id}
            onClick={onSelect ? () => onSelect(p) : undefined}
            className={onSelect ? 'cursor-pointer' : undefined}
          >
            <title>{pinTitle(p)}</title>
            <circle
              cx={cx}
              cy={cy}
              r={14}
              fill={pinColor(p)}
              stroke={selectedId === p.id ? '#111827' : '#ffffff'}
              strokeWidth={selectedId === p.id ? 3 : 2}
            />
            <text
              x={cx}
              y={cy}
              textAnchor="middle"
              dominantBaseline="central"
              fill="#ffffff"
              fontSize={label.length > 2 ? 9 : 11}
              fontWeight={700}
            >
              {label}
            </text>
          </g>
        )
      })}
    </svg>
  )
}
