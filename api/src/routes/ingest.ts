/**
 * Ingest endpoint
 * POST /ingest - Accept trace and span events
 */

import { Hono } from 'hono'
import { IngestPayloadSchema, type TraceOrSpan } from '@ariadne/shared'
import { getStore } from '../store/eventStore.js'
import { truncateEvent } from '../middleware/truncate.js'
import { getSseManager } from '../store/sseManager.js'

const ingest = new Hono()

ingest.post('/ingest', async (c) => {
  try {
    // Parse request body
    const body = await c.req.json()

    // Apply truncation BEFORE validation (FR-008)
    const truncatedBody = Array.isArray(body) ? body.map(truncateEvent) :
                          'batch' in body ? { batch: body.batch.map((e: any) => truncateEvent(e)) } :
                          truncateEvent(body)

    // Validate with Zod (FR-003, FR-005)
    const payload = IngestPayloadSchema.parse(truncatedBody)

    // Extract events from payload (FR-002)
    const events: TraceOrSpan[] = 'batch' in payload ? payload.batch : [payload]

    // Process each event
    const store = getStore()
    const sseManager = getSseManager()

    for (const event of events) {
      // Store event (FR-006)
      store.append(event)

      // Broadcast to SSE clients (FR-010)
      sseManager.broadcast(event)
    }

    // Return success
    return c.json({
      success: true,
      count: events.length
    })

  } catch (error) {
    // Handle Zod validation errors
    if (error && typeof error === 'object' && 'issues' in error) {
      return c.json(
        {
          error: 'Validation failed',
          details: (error as any).issues.map((e: any) => ({
            path: e.path,
            message: e.message
          }))
        },
        400
      )
    }

    // Handle other errors
    console.error('Ingest error:', error)
    return c.json(
      {
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error'
      },
      500
    )
  }
})

export default ingest
