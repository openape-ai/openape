import { defineEventHandler } from 'h3'

/**
 * GET /api/health — liveness probe for the container healthcheck and the
 * deploy gate. Intentionally no auth and no DB access: it answers "is the
 * process up and serving HTTP", nothing more.
 */
export default defineEventHandler(() => ({ ok: true }))
