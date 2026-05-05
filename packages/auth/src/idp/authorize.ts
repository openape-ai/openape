import type { PolicyMode } from '@openape/core'
import type { AdminAllowlistStore, ConsentStore } from './stores.js'

export interface AuthorizeParams {
  client_id: string
  redirect_uri: string
  state: string
  code_challenge: string
  code_challenge_method: string
  nonce?: string
  response_type: string
  scope?: string
}

export interface AuthorizeResult {
  action: 'authenticate' | 'consent' | 'redirect'
  /** If action is 'redirect', this contains the redirect URL with code */
  redirectUrl?: string
  /** SP info for consent screen */
  spInfo?: { clientId: string, redirectUri: string }
  /** Stored params for after auth/consent */
  params: AuthorizeParams
}

/**
 * Validate an authorization request from an SP.
 */
export function validateAuthorizeRequest(params: AuthorizeParams): string | null {
  if (params.response_type !== 'code') {
    return 'Unsupported response_type. Must be "code".'
  }
  if (params.code_challenge_method !== 'S256') {
    return 'Unsupported code_challenge_method. Must be "S256".'
  }
  if (!params.client_id || !params.redirect_uri || !params.state || !params.code_challenge) {
    return 'Missing required parameters.'
  }
  return null
}

export interface EvaluatePolicyOptions {
  /**
   * Backing store for `mode=allowlist-admin`. When omitted, that
   * mode falls through to a hard deny — same as before this option
   * existed, preserving backward compat for callers that don't ship
   * an admin allowlist.
   */
  adminAllowlistStore?: AdminAllowlistStore
}

function extractDomain(userId: string): string {
  const at = userId.lastIndexOf('@')
  return at < 0 ? '' : userId.slice(at + 1).toLowerCase()
}

/**
 * Evaluate policy: should the user be prompted for consent?
 */
export async function evaluatePolicy(
  mode: PolicyMode | undefined,
  clientId: string,
  userId: string,
  consentStore: ConsentStore,
  options?: EvaluatePolicyOptions,
): Promise<'allow' | 'consent' | 'deny'> {
  switch (mode) {
    case 'open':
      return 'allow'
    case 'deny':
      return 'deny'
    case 'allowlist-user': {
      const hasConsent = await consentStore.hasConsent(userId, clientId)
      return hasConsent ? 'allow' : 'consent'
    }
    case 'allowlist-admin': {
      // Domain-owner-curated SP allowlist. Without a store wired up,
      // the safe answer is deny — the domain explicitly opted into
      // a strict mode and we shouldn't silently relax it.
      const store = options?.adminAllowlistStore
      if (!store) return 'deny'
      const userDomain = extractDomain(userId)
      if (!userDomain) return 'deny'
      const allowed = await store.isAllowed(userDomain, clientId)
      return allowed ? 'allow' : 'deny'
    }
    default:
      return 'consent'
  }
}
