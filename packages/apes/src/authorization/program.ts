import type { BrokeredGrant, OpenApeAuthZClaims, OpenApeGrantBatch, OpenApeGrantSummary } from '@openape/core'
import { computeArgvHash, sameBrokeredGrant, verifyAuthzJWT } from '@openape/grants'
import { ApiError, apiFetch, discoverEndpoints, getGrantsEndpoint } from '../http.js'
import { GRANT_WAIT_MS } from '../shapes/grants.js'
import { createWaitProgressReporter } from '../wait-progress.js'
import { bindProgramCall } from './program-files.js'
import type { ProgramFile } from './program-files.js'
import { loadAuth } from '../config.js'

export { locateProgram, findExecutable, hashFile } from './program-location.js'

/**
 * Per-call program authorization at the IdP (issue 1473, revision 4). apes sends the exact command and the hash of
 * the program file; the IdP alone resolves it with Shapes and answers approved (with a command token), pending or
 * denied. apes never reads local adapter files.
 */

export interface LocatedProgram {
  /** The file that runs: the real path (symlinks resolved) of the PATH lookup result or the given path. */
  path: string
  /** The path as found (PATH lookup or given), passed as argv[0] so programs that look at their name still work. */
  argv0: string
  /** Basename of `argv0`, the program name the IdP selects a shape by. */
  name: string
  /** Lowercase hex SHA-256 of the file. */
  sha256: string
}

export interface ProgramCall {
  program: LocatedProgram
  /** Arguments without the executable, exactly as executed. */
  argv: string[]
  files?: ProgramFile[]
}

export type GrantType = 'once' | 'always'

export interface AuthorizationRequest {
  idp: string
  targetHost: string
  grantType: GrantType
  summary?: OpenApeGrantSummary
  batch?: OpenApeGrantBatch
  reference?: string
}

export type AuthorizeAnswer =
  | { state: 'approved', grantId: string, token: string, expiresAt: number }
  | { state: 'pending', grantId: string, approvalUrl: string }
  | { state: 'denied' | 'revoked' | 'expired' | 'used' | 'withdrawn', grantId: string }

export interface ProgramTokenClaims extends OpenApeAuthZClaims {
  argv_hash: string
  program_sha256: string
}

export type ProgramAuthorization =
  | { kind: 'authorized', grantId: string, token: string, claims: ProgramTokenClaims }
  | { kind: 'pending', grantId: string, approvalUrl: string }

export class AuthorizationRefusedError extends Error {
  constructor(public state: string, public grantId: string) {
    super(`Grant ${grantId} ${state}`)
    this.name = 'AuthorizationRefusedError'
  }
}

export class AuthorizationTimeoutError extends Error {
  constructor(public grantId: string, waitMs: number) {
    super(`Grant ${grantId} approval timed out after ${Math.round(waitMs / 1000)} s; nothing was executed`)
    this.name = 'AuthorizationTimeoutError'
  }
}

/** The argv the IdP resolves and hashes: the program name followed by the arguments. */
export function executionArgv(call: ProgramCall): string[] {
  return [call.program.name, ...call.argv]
}

function issuerOf(idp: string): string {
  return idp.replace(/\/+$/, '')
}

function parseAnswer(body: Record<string, unknown>): AuthorizeAnswer {
  const grantId = body.grant_id
  if (typeof grantId !== 'string' || !grantId) throw new Error('Authorization answer is missing grant_id')
  if (body.state === 'approved' && typeof body.authz_jwt === 'string' && typeof body.expires_at === 'number')
    return { state: 'approved', grantId, token: body.authz_jwt, expiresAt: body.expires_at }
  if (body.state === 'pending' && typeof body.approval_url === 'string')
    return { state: 'pending', grantId, approvalUrl: body.approval_url }
  throw new Error(`Unrecognized authorization answer: ${String(body.state)}`)
}

async function authorizationEndpoint(issuer: string, reference?: string): Promise<string> {
  const discovery = await discoverEndpoints(issuer)
  if (reference !== undefined && discovery.openape_grant_reference_supported !== true) throw new Error('The IdP does not support grant references')
  return (discovery.openape_program_authorization_endpoint as string | undefined) ?? `${issuer}/api/grants/authorize`
}

/** One `POST /api/grants/authorize` round trip. */
export async function requestAuthorization(call: ProgramCall, request: AuthorizationRequest): Promise<AuthorizeAnswer> {
  const issuer = issuerOf(request.idp)
  try {
    const body = await apiFetch<Record<string, unknown>>(await authorizationEndpoint(issuer, request.reference), {
      method: 'POST',
      idp: issuer,
      body: {
        target_host: request.targetHost,
        audience: 'shapes',
        program: { name: call.program.name, sha256: call.program.sha256 },
        argv: call.argv,
        ...(call.files?.length ? { files: call.files } : {}),
        grant_type: request.grantType,
        ...(request.summary ? { summary: request.summary } : {}),
        ...(request.batch ? { batch: request.batch } : {}),
        ...(request.reference !== undefined ? { reference: request.reference } : {}),
      },
    })
    return parseAnswer(body)
  }
  catch (error) {
    const refusal = error instanceof ApiError && error.statusCode === 403 ? error.problemDetails : undefined
    if (refusal && (refusal.state === 'denied' || refusal.state === 'revoked' || refusal.state === 'expired' || refusal.state === 'used' || refusal.state === 'withdrawn') && typeof refusal.grant_id === 'string')
      return { state: refusal.state, grantId: refusal.grant_id }
    throw error
  }
}

/**
 * Checks a command token before anything runs: signature by the IdP's keys, issuer, audience, subject, target
 * host, the argv hash of the exact command and the hash of the file that will run.
 */
export async function verifyProgramToken(
  token: string,
  binding: { idp: string, subject: string, targetHost: string, call: ProgramCall, brokered?: BrokeredGrant },
): Promise<ProgramTokenClaims> {
  const issuer = issuerOf(binding.idp)
  const result = await verifyAuthzJWT(token, {
    expectedIss: issuer,
    expectedAud: 'shapes',
    jwksUri: `${issuer}/.well-known/jwks.json`,
  })
  if (!result.valid || !result.claims) throw new Error(`Command token rejected: ${result.error ?? 'invalid token'}`)
  const claims = result.claims as ProgramTokenClaims
  if (claims.sub !== binding.subject) throw new Error('Command token was issued to another identity')
  if (claims.target_host !== binding.targetHost) throw new Error('Command token is for another host')
  if (claims.argv_hash !== await computeArgvHash(executionArgv(binding.call))) throw new Error('Command token does not match this command')
  if (claims.program_sha256 !== binding.call.program.sha256) throw new Error('Command token does not match this program file')
  if (JSON.stringify(claims.execution_context?.files ?? []) !== JSON.stringify(binding.call.files ?? [])) throw new Error('Command token does not match the script content')
  if (claims.run_as !== undefined) throw new Error('Program authorization cannot change the execution user')
  if (!sameBrokeredGrant(claims.brokered, binding.brokered) || (binding.brokered && claims.decided_by !== binding.brokered.owner)) throw new Error('Command token does not match the brokered owner identity')
  return claims
}

type Decision = 'approved' | 'denied' | 'revoked' | 'used' | 'expired' | 'withdrawn'
const DECISIONS = new Set<string>(['approved', 'denied', 'revoked', 'used', 'expired', 'withdrawn'])

/** Polls `GET /api/grants/{id}` until the grant is decided; running out of time throws. */
export async function waitForDecision(idp: string, grantId: string, waitMs: number, intervalMs: number): Promise<Decision> {
  const grantsEndpoint = await getGrantsEndpoint(issuerOf(idp))
  const deadline = Date.now() + waitMs
  const reportProgress = createWaitProgressReporter(grantId)
  while (Date.now() < deadline) {
    const grant = await apiFetch<{ status: string }>(`${grantsEndpoint}/${encodeURIComponent(grantId)}`, { idp })
    if (DECISIONS.has(grant.status)) return grant.status as Decision
    reportProgress()
    await new Promise(resolve => setTimeout(resolve, Math.max(0, Math.min(intervalMs, deadline - Date.now()))))
  }
  throw new AuthorizationTimeoutError(grantId, waitMs)
}

/**
 * The IdP issues a token for an approved single-use grant on every authorize call until the grant is consumed, so
 * apes consumes it before the command runs (as for every grant token before); anything but `consumed` refuses.
 */
async function consumeSingleUseGrant(idp: string, grantId: string, token: string): Promise<void> {
  const grantsEndpoint = await getGrantsEndpoint(issuerOf(idp))
  const response = await fetch(`${grantsEndpoint}/${encodeURIComponent(grantId)}/consume`, {
    method: 'POST',
    redirect: 'error',
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!response.ok) throw new Error(`Consuming grant ${grantId} failed: ${response.status} ${response.statusText}`)
  const result = await response.json() as { error?: string, status?: string }
  if (result.error || result.status !== 'consumed') throw new Error(`Grant ${grantId} cannot be used: ${result.error ?? result.status}`)
}

const REUSE_MARGIN_SECONDS = 5
const tokenCache = new Map<string, { grantId: string, token: string, claims: ProgramTokenClaims }>()

async function cacheKey(call: ProgramCall, request: AuthorizationRequest, subject: string): Promise<string> {
  return JSON.stringify([issuerOf(request.idp), subject, request.targetHost, call.program.sha256, await computeArgvHash(executionArgv(call)), call.files ?? [], request.reference ?? null])
}

/** Forgets reusable command tokens; tests and long-lived processes that switch identity use it. */
export function clearProgramTokenCache(): void {
  tokenCache.clear()
}

export interface AuthorizeProgramOptions extends AuthorizationRequest {
  /** The actual child context, when a supervised caller supplies a separate environment. */
  context?: { cwd: string, env: NodeJS.ProcessEnv }
  /** The own identity; the command token must name it as subject. */
  subject: string
  /** Wait for a pending decision instead of returning it. A wait that runs out throws and nothing runs. */
  wait: boolean
  /** How long to wait for a decision; default 5 minutes. */
  waitMs?: number
  /** Poll interval while waiting; default 3 seconds. */
  pollIntervalMs?: number
  onPending?: (answer: { grantId: string, approvalUrl: string }) => void | Promise<void>
}

/**
 * Obtains a verified command token for exactly this call, or the pending request when not waiting. Denied and
 * revoked answers throw `AuthorizationRefusedError`. A single-use grant is consumed before this returns, so the
 * caller runs the command at most once for it. Reusable tokens of identical calls are kept until shortly before
 * they expire; single-use tokens never are.
 */
export async function authorizeProgramCall(call: ProgramCall, options: AuthorizeProgramOptions): Promise<ProgramAuthorization> {
  call.files = bindProgramCall(call, options.context).files
  const auth = loadAuth()
  const ownAuth = auth?.email === options.subject && issuerOf(auth.idp) === issuerOf(options.idp) ? auth : undefined
  const decisionIssuer = ownAuth?.decision_issuer ?? options.idp
  const brokered = ownAuth?.brokered
  if (brokered && !ownAuth?.decision_issuer) throw new Error('Brokered authorization requires its decision issuer')
  const key = JSON.stringify([await cacheKey(call, options, options.subject), decisionIssuer, brokered ?? null])
  const cached = tokenCache.get(key)
  if (!options.reference && cached && cached.claims.exp - REUSE_MARGIN_SECONDS > Date.now() / 1000)
    return { kind: 'authorized', ...cached }
  tokenCache.delete(key)

  let answer = await requestAuthorization(call, options)
  if (answer.state === 'pending') {
    await options.onPending?.(answer)
    if (!options.wait) return { kind: 'pending', grantId: answer.grantId, approvalUrl: answer.approvalUrl }
    const status = await waitForDecision(options.idp, answer.grantId, options.waitMs ?? GRANT_WAIT_MS, options.pollIntervalMs ?? 3000)
    if (status !== 'approved') throw new AuthorizationRefusedError(status, answer.grantId)
    const pendingGrantId = answer.grantId
    answer = await requestAuthorization(call, options)
    if (answer.state === 'pending') throw new Error(`Grant ${pendingGrantId} was approved but does not authorize this command`)
  }
  if (answer.state !== 'approved') throw new AuthorizationRefusedError(answer.state, answer.grantId)

  const claims = await verifyProgramToken(answer.token, { idp: decisionIssuer, subject: options.subject, targetHost: options.targetHost, call, brokered })
  if (claims.grant_id !== answer.grantId) throw new Error('Command token belongs to another grant')
  const authorized = { grantId: answer.grantId, token: answer.token, claims }
  if (claims.grant_type === 'once') await consumeSingleUseGrant(decisionIssuer, answer.grantId, answer.token)
  else tokenCache.set(key, authorized)
  return { kind: 'authorized', ...authorized }
}
