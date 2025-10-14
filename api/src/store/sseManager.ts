/**
 * SSE Connection Manager
 * Manages Server-Sent Events connections with per-connection queues and backpressure
 */

import type { TraceOrSpan } from '@ariadne/shared'

interface SSEConnection {
  id: string
  controller: ReadableStreamDefaultController
  queue: TraceOrSpan[]
  maxQueueSize: number
  filter?: ConnectionFilter
  lastHeartbeat: number
  connected: boolean
}

interface ConnectionFilter {
  traceId?: string
  kinds?: Set<string>
  since?: Date
}

export class SSEManager {
  private connections: Map<string, SSEConnection> = new Map()
  private nextId: number = 1
  private heartbeatInterval: NodeJS.Timeout | null = null
  private readonly MAX_QUEUE_SIZE = 5000 // FR-013

  constructor() {
    // Start heartbeat timer (FR-011)
    this.startHeartbeat()
  }

  /**
   * Create a new SSE connection
   */
  createConnection(filter?: ConnectionFilter): { id: string; stream: ReadableStream } {
    const id = `sse_${this.nextId++}`

    const stream = new ReadableStream({
      start: (controller) => {
        const connection: SSEConnection = {
          id,
          controller,
          queue: [],
          maxQueueSize: this.MAX_QUEUE_SIZE,
          filter,
          lastHeartbeat: Date.now(),
          connected: true
        }

        this.connections.set(id, connection)

        // Send initial connection message
        this.sendMessage(connection, { type: 'connected', timestamp: new Date().toISOString() })

        console.log(`[SSE] Client ${id} connected (total: ${this.connections.size})`)
      },
      cancel: () => {
        this.removeConnection(id)
      }
    })

    return { id, stream }
  }

  /**
   * Remove a connection
   */
  removeConnection(id: string): void {
    const connection = this.connections.get(id)
    if (connection) {
      connection.connected = false
      this.connections.delete(id)
      console.log(`[SSE] Client ${id} disconnected (total: ${this.connections.size})`)
    }
  }

  /**
   * Broadcast an event to all connected clients
   * Applies per-connection filters (FR-012)
   */
  broadcast(event: TraceOrSpan): void {
    for (const connection of this.connections.values()) {
      if (!connection.connected) continue

      // Apply filter if present
      if (connection.filter && !this.matchesFilter(event, connection.filter)) {
        continue
      }

      // Check for backpressure (FR-014)
      if (connection.queue.length >= connection.maxQueueSize) {
        // Drop oldest event
        connection.queue.shift()
        this.sendComment(connection, 'warning stream backpressure; events skipped')
      }

      // Add to queue
      connection.queue.push(event)

      // Flush immediately
      this.flushConnection(connection)
    }
  }

  /**
   * Check if event matches connection filter
   */
  private matchesFilter(event: TraceOrSpan, filter: ConnectionFilter): boolean {
    // Filter by trace ID
    if (filter.traceId && event.trace_id !== filter.traceId) {
      return false
    }

    // Filter by span kind (only for spans)
    if (filter.kinds && event.type === 'span') {
      if (!event.kind || !filter.kinds.has(event.kind)) {
        return false
      }
    }

    // Filter by time (since)
    if (filter.since && event.type === 'span' && event.started_at) {
      const eventTime = new Date(event.started_at)
      if (eventTime < filter.since) {
        return false
      }
    }

    return true
  }

  /**
   * Flush queued events for a connection
   */
  private flushConnection(connection: SSEConnection): void {
    while (connection.queue.length > 0 && connection.connected) {
      const event = connection.queue.shift()!
      this.sendMessage(connection, event)
    }
  }

  /**
   * Send a message to a connection (FR-015)
   */
  private sendMessage(connection: SSEConnection, data: any): void {
    if (!connection.connected) return

    try {
      const message = `data: ${JSON.stringify(data)}\n\n`
      connection.controller.enqueue(new TextEncoder().encode(message))
    } catch (error) {
      console.error(`[SSE] Error sending message to ${connection.id}:`, error)
      this.removeConnection(connection.id)
    }
  }

  /**
   * Send a comment to a connection
   */
  private sendComment(connection: SSEConnection, comment: string): void {
    if (!connection.connected) return

    try {
      const message = `:${comment}\n\n`
      connection.controller.enqueue(new TextEncoder().encode(message))
    } catch (error) {
      console.error(`[SSE] Error sending comment to ${connection.id}:`, error)
      this.removeConnection(connection.id)
    }
  }

  /**
   * Start heartbeat timer (FR-011)
   */
  private startHeartbeat(): void {
    this.heartbeatInterval = setInterval(() => {
      const now = Date.now()
      for (const connection of this.connections.values()) {
        if (now - connection.lastHeartbeat >= 15000) {
          this.sendComment(connection, 'heartbeat')
          connection.lastHeartbeat = now
        }
      }
    }, 15000) // Every 15 seconds
  }

  /**
   * Stop heartbeat timer
   */
  destroy(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval)
      this.heartbeatInterval = null
    }

    // Close all connections
    for (const connection of this.connections.values()) {
      this.removeConnection(connection.id)
    }
  }

  /**
   * Get connection count
   */
  getConnectionCount(): number {
    return this.connections.size
  }
}

// Singleton instance
let sseManagerInstance: SSEManager | null = null

export function initializeSseManager(): SSEManager {
  sseManagerInstance = new SSEManager()
  return sseManagerInstance
}

export function getSseManager(): SSEManager {
  if (!sseManagerInstance) {
    throw new Error('SSE manager not initialized. Call initializeSseManager() first.')
  }
  return sseManagerInstance
}
