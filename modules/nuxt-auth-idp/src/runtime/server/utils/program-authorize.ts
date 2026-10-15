import type { BrokeredGrant, OpenApeGrant, OpenApeGrantRequest, OpenApeProgramAuthorizeRequest, OpenApeProgramAuthorizeResponse } from '@openape/core'
import type { ResolvedProgramCall } from '@openape/grants'
import { computeCmdHash } from '@openape/core'
import { assertGrantBatchMember, createGrant, evaluateStandingGrants, InvalidGrantBatchError, InvalidProgramAuthorizeRequestError, issueCommandJWT, PROGRAM_AUTHORIZE_LIMITS, resolveProgramCall } from '@openape/grants'
import type { H3Event } from 'h3'
import { isError, setResponseHeader, setResponseStatus } from 'h3'
import { runGrantPendingHooks } from './grant-pending-hooks'
import type { ProgramCallScope } from './grant-reuse'
import { findCoveringGrant, findLatestRequest } from './grant-reuse'
import { useGrantStores } from './grant-stores'
import { runPreApprovalHooks } from './pre-approval-hooks'
import { createProblemError } from './problem'
import { useShapeStore } from './shape-store'
import { getIdpIssuer, useIdpStores } from './stores'

export interface ProgramAuthorizeResult {
  status: 200 | 202 | 403
  body: OpenApeProgramAuthorizeResponse
}

export interface ProgramAuthorizeInput {
  /** The verified requester: the bearer token subject, or the broker-signed agent subject. */
  requester: string
  request: OpenApeProgramAuthorizeRequest
  /** The broker binding of a brokered identity; its grants are never shared with other bindings. */
  brokered?: BrokeredGrant
  /** Called after a command token was issued (the decision IdP audits brokered tokens). */
  onToken?: (grant: OpenApeGrant) => Promise<void>
}

/** Sends an authorize answer; a refusal is problem+json that keeps `state` and `grant_id`. */
export function sendProgramAuthorizeResult(event: H3Event, result: ProgramAuthorizeResult): Record<string, unknown> {
  setResponseStatus(event, result.status)
  setResponseHeader(event, 'Cache-Control', 'no-store')
  if (result.status !== 403) return result.body
  setResponseHeader(event, 'Content-Type', 'application/problem+json')
  return { type: `https://openape.org/errors/grant_${result.body.state}`, title: `The owner ${result.body.state === 'denied' ? 'denied' : 'revoked'} this permission`, status: 403, ...result.body }
}

/** What an authorize failure log may name about a call: the program and the operation the IdP resolved, never its arguments. */
export interface AuthorizeTrace {
  cli: string
  operation?: string
}

function stackFrames(error: unknown): string {
  // The first stack line repeats the message, which may quote stored grant data.
  return error instanceof Error ? (error.stack ?? '').split('\n').slice(1, 6).map(line => line.trim()).join(' | ') : ''
}

/**
 * Logs an authorize failure the IdP did not intend (a 5xx or an exception)
 * with a request id that the problem answer carries too, so a requester's
 * report can be matched to the log. Intended refusals (4xx) pass unchanged.
 */
export function reportUnexpectedAuthorizeFailure(error: unknown, trace: AuthorizeTrace): unknown {
  if (isError(error) && error.statusCode < 500) return error
  const requestId = crypto.randomUUID()
  const problem = isError(error) ? error : createProblemError({ status: 500, title: 'Program authorization failed unexpectedly' })
  problem.data = { ...(problem.data as Record<string, unknown> | undefined), request_id: requestId }
  const call = `cli=${JSON.stringify(trace.cli)}${trace.operation ? ` operation=${JSON.stringify(trace.operation)}` : ''}`
  const cause = isError(error) ? '' : ` cause=${error instanceof Error ? error.name : typeof error} ${stackFrames(error)}`
  console.error(`[grants/authorize] request ${requestId} failed with HTTP ${problem.statusCode} ${JSON.stringify(problem.statusMessage ?? '')} ${call}${cause}`)
  return problem
}

function text(value: unknown, maxLength = 16 * 1024): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maxLength
}

/**
 * The decision IdP's answer to a forwarded `authorize` operation, checked
 * before the broker relays it with the status that belongs to its state.
 */
export function readForwardedAuthorize(value: unknown): ProgramAuthorizeResult {
  const answer = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>
  const invalid = () => createProblemError({ status: 503, title: 'The decision identity provider returned an invalid authorization answer', type: 'https://openape.org/errors/broker_unavailable' })
  if (!text(answer.grant_id)) throw invalid()
  if (answer.state === 'approved') {
    if (!text(answer.authz_jwt, PROGRAM_AUTHORIZE_LIMITS.tokenChars) || !Number.isInteger(answer.expires_at)) throw invalid()
    return { status: 200, body: { state: 'approved', grant_id: answer.grant_id, authz_jwt: answer.authz_jwt, expires_at: answer.expires_at as number } }
  }
  if (answer.state === 'pending') {
    if (!text(answer.approval_url) || !answer.approval_url.startsWith('https://')) throw invalid()
    return { status: 202, body: { state: 'pending', grant_id: answer.grant_id, approval_url: answer.approval_url } }
  }
  if (answer.state === 'denied' || answer.state === 'revoked') return { status: 403, body: { state: answer.state, grant_id: answer.grant_id } }
  throw invalid()
}

function grantRequestFor(requester: string, request: OpenApeProgramAuthorizeRequest, call: ResolvedProgramCall, cmdHash: string): OpenApeGrantRequest {
  return {
    requester,
    target_host: request.target_host,
    audience: request.audience,
    grant_type: call.requiresOnce ? 'once' : request.grant_type,
    permissions: [call.detail.permission],
    authorization_details: [call.detail],
    command: call.executionArgv,
    cmd_hash: cmdHash,
    execution_context: call.executionContext,
    ...(request.summary ? { summary: request.summary } : {}),
    ...(request.batch ? { batch: request.batch } : {}),
  }
}

/**
 * A command token for the grant, or null when it is single-use and another
 * call spent it first: issuing the token consumes a single-use grant.
 */
async function approvedAnswer(grant: OpenApeGrant, call: ResolvedProgramCall, onToken: ProgramAuthorizeInput['onToken']): Promise<ProgramAuthorizeResult | null> {
  const key = await useIdpStores().keyStore.getSigningKey()
  const { token, expiresAt } = await issueCommandJWT(grant, { argvHash: call.argvHash, programSha256: call.executionContext.program_sha256, detail: call.detail, executionContext: call.executionContext }, getIdpIssuer(), key.privateKey, key.kid)
  // Refused before a single-use grant is spent: no broker or requester could relay or read a larger answer.
  if (token.length > PROGRAM_AUTHORIZE_LIMITS.tokenChars) throw createProblemError({ status: 413, title: `The command is too large to authorize: its command token would exceed ${PROGRAM_AUTHORIZE_LIMITS.tokenChars} characters; shorten its arguments`, type: 'https://openape.org/errors/command_too_large' })
  await onToken?.(grant)
  if ((grant.request.grant_type ?? 'once') === 'once' && !await useGrantStores().grantStore.claimOnce(grant.id, Math.floor(Date.now() / 1000))) return null
  return { status: 200, body: { state: 'approved', grant_id: grant.id, authz_jwt: token, expires_at: expiresAt } }
}

function pendingAnswer(grant: OpenApeGrant): ProgramAuthorizeResult {
  return { status: 202, body: { state: 'pending', grant_id: grant.id, approval_url: `${getIdpIssuer()}/grant-approval?grant_id=${encodeURIComponent(grant.id)}` } }
}

/** Records an auto-approval the way `POST /api/grants` does and returns the approved grant. */
async function autoApprove(request: OpenApeGrantRequest, extra: Record<string, unknown>): Promise<OpenApeGrant> {
  const { grantStore } = useGrantStores()
  const pending = await createGrant(request, grantStore)
  await grantStore.updateStatus(pending.id, 'approved', { status: 'approved', decided_at: Math.floor(Date.now() / 1000), ...extra })
  const approved = await grantStore.findById(pending.id)
  if (!approved) throw new Error('Auto-approved grant disappeared')
  return approved
}

/** Stores a new pending request and notifies whoever decides it, exactly as `POST /api/grants` and brokered creation do. */
async function requestDecision(request: OpenApeGrantRequest, brokered: BrokeredGrant | undefined): Promise<OpenApeGrant> {
  const { grantStore } = useGrantStores()
  if (brokered) {
    const grant: OpenApeGrant = { id: crypto.randomUUID(), status: 'pending', type: 'command', request, brokered, created_at: Math.floor(Date.now() / 1000) }
    await grantStore.save(grant)
    await runGrantPendingHooks(grant)
    return grant
  }
  const grant = await createGrant(request, grantStore)
  // Fire-and-forget so a slow notification doesn't delay the response.
  void runGrantPendingHooks(grant).catch(err => console.warn('[grants/authorize] pending-hook failed:', err))
  return grant
}

async function resolveCall(request: OpenApeProgramAuthorizeRequest): Promise<ResolvedProgramCall> {
  try { return await resolveProgramCall(useShapeStore(), request) }
  catch (error) {
    if (!(error instanceof InvalidProgramAuthorizeRequestError)) throw error
    throw createProblemError({ status: 400, title: error.message })
  }
}

/**
 * Decides one program call (issue 1473): the IdP resolves the command with
 * its own shapes, answers with a command token when an approved or standing
 * grant covers it, reuses or creates one pending request otherwise, and
 * refuses when the owner's newest decision for this permission was a denial
 * or revocation. Brokered identities only use grants of their own binding;
 * standing grants and pre-approval hooks never decide for them.
 */
export async function authorizeProgramCall(event: H3Event, input: ProgramAuthorizeInput): Promise<ProgramAuthorizeResult> {
  const trace: AuthorizeTrace = { cli: input.request.program.name }
  try {
    // A lost race for a single-use grant decides again with the grant spent.
    for (let attempt = 0; attempt < 3; attempt++) {
      const result = await decideProgramCall(event, input, trace)
      if (result) return result
    }
  }
  catch (error) { throw reportUnexpectedAuthorizeFailure(error, trace) }
  throw createProblemError({ status: 409, title: 'Concurrent calls spent the single-use grants for this command; retry the call' })
}

async function decideProgramCall(event: H3Event, input: ProgramAuthorizeInput, trace: AuthorizeTrace): Promise<ProgramAuthorizeResult | null> {
  const { requester, request, brokered, onToken } = input
  const { grantStore } = useGrantStores()
  const call = await resolveCall(request)
  trace.operation = call.detail.operation_id
  const grantRequest = grantRequestFor(requester, request, call, await computeCmdHash(call.executionArgv.join(' ')))
  try { await assertGrantBatchMember(grantRequest, grantStore) }
  catch (error) {
    if (!(error instanceof InvalidGrantBatchError)) throw error
    throw createProblemError({ status: 400, title: `Invalid batch: ${error.message}` })
  }

  const scope: ProgramCallScope = { target_host: request.target_host, audience: request.audience, detail: call.detail, argvHash: call.argvHash, programSha256: request.program.sha256, files: request.files, requiresOnce: call.requiresOnce }
  const existing = await grantStore.findByRequester(requester)
  const covering = findCoveringGrant(existing, scope, brokered)
  if (covering) return await approvedAnswer(covering, call, onToken)

  if (!brokered && !call.requiresOnce) {
    const standing = await evaluateStandingGrants(grantRequest, grantStore)
    if (standing) {
      const decidedBy = (await grantStore.findById(standing.standing_grant_id))?.decided_by
      const approved = await autoApprove(grantRequest, { decided_by: decidedBy, decided_by_standing_grant: standing.standing_grant_id, auto_approval_kind: 'standing' })
      return await approvedAnswer(approved, call, onToken)
    }
  }

  const latest = findLatestRequest(existing, scope, brokered)
  if (latest?.status === 'pending') return pendingAnswer(latest)
  if (latest?.status === 'denied' || latest?.status === 'revoked') return { status: 403, body: { state: latest.status, grant_id: latest.id } }

  if (!brokered && !call.requiresOnce) {
    const preApproval = await runPreApprovalHooks(event, grantRequest)
    if (preApproval) {
      const approved = await autoApprove(grantRequest, { decided_by: preApproval.decidedBy, auto_approval_kind: preApproval.kind })
      return await approvedAnswer(approved, call, onToken)
    }
  }

  return pendingAnswer(await requestDecision(grantRequest, brokered))
}
