/**
 * Ariadne API Server
 * Main entry point with Hono app setup
 */

import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { serve } from '@hono/node-server'
import { loadConfig } from './config.js'
import { initializeStore } from './store/eventStore.js'
import { initializeSseManager } from './store/sseManager.js'
import { sizeLimit } from './middleware/sizeLimit.js'
import { errorHandler } from './middleware/errorHandler.js'
import health from './routes/health.js'
import ingest from './routes/ingest.js'
import events from './routes/events.js'

// Load configuration
const config = loadConfig()

// Initialize event store
initializeStore(config.MAX_EVENTS)

// Initialize SSE manager
initializeSseManager()

// Create Hono app
const app = new Hono()

// Global error handler middleware (FR-025)
app.use('*', errorHandler)

// CORS middleware with origin validation (FR-019, FR-020)
// Allow both localhost and 127.0.0.1 to handle browser differences
const allowedOrigins = [config.CORS_ORIGIN, 'http://127.0.0.1:5173']
app.use('*', cors({
  origin: (origin) => {
    if (!origin || allowedOrigins.includes(origin)) {
      return origin || allowedOrigins[0]
    }
    return allowedOrigins[0]
  },
  allowMethods: ['GET', 'POST', 'OPTIONS'],
  allowHeaders: ['Content-Type'],
  credentials: false
}))

// Size limit middleware (FR-004)
app.use('/ingest', sizeLimit)

// Routes
app.route('/', health)
app.route('/', ingest)
app.route('/', events)

// Root endpoint
app.get('/', (c) => {
  return c.json({
    name: 'Ariadne Trace Viewer API',
    version: '1.0.0',
    endpoints: {
      health: '/healthz',
      ingest: 'POST /ingest',
      events: 'GET /events'
    }
  })
})

// Start server
serve({
  fetch: app.fetch,
  port: config.PORT,
  hostname: config.HOST
})

console.log(`🚀 Ariadne API listening on http://${config.HOST}:${config.PORT}`)
console.log(`📊 Event buffer capacity: ${config.MAX_EVENTS}`)
console.log(`🔒 CORS origin: ${config.CORS_ORIGIN}`)

export default app
