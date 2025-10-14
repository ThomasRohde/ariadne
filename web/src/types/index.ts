/**
 * Re-export shared types for Web UI
 */

import type { TraceEvent, SpanEvent, TraceOrSpan } from '@ariadne/shared'

export type { TraceEvent, SpanEvent, TraceOrSpan }

/**
 * Client-side Trace aggregation
 */
export interface Trace {
  traceId: string
  traceEvent: TraceEvent | null
  spans: SpanEvent[]
}

/**
 * Connection status
 */
export type ConnectionStatus = 'connected' | 'connecting' | 'disconnected' | 'reconnecting'

/**
 * UI selection state for tree + inspector coordination
 */
export type SelectedItem =
  | {
      kind: 'trace'
      traceId: string
    }
  | {
      kind: 'span'
      traceId: string
      spanId: string
    }
