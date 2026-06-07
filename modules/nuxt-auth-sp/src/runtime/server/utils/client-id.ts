/**
 * Resolve this SP's OAuth `client_id`.
 *
 * When an SP pins its identity (`openapeSp.clientId` /
 * `NUXT_OPENAPE_SP_CLIENT_ID`), that always wins. Otherwise the SP identifies
 * as its own request host — the DDISA model where an SP's identity IS its
 * domain. This lets dynamic preview hosts (e.g. `pr-123.preview.example.com`)
 * self-register without any per-deploy config: the published
 * `/.well-known/oauth-client-metadata` and the authorize `client_id` both
 * become the live host, so the IdP fetches and validates the right document.
 *
 * Kept dependency-free so it is unit-testable without the Nitro runtime.
 */
export function resolveClientId(configuredClientId: string, requestHost: string): string {
  return configuredClientId.trim() || requestHost
}
