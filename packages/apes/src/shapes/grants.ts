import type { BrokeredGrant, OpenApeCliAuthorizationDetail } from '@openape/core'
import { computeCmdHash } from '@openape/core'
import { cliAuthorizationDetailCovers, sameBrokeredGrant, verifyAuthzJWT } from '@openape/grants'
import type { VerifyAuthzOptions } from '@openape/grants'
import {
  discoverEndpoints,
  getGrantsEndpoint,
} from '@openape/shapes'
import type { ResolvedCommand } from '@openape/shapes'

function decodePayload(token: string): Record<string, unknown> {
  const [, payload] = token.split('.')
  if (!payload)
    throw new Error('Invalid JWT')
  return JSON.parse(Buffer.from(payload, 'base64url').toString('utf-8')) as Record<string, unknown>
}

/**
 * True when the IdP already decided this grant at creation time (standing
 * grant, YOLO policy). Callers use it to skip everything that only makes
 * sense while a human still has to act: the approve URL, the waiting
 * protocol (#1081) and the "grant is waiting for you" notification (#1083).
 *
 * Unknown shapes read as pending — the safe direction is to tell the owner
 * about a grant that turned out to be automatic, not to stay silent about
 * one that is genuinely waiting.
 */
export function isAutoApproved(grant: { status?: string, approved_automatically?: boolean }): boolean {
  return grant.approved_automatically === true || grant.status === 'approved'
}

/**
 * How long a caller waits for a decision before giving up. Both the waiting and
 * the deadline announced to the approver come from here — if they drifted, the
 * grant card would promise a countdown nobody honours, which is worse than no
 * countdown at all.
 */
export const GRANT_WAIT_MS = 300_000

/** The wall-clock moment this caller stops caring, in epoch seconds. */
export function waitsUntil(nowMs: number = Date.now()): number {
  return Math.floor((nowMs + GRANT_WAIT_MS) / 1000)
}

function grantedCliDetails(claims: Record<string, unknown>): OpenApeCliAuthorizationDetail[] {
  const details = claims.authorization_details
  if (!Array.isArray(details))
    return []

  return details.filter((detail): detail is OpenApeCliAuthorizationDetail =>
    typeof detail === 'object'
    && detail !== null
    && (detail as Record<string, unknown>).type === 'openape_cli')
}

function hasStructuredCliGrant(claims: Record<string, unknown>): boolean {
  return grantedCliDetails(claims).length > 0
}

/**
 * Binding of an assigned grant (`@openape/apes/assigned`, used by the Pods
 * desktop): `verifyAndConsume` checks a grant token against the resolved
 * command and this binding and marks the grant as consumed on the IdP. It
 * does not execute anything.
 */
export interface AssignedGrantScope {
  brokered?: BrokeredGrant
  issuer: string
  subject: string
  targetHost: string
  grantId: string
  jwksUri: string
  grantsEndpoint: string
  runAs?: string
  signal?: AbortSignal
  fetch?: (url: string, options: RequestInit) => Promise<Response>
  /** Key set already fetched from `jwksUri`; skips the key request. */
  jwks?: VerifyAuthzOptions['jwks']
  /** `false` re-verifies a reusable grant token that was consumed earlier; single-use grants are always consumed. */
  consume?: false
  /** The command runs only with a grant bound to its exact argv (argv hash), whatever its covering detail allows. */
  exactCommand?: true
}
export async function verifyAndConsume(token: string, resolved: ResolvedCommand, scope?: AssignedGrantScope): Promise<void> {
  const payload = decodePayload(token)
  const issuer = scope?.issuer ?? String(payload.iss ?? '')
  if (!issuer)
    throw new Error('Grant token is missing issuer')

  const discovery = scope ? {} : await discoverEndpoints(issuer)
  const jwksUri = scope?.jwksUri ?? String(discovery.jwks_uri ?? `${issuer}/.well-known/jwks.json`)
  const transport = scope?.fetch ?? fetch
  let jwks = scope?.jwks
  if (!jwks && scope?.fetch) {
    const response = await transport(jwksUri, { redirect: 'error', signal: AbortSignal.any([...(scope.signal ? [scope.signal] : []), AbortSignal.timeout(10000)]) })
    if (!response.ok) throw new Error(`JWKS request failed: ${response.status}`)
    jwks = await response.json() as typeof jwks
  }
  const result = await verifyAuthzJWT(token, {
    expectedIss: issuer,
    expectedAud: resolved.adapter.cli.audience ?? 'shapes',
    jwksUri,
    jwks,
  })

  if (!result.valid || !result.claims) {
    throw new Error(result.error ?? 'Grant verification failed')
  }

  const claims = result.claims
  if (claims.brokered && !scope) throw new Error('Brokered grants require an explicitly assigned owner and agent binding')
  if (scope && (!sameBrokeredGrant(scope.brokered, claims.brokered) || (scope.brokered && claims.decided_by !== scope.brokered.owner))) throw new Error('Grant does not match the assigned broker connection')
  if (scope && (claims.sub !== scope.subject || claims.target_host !== scope.targetHost || claims.grant_id !== scope.grantId || claims.run_as !== scope.runAs || claims.execution_context?.adapter_digest !== resolved.digest)) throw new Error('Grant does not match the assigned identity, host or adapter')
  const details = grantedCliDetails(claims as unknown as Record<string, unknown>)

  if (claims.execution_context?.adapter_digest && claims.execution_context.adapter_digest !== resolved.digest) {
    throw new Error('Adapter digest mismatch')
  }

  if (!hasStructuredCliGrant(claims as unknown as Record<string, unknown>)) {
    const argv = resolved.executionContext.argv
    if (!argv?.length) {
      throw new Error('Resolved command is missing argv')
    }
    const expectedCmdHash = await computeCmdHash(argv.join(' '))
    if (claims.command?.join('\0') !== argv.join('\0')) {
      throw new Error('Granted command does not match current argv')
    }
    if (claims.cmd_hash && claims.cmd_hash !== expectedCmdHash) {
      throw new Error('Granted command does not match current argv')
    }
    if (!claims.command?.length && !claims.cmd_hash) {
      throw new Error('Grant is not a structured CLI grant and is missing command binding')
    }
  }
  else {
    if (!details.some(detail => cliAuthorizationDetailCovers(detail, resolved.detail))) {
      throw new Error(`Grant does not cover required permission: ${resolved.permission}`)
    }

    const exactRequired = details.some(detail =>
      cliAuthorizationDetailCovers(detail, resolved.detail) && detail.constraints?.exact_command)

    const isOnce = claims.grant_type === 'once' || claims.approval === 'once'
    const enforceArgvHash = exactRequired || scope?.exactCommand === true || (isOnce && !!claims.execution_context?.argv_hash)

    if (enforceArgvHash && claims.execution_context?.argv_hash !== resolved.executionContext.argv_hash) {
      throw new Error('Granted command does not match current argv')
    }
  }

  if (scope?.consume === false) {
    if (claims.grant_type === 'once' || claims.approval === 'once') throw new Error('A single-use grant must be consumed')
    return
  }

  const grantsEndpoint = scope?.grantsEndpoint ?? await getGrantsEndpoint(issuer)
  const consume = await transport(`${grantsEndpoint}/${encodeURIComponent(claims.grant_id)}/consume`, {
    method: 'POST',
    ...(scope ? { redirect: 'error' as const, signal: AbortSignal.any([...(scope.signal ? [scope.signal] : []), AbortSignal.timeout(10000)]) } : {}),
    headers: {
      Authorization: `Bearer ${token}`,
    },
  })

  if (!consume.ok) {
    throw new Error(`Consume failed: ${consume.status} ${consume.statusText}`)
  }

  const consumeResult = await consume.json() as { error?: string, status?: string }
  if (consumeResult.error) {
    throw new Error(`Grant rejected at consume step: ${consumeResult.error}`)
  }
  if (scope && !['valid', 'consumed'].includes(consumeResult.status ?? '')) throw new Error('Unrecognized grant consume response')
}
