import { ofetch } from 'ofetch'

/**
 * SP client metadata as defined by DDISA core.md §4 (RFC 7591 subset).
 * Only the fields the IdP actually consumes during /authorize are
 * modelled here — additional fields like `client_uri`, `logo_uri`,
 * `contacts` etc. are tolerated but ignored.
 */
export interface ClientMetadata {
  client_id: string
  client_name?: string
  redirect_uris: string[]
  jwks_uri?: string
  /** RFC 7591 §2 — homepage / description URL. Used by consent UIs. */
  client_uri?: string
  /** RFC 7591 §2 — logo for the consent UI. */
  logo_uri?: string
  /** RFC 7591 §2 — privacy policy link. */
  policy_uri?: string
  /** RFC 7591 §2 — terms-of-service link. */
  tos_uri?: string
  /** RFC 7591 §2 — admin contact emails. */
  contacts?: string[]
}

export interface ClientMetadataStore {
  /** Resolve a SP's metadata. `null` if the SP doesn't publish any. */
  resolve: (clientId: string) => Promise<ClientMetadata | null>
}

/**
 * Configuration for {@link createClientMetadataResolver}.
 */
export interface ClientMetadataResolverOptions {
  /**
   * Cache TTL for resolved metadata (ms). Defaults to 300s (5min),
   * mirroring the DDISA DNS cache default. Operators may want to
   * lower this for SPs that rotate redirect_uris frequently.
   */
  cacheTtlMs?: number
  /**
   * Pre-registered "public clients" — native apps without a domain
   * (RFC 8252). Their client_id is a flat name (e.g. `apes-cli`) and
   * their redirect_uris are typically loopback HTTP URIs or custom
   * URI schemes. Per DDISA core.md §4.3 the spec doesn't explicitly
   * cover native CLIs; we treat them as `client_id`s without a `.`
   * and look them up in this static map first.
   */
  publicClients?: Record<string, ClientMetadata>
  /**
   * Custom fetch implementation — exists for tests + for any IdP
   * that needs to stub the HTTP call (e.g. Vercel edge restrictions).
   */
  fetchImpl?: (url: string) => Promise<unknown>
}

const WELL_KNOWN_PRIMARY = '/.well-known/oauth-client-metadata'
const WELL_KNOWN_LEGACY = '/.well-known/sp-manifest.json'

// Caps on SP-supplied display strings. SPs that exceed these are
// almost always either misconfigured or attempting UI-disruption /
// XSS-via-length attacks against IdP consent screens. We trim
// silently rather than reject the whole metadata so a single oversize
// field doesn't lock out an otherwise-valid SP.
const MAX_DISPLAY_NAME = 200
const MAX_URL = 2000

// Schemes accepted in URL fields fetched from SP metadata. Anything
// else (`javascript:`, `data:`, `vbscript:`, `file:`, …) is silently
// dropped. The IdP's consent UI binds these to `:href` / `:src`, so
// allowing `javascript:` here is a direct XSS-on-click vector. `http:`
// is permitted only because some SPs run plain HTTP in dev — the
// reference UI may further restrict to `https:` only at render time.
const SAFE_URL_SCHEMES = new Set(['https:', 'http:'])

function sanitizeShortString(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  if (trimmed.length === 0) return undefined
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed
}

function sanitizeHttpUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  if (value.length > MAX_URL) return undefined
  let parsed: URL
  try { parsed = new URL(value) }
  catch { return undefined }
  if (!SAFE_URL_SCHEMES.has(parsed.protocol)) return undefined
  return parsed.toString()
}

/**
 * Strip SP-controlled metadata down to a known-safe shape. The
 * resolver runs this on every fetched document so downstream
 * consumers (consent UI, admin views) can render the fields without
 * having to remember which ones came from an untrusted source.
 *
 * Rules:
 *   - `client_id` and `redirect_uris` are NOT touched here — the
 *     caller has already type-validated them via `isValidMetadata`,
 *     and `redirect_uri` matching is exact-equality so we mustn't
 *     normalize away a trailing slash etc.
 *   - All display strings are length-capped.
 *   - All URL fields must parse as `http(s):` — no `javascript:`,
 *     `data:`, etc. Invalid → field is dropped.
 *   - `contacts` is filtered to string entries only.
 */
function sanitizeMetadata(raw: ClientMetadata): ClientMetadata {
  return {
    client_id: raw.client_id,
    redirect_uris: raw.redirect_uris,
    client_name: sanitizeShortString(raw.client_name, MAX_DISPLAY_NAME),
    client_uri: sanitizeHttpUrl(raw.client_uri),
    logo_uri: sanitizeHttpUrl(raw.logo_uri),
    policy_uri: sanitizeHttpUrl(raw.policy_uri),
    tos_uri: sanitizeHttpUrl(raw.tos_uri),
    jwks_uri: sanitizeHttpUrl(raw.jwks_uri),
    contacts: Array.isArray(raw.contacts)
      ? raw.contacts.filter((c): c is string => typeof c === 'string').map(c => c.slice(0, MAX_DISPLAY_NAME))
      : undefined,
  }
}

interface CacheEntry {
  metadata: ClientMetadata | null
  expiresAt: number
}

/**
 * Build a resolver that fetches and caches SP client metadata per
 * DDISA core.md §4.1. The IdP's `validateAuthorizeRequest` consults
 * this to enforce that `redirect_uri` was pre-registered by the SP
 * itself (the SP — not the IdP — is the source of truth for its own
 * allowed redirect targets).
 *
 * Returns:
 *   - the parsed metadata when the SP publishes a usable document
 *   - `null` when the SP publishes nothing or the document is malformed
 *
 * The caller decides what `null` means (strict-mode fail-closed vs.
 * permissive-mode warn-only) — see {@link ClientMetadataMode}.
 */
export function createClientMetadataResolver(
  opts: ClientMetadataResolverOptions = {},
): ClientMetadataStore {
  const cache = new Map<string, CacheEntry>()
  const ttl = opts.cacheTtlMs ?? 300_000
  const publicClients = opts.publicClients ?? {}
  const fetchImpl = opts.fetchImpl ?? (async (url: string) => await ofetch(url, { responseType: 'json' }))

  function looksLikeHostname(clientId: string): boolean {
    // RFC 7591 leaves `client_id` opaque; DDISA core.md §4.3 says
    // "Typically the SP's domain name. MUST be OIDC-compatible."
    // We use the presence of a `.` and parsability as a URL host as
    // the discriminator: hostname-y client_ids get the well-known
    // fetch, flat names go through the public-client map.
    if (!clientId.includes('.')) return false
    return URL.canParse(`https://${clientId}/`)
  }

  async function fetchOne(url: string): Promise<unknown | null> {
    try {
      return await fetchImpl(url)
    }
    catch {
      return null
    }
  }

  function isValidMetadata(value: unknown): value is ClientMetadata {
    if (!value || typeof value !== 'object') return false
    const obj = value as Record<string, unknown>
    if (typeof obj.client_id !== 'string') return false
    if (!Array.isArray(obj.redirect_uris)) return false
    if (!obj.redirect_uris.every(u => typeof u === 'string')) return false
    return true
  }

  async function fetchMetadata(clientId: string): Promise<ClientMetadata | null> {
    const base = `https://${clientId}`
    // Primary path per current DDISA spec (§4.1). Legacy path is the
    // pre-1.0 convention — kept as fallback per the migration note.
    const candidates = [base + WELL_KNOWN_PRIMARY, base + WELL_KNOWN_LEGACY]
    for (const url of candidates) {
      const raw = await fetchOne(url)
      if (raw && isValidMetadata(raw)) return sanitizeMetadata(raw)
    }
    return null
  }

  return {
    async resolve(clientId: string): Promise<ClientMetadata | null> {
      const now = Date.now()

      const cached = cache.get(clientId)
      if (cached && cached.expiresAt > now) return cached.metadata

      // Public-client (CLI / native app) shortcut — no network call.
      if (!looksLikeHostname(clientId)) {
        const raw = publicClients[clientId]
        const fixed = raw ? sanitizeMetadata(raw) : null
        cache.set(clientId, { metadata: fixed, expiresAt: now + ttl })
        return fixed
      }

      const fetched = await fetchMetadata(clientId)
      cache.set(clientId, { metadata: fetched, expiresAt: now + ttl })
      return fetched
    },
  }
}

/**
 * Configurable enforcement mode for redirect_uri validation.
 *
 *   - `strict`: an unresolvable SP metadata or a non-matching redirect
 *     URI is a hard error. Use in production once all known SPs
 *     publish their `.well-known/oauth-client-metadata`.
 *   - `permissive`: warn-log and pass through. Use during the
 *     transition window so existing flows don't break before SPs
 *     have published their metadata.
 *
 * Defaults to `permissive` to keep the upgrade path soft. See #280.
 */
export type ClientMetadataMode = 'strict' | 'permissive'

/**
 * Validate that the request's `redirect_uri` is one the SP has pre-
 * registered in its published metadata, per DDISA core.md §5.2.1.
 *
 * Strict equality matching, per OAuth 2.0 Security BCP — no path
 * prefixes, no wildcards. SPs needing multiple callbacks list each
 * one explicitly in `redirect_uris`.
 *
 * Returns `null` when the URI is acceptable, or an error object
 * suitable for `400 invalid_request` when not.
 */
export async function validateRedirectUri(
  clientId: string,
  redirectUri: string,
  store: ClientMetadataStore,
  mode: ClientMetadataMode = 'permissive',
): Promise<{ error: string, detail?: string } | null> {
  const metadata = await store.resolve(clientId)
  if (!metadata) {
    if (mode === 'strict') {
      return {
        error: 'invalid_client',
        detail: `Could not resolve SP metadata at /.well-known/oauth-client-metadata for client_id=${clientId}`,
      }
    }
    return null
  }

  if (!metadata.redirect_uris.includes(redirectUri)) {
    return {
      error: 'invalid_request',
      detail: `redirect_uri ${redirectUri} is not registered in SP metadata for client_id=${clientId}`,
    }
  }

  return null
}
