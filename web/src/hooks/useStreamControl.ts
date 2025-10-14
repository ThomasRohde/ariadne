/**
 * Stream Control State Management Hook
 * Implements FR-043, FR-044, FR-045 - Pause/resume controls for event stream
 */

import { useState, useCallback } from 'react'
import type { TraceOrSpan } from '../types'

interface StreamState {
  // Whether the stream is currently paused
  isPaused: boolean
  // Buffer of events received while paused
  bufferedEvents: TraceOrSpan[]
}

export function useStreamControl() {
  const [streamState, setStreamState] = useState<StreamState>({
    isPaused: false,
    bufferedEvents: []
  })

  // Toggle pause/resume (FR-043)
  const togglePause = useCallback(() => {
    setStreamState(prev => ({
      ...prev,
      isPaused: !prev.isPaused
    }))
  }, [])

  // Pause the stream
  const pause = useCallback(() => {
    setStreamState(prev => ({
      ...prev,
      isPaused: true
    }))
  }, [])

  // Resume the stream and flush buffered events (FR-044)
  const resume = useCallback(() => {
    setStreamState(prev => ({
      ...prev,
      isPaused: false
    }))
  }, [])

  // Add event to buffer while paused (FR-044)
  const bufferEvent = useCallback((event: TraceOrSpan) => {
    setStreamState(prev => ({
      ...prev,
      bufferedEvents: [...prev.bufferedEvents, event]
    }))
  }, [])

  // Get and clear buffered events when resuming (FR-044)
  const flushBufferedEvents = useCallback((): TraceOrSpan[] => {
    const events = streamState.bufferedEvents
    setStreamState(prev => ({
      ...prev,
      bufferedEvents: []
    }))
    return events
  }, [streamState.bufferedEvents])

  return {
    isPaused: streamState.isPaused,
    bufferedCount: streamState.bufferedEvents.length,
    togglePause,
    pause,
    resume,
    bufferEvent,
    flushBufferedEvents
  }
}
