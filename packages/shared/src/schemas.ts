/**
 * Zod validation schemas for event types
 * Based on data-model.md validation rules
 */

import { z } from 'zod'

/**
 * TraceEvent schema with timestamp validation
 */
export const TraceEventSchema = z.object({
  type: z.literal('trace'),
  trace_id: z.string().min(1),
  name: z.string().optional(), // No max length - truncation happens before validation
  group_id: z.string().optional(),
  started_at: z.string().datetime().optional(),
  ended_at: z.string().datetime().optional(),
  metadata: z.record(z.string()).optional()
}).refine(
  (data) => {
    if (data.started_at && data.ended_at) {
      return new Date(data.started_at) <= new Date(data.ended_at)
    }
    return true
  },
  { message: 'ended_at must be >= started_at' }
)

/**
 * SpanEvent schema with timestamp validation
 */
export const SpanEventSchema = z.object({
  type: z.literal('span'),
  trace_id: z.string().min(1),
  span_id: z.string().min(1),
  parent_id: z.string().optional(),
  kind: z.string().optional(),
  name: z.string().optional(), // No max length - truncation happens before validation
  started_at: z.string().datetime().optional(),
  ended_at: z.string().datetime().optional(),
  data: z.record(z.unknown()).optional(),
  status: z.enum(['ok', 'error']).optional()
}).refine(
  (data) => {
    if (data.started_at && data.ended_at) {
      return new Date(data.started_at) <= new Date(data.ended_at)
    }
    return true
  },
  { message: 'ended_at must be >= started_at' }
)

/**
 * Union schema for TraceEvent or SpanEvent
 */
export const TraceOrSpanSchema = z.union([TraceEventSchema, SpanEventSchema])

/**
 * IngestPayload schema (single event or batch)
 */
export const IngestPayloadSchema = z.union([
  TraceOrSpanSchema,
  z.object({ batch: z.array(TraceOrSpanSchema) })
])

// Type inference from schemas
export type TraceEvent = z.infer<typeof TraceEventSchema>
export type SpanEvent = z.infer<typeof SpanEventSchema>
export type TraceOrSpan = z.infer<typeof TraceOrSpanSchema>
export type IngestPayload = z.infer<typeof IngestPayloadSchema>
