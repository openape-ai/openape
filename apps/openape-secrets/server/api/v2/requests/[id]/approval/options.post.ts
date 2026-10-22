import { and, eq } from 'drizzle-orm'
import { defineEventHandler, getRouterParam, readBody } from 'h3'
import { ulid } from 'ulid'
import { useDb } from '../../../../../database/drizzle'
import { consumers, vaultSecretVersions } from '../../../../../database/schema'
import { createProblemError } from '../../../../../utils/problem'
import { requireVaultOwner } from '../../../../../utils/vault-owner'
import { activeCredentials, authenticationOptions, issueChallenge, nowSec } from '../../../../../utils/vault-passkeys'
import { fingerprintOf, liveSecretFor, MAX_TIMED_SEC, ONCE_COLLECT_WINDOW_SEC, requestStatus, requireOwnRequest } from '../../../../../utils/vault-requests'

/**
 * POST /api/v2/requests/:id/approval/options — fix exactly what the owner is
 * about to approve: secret version, machine key fingerprint, release mode and
 * end time. The passkey confirms this descriptor; the commit cannot change it.
 *
 * Body: `{ mode: 'once' | 'timed' | 'standing', durationSec? }`.
 */
export default defineEventHandler(async (event) => {
  const owner = await requireVaultOwner(event)
  const request = await requireOwnRequest(owner, getRouterParam(event, 'id'))
  const body = (await readBody<{ mode?: unknown, durationSec?: unknown }>(event)) ?? {}

  const status = requestStatus(request)
  if (status !== 'pending_approval') throw createProblemError({ status: 409, title: `This request is ${status.replace('_', ' ')}` })

  const now = nowSec()
  let expiresAt: number | null
  if (body.mode === 'once') {
    expiresAt = now + ONCE_COLLECT_WINDOW_SEC
  }
  else if (body.mode === 'standing') {
    expiresAt = null
  }
  else if (body.mode === 'timed') {
    const duration = Number(body.durationSec)
    if (!Number.isInteger(duration) || duration < 60 || duration > MAX_TIMED_SEC) throw createProblemError({ status: 400, title: 'durationSec must be between 60 seconds and 7 days' })
    expiresAt = now + duration
  }
  else {
    throw createProblemError({ status: 400, title: 'mode must be once, timed or standing' })
  }

  const secret = await liveSecretFor(request)
  if (!secret) throw createProblemError({ status: 409, title: `Save ${request.fieldName} in your vault first`, detail: 'Then approve this request with it.' })
  const db = useDb()
  const machine = await db.select().from(consumers).where(eq(consumers.id, request.consumerId)).get()
  if (!machine || await fingerprintOf(machine.publicKeyJwk) !== request.consumerFingerprint) {
    throw createProblemError({ status: 409, title: 'The machine key changed since this request', detail: 'Ask the agent to request it again.' })
  }
  const version = await db.select().from(vaultSecretVersions).where(and(eq(vaultSecretVersions.secretId, secret.id), eq(vaultSecretVersions.version, secret.currentVersion))).get()

  const approvalId = ulid()
  const descriptor = {
    requestId: request.id,
    approvalId,
    secretId: secret.id,
    version: secret.currentVersion,
    consumerId: request.consumerId,
    consumerKeyFingerprint: request.consumerFingerprint,
    mode: body.mode,
    expiresAt,
  }
  const { challengeId, challenge } = await issueChallenge(owner, 'request.approve', request.vaultId, descriptor)
  return {
    challengeId,
    approvalId,
    descriptor,
    consumer: { id: machine.id, name: machine.name, publicKeyJwk: JSON.parse(machine.publicKeyJwk) as JsonWebKey },
    sealed: version ? { value: { iv: version.valueIv, ct: version.valueCt }, dek: { iv: version.dekIv, ct: version.dekCt } } : null,
    assertion: await authenticationOptions(challenge, await activeCredentials(db, request.vaultId)),
  }
})
