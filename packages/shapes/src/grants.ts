import { verifyAuthzJWT } from '@openape/grants'
import { cliAuthorizationDetailCovers, computeCmdHash } from '@openape/core'
import type { OpenApeCliAuthorizationDetail } from '@openape/core'
import { execFileSync } from 'node:child_process'
import { hostname } from 'node:os'
import consola from 'consola'
import { getRequesterIdentity } from './config.js'
import type { ResolvedCommand } from './types.js'
import { apiFetch, discoverEndpoints, getGrantsEndpoint } from './http.js'

function decodePayload(token: string): Record<string, unknown> {
  const [, payload] = token.split('.')
  if (!payload)
    throw new Error('Invalid JWT')
  return JSON.parse(Buffer.from(payload, 'base64url').toString('utf-8')) as Record<string, unknown>
}

export async function createShapesGrant(
  resolved: ResolvedCommand,
  params: {
    idp: string
    approval: 'once' | 'timed' | 'always'
    reason?: string
  },
): Promise<{ id: string, status: string }> {
  const grantsEndpoint = await getGrantsEndpoint(params.idp)
  const requester = getRequesterIdentity()
  if (!requester) {
    throw new Error('No requester identity available. Run `grapes login` first.')
  }
  return apiFetch<{ id: string, status: string }>(grantsEndpoint, {
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
    },
  })
}

export async function waitForGrantStatus(idp: string, grantId: string): Promise<'approved' | 'denied' | 'revoked'> {
  const grantsEndpoint = await getGrantsEndpoint(idp)
  const deadline = Date.now() + 300_000

  while (Date.now() < deadline) {
    const grant = await apiFetch<{ status: 'pending' | 'approved' | 'denied' | 'revoked' }>(`${grantsEndpoint}/${grantId}`, { idp })
    if (grant.status === 'approved' || grant.status === 'denied' || grant.status === 'revoked')
      return grant.status
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

export async function verifyAndExecute(token: string, resolved: ResolvedCommand): Promise<void> {
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

    if ((exactRequired || claims.execution_context?.argv_hash) && claims.execution_context?.argv_hash !== resolved.executionContext.argv_hash) {
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

  consola.info(`Executing ${(resolved.executionContext.argv ?? [resolved.executable, ...resolved.commandArgv]).join(' ')}`)
  execFileSync(resolved.executable, resolved.commandArgv, { stdio: 'inherit' })
}
