// Deterministic liveness probe for the container healthcheck and the
// image deployer. Intentionally touches no auth and no database so it
// returns 200 even before Turso is reachable or a session exists —
// unlike `/`, which can render a login/redirect state. See
// docs/superpowers/specs/2026-06-05-troop-docker-deploy-design.md.
export function healthPayload() {
  return { ok: true as const, service: 'openape-troop' as const }
}

export default defineEventHandler(() => healthPayload())
