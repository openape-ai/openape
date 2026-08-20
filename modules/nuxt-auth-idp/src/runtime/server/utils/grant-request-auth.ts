import { useRuntimeConfig } from 'nitropack/runtime'

/**
 * The grants spec (grants.md §5) requires a Bearer token on every grants-API
 * request; §3.4 binds `requester` to the authenticated identity. Enforcing
 * that is the default. The escape hatch exists for legacy deployments and
 * test fixtures whose clients cannot authenticate yet — never for prod.
 */
export function allowUnauthenticatedGrantRequests(): boolean {
  if (process.env.NUXT_OPENAPE_IDP_ALLOW_UNAUTH_GRANT_REQUESTS === '1') return true
  const idpConfig = useRuntimeConfig().openapeIdp as Record<string, unknown> | undefined
  return idpConfig?.allowUnauthenticatedGrantRequests === true
}
