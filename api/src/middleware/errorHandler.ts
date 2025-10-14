/**
 * Global error handler middleware
 * Handles validation errors and unexpected errors
 */

import type { Context, Next } from 'hono'
import { ZodError } from 'zod'

export async function errorHandler(c: Context, next: Next) {
  try {
    await next()
  } catch (err) {
    // Handle Zod validation errors
    if (err instanceof ZodError) {
      return c.json(
        {
          error: 'Validation failed',
          details: err.errors.map(e => ({
            path: e.path.join('.'),
            message: e.message
          }))
        },
        400
      )
    }

    // Handle other errors
    console.error('Unexpected error:', err)
    return c.json(
      {
        error: 'Internal server error',
        message: err instanceof Error ? err.message : 'Unknown error'
      },
      500
    )
  }
}
