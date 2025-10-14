/**
 * Shared types and schemas for Ariadne
 * Barrel export for easy importing
 */

export type { TraceEvent, SpanEvent, TraceOrSpan, IngestPayload } from './types.js'

export {
  TraceEventSchema,
  SpanEventSchema,
  TraceOrSpanSchema,
  IngestPayloadSchema
} from './schemas.js'
