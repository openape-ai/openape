import type { H3Event } from 'h3'
import { normalizeActClaim } from '@openape/core'
import { createError, getHeader, getMethod, useSession } from 'h3'
import { useRuntimeConfig } from 'nitropack/runtime'
import { verifyCliToken } from './cli-token'

export interface Caller {
  email: string
  act: 'human' | 'agent'
  /** Delegated scope subset; undefined = first-party (unrestricted). */
  scope?: string[]
}

interface CatalogScopeEntry {
  id: string
  grants?: string[]
}

/** The SP's published scope catalog (`openapeSp.manifest.scopes`), if any. */
function getCatalogScopes(): CatalogScopeEntry[] {
  const config = useRuntimeConfig()
  const raw = (config.openapeSp as unknown as { manifest?: { scopes?: CatalogScopeEntry[] } } | undefined)
    ?.manifest
    ?.scopes
  return Array.isArray(raw) ? raw : []
}

/**
 * Does a catalog grant like `POST /api/cockpit/agent/skill/:id` cover the
 * request? Method matches case-insensitively; path segments match exactly,
 * except `:param` / `[param]` segments, which match exactly one arbitrary
 * segment.
 */
function grantCoversRequest(grant: string, method: string, path: string): boolean {
  const [grantMethod, grantPath] = grant.trim().split(/\s+/)
  if (!grantMethod || !grantPath) return false
  if (grantMethod.toUpperCase() !== method) return false
  const grantSegments = grantPath.split('/').filter(Boolean)
  const pathSegments = path.split('/').filter(Boolean)
  if (grantSegments.length !== pathSegments.length) return false
  return grantSegments.every((segment, i) =>
    segment.startsWith(':') || (segment.startsWith('[') && segment.endsWith(']')) || segment === pathSegments[i])
}

/**
 * Scope enforcement chokepoint (sp-data-access.md §5.3). Throws 403 unless the
 * held scopes cover `METHOD path`. Exported so SPs whose own auth helpers
 * resolve the token themselves (troop's `requireOwner`) enforce the SAME rule
 * instead of a second, drifting one. Callers with no scope claim at all are
 * first-party and must not reach this.
 *
 * Catalog first, convention fallback (#1033, blocker found in #1047):
 *
 *   1. Exact catalog scope ids (`<sp>:<action>`) are the spec convention
 *      (sp-data-access.md §3.2). If any held scope's catalog entry declares a
 *      grant covering the current `METHOD + path`, the request passes.
 *   2. The `<prefix>:read|write` method convention is the older scheme and
 *      stays as fallback — for SPs without a catalog and for held scopes
 *      without a catalog entry — so read/write-pair SPs (tasks, timetrack)
 *      behave exactly as before.
 */
export function assertScopeCoversRequest(event: H3Event, scope: string[]): void {
  if (scope.length === 0) {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden', message: 'Delegated token carries no scope' })
  }
  const method = getMethod(event).toUpperCase()
  const path = event.path.split('?')[0]!

  const heldCatalogEntries = getCatalogScopes().filter(entry => scope.includes(entry.id))
  const catalogCovers = heldCatalogEntries.some(entry =>
    entry.grants?.some(grant => grantCoversRequest(grant, method, path)))
  if (catalogCovers) return

  const prefix = scope[0]!.split(':')[0]
  const needed = method === 'GET' || method === 'HEAD' ? `${prefix}:read` : `${prefix}:write`
  if (scope.includes(needed)) return

  throw createError({
    statusCode: 403,
    statusMessage: 'Forbidden',
    message: heldCatalogEntries.length > 0
      ? `Delegated token scopes (${scope.join(', ')}) do not cover ${method} ${path}: no catalog grant matches this route and conventional scope "${needed}" is not held`
      : `Delegated token lacks required scope "${needed}" for ${method} ${path} (has: ${scope.join(', ')})`,
  })
}

function enforceScope(event: H3Event, caller: Caller): Caller {
  if (!caller.scope) return caller
  assertScopeCoversRequest(event, caller.scope)
  return caller
}

interface SpSessionData {
  // @openape/nuxt-auth-sp stores DDISA assertion under `claims`
  claims?: {
    sub?: string
    email?: string
    act?: unknown
  }
}

/**
 * Authenticate the current request. Two paths:
 *
 *   1. Session cookie from @openape/nuxt-auth-sp (browser, after DDISA login).
 *      Cookie name is "openape-sp"; payload lives under `data.claims`.
 *   2. Bearer token (agent CLI) — verified against the DDISA-resolved IdP.
 *
 * Returns { email, act } or throws 401.
 */
export async function requireCaller(event: H3Event): Promise<Caller> {
  // 1. Try session cookie
  try {
    const config = useRuntimeConfig()
    const sessionSecret = (config.openapeSp as { sessionSecret?: string } | undefined)?.sessionSecret
    if (sessionSecret) {
      const session = await useSession<SpSessionData>(event, { name: 'openape-sp', password: sessionSecret })
      const claims = session.data?.claims
      const email = claims?.email ?? claims?.sub
      if (email) {
        return { email, act: normalizeActClaim(claims?.act) }
      }
    }
  }
  catch {
    // session unusable, fall through to bearer
  }

  // 2. Try bearer token — first as a locally-issued CLI token (fast, offline
  //    verify), then fall back to IdP-issued agent tokens (network round-trip).
  const authHeader = getHeader(event, 'authorization')
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice(7).trim()
    if (token) {
      const cli = await verifyCliToken(token)
      if (cli) return enforceScope(event, { email: cli.email, act: cli.act, scope: cli.scope })
      const verified = await verifyAgentToken(token)
      if (verified) return verified
    }
  }

  throw createError({ statusCode: 401, statusMessage: 'Unauthorized', message: 'Valid session or bearer token required' })
}

/**
 * Verify an agent bearer token by posting it to the issuing IdP's verify endpoint.
 * The IdP URL is derived from the token's `iss` claim via DDISA, or falls back to
 * the configured fallback IdP.
 */
async function verifyAgentToken(token: string): Promise<Caller | null> {
  try {
    const parts = token.split('.')
    if (parts.length !== 3) return null
    const payload = JSON.parse(Buffer.from(parts[1]!, 'base64url').toString('utf-8')) as {
      iss?: string
      sub?: string
      email?: string
      act?: unknown
      exp?: number
    }
    if (payload.exp && payload.exp * 1000 < Date.now()) return null

    const iss = payload.iss
    const config = useRuntimeConfig()
    const fallbackIdpUrl = (config.openapeSp as { fallbackIdpUrl?: string } | undefined)?.fallbackIdpUrl || 'https://id.openape.ai'
    const idpUrl = iss?.startsWith('https://') ? iss : fallbackIdpUrl

    // POST {idpUrl}/api/grants/verify — returns { valid: boolean, claims? }
    const result = await $fetch<{ valid: boolean, claims?: { sub?: string, email?: string, act?: unknown } }>(
      `${idpUrl}/api/grants/verify`,
      { method: 'POST', body: { token } },
    )
    if (!result.valid) return null
    const email = result.claims?.email ?? result.claims?.sub ?? payload.email ?? payload.sub
    if (!email) return null
    return {
      email,
      act: normalizeActClaim(result.claims?.act ?? payload.act),
    }
  }
  catch (err) {
    console.warn('[require-auth] bearer verify failed:', err)
    return null
  }
}
