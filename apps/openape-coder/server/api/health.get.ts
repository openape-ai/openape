// Deterministic liveness probe for container healthchecks (compose, deploy
// gate). Intentionally touches no auth and no database so it returns 200
// even before the DB is reachable or a session exists.
import { defineEventHandler } from 'h3'

export function healthPayload() {
  return { ok: true as const, service: 'openape-coder' as const }
}

export default defineEventHandler(() => healthPayload())
