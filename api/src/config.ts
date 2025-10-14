/**
 * Environment configuration loading
 * Loads from process.env with defaults
 */

export interface Config {
  PORT: number
  MAX_EVENTS: number
  CORS_ORIGIN: string
  HOST: string
}

export function loadConfig(): Config {
  return {
    PORT: parseInt(process.env.PORT || '5175', 10),
    MAX_EVENTS: parseInt(process.env.MAX_EVENTS || '10000', 10),
    CORS_ORIGIN: process.env.CORS_ORIGIN || 'http://localhost:5173',
    HOST: process.env.HOST || '127.0.0.1'
  }
}
