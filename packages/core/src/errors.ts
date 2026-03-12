import type { ProblemDetails } from './types/index.js'

export const DDISA_ERROR_BASE = 'https://ddisa.org/errors/'
export const OPENAPE_ERROR_BASE = 'https://openape.org/errors/'

export function createProblemDetails(opts: {
  type?: string
  title: string
  status: number
  detail?: string
}): ProblemDetails {
  return {
    type: opts.type ?? 'about:blank',
    title: opts.title,
    status: opts.status,
    ...(opts.detail ? { detail: opts.detail } : {}),
  }
}

// --- DDISA errors (core.md §6.2) ---

export function invalidRecord(detail?: string): ProblemDetails {
  return createProblemDetails({ type: `${DDISA_ERROR_BASE}invalid_record`, title: 'Invalid DDISA record', status: 400, detail })
}

export function idpUnreachable(detail?: string): ProblemDetails {
  return createProblemDetails({ type: `${DDISA_ERROR_BASE}idp_unreachable`, title: 'IdP unreachable', status: 502, detail })
}

export function invalidManifest(detail?: string): ProblemDetails {
  return createProblemDetails({ type: `${DDISA_ERROR_BASE}invalid_manifest`, title: 'Invalid manifest', status: 400, detail })
}

export function invalidToken(detail?: string): ProblemDetails {
  return createProblemDetails({ type: `${DDISA_ERROR_BASE}invalid_token`, title: 'Invalid token', status: 401, detail })
}

export function tokenExpired(detail?: string): ProblemDetails {
  return createProblemDetails({ type: `${DDISA_ERROR_BASE}token_expired`, title: 'Token expired', status: 401, detail })
}

export function invalidAudience(detail?: string): ProblemDetails {
  return createProblemDetails({ type: `${DDISA_ERROR_BASE}invalid_audience`, title: 'Invalid audience', status: 403, detail })
}

export function invalidNonce(detail?: string): ProblemDetails {
  return createProblemDetails({ type: `${DDISA_ERROR_BASE}invalid_nonce`, title: 'Invalid nonce', status: 400, detail })
}

export function unsupportedAuthMethod(detail?: string): ProblemDetails {
  return createProblemDetails({ type: `${DDISA_ERROR_BASE}unsupported_auth_method`, title: 'Unsupported authentication method', status: 400, detail })
}

// --- OpenAPE errors (grants.md §9) ---

export function grantNotFound(detail?: string): ProblemDetails {
  return createProblemDetails({ type: `${OPENAPE_ERROR_BASE}grant_not_found`, title: 'Grant not found', status: 404, detail })
}

export function grantAlreadyDecided(detail?: string): ProblemDetails {
  return createProblemDetails({ type: `${OPENAPE_ERROR_BASE}grant_already_decided`, title: 'Grant already decided', status: 409, detail })
}

export function grantExpired(detail?: string): ProblemDetails {
  return createProblemDetails({ type: `${OPENAPE_ERROR_BASE}grant_expired`, title: 'Grant expired', status: 410, detail })
}

export function grantNotApproved(detail?: string): ProblemDetails {
  return createProblemDetails({ type: `${OPENAPE_ERROR_BASE}grant_not_approved`, title: 'Grant not approved', status: 403, detail })
}

export function grantAlreadyUsed(detail?: string): ProblemDetails {
  return createProblemDetails({ type: `${OPENAPE_ERROR_BASE}grant_already_used`, title: 'Grant already used', status: 409, detail })
}

export function invalidGrantType(detail?: string): ProblemDetails {
  return createProblemDetails({ type: `${OPENAPE_ERROR_BASE}invalid_grant_type`, title: 'Invalid grant type', status: 400, detail })
}

export function missingDuration(detail?: string): ProblemDetails {
  return createProblemDetails({ type: `${OPENAPE_ERROR_BASE}missing_duration`, title: 'Missing duration', status: 400, detail })
}

export function batchPartialFailure(detail?: string): ProblemDetails {
  return createProblemDetails({ type: `${OPENAPE_ERROR_BASE}batch_partial_failure`, title: 'Batch partial failure', status: 207, detail })
}

export function invalidAuthzJwt(detail?: string): ProblemDetails {
  return createProblemDetails({ type: `${OPENAPE_ERROR_BASE}invalid_authz_jwt`, title: 'Invalid authorization JWT', status: 401, detail })
}
