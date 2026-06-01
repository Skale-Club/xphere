'use client'

/**
 * AudioPlayer | rich audio playback with waveform, full-width layout, 2× speed.
 *
 * Waveform bars are deterministically generated from the src URL so the same
 * audio always renders the same pattern. No Web Audio API decoding needed —
 * the bars are visual sugar, not accurate peaks.
 */

import { useEffect, useRef, useState } from 'react'
import { Play, Pause } from 'lucide-react'
import { cn } from '@/lib/utils'

interface AudioPlayerProps {
  src: string
  duration?: number
}

function formatTime(seconds: number): string {
  if (!isFinite(seconds) || isNaN(seconds)) return '0:00'
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

/**
 * Deterministic pseudo-waveform seeded from the URL so the same audio always
 * renders the same bars. Heights are biased toward the middle of the range
 * (30–90 %) to look like a natural voice envelope.
 */
const BAR_COUNT = 48

function generateWaveform(src: string): number[] {
  let hash = 0
  for (let i = 0; i < src.length; i++) {
    hash = Math.imul(hash * 31 + src.charCodeAt(i), 2654435761)
  }
  return Array.from({ length: BAR_COUNT }, (_, i) => {
    const seed = Math.imul(hash ^ (i * 2246822519), 2654435761)
    const raw = (Math.abs(seed) % 1000) / 1000
    // voice-like envelope: taller in the middle, tapers at edges
    const env = Math.sin((i / (BAR_COUNT - 1)) * Math.PI) * 0.4 + 0.6
    return Math.max(0.12, raw * 0.7 * env + 0.15)
  })
}

export function AudioPlayer({ src, duration }: AudioPlayerProps) {
  const audioRef = useRef<HTMLAudioElement>(null)
  const [playing, setPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [totalDuration, setTotalDuration] = useState(duration ?? 0)
  const [speed, setSpeed] = useState<1 | 2>(1)
  const waveform = useRef(generateWaveform(src))

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return
    const onTimeUpdate = () => setCurrentTime(audio.currentTime)
    const onDurationChange = () => {
      if (isFinite(audio.duration)) setTotalDuration(audio.duration)
    }
    const onEnded = () => { setPlaying(false); setCurrentTime(0) }
    audio.addEventListener('timeupdate', onTimeUpdate)
    audio.addEventListener('durationchange', onDurationChange)
    audio.addEventListener('loadedmetadata', onDurationChange)
    audio.addEventListener('ended', onEnded)
    return () => {
      audio.removeEventListener('timeupdate', onTimeUpdate)
      audio.removeEventListener('durationchange', onDurationChange)
      audio.removeEventListener('loadedmetadata', onDurationChange)
      audio.removeEventListener('ended', onEnded)
    }
  }, [])

  function togglePlayPause() {
    const audio = audioRef.current
    if (!audio) return
    if (playing) {
      audio.pause()
      setPlaying(false)
    } else {
      audio.playbackRate = speed
      audio.play().catch(() => setPlaying(false))
      setPlaying(true)
    }
  }

  function toggleSpeed() {
    const audio = audioRef.current
    const next: 1 | 2 = speed === 1 ? 2 : 1
    setSpeed(next)
    if (audio) audio.playbackRate = next
  }

  function handleWaveformClick(e: React.MouseEvent<HTMLDivElement>) {
    const audio = audioRef.current
    if (!audio || !displayDuration) return
    const rect = e.currentTarget.getBoundingClientRect()
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
    const time = ratio * displayDuration
    audio.currentTime = time
    setCurrentTime(time)
  }

  const displayDuration = totalDuration > 0 ? totalDuration : (duration ?? 0)
  const progress = displayDuration > 0 ? currentTime / displayDuration : 0

  return (
    <div className="flex w-full items-center gap-2.5 py-0.5">
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <audio ref={audioRef} src={src} preload="metadata" />

      {/* Play / Pause */}
      <button
        type="button"
        onClick={togglePlayPause}
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent text-white hover:bg-accent-hover transition-colors"
        aria-label={playing ? 'Pause' : 'Play'}
      >
        {playing
          ? <Pause className="h-4 w-4" />
          : <Play className="h-4 w-4 translate-x-[1px]" />
        }
      </button>

      {/* Waveform + timestamps */}
      <div className="flex flex-1 flex-col gap-1 min-w-0">
        {/* Waveform bars — click anywhere to seek */}
        <div
          role="slider"
          aria-label="Seek"
          aria-valuemin={0}
          aria-valuemax={displayDuration || 1}
          aria-valuenow={currentTime}
          tabIndex={0}
          className="flex h-8 w-full cursor-pointer items-end gap-px select-none"
          onClick={handleWaveformClick}
          onKeyDown={(e) => {
            const audio = audioRef.current
            if (!audio) return
            if (e.key === 'ArrowRight') audio.currentTime = Math.min(audio.currentTime + 5, displayDuration)
            if (e.key === 'ArrowLeft')  audio.currentTime = Math.max(audio.currentTime - 5, 0)
          }}
        >
          {waveform.current.map((height, i) => {
            const barProgress = (i + 1) / BAR_COUNT
            const active = barProgress <= progress
            const isCurrent = !active && barProgress - 1 / BAR_COUNT <= progress
            return (
              <div
                key={i}
                className={cn(
                  'flex-1 rounded-full transition-colors duration-75',
                  active
                    ? 'bg-accent'
                    : isCurrent
                    ? 'bg-accent/60'
                    : 'bg-white/25',
                )}
                style={{ height: `${Math.round(height * 100)}%` }}
              />
            )
          })}
        </div>

        {/* Time */}
        <div className="flex justify-between text-[10px] tabular-nums text-text-tertiary">
          <span>{formatTime(currentTime)}</span>
          <span>{formatTime(displayDuration)}</span>
        </div>
      </div>

      {/* 2× speed toggle */}
      <button
        type="button"
        onClick={toggleSpeed}
        className={cn(
          'shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-semibold tabular-nums transition-colors',
          speed === 2
            ? 'bg-accent/20 text-accent'
            : 'text-white/50 hover:text-white/80',
        )}
        aria-label={`Playback speed: ${speed}x. Click to toggle.`}
      >
        {speed}×
      </button>
    </div>
  )
}
