/**
 * Health check endpoint
 * GET /healthz - Simple health check
 */

import { Hono } from 'hono'
import { getStore } from '../store/eventStore.js'

const health = new Hono()

health.get('/healthz', (c) => {
  const store = getStore()
  return c.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    events: {
      count: store.getCount(),
      capacity: store.getSize()
    }
  })
})

export default health
