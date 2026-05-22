'use client'

import { useState, useMemo } from 'react'
import {
  format, startOfMonth, endOfMonth, startOfWeek, endOfWeek,
  eachDayOfInterval, addMonths, subMonths, isSameDay, isSameMonth, isToday,
} from 'date-fns'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'

const DAY_HEADERS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

interface MiniCalendarProps {
  selectedDate: Date | null
  onSelectDate: (d: Date | null) => void
  taskDates: Set<string>
}

export function MiniCalendar({ selectedDate, onSelectDate, taskDates }: MiniCalendarProps) {
  const [viewMonth, setViewMonth] = useState(() => startOfMonth(new Date()))

  const days = useMemo(() => eachDayOfInterval({
    start: startOfWeek(startOfMonth(viewMonth)),
    end: endOfWeek(endOfMonth(viewMonth)),
  }), [viewMonth])

  return (
    <div className="rounded-xl border border-white/10 bg-[#111113] p-4 select-none">
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm font-medium text-foreground">
          {format(viewMonth, 'MMMM yyyy')}
        </span>
        <div className="flex gap-1">
          <button
            onClick={() => setViewMonth((m) => subMonths(m, 1))}
            className="h-6 w-6 rounded-md flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-white/8 transition-colors"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => setViewMonth((m) => addMonths(m, 1))}
            className="h-6 w-6 rounded-md flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-white/8 transition-colors"
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-7 mb-1">
        {DAY_HEADERS.map((d) => (
          <div key={d} className="text-center text-[0.6rem] text-muted-foreground py-1 font-medium">
            {d}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-y-0.5">
        {days.map((day) => {
          const key = format(day, 'yyyy-MM-dd')
          const hasTasks = taskDates.has(key)
          const isSelected = selectedDate ? isSameDay(day, selectedDate) : false
          const isCurrentDay = isToday(day)
          const inMonth = isSameMonth(day, viewMonth)

          return (
            <button
              key={key}
              onClick={() => onSelectDate(isSelected ? null : day)}
              className={cn(
                'relative flex flex-col items-center justify-center h-8 w-full text-xs rounded-lg transition-colors',
                !inMonth && 'opacity-25 pointer-events-none',
                isSelected && 'bg-white text-black font-semibold',
                !isSelected && isCurrentDay && 'text-indigo-400 font-semibold',
                !isSelected && !isCurrentDay && 'text-muted-foreground hover:bg-white/6 hover:text-foreground',
              )}
            >
              {format(day, 'd')}
              {hasTasks && !isSelected && (
                <span className="absolute bottom-0.5 h-1 w-1 rounded-full bg-indigo-400" />
              )}
            </button>
          )
        })}
      </div>

      {selectedDate && (
        <button
          onClick={() => onSelectDate(null)}
          className="mt-3 w-full text-xs text-muted-foreground hover:text-foreground transition-colors text-center"
        >
          Clear selection
        </button>
      )}
    </div>
  )
}
