/**
 * Web UI Configuration
 * Loads from environment variables
 */

export const config = {
  API_URL: import.meta.env.VITE_API_URL || 'http://localhost:5175',
  MAX_TRACES: parseInt(import.meta.env.VITE_MAX_TRACES || '200', 10)
}
