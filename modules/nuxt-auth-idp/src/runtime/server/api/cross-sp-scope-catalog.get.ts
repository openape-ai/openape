import { createError, defineEventHandler, getQuery } from 'h3'

// GET /api/cross-sp-scope-catalog?audience=<sp-domain>
//
// Server-side proxy: fetches the Provider SP's
// `/.well-known/openape.json` and returns its `scopes` array. The
// consent page (M4γ) calls this from the Owner's browser when
// rendering the cross-SP delegation card so we don't need CORS on
// every Provider — and we can validate the response shape before
// rendering anything user-facing.
//
// Trust model: this endpoint runs on the User's own IdP (the
// delegator's trust anchor). The Provider is whatever the delegator's
// Receiver SP asks for; we DO NOT allowlist Providers here because
// the User decides who to delegate to. The Provider's
// `/.well-known/openape.json` is publicly discoverable per spec —
// no auth required.
//
// Failure modes surface to the page as 4xx with a short detail:
//   - 400 missing/invalid audience
//   - 502 Provider unreachable / non-2xx
//   - 502 catalog malformed (missing `scopes` array, wrong shape)

interface ScopeEntry {
  id: string
  description: string
  grants?: string[]
}

interface ProviderManifest {
  scopes?: unknown
  service?: { name?: string }
}

function isValidScope(s: unknown): s is ScopeEntry {
  return !!s && typeof s === 'object'
    && typeof (s as Record<string, unknown>).id === 'string'
    && typeof (s as Record<string, unknown>).description === 'string'
}

export default defineEventHandler(async (event) => {
  const q = getQuery(event)
  const audience = String(q.audience ?? '').trim()
  if (!audience) throw createError({ statusCode: 400, statusMessage: 'audience required' })

  // Accept either bare domain ('troop.openape.ai') or full URL. Normalize
  // to https://<host>/.well-known/openape.json.
  let url: URL
  try {
    url = new URL(audience.includes('://') ? audience : `https://${audience}`)
  }
  catch {
    throw createError({ statusCode: 400, statusMessage: 'audience must be a valid host or URL' })
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw createError({ statusCode: 400, statusMessage: 'audience must be http(s)' })
  }
  url.pathname = '/.well-known/openape.json'
  url.search = ''

  let manifest: ProviderManifest
  try {
    manifest = await $fetch<ProviderManifest>(url.toString(), {
      timeout: 5_000,
      // Cache for 5 min — scope catalogs change rarely. CDN-friendly.
      headers: { Accept: 'application/json' },
    })
  }
  catch (err: any) {
    throw createError({
      statusCode: 502,
      statusMessage: `provider ${url.host} unreachable: ${err?.message ?? 'unknown'}`,
    })
  }

  if (!Array.isArray(manifest.scopes)) {
    throw createError({
      statusCode: 502,
      statusMessage: `provider ${url.host} publishes no scopes array at ${url.pathname}`,
    })
  }
  const scopes = manifest.scopes.filter(isValidScope)
  return {
    audience: url.host,
    service_name: manifest.service?.name ?? url.host,
    scopes,
  }
})
