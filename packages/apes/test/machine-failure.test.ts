import { describe, expect, it } from 'vitest'
import { ApiError } from '../src/http'
import { executionFailure } from '../src/authorization/machine-failure'
import { AuthorizationRefusedError, AuthorizationTimeoutError } from '../src/authorization/program'

describe('not-started failure classification', () => {
  it.each([408, 429, 500, 502, 503, 504])('preserves typed transient HTTP %s without copying private response details', (status) => {
    const failure = executionFailure(new ApiError(status, 'Private response body', undefined, 90000))
    expect(failure).toEqual({ kind: 'infrastructure', phase: 'authorization', status, retryAfterMs: 60000, detail: `HTTP ${status}` })
  })

  it.each(['missing', 'pending', 'denied', 'revoked', 'expired', 'used', 'withdrawn'])('preserves permission state %s without turning refusal into infrastructure', (state) => {
    expect(executionFailure(new AuthorizationRefusedError(state, 'grant-fixture'))).toEqual({ kind: 'permission', state, grantId: 'grant-fixture' })
  })

  it('reports an approval deadline as pending, independently of the message', () => {
    expect(executionFailure(new AuthorizationTimeoutError('grant-fixture', 1000))).toEqual({ kind: 'permission', state: 'pending', grantId: 'grant-fixture' })
    expect(executionFailure(new ApiError(404, 'Missing', { type: 'https://openape.org/errors/grant_not_found' }))).toEqual({ kind: 'permission', state: 'missing' })
  })

  it('classifies known transport failures but leaves generic HTTP text and untrusted objects conservative', () => {
    expect(executionFailure(new TypeError('fetch failed', { cause: { code: 'ECONNRESET' } }))).toEqual({ kind: 'infrastructure', phase: 'authorization', retryAfterMs: 0 })
    for (const error of [new Error('Broker service returned HTTP 502'), new Error('Command token does not match this program file'), new ApiError(401, 'Expired'), new ApiError(403, 'Denied'), new ApiError(404, 'Unknown endpoint'), new ApiError(409, 'Conflict'), { code: 'ECONNRESET' }]) expect(executionFailure(error)).toBeUndefined()
  })
})
