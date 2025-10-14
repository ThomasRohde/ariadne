/**
 * Privacy State Management Hook
 * Implements FR-046, FR-047, FR-048 - Privacy control for sensitive data
 */

import { useState, useCallback } from 'react'

interface PrivacyState {
  // Global privacy mode - enabled by default (FR-046)
  isPrivacyEnabled: boolean
  // Per-event reveal tracking - Set of event IDs that are revealed (FR-048)
  revealedEvents: Set<string>
}

export function usePrivacyStore() {
  // FR-046: Privacy mode enabled by default on first load
  const [privacyState, setPrivacyState] = useState<PrivacyState>({
    isPrivacyEnabled: true,
    revealedEvents: new Set()
  })

  // Toggle global privacy mode (FR-046)
  const togglePrivacyMode = useCallback(() => {
    setPrivacyState(prev => ({
      ...prev,
      isPrivacyEnabled: !prev.isPrivacyEnabled,
      // Clear revealed events when disabling privacy mode
      revealedEvents: prev.isPrivacyEnabled ? new Set() : prev.revealedEvents
    }))
  }, [])

  // Reveal individual event (FR-048)
  const revealEvent = useCallback((eventId: string) => {
    setPrivacyState(prev => {
      const newRevealed = new Set(prev.revealedEvents)
      newRevealed.add(eventId)
      return {
        ...prev,
        revealedEvents: newRevealed
      }
    })
  }, [])

  // Hide individual event
  const hideEvent = useCallback((eventId: string) => {
    setPrivacyState(prev => {
      const newRevealed = new Set(prev.revealedEvents)
      newRevealed.delete(eventId)
      return {
        ...prev,
        revealedEvents: newRevealed
      }
    })
  }, [])

  // Toggle individual event reveal state (FR-048)
  const toggleEventReveal = useCallback((eventId: string) => {
    setPrivacyState(prev => {
      const newRevealed = new Set(prev.revealedEvents)
      if (newRevealed.has(eventId)) {
        newRevealed.delete(eventId)
      } else {
        newRevealed.add(eventId)
      }
      return {
        ...prev,
        revealedEvents: newRevealed
      }
    })
  }, [])

  // Check if an event is revealed
  const isEventRevealed = useCallback((eventId: string): boolean => {
    return privacyState.revealedEvents.has(eventId)
  }, [privacyState.revealedEvents])

  // Check if data should be hidden for an event (FR-047)
  const shouldHideData = useCallback((eventId: string): boolean => {
    return privacyState.isPrivacyEnabled && !privacyState.revealedEvents.has(eventId)
  }, [privacyState.isPrivacyEnabled, privacyState.revealedEvents])

  return {
    isPrivacyEnabled: privacyState.isPrivacyEnabled,
    revealedEvents: privacyState.revealedEvents,
    togglePrivacyMode,
    revealEvent,
    hideEvent,
    toggleEventReveal,
    isEventRevealed,
    shouldHideData
  }
}
