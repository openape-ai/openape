import { createHash } from 'node:crypto'
import { accessSync, constants, createReadStream, statSync } from 'node:fs'
import { basename, delimiter, join, resolve } from 'node:path'
import type { OpenApeAuthZClaims, OpenApeGrantSummary } from '@openape/core'
import { computeArgvHash, verifyAuthzJWT } from '@openape/grants'
import { ApiError, apiFetch, getGrantsEndpoint } from '../http.js'
import { GRANT_WAIT_MS } from '../shapes/grants.js'
import { createWaitProgressReporter } from '../wait-progress.js'

/**
 * Per-call program authorization at the IdP (issue 1473, revision 4). apes sends the exact command and the hash of
 * the program file; the IdP alone resolves it with Shapes and answers approved (with a command token), pending or
 * denied. apes never reads local adapter files.
 */

export interface LocatedProgram {
  /** The file that runs: the PATH lookup result or the given path. */
  path: string
  /** Basename of `path`, the program name the IdP selects a shape by. */
  name: string
  /** Lowercase hex SHA-256 of the file. */
  sha256: string
}

export interface ProgramCall {
  program: LocatedProgram
  /** Arguments without the executable, exactly as executed. */
  argv: string[]
}

export type GrantType = 'once' | 'always'

export interface AuthorizationRequest {
  idp: string
  targetHost: string
  grantType: GrantType
  summary?: OpenApeGrantSummary
}

export type AuthorizeAnswer =
  | { state: 'approved', grantId: string, token: string, expiresAt: number }
  | { state: 'pending', grantId: string, approvalUrl: string }
  | { state: 'denied' | 'revoked', grantId: string }

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

function isExecutableFile(path: string): boolean {
  try {
    if (!statSync(path).isFile()) return false
    accessSync(path, constants.X_OK)
    return true
  }
  catch {
    return false
  }
}

/** The file a shell would run for `executable`: the path itself when it has a slash, else the first PATH match. */
export function findExecutable(executable: string, pathVariable = process.env.PATH ?? ''): string | null {
  if (executable.includes('/')) {
    const path = resolve(executable)
    return isExecutableFile(path) ? path : null
  }
  for (const directory of pathVariable.split(delimiter)) {
    if (!directory) continue
    const candidate = resolve(join(directory, executable))
    if (isExecutableFile(candidate)) return candidate
  }
  return null
}

export async function hashFile(path: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer)
  return hash.digest('hex')
}

/** Locates and hashes the program; null when no executable file exists for it. */
export async function locateProgram(executable: string): Promise<LocatedProgram | null> {
  const path = findExecutable(executable)
  if (!path) return null
  return { path, name: basename(path), sha256: await hashFile(path) }
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

/** One `POST /api/grants/authorize` round trip. */
export async function requestAuthorization(call: ProgramCall, request: AuthorizationRequest): Promise<AuthorizeAnswer> {
  const issuer = issuerOf(request.idp)
  try {
    const body = await apiFetch<Record<string, unknown>>(`${issuer}/api/grants/authorize`, {
      method: 'POST',
      idp: issuer,
      body: {
        target_host: request.targetHost,
        audience: 'shapes',
        program: { name: call.program.name, sha256: call.program.sha256 },
        argv: call.argv,
        grant_type: request.grantType,
        ...(request.summary ? { summary: request.summary } : {}),
      },
    })
    return parseAnswer(body)
  }
  catch (error) {
    const refusal = error instanceof ApiError && error.statusCode === 403 ? error.problemDetails : undefined
    if (refusal && (refusal.state === 'denied' || refusal.state === 'revoked') && typeof refusal.grant_id === 'string')
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
  binding: { idp: string, subject: string, targetHost: string, call: ProgramCall },
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
  return claims
}

type Decision = 'approved' | 'denied' | 'revoked' | 'used'
const DECISIONS = new Set<string>(['approved', 'denied', 'revoked', 'used'])

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

const REUSE_MARGIN_SECONDS = 5
const tokenCache = new Map<string, { grantId: string, token: string, claims: ProgramTokenClaims }>()

async function cacheKey(call: ProgramCall, request: AuthorizationRequest, subject: string): Promise<string> {
  return JSON.stringify([issuerOf(request.idp), subject, request.targetHost, call.program.sha256, await computeArgvHash(executionArgv(call))])
}

/** Forgets reusable command tokens; tests and long-lived processes that switch identity use it. */
export function clearProgramTokenCache(): void {
  tokenCache.clear()
}

export interface AuthorizeProgramOptions extends AuthorizationRequest {
  /** The own identity; the command token must name it as subject. */
  subject: string
  /** Wait for a pending decision instead of returning it. A wait that runs out throws and nothing runs. */
  wait: boolean
  /** How long to wait for a decision; default 5 minutes. */
  waitMs?: number
  /** Poll interval while waiting; default 3 seconds. */
  pollIntervalMs?: number
  onPending?: (answer: { grantId: string, approvalUrl: string }) => void
}

/**
 * Obtains a verified command token for exactly this call, or the pending request when not waiting. Denied and
 * revoked answers throw `AuthorizationRefusedError`. Reusable tokens of identical calls are kept until shortly
 * before they expire; single-use tokens never are.
 */
export async function authorizeProgramCall(call: ProgramCall, options: AuthorizeProgramOptions): Promise<ProgramAuthorization> {
  const key = await cacheKey(call, options, options.subject)
  const cached = tokenCache.get(key)
  if (cached && cached.claims.exp - REUSE_MARGIN_SECONDS > Date.now() / 1000)
    return { kind: 'authorized', ...cached }
  tokenCache.delete(key)

  let answer = await requestAuthorization(call, options)
  if (answer.state === 'pending') {
    options.onPending?.(answer)
    if (!options.wait) return { kind: 'pending', grantId: answer.grantId, approvalUrl: answer.approvalUrl }
    const status = await waitForDecision(options.idp, answer.grantId, options.waitMs ?? GRANT_WAIT_MS, options.pollIntervalMs ?? 3000)
    if (status !== 'approved') throw new AuthorizationRefusedError(status, answer.grantId)
    const pendingGrantId = answer.grantId
    answer = await requestAuthorization(call, options)
    if (answer.state === 'pending') throw new Error(`Grant ${pendingGrantId} was approved but does not authorize this command`)
  }
  if (answer.state !== 'approved') throw new AuthorizationRefusedError(answer.state, answer.grantId)

  const claims = await verifyProgramToken(answer.token, { idp: options.idp, subject: options.subject, targetHost: options.targetHost, call })
  const authorized = { grantId: answer.grantId, token: answer.token, claims }
  if (claims.grant_type !== 'once') tokenCache.set(key, authorized)
  return { kind: 'authorized', ...authorized }
}
