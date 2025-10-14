/**
 * Truncation middleware for large event fields
 * Implements FR-008: name at 1KB, data values at 100KB
 */

import type { Context, Next } from 'hono'
import type { TraceOrSpan } from '@ariadne/shared'

const MAX_NAME_LENGTH = 1024 // 1 KB
const MAX_DATA_VALUE_LENGTH = 100 * 1024 // 100 KB

function truncateString(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str
  return str.substring(0, maxLength) + '... [truncated]'
}

function truncateDataField(data: Record<string, unknown>): Record<string, unknown> {
  const truncated: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(data)) {
    if (typeof value === 'string') {
      truncated[key] = truncateString(value, MAX_DATA_VALUE_LENGTH)
    } else if (value && typeof value === 'object' && !Array.isArray(value)) {
      // Recursively truncate nested objects
      truncated[key] = truncateDataField(value as Record<string, unknown>)
    } else {
      truncated[key] = value
    }
  }

  return truncated
}

export function truncateEvent(event: TraceOrSpan): TraceOrSpan {
  const truncated = { ...event }

  // Truncate name field
  if (truncated.name) {
    truncated.name = truncateString(truncated.name, MAX_NAME_LENGTH)
  }

  // Truncate data field for spans
  if (truncated.type === 'span' && truncated.data) {
    truncated.data = truncateDataField(truncated.data)
  }

  return truncated
}

export async function truncate(c: Context, next: Next) {
  await next()
}
