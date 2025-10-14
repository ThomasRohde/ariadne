/**
 * SSE Events endpoint
 * GET /events - Server-Sent Events stream for real-time event updates
 */

import { Hono } from 'hono'
import { stream } from 'hono/streaming'
import { getSseManager } from '../store/sseManager.js'

const events = new Hono()

events.get('/events', (c) => {
  // Parse query parameters for server-side filtering (FR-012)
  const traceId = c.req.query('traceId')
  const kindsParam = c.req.query('kinds')
  const sinceParam = c.req.query('since')

  // Build filter object
  const filter: any = {}

  if (traceId) {
    filter.traceId = traceId
  }

  if (kindsParam) {
    filter.kinds = new Set(kindsParam.split(',').map(k => k.trim()))
  }

  if (sinceParam) {
    try {
      filter.since = new Date(sinceParam)
      if (isNaN(filter.since.getTime())) {
        return c.json({ error: 'Invalid since parameter' }, 400)
      }
    } catch {
      return c.json({ error: 'Invalid since parameter' }, 400)
    }
  }

  // Create SSE connection
  const sseManager = getSseManager()
  const { id, stream: eventStream } = sseManager.createConnection(Object.keys(filter).length > 0 ? filter : undefined)

  // Set SSE headers
  c.header('Content-Type', 'text/event-stream')
  c.header('Cache-Control', 'no-cache')
  c.header('Connection', 'keep-alive')

  // Return stream
  return stream(c, async (streamCtx) => {
    // The stream is managed by SSEManager
    // We just pipe the event stream to the response
    const reader = eventStream.getReader()

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        await streamCtx.write(value)
      }
    } catch (error) {
      console.error(`[SSE] Stream error for ${id}:`, error)
    } finally {
      reader.releaseLock()
      sseManager.removeConnection(id)
    }
  })
})

export default events
