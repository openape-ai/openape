import { describe, expect, it } from 'vitest'
import {
  batchPartialFailure,
  createProblemDetails,
  DDISA_ERROR_BASE,
  grantAlreadyDecided,
  grantAlreadyUsed,
  grantExpired,
  grantNotApproved,
  grantNotFound,
  idpUnreachable,
  invalidAudience,
  invalidAuthzJwt,
  invalidGrantType,
  invalidManifest,
  invalidNonce,
  invalidPkce,
  invalidRecord,
  invalidState,
  invalidToken,
  missingDuration,
  OPENAPE_ERROR_BASE,
  policyDenied,
  tokenExpired,
  unsupportedAuthMethod,
} from '../errors.js'

describe('createProblemDetails', () => {
  it('creates problem details with all fields', () => {
    const result = createProblemDetails({
      type: 'https://example.com/error',
      title: 'Test Error',
      status: 400,
      detail: 'Something went wrong',
    })
    expect(result).toEqual({
      type: 'https://example.com/error',
      title: 'Test Error',
      status: 400,
      detail: 'Something went wrong',
    })
  })

  it('defaults type to about:blank and omits detail when not provided', () => {
    const result = createProblemDetails({ title: 'Test', status: 500 })
    expect(result.type).toBe('about:blank')
    expect(result).not.toHaveProperty('detail')
  })
})

describe('error factories', () => {
  const allFactories: Array<{
    fn: (detail?: string) => ReturnType<typeof createProblemDetails>
    base: string
    slug: string
    title: string
    status: number
  }> = [
    { fn: invalidRecord, base: DDISA_ERROR_BASE, slug: 'invalid_record', title: 'Invalid DDISA record', status: 400 },
    { fn: idpUnreachable, base: DDISA_ERROR_BASE, slug: 'idp_unreachable', title: 'IdP unreachable', status: 502 },
    { fn: invalidManifest, base: DDISA_ERROR_BASE, slug: 'invalid_manifest', title: 'Invalid manifest', status: 400 },
    { fn: invalidToken, base: DDISA_ERROR_BASE, slug: 'invalid_token', title: 'Invalid token', status: 401 },
    { fn: tokenExpired, base: DDISA_ERROR_BASE, slug: 'token_expired', title: 'Token expired', status: 401 },
    { fn: invalidAudience, base: DDISA_ERROR_BASE, slug: 'invalid_audience', title: 'Invalid audience', status: 401 },
    { fn: invalidNonce, base: DDISA_ERROR_BASE, slug: 'invalid_nonce', title: 'Invalid nonce', status: 401 },
    { fn: unsupportedAuthMethod, base: DDISA_ERROR_BASE, slug: 'unsupported_auth_method', title: 'Unsupported authentication method', status: 400 },
    { fn: policyDenied, base: DDISA_ERROR_BASE, slug: 'policy_denied', title: 'Policy denied', status: 403 },
    { fn: invalidPkce, base: DDISA_ERROR_BASE, slug: 'invalid_pkce', title: 'Invalid PKCE', status: 400 },
    { fn: invalidState, base: DDISA_ERROR_BASE, slug: 'invalid_state', title: 'Invalid state', status: 400 },
    { fn: grantNotFound, base: OPENAPE_ERROR_BASE, slug: 'grant_not_found', title: 'Grant not found', status: 404 },
    { fn: grantAlreadyDecided, base: OPENAPE_ERROR_BASE, slug: 'grant_already_decided', title: 'Grant already decided', status: 409 },
    { fn: grantExpired, base: OPENAPE_ERROR_BASE, slug: 'grant_expired', title: 'Grant expired', status: 410 },
    { fn: grantNotApproved, base: OPENAPE_ERROR_BASE, slug: 'grant_not_approved', title: 'Grant not approved', status: 400 },
    { fn: grantAlreadyUsed, base: OPENAPE_ERROR_BASE, slug: 'grant_already_used', title: 'Grant already used', status: 410 },
    { fn: invalidGrantType, base: OPENAPE_ERROR_BASE, slug: 'invalid_grant_type', title: 'Invalid grant type', status: 400 },
    { fn: missingDuration, base: OPENAPE_ERROR_BASE, slug: 'missing_duration', title: 'Missing duration', status: 400 },
    { fn: batchPartialFailure, base: OPENAPE_ERROR_BASE, slug: 'batch_partial_failure', title: 'Batch partial failure', status: 207 },
    { fn: invalidAuthzJwt, base: OPENAPE_ERROR_BASE, slug: 'invalid_authz_jwt', title: 'Invalid authorization JWT', status: 401 },
  ]

  it('all factories return correct type, title, status and pass through detail', () => {
    for (const { fn, base, slug, title, status } of allFactories) {
      const without = fn()
      expect(without).toEqual({ type: `${base}${slug}`, title, status })

      const withDetail = fn('extra')
      expect(withDetail).toEqual({ type: `${base}${slug}`, title, status, detail: 'extra' })
    }
  })
})
