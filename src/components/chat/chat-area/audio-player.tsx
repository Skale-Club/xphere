'use client'

/**
 * AudioPlayer | minimal audio playback component.
 * SEED-030: Chat Rich Messages
 *
 * Features:
 *   - Play/pause toggle with Lucide icons
 *   - Clickable progress bar (seek)
 *   - Time display in mm:ss format
 *   - Max width ~220px, designed to fit inside message bubbles
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

export function AudioPlayer({ src, duration }: AudioPlayerProps) {
  const audioRef = useRef<HTMLAudioElement>(null)
  const [playing, setPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [totalDuration, setTotalDuration] = useState(duration ?? 0)

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return

    function onTimeUpdate() {
      setCurrentTime(audio!.currentTime)
    }
    function onDurationChange() {
      if (isFinite(audio!.duration)) {
        setTotalDuration(audio!.duration)
      }
    }
    function onEnded() {
      setPlaying(false)
      setCurrentTime(0)
    }

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
      audio.play().catch(() => {
        // Autoplay blocked or other error | silently ignore
        setPlaying(false)
      })
      setPlaying(true)
    }
  }

  function handleSeek(e: React.ChangeEvent<HTMLInputElement>) {
    const audio = audioRef.current
    if (!audio) return
    const time = parseFloat(e.target.value)
    audio.currentTime = time
    setCurrentTime(time)
  }

  const progress = totalDuration > 0 ? currentTime / totalDuration : 0
  const displayDuration = totalDuration > 0 ? totalDuration : (duration ?? 0)

  return (
    <div className="flex items-center gap-2 max-w-[220px] w-full">
      {/* Hidden audio element */}
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <audio ref={audioRef} src={src} preload="metadata" />

      {/* Play/Pause button */}
      <button
        type="button"
        onClick={togglePlayPause}
        className={cn(
          'flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-colors',
          'bg-accent text-white hover:bg-accent-hover'
        )}
        aria-label={playing ? 'Pause' : 'Play'}
      >
        {playing ? (
          <Pause className="h-3.5 w-3.5" />
        ) : (
          <Play className="h-3.5 w-3.5 translate-x-[1px]" />
        )}
      </button>

      {/* Progress bar + time */}
      <div className="flex flex-1 flex-col gap-0.5 min-w-0">
        <input
          type="range"
          min={0}
          max={displayDuration || 1}
          step={0.1}
          value={currentTime}
          onChange={handleSeek}
          className="h-1 w-full cursor-pointer appearance-none rounded-full bg-border-subtle accent-accent"
          aria-label="Seek"
        />
        <div className="flex justify-between text-[10px] tabular-nums text-text-tertiary">
          <span>{formatTime(currentTime)}</span>
          <span>{formatTime(displayDuration)}</span>
        </div>
      </div>
    </div>
  )
}
