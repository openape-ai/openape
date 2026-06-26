import type { H3Event } from 'h3'
import { createError, getHeader, getMethod, useSession } from 'h3'
import { useRuntimeConfig } from 'nitropack/runtime'
import { verifyTestrunCliToken } from './cli-token'

export interface Caller {
  email: string
  act: 'human' | 'agent'
  /** Delegated scope subset; undefined = first-party (unrestricted). */
  scope?: string[]
}

/**
 * Scope enforcement chokepoint (sp-data-access.md §5.3). Only delegated
 * tokens carry `scope`; first-party callers pass through unchanged. Method
 * → required scope: GET/HEAD → `<prefix>:read`, mutating → `<prefix>:write`.
 */
function enforceScope(event: H3Event, caller: Caller): Caller {
  if (!caller.scope) return caller
  if (caller.scope.length === 0) {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden', message: 'Delegated token carries no scope' })
  }
  const prefix = caller.scope[0]!.split(':')[0]
  const method = getMethod(event).toUpperCase()
  const needed = method === 'GET' || method === 'HEAD' ? `${prefix}:read` : `${prefix}:write`
  if (!caller.scope.includes(needed)) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Forbidden',
      message: `Delegated token lacks required scope "${needed}" (has: ${caller.scope.join(', ')})`,
    })
  }
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
        return { email, act: normalizeAct(claims?.act) }
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
      const cli = await verifyTestrunCliToken(token)
      if (cli) return enforceScope(event, { email: cli.email, act: cli.act, scope: cli.scope })
      const verified = await verifyAgentToken(token)
      if (verified) return verified
    }
  }

  throw createError({ statusCode: 401, statusMessage: 'Unauthorized', message: 'Valid session or bearer token required' })
}

function normalizeAct(raw: unknown): 'human' | 'agent' {
  // DDISA `act` can be a string OR a nested object (delegation chain).
  // When nested (agent acting for human), treat caller as agent.
  if (raw === 'agent') return 'agent'
  if (typeof raw === 'object' && raw !== null) return 'agent'
  return 'human'
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
      act?: string
      exp?: number
    }
    if (payload.exp && payload.exp * 1000 < Date.now()) return null

    const iss = payload.iss
    const config = useRuntimeConfig()
    const fallbackIdpUrl = (config.openapeSp as { fallbackIdpUrl?: string } | undefined)?.fallbackIdpUrl || 'https://id.openape.ai'
    const idpUrl = iss?.startsWith('https://') ? iss : fallbackIdpUrl

    // POST {idpUrl}/api/grants/verify — returns { valid: boolean, claims? }
    const result = await $fetch<{ valid: boolean, claims?: { sub?: string, email?: string, act?: string } }>(
      `${idpUrl}/api/grants/verify`,
      { method: 'POST', body: { token } },
    )
    if (!result.valid) return null
    const email = result.claims?.email ?? result.claims?.sub ?? payload.email ?? payload.sub
    if (!email) return null
    return {
      email,
      act: (result.claims?.act as 'human' | 'agent' | undefined) ?? (payload.act as 'human' | 'agent' | undefined) ?? 'agent',
    }
  }
  catch (err) {
    console.warn('[require-auth] bearer verify failed:', err)
    return null
  }
}
