import type { OpenApeCliAuthorizationDetail, OpenApeGrant } from '@openape/core'
import { computeCmdHash } from '@openape/core'
import { cliAuthorizationDetailCovers, verifyAuthzJWT } from '@openape/grants'
import { execFileSync } from 'node:child_process'
import { hostname } from 'node:os'
import consola from 'consola'
import { getGenericAuditLogPath } from '../config.js'
import { appendGenericCallLog } from '../audit/generic-log.js'
import { createWaitProgressReporter } from '../wait-progress.js'
import {
  apiFetch,
  discoverEndpoints,
  getGrantsEndpoint,
  getRequesterIdentity,
  isGenericResolved,
  loadOrInstallAdapter,
  resolveCommand,
} from '@openape/shapes'
import type { ResolvedCommand, ResolvedCompound } from '@openape/shapes'

function decodePayload(token: string): Record<string, unknown> {
  const [, payload] = token.split('.')
  if (!payload)
    throw new Error('Invalid JWT')
  return JSON.parse(Buffer.from(payload, 'base64url').toString('utf-8')) as Record<string, unknown>
}

interface SimilarGrantsInfo {
  similar_grants: Array<{ grant: { id: string }, similar_detail_indices: number[] }>
  widened_details: Array<{ permission: string }>
  merged_details: Array<{ permission: string }>
}

/**
 * POST /grants response. `approved_automatically` / `auto_approval_kind`
 * are set when the IdP approved the grant at creation time (standing
 * grants, pre-approval hooks like YOLO) — the async info block relies
 * on them to report the real status (#1081).
 */
interface CreateShapesGrantResult {
  id: string
  status: string
  approved_automatically?: boolean
  auto_approval_kind?: string
  similar_grants?: SimilarGrantsInfo
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

export async function createShapesGrant(
  resolved: ResolvedCommand,
  params: {
    idp: string
    approval: 'once' | 'timed' | 'always'
    reason?: string
  },
): Promise<CreateShapesGrantResult> {
  const grantsEndpoint = await getGrantsEndpoint(params.idp)
  const requester = getRequesterIdentity()
  if (!requester) {
    throw new Error('No requester identity available. Run `apes login` first.')
  }
  return apiFetch<CreateShapesGrantResult>(grantsEndpoint, {
    method: 'POST',
    idp: params.idp,
    body: {
      requester,
      target_host: hostname(),
      audience: resolved.adapter.cli.audience ?? 'shapes',
      grant_type: params.approval,
      command: resolved.executionContext.argv,
      reason: params.reason ?? resolved.detail.display,
      permissions: [resolved.permission],
      authorization_details: [resolved.detail],
      execution_context: resolved.executionContext,
      // Tell the approver when this stops being a live decision (#1306).
      waits_until: waitsUntil(),
    },
  })
}

/**
 * Poll a grant until it leaves `pending` (max 5 minutes). While waiting,
 * a short progress line is written to stderr every 15 seconds so callers
 * (and their stall heuristics) can tell an ongoing wait from a hang —
 * stdout stays untouched. Suppress the progress output with
 * `APES_QUIET_WAIT=1` for quiet/non-interactive runs.
 */
export async function waitForGrantStatus(idp: string, grantId: string): Promise<'approved' | 'denied' | 'revoked'> {
  const grantsEndpoint = await getGrantsEndpoint(idp)
  const deadline = Date.now() + GRANT_WAIT_MS
  const reportProgress = createWaitProgressReporter(grantId)

  while (Date.now() < deadline) {
    const grant = await apiFetch<{ status: 'pending' | 'approved' | 'denied' | 'revoked' }>(`${grantsEndpoint}/${grantId}`, { idp })
    if (grant.status === 'approved' || grant.status === 'denied' || grant.status === 'revoked')
      return grant.status
    reportProgress()
    await new Promise(resolve => setTimeout(resolve, 3000))
  }

  throw new Error('Timed out waiting for grant approval')
}

export async function fetchGrantToken(idp: string, grantId: string): Promise<string> {
  const grantsEndpoint = await getGrantsEndpoint(idp)
  const response = await apiFetch<{ authz_jwt: string }>(`${grantsEndpoint}/${grantId}/token`, {
    method: 'POST',
    idp,
  })
  return response.authz_jwt
}

function grantedCliDetails(claims: Record<string, unknown>): OpenApeCliAuthorizationDetail[] {
  const details = claims.authorization_details
  if (!Array.isArray(details))
    return []

  return details.filter((detail): detail is OpenApeCliAuthorizationDetail =>
    typeof detail === 'object'
    && detail !== null
    && (detail as Record<string, unknown>).type === 'openape_cli',
  )
}

function hasStructuredCliGrant(claims: Record<string, unknown>): boolean {
  return grantedCliDetails(claims).length > 0
}

/**
 * Verifies a grant token against the resolved command and marks the grant
 * as consumed on the IdP. Does NOT execute anything — callers that want
 * the one-shot behavior should use `verifyAndExecute`, callers that want
 * to run the command themselves (e.g. the interactive REPL piping through
 * a persistent bash pty) should call this and then do their own execution.
 *
 * Split out so the interactive shell can re-use the verify + consume path
 * without being forced into the `execFileSync`-based one-shot execution.
 */
export async function verifyAndConsume(token: string, resolved: ResolvedCommand): Promise<void> {
  const payload = decodePayload(token)
  const issuer = String(payload.iss ?? '')
  if (!issuer)
    throw new Error('Grant token is missing issuer')

  const discovery = await discoverEndpoints(issuer)
  const jwksUri = String(discovery.jwks_uri ?? `${issuer}/.well-known/jwks.json`)
  const result = await verifyAuthzJWT(token, {
    expectedIss: issuer,
    expectedAud: resolved.adapter.cli.audience ?? 'shapes',
    jwksUri,
  })

  if (!result.valid || !result.claims) {
    throw new Error(result.error ?? 'Grant verification failed')
  }

  const claims = result.claims
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
      cliAuthorizationDetailCovers(detail, resolved.detail) && detail.constraints?.exact_command,
    )

    const isOnce = claims.grant_type === 'once' || claims.approval === 'once'
    const enforceArgvHash = exactRequired || (isOnce && !!claims.execution_context?.argv_hash)

    if (enforceArgvHash && claims.execution_context?.argv_hash !== resolved.executionContext.argv_hash) {
      throw new Error('Granted command does not match current argv')
    }
  }

  const grantsEndpoint = await getGrantsEndpoint(issuer)
  const consume = await fetch(`${grantsEndpoint}/${claims.grant_id}/consume`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
    },
  })

  if (!consume.ok) {
    throw new Error(`Consume failed: ${consume.status} ${consume.statusText}`)
  }

  const consumeResult = await consume.json() as { error?: string }
  if (consumeResult.error) {
    throw new Error(`Grant rejected at consume step: ${consumeResult.error}`)
  }
}

/**
 * Execute a verified + consumed resolved command directly via execFileSync,
 * inheriting stdio so the caller's terminal is handed to the child. Used by
 * the one-shot `apes run --shell` path.
 */
function executeResolvedViaExec(resolved: ResolvedCommand): void {
  consola.info(`Executing ${(resolved.executionContext.argv ?? [resolved.executable, ...resolved.commandArgv]).join(' ')}`)
  execFileSync(resolved.executable, resolved.commandArgv, { stdio: 'inherit' })
}

/**
 * One-shot verify + consume + execute. Preserves the legacy behavior of
 * the `apes run --shell` path so existing callers keep working unchanged.
 *
 * When `resolved` carries the generic-fallback operation id
 * (`_generic.exec`), a JSONL audit entry is appended to the generic-calls
 * log after the child process exits. `grantId` is needed to write the
 * entry — callers that know the grant id should pass it; if omitted, the
 * log entry is skipped (the audit hook is best-effort, not a hard gate).
 *
 * This is the central exec path for sync (`--wait`), async-default
 * (`apes grants run <id> --wait`), and REPL one-shot, so a hook here
 * covers all three flows without duplicating logic in each caller.
 */
export async function verifyAndExecute(
  token: string,
  resolved: ResolvedCommand,
  grantId?: string,
): Promise<void> {
  await verifyAndConsume(token, resolved)

  const isGeneric = isGenericResolved(resolved)
  const start = Date.now()
  let exitCode = 0
  try {
    executeResolvedViaExec(resolved)
  }
  catch (err) {
    exitCode = (err as { status?: number })?.status ?? 1
    throw err
  }
  finally {
    if (isGeneric && grantId) {
      // Best-effort: swallow log errors so a broken audit file never
      // blocks a successful command.
      try {
        await appendGenericCallLog(
          {
            ts: new Date().toISOString(),
            cli: resolved.detail.cli_id,
            argv: resolved.executionContext.argv ?? [resolved.executable, ...resolved.commandArgv],
            argv_hash: resolved.executionContext.argv_hash ?? '',
            grant_id: grantId,
            exit_code: exitCode,
            duration_ms: Date.now() - start,
          },
          getGenericAuditLogPath(),
        )
      }
      catch (logErr) {
        consola.debug('Failed to append generic-call audit entry:', logErr)
      }
    }
  }
}

/**
 * Re-resolve a ResolvedCommand from a previously-created grant's recorded
 * request (argv + adapter digest). Used by `apes grants run <id>` to replay
 * an approved grant locally after the async approval step.
 *
 * Throws when the grant is missing argv, when the adapter cannot be loaded,
 * or when the locally installed adapter's digest no longer matches what the
 * grant was issued against.
 */
export async function resolveFromGrant(
  grant: {
    request: {
      command?: string[]
      execution_context?: { adapter_digest?: string, argv_hash?: string }
      authorization_details?: Array<{ type?: string, permission?: string }>
    }
  },
): Promise<ResolvedCommand> {
  const argv = grant.request?.command
  if (!argv || argv.length === 0)
    throw new Error('Grant request is missing command argv')

  const executable = argv[0]! // argv.length === 0 throws above
  const adapter = await loadOrInstallAdapter(executable)
  if (!adapter)
    throw new Error(`No shapes adapter found for ${executable}`)

  const resolved = await resolveCommand(adapter, argv)

  const grantDigest = grant.request.execution_context?.adapter_digest
  if (grantDigest && grantDigest !== resolved.digest) {
    throw new Error(
      `Adapter digest mismatch: grant was created against adapter ${grantDigest}, but local adapter is ${resolved.digest}. Reinstall or revert the adapter.`,
    )
  }

  return resolved
}

export async function findExistingGrant(
  resolved: ResolvedCommand,
  idp: string,
): Promise<string | null> {
  const grantsEndpoint = await getGrantsEndpoint(idp)
  const response = await apiFetch<{ data: OpenApeGrant[] }>(
    `${grantsEndpoint}?status=approved`,
    { idp },
  )

  const now = Math.floor(Date.now() / 1000)
  const expectedAudience = resolved.adapter.cli.audience ?? 'shapes'

  for (const grant of response.data) {
    const req = grant.request
    if (req.grant_type === 'once')
      continue
    if (req.grant_type === 'timed' && grant.expires_at && grant.expires_at <= now)
      continue
    if (req.audience !== expectedAudience)
      continue
    if (req.execution_context?.adapter_digest && req.execution_context.adapter_digest !== resolved.digest)
      continue

    const cliDetails = (req.authorization_details ?? []).filter(
      (d): d is OpenApeCliAuthorizationDetail => d.type === 'openape_cli',
    )

    if (cliDetails.length > 0) {
      if (cliDetails.some(detail => cliAuthorizationDetailCovers(detail, resolved.detail)))
        return grant.id
    }
    else if (req.permissions?.includes(resolved.permission)) {
      return grant.id
    }
  }

  return null
}

/**
 * True when `granted` covers every segment detail of a compound line —
 * the coverage question for one grant carrying N per-segment details.
 * Pure so it can be unit-tested without token plumbing.
 */
export function compoundCoveredByDetails(
  granted: OpenApeCliAuthorizationDetail[],
  compound: Pick<ResolvedCompound, 'segments'>,
): boolean {
  return compound.segments.every(seg =>
    granted.some(detail => cliAuthorizationDetailCovers(detail, seg.detail)),
  )
}

/**
 * Compound sibling of `createShapesGrant`: ONE grant request whose
 * authorization_details are the merged per-segment details and whose
 * command/execution_context bind the ORIGINAL `bash -c` argv — after
 * approval the line runs as a whole (pipes need the shell).
 */
export async function createCompoundGrant(
  compound: ResolvedCompound,
  params: {
    idp: string
    approval: 'once' | 'timed' | 'always'
    reason?: string
  },
): Promise<CreateShapesGrantResult> {
  const grantsEndpoint = await getGrantsEndpoint(params.idp)
  const requester = getRequesterIdentity()
  if (!requester) {
    throw new Error('No requester identity available. Run `apes login` first.')
  }
  return apiFetch<CreateShapesGrantResult>(grantsEndpoint, {
    method: 'POST',
    idp: params.idp,
    body: {
      requester,
      target_host: hostname(),
      audience: compound.audience,
      grant_type: params.approval,
      command: compound.executionContext.argv,
      reason: params.reason ?? `Compound: ${compound.innerLine.slice(0, 120)}`,
      permissions: compound.permissions,
      authorization_details: compound.details,
      execution_context: compound.executionContext,
    },
  })
}

/**
 * Reuse check for compound lines: an approved timed/always grant qualifies
 * only when it covers EVERY segment. Adapter-digest pinning is skipped —
 * a compound line spans several adapters, per-segment integrity lives in
 * the segment resource chains instead.
 */
export async function findExistingCompoundGrant(
  compound: ResolvedCompound,
  idp: string,
): Promise<string | null> {
  const grantsEndpoint = await getGrantsEndpoint(idp)
  const response = await apiFetch<{ data: OpenApeGrant[] }>(
    `${grantsEndpoint}?status=approved`,
    { idp },
  )
  const now = Math.floor(Date.now() / 1000)

  for (const grant of response.data) {
    const req = grant.request
    if (req.grant_type === 'once')
      continue
    if (req.grant_type === 'timed' && grant.expires_at && grant.expires_at <= now)
      continue
    if (req.audience !== compound.audience)
      continue
    const cliDetails = (req.authorization_details ?? []).filter(
      (d): d is OpenApeCliAuthorizationDetail => d.type === 'openape_cli',
    )
    if (cliDetails.length > 0 && compoundCoveredByDetails(cliDetails, compound))
      return grant.id
  }
  return null
}

/**
 * Compound sibling of `verifyAndConsume`: verifies the authz token covers
 * every segment, binds once grants to the original argv, consumes — and
 * leaves execution to the caller (the whole line must run through the
 * shell, not per segment).
 */
export async function verifyAndConsumeCompound(token: string, compound: ResolvedCompound): Promise<void> {
  const payload = decodePayload(token)
  const issuer = String(payload.iss ?? '')
  if (!issuer)
    throw new Error('Grant token is missing issuer')

  const discovery = await discoverEndpoints(issuer)
  const jwksUri = String(discovery.jwks_uri ?? `${issuer}/.well-known/jwks.json`)
  const result = await verifyAuthzJWT(token, {
    expectedIss: issuer,
    expectedAud: compound.audience,
    jwksUri,
  })
  if (!result.valid || !result.claims) {
    throw new Error(result.error ?? 'Grant verification failed')
  }

  const claims = result.claims
  const details = grantedCliDetails(claims as unknown as Record<string, unknown>)
  if (details.length === 0)
    throw new Error('Grant carries no structured CLI details for a compound command')

  if (!compoundCoveredByDetails(details, compound)) {
    const missing = compound.segments.find(seg => !details.some(d => cliAuthorizationDetailCovers(d, seg.detail)))
    throw new Error(`Grant does not cover required permission: ${missing?.permission ?? 'unknown segment'}`)
  }

  // Generic segments carry exact_command; a once grant binds the whole
  // wrapped argv. Either way the binding target is the ORIGINAL line.
  const exactRequired = compound.segments.some(seg => seg.detail.constraints?.exact_command)
  const isOnce = claims.grant_type === 'once' || claims.approval === 'once'
  if ((exactRequired || isOnce) && claims.execution_context?.argv_hash !== compound.executionContext.argv_hash) {
    throw new Error('Granted command does not match current argv')
  }

  const grantsEndpoint = await getGrantsEndpoint(issuer)
  const consume = await fetch(`${grantsEndpoint}/${claims.grant_id}/consume`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!consume.ok) {
    throw new Error(`Consume failed: ${consume.status} ${consume.statusText}`)
  }
  const consumeResult = await consume.json() as { error?: string }
  if (consumeResult.error) {
    throw new Error(`Grant rejected at consume step: ${consumeResult.error}`)
  }
}
