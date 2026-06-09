// Deterministic liveness probe for container healthchecks (compose, Coolify)
// and deployers. Intentionally touches no auth and no database so it returns
// 200 even before the DB is reachable or a session exists — unlike `/`,
// which can render a login/redirect state.
import { defineEventHandler } from 'h3'

export function healthPayload() {
  return { ok: true as const, service: 'openape-org' as const }
}

export default defineEventHandler(() => healthPayload())
