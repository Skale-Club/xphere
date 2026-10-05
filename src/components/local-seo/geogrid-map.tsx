'use client'

import { useEffect } from 'react'
import { AdvancedMarker, APIProvider, Map, useMap } from '@vis.gl/react-google-maps'

import { GeoGridSvg } from './geogrid-svg'
import { pinColor, pinLabel, pinTitle, type GridPin } from './geogrid-pins'

type Props = {
  apiKey: string | null
  mapId?: string | null
  center: { lat: number; lng: number }
  pins: GridPin[]
  size: number
  depth?: number
  selectedId?: string | null
  onSelect?: (pin: GridPin) => void
}

/** Keeps the whole grid in view whenever the scan (and so its pins) changes. */
function FitToPins({ pins }: { pins: GridPin[] }) {
  const map = useMap()
  const key = pins.map((p) => p.id).join(',')
  useEffect(() => {
    if (!map || pins.length === 0) return
    const bounds = new google.maps.LatLngBounds()
    for (const p of pins) bounds.extend({ lat: p.lat, lng: p.lng })
    map.fitBounds(bounds, 48)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, key])
  return null
}

/**
 * Geogrid on Google Maps (D2): numbered pins coloured by rank band, like the
 * BrightLocal grid. Falls back to the map-free SVG grid without a browser key.
 */
export function GeoGridMap({ apiKey, mapId, center, pins, size, depth = 20, selectedId, onSelect }: Props) {
  if (!apiKey) {
    return (
      <div className="flex justify-center rounded-xl border border-border-subtle p-4">
        <GeoGridSvg pins={pins} size={size} depth={depth} selectedId={selectedId} onSelect={onSelect} />
      </div>
    )
  }

  return (
    <div className="h-[420px] overflow-hidden rounded-xl border border-border-subtle sm:h-[560px]">
      <APIProvider apiKey={apiKey}>
        <Map
          mapId={mapId || 'DEMO_MAP_ID'}
          defaultCenter={center}
          defaultZoom={13}
          gestureHandling="greedy"
          disableDefaultUI
          zoomControl
          clickableIcons={false}
          style={{ width: '100%', height: '100%' }}
        >
          <FitToPins pins={pins} />
          <AdvancedMarker position={center} title="Business location" zIndex={0}>
            <div className="h-3 w-3 rounded-full border-2 border-white bg-accent shadow" />
          </AdvancedMarker>
          {pins.map((p) => {
            const label = pinLabel(p, depth)
            const selected = selectedId === p.id
            return (
              <AdvancedMarker
                key={p.id}
                position={{ lat: p.lat, lng: p.lng }}
                title={pinTitle(p)}
                zIndex={selected ? 2 : 1}
                onClick={onSelect ? () => onSelect(p) : undefined}
              >
                <div
                  className="flex h-8 w-8 items-center justify-center rounded-full font-bold text-white shadow-md"
                  style={{
                    background: pinColor(p),
                    border: `${selected ? 3 : 2}px solid ${selected ? '#111827' : '#ffffff'}`,
                    fontSize: label.length > 2 ? 10 : 12,
                  }}
                >
                  {label}
                </div>
              </AdvancedMarker>
            )
          })}
        </Map>
      </APIProvider>
    </div>
  )
}
