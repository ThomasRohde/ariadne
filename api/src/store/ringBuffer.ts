/**
 * Ring buffer implementation for bounded event storage
 * O(1) append with FIFO eviction when full
 */

import type { TraceOrSpan } from '@ariadne/shared'

export class RingBuffer {
  private buffer: TraceOrSpan[]
  private head: number = 0
  private size: number
  private count: number = 0

  constructor(maxSize: number) {
    this.buffer = new Array(maxSize)
    this.size = maxSize
  }

  /**
   * Append an event to the buffer
   * O(1) operation - overwrites oldest if full
   */
  append(event: TraceOrSpan): void {
    this.buffer[this.head] = event
    this.head = (this.head + 1) % this.size
    if (this.count < this.size) {
      this.count++
    }
  }

  /**
   * Get all events in arrival order
   * O(n) operation
   */
  getAll(): TraceOrSpan[] {
    if (this.count < this.size) {
      // Buffer not yet full - return from start to head
      return this.buffer.slice(0, this.count)
    }
    // Buffer is full - return from head to end, then start to head
    return [...this.buffer.slice(this.head), ...this.buffer.slice(0, this.head)]
  }

  /**
   * Get all events for a specific trace_id
   * O(n) operation
   */
  getByTrace(traceId: string): TraceOrSpan[] {
    return this.getAll().filter(event => event.trace_id === traceId)
  }

  /**
   * Get current count of events in buffer
   */
  getCount(): number {
    return this.count
  }

  /**
   * Get maximum buffer size
   */
  getSize(): number {
    return this.size
  }

  /**
   * Clear all events
   */
  clear(): void {
    this.buffer = new Array(this.size)
    this.head = 0
    this.count = 0
  }
}
