import { defineEventHandler } from 'h3'

/** GET /api/health — liveness probe for the container healthcheck. No auth, no DB. */
export default defineEventHandler(() => ({ ok: true }))
