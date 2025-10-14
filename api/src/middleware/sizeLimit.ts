/**
 * Request size limit middleware
 * Enforces 256 KB maximum payload size (FR-004)
 */

import type { Context, Next } from 'hono'

const MAX_SIZE = 256 * 1024 // 256 KB in bytes

export async function sizeLimit(c: Context, next: Next) {
  const contentLength = c.req.header('content-length')

  if (contentLength) {
    const size = parseInt(contentLength, 10)
    if (size > MAX_SIZE) {
      return c.json(
        {
          error: 'Payload too large',
          message: `Request size ${size} bytes exceeds maximum of ${MAX_SIZE} bytes`
        },
        413
      )
    }
  }

  await next()
}
