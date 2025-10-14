/**
 * Core event types for the Ariadne trace viewer
 * Based on data-model.md specification
 */

/**
 * TraceEvent represents a top-level agent workflow or execution session
 */
export interface TraceEvent {
  type: 'trace'
  trace_id: string
  name?: string
  group_id?: string
  started_at?: string // ISO 8601
  ended_at?: string // ISO 8601
  metadata?: Record<string, string>
}

/**
 * SpanEvent represents an individual operation within a trace
 */
export interface SpanEvent {
  type: 'span'
  trace_id: string
  span_id: string
  parent_id?: string
  kind?: string
  name?: string
  started_at?: string // ISO 8601
  ended_at?: string // ISO 8601
  data?: Record<string, unknown>
  status?: 'ok' | 'error'
}

/**
 * Union type for all event types
 */
export type TraceOrSpan = TraceEvent | SpanEvent

/**
 * IngestPayload can be a single event or a batch
 */
export type IngestPayload = TraceOrSpan | { batch: TraceOrSpan[] }
