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

  it('defaults type to about:blank when not provided', () => {
    const result = createProblemDetails({
      title: 'Test',
      status: 500,
    })
    expect(result.type).toBe('about:blank')
  })

  it('omits detail when not provided', () => {
    const result = createProblemDetails({
      title: 'Test',
      status: 500,
    })
    expect(result).not.toHaveProperty('detail')
  })
})

describe('DDISA error factories', () => {
  const ddisaErrors: Array<{
    fn: (detail?: string) => ReturnType<typeof createProblemDetails>
    name: string
    title: string
    status: number
    errorSlug: string
  }> = [
    { fn: invalidRecord, name: 'invalidRecord', title: 'Invalid DDISA record', status: 400, errorSlug: 'invalid_record' },
    { fn: idpUnreachable, name: 'idpUnreachable', title: 'IdP unreachable', status: 502, errorSlug: 'idp_unreachable' },
    { fn: invalidManifest, name: 'invalidManifest', title: 'Invalid manifest', status: 400, errorSlug: 'invalid_manifest' },
    { fn: invalidToken, name: 'invalidToken', title: 'Invalid token', status: 401, errorSlug: 'invalid_token' },
    { fn: tokenExpired, name: 'tokenExpired', title: 'Token expired', status: 401, errorSlug: 'token_expired' },
    { fn: invalidAudience, name: 'invalidAudience', title: 'Invalid audience', status: 401, errorSlug: 'invalid_audience' },
    { fn: invalidNonce, name: 'invalidNonce', title: 'Invalid nonce', status: 401, errorSlug: 'invalid_nonce' },
    { fn: unsupportedAuthMethod, name: 'unsupportedAuthMethod', title: 'Unsupported authentication method', status: 400, errorSlug: 'unsupported_auth_method' },
    { fn: policyDenied, name: 'policyDenied', title: 'Policy denied', status: 403, errorSlug: 'policy_denied' },
    { fn: invalidPkce, name: 'invalidPkce', title: 'Invalid PKCE', status: 400, errorSlug: 'invalid_pkce' },
    { fn: invalidState, name: 'invalidState', title: 'Invalid state', status: 400, errorSlug: 'invalid_state' },
  ]

  for (const { fn, name, title, status, errorSlug } of ddisaErrors) {
    describe(name, () => {
      it('returns correct type, title, and status without detail', () => {
        const result = fn()
        expect(result).toEqual({
          type: `${DDISA_ERROR_BASE}${errorSlug}`,
          title,
          status,
        })
      })

      it('includes detail when provided', () => {
        const result = fn('extra info')
        expect(result).toEqual({
          type: `${DDISA_ERROR_BASE}${errorSlug}`,
          title,
          status,
          detail: 'extra info',
        })
      })
    })
  }
})

describe('OpenApe error factories', () => {
  const openapeErrors: Array<{
    fn: (detail?: string) => ReturnType<typeof createProblemDetails>
    name: string
    title: string
    status: number
    errorSlug: string
  }> = [
    { fn: grantNotFound, name: 'grantNotFound', title: 'Grant not found', status: 404, errorSlug: 'grant_not_found' },
    { fn: grantAlreadyDecided, name: 'grantAlreadyDecided', title: 'Grant already decided', status: 409, errorSlug: 'grant_already_decided' },
    { fn: grantExpired, name: 'grantExpired', title: 'Grant expired', status: 410, errorSlug: 'grant_expired' },
    { fn: grantNotApproved, name: 'grantNotApproved', title: 'Grant not approved', status: 400, errorSlug: 'grant_not_approved' },
    { fn: grantAlreadyUsed, name: 'grantAlreadyUsed', title: 'Grant already used', status: 410, errorSlug: 'grant_already_used' },
    { fn: invalidGrantType, name: 'invalidGrantType', title: 'Invalid grant type', status: 400, errorSlug: 'invalid_grant_type' },
    { fn: missingDuration, name: 'missingDuration', title: 'Missing duration', status: 400, errorSlug: 'missing_duration' },
    { fn: batchPartialFailure, name: 'batchPartialFailure', title: 'Batch partial failure', status: 207, errorSlug: 'batch_partial_failure' },
    { fn: invalidAuthzJwt, name: 'invalidAuthzJwt', title: 'Invalid authorization JWT', status: 401, errorSlug: 'invalid_authz_jwt' },
  ]

  for (const { fn, name, title, status, errorSlug } of openapeErrors) {
    describe(name, () => {
      it('returns correct type, title, and status without detail', () => {
        const result = fn()
        expect(result).toEqual({
          type: `${OPENAPE_ERROR_BASE}${errorSlug}`,
          title,
          status,
        })
      })

      it('includes detail when provided', () => {
        const result = fn('extra info')
        expect(result).toEqual({
          type: `${OPENAPE_ERROR_BASE}${errorSlug}`,
          title,
          status,
          detail: 'extra info',
        })
      })
    })
  }
})
