'use client'

import * as React from 'react'
import { Play, Pause, Volume2 } from 'lucide-react'
import WaveSurfer from 'wavesurfer.js'

import { Button } from '@/components/ui/button'

interface CallWaveformPlayerProps {
  url: string
  duration: number
}

export function CallWaveformPlayer({ url, duration }: CallWaveformPlayerProps) {
  const waveContainer = React.useRef<HTMLDivElement | null>(null)
  const wavesurfer = React.useRef<WaveSurfer | null>(null)
  const [playing, setPlaying] = React.useState(false)
  const [currentTime, setCurrentTime] = React.useState(0)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [volume, setVolume] = React.useState(1)

  React.useEffect(() => {
    if (!waveContainer.current) return
    const ws = WaveSurfer.create({
      container: waveContainer.current,
      waveColor: '#3a3a4a',
      progressColor: '#7c6cff',
      cursorColor: '#a89cff',
      barWidth: 2,
      barRadius: 2,
      barGap: 2,
      height: 64,
      normalize: true,
      backend: 'WebAudio',
    })
    wavesurfer.current = ws

    ws.on('ready', () => setLoading(false))
    ws.on('audioprocess', () => setCurrentTime(ws.getCurrentTime()))
    ws.on('seeking', () => setCurrentTime(ws.getCurrentTime()))
    ws.on('finish', () => setPlaying(false))
    ws.on('error', (err) => {
      setLoading(false)
      setError(err instanceof Error ? err.message : 'Recording failed to load')
    })

    ws.load(url).catch((err) => {
      setLoading(false)
      setError(err instanceof Error ? err.message : 'Failed to load audio')
    })

    return () => {
      ws.destroy()
      wavesurfer.current = null
    }
  }, [url])

  function togglePlay() {
    const ws = wavesurfer.current
    if (!ws || loading) return
    if (playing) {
      ws.pause()
      setPlaying(false)
    } else {
      ws.play()
      setPlaying(true)
    }
  }

  function onVolumeChange(e: React.ChangeEvent<HTMLInputElement>) {
    const v = parseFloat(e.target.value)
    setVolume(v)
    wavesurfer.current?.setVolume(v)
  }

  return (
    <div className="rounded-[14px] border border-border bg-bg-secondary p-5 space-y-4">
      <div className="flex items-center gap-4">
        <Button
          variant="primary"
          size="icon-lg"
          onClick={togglePlay}
          disabled={loading || Boolean(error)}
          aria-label={playing ? 'Pause' : 'Play'}
          className="rounded-full"
        >
          {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
        </Button>
        <div className="flex-1 min-w-0">
          <div
            ref={waveContainer}
            className="w-full"
            aria-label="Call recording waveform"
          />
          {loading && (
            <div className="text-[11.5px] text-text-tertiary">Loading recording…</div>
          )}
          {error && (
            <div className="text-[11.5px] text-rose-400">{error}</div>
          )}
        </div>
      </div>

      <div className="flex items-center justify-between text-[11.5px] text-text-tertiary">
        <span className="font-mono">{formatTime(currentTime)} / {formatTime(duration)}</span>
        <div className="flex items-center gap-2">
          <Volume2 className="h-3.5 w-3.5" />
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={volume}
            onChange={onVolumeChange}
            className="h-1 w-24 cursor-pointer accent-accent"
            aria-label="Volume"
          />
        </div>
      </div>
    </div>
  )
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00'
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}
