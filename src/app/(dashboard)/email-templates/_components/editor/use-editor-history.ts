'use client'

import { useReducer, useCallback, useMemo } from 'react'

/**
 * Undo/redo history for the editor document.
 *
 * Bursts of rapid changes (dragging a colour picker, nudging a slider) within
 * `COALESCE_MS` collapse into a single undo step, so one visual edit == one
 * undo — not fifty. Discrete actions (add/remove/move/drop) that are more than
 * `COALESCE_MS` apart each get their own step.
 *
 * `Date.now()` is used only for burst coalescing; it never affects rendered
 * output, so it is safe here (unlike in deterministic workflow scripts).
 */

const COALESCE_MS = 500
const MAX_DEPTH = 100

interface HistoryState<T> {
  past: T[]
  present: T
  future: T[]
  lastTs: number
}

type Action<T> =
  | { type: 'SET'; updater: (prev: T) => T; ts: number }
  | { type: 'UNDO' }
  | { type: 'REDO' }
  | { type: 'RESET'; value: T }

function reducer<T>(state: HistoryState<T>, action: Action<T>): HistoryState<T> {
  switch (action.type) {
    case 'SET': {
      const next = action.updater(state.present)
      if (next === state.present) return state
      const burst = action.ts - state.lastTs <= COALESCE_MS
      return {
        past: burst ? state.past : [...state.past, state.present].slice(-MAX_DEPTH),
        present: next,
        future: [],
        lastTs: action.ts,
      }
    }
    case 'UNDO': {
      if (state.past.length === 0) return state
      const previous = state.past[state.past.length - 1]
      return {
        past: state.past.slice(0, -1),
        present: previous,
        future: [...state.future, state.present],
        lastTs: 0,
      }
    }
    case 'REDO': {
      if (state.future.length === 0) return state
      const next = state.future[state.future.length - 1]
      return {
        past: [...state.past, state.present],
        present: next,
        future: state.future.slice(0, -1),
        lastTs: 0,
      }
    }
    case 'RESET':
      return { past: [], present: action.value, future: [], lastTs: 0 }
    default:
      return state
  }
}

export interface EditorHistory<T> {
  state: T
  set: (updater: ((prev: T) => T) | T) => void
  undo: () => void
  redo: () => void
  reset: (value: T) => void
  canUndo: boolean
  canRedo: boolean
}

export function useEditorHistory<T>(initial: T): EditorHistory<T> {
  const [history, dispatch] = useReducer(reducer<T>, {
    past: [],
    present: initial,
    future: [],
    lastTs: 0,
  })

  const set = useCallback((updater: ((prev: T) => T) | T) => {
    const fn = typeof updater === 'function' ? (updater as (prev: T) => T) : () => updater
    dispatch({ type: 'SET', updater: fn, ts: Date.now() })
  }, [])

  const undo = useCallback(() => dispatch({ type: 'UNDO' }), [])
  const redo = useCallback(() => dispatch({ type: 'REDO' }), [])
  const reset = useCallback((value: T) => dispatch({ type: 'RESET', value }), [])

  return useMemo(
    () => ({
      state: history.present,
      set,
      undo,
      redo,
      reset,
      canUndo: history.past.length > 0,
      canRedo: history.future.length > 0,
    }),
    [history.present, history.past.length, history.future.length, set, undo, redo, reset],
  )
}
