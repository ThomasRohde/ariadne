/**
 * Event store singleton wrapping RingBuffer with trace indexing
 * Provides efficient trace-based lookups
 */

import type { TraceOrSpan, TraceEvent, SpanEvent } from '@ariadne/shared'
import { RingBuffer } from './ringBuffer.js'

interface Trace {
  traceEvent: TraceEvent | null
  spans: SpanEvent[]
}

export class EventStore {
  private buffer: RingBuffer
  private traceIndex: Map<string, Trace>

  constructor(maxSize: number) {
    this.buffer = new RingBuffer(maxSize)
    this.traceIndex = new Map()
  }

  /**
   * Add an event to the store and update trace index
   */
  append(event: TraceOrSpan): void {
    this.buffer.append(event)

    // Update trace index
    const traceId = event.trace_id
    let trace = this.traceIndex.get(traceId)

    if (!trace) {
      trace = { traceEvent: null, spans: [] }
      this.traceIndex.set(traceId, trace)
    }

    if (event.type === 'trace') {
      trace.traceEvent = event
    } else {
      trace.spans.push(event)
    }
  }

  /**
   * Get all events in arrival order
   */
  getAll(): TraceOrSpan[] {
    return this.buffer.getAll()
  }

  /**
   * Get all events for a specific trace
   */
  getByTrace(traceId: string): TraceOrSpan[] {
    const trace = this.traceIndex.get(traceId)
    if (!trace) return []

    const events: TraceOrSpan[] = []
    if (trace.traceEvent) {
      events.push(trace.traceEvent)
    }
    events.push(...trace.spans)
    return events
  }

  /**
   * Get all trace IDs
   */
  getTraceIds(): string[] {
    return Array.from(this.traceIndex.keys())
  }

  /**
   * Get count of events in store
   */
  getCount(): number {
    return this.buffer.getCount()
  }

  /**
   * Get maximum store size
   */
  getSize(): number {
    return this.buffer.getSize()
  }

  /**
   * Clear all events and index
   */
  clear(): void {
    this.buffer.clear()
    this.traceIndex.clear()
  }
}

// Singleton instance (will be initialized with config)
let storeInstance: EventStore | null = null

export function initializeStore(maxSize: number): EventStore {
  storeInstance = new EventStore(maxSize)
  return storeInstance
}

export function getStore(): EventStore {
  if (!storeInstance) {
    throw new Error('Event store not initialized. Call initializeStore() first.')
  }
  return storeInstance
}
