import { and, eq, isNull } from 'drizzle-orm'
import { defineEventHandler, getRouterParam, readBody, setResponseStatus } from 'h3'
import { verifyDelivery } from '#shared/vault-crypto'
import { consumers, secretAccessRequests, secretApprovals, vaults, vaultSecrets } from '../../../../../database/schema'
import { createProblemError } from '../../../../../utils/problem'
import { requireVaultOwner } from '../../../../../utils/vault-owner'
import { audit, b64uField, consumeChallenge, nowSec, sealedField, signingKeyField, vaultTransaction, verifyVaultPasskey } from '../../../../../utils/vault-passkeys'
import { fingerprintOf, requestStatus } from '../../../../../utils/vault-requests'

const MAX_VALUE_BYTES = 64 * 1024

interface Descriptor { requestId: string, approvalId: string, secretId: string, version: number, consumerId: string, consumerKeyFingerprint: string, mode: 'once' | 'timed' | 'standing', expiresAt: number | null }

/**
 * POST /api/v2/requests/:id/approval/commit — store the approval and the
 * package sealed for the machine, after a fresh passkey assertion over the
 * descriptor fixed by approval/options. Everything that descriptor names is
 * checked again inside the transaction: the request is still waiting, the
 * secret still has that version, the machine still has that key.
 */
export default defineEventHandler(async (event) => {
  const owner = await requireVaultOwner(event)
  const requestId = getRouterParam(event, 'id')
  const body = (await readBody<Record<string, unknown>>(event)) ?? {}
  const pkg = body.package as Record<string, unknown> | undefined
  const sealed = sealedField(pkg, 'package', MAX_VALUE_BYTES + 16)
  const epk = b64uField(pkg?.epk, 'package.epk', { exact: 65 })
  const signature = b64uField(body.signature, 'signature', { exact: 64 })

  const result = await vaultTransaction(async (tx) => {
    const challenge = await consumeChallenge(tx, body.challengeId, owner, 'request.approve')
    const d = challenge.descriptor as unknown as Descriptor
    if (d.requestId !== requestId) throw createProblemError({ status: 400, title: 'This confirmation belongs to another request' })
    const confirmedBy = await verifyVaultPasskey(tx, challenge.vaultId, body.assertion, challenge.matches)

    const request = await tx.select().from(secretAccessRequests).where(eq(secretAccessRequests.id, d.requestId)).get()
    const status = request ? requestStatus(request) : 'missing'
    if (status !== 'pending_approval') throw createProblemError({ status: 409, title: `This request is ${status.replace('_', ' ')}` })
    const secret = await tx.select().from(vaultSecrets).where(and(eq(vaultSecrets.id, d.secretId), isNull(vaultSecrets.deletedAt))).get()
    if (!secret || secret.currentVersion !== d.version) throw createProblemError({ status: 409, title: 'The secret changed while you were approving', detail: 'Open the request again to approve the current version.' })
    const machine = await tx.select().from(consumers).where(eq(consumers.id, d.consumerId)).get()
    if (!machine || await fingerprintOf(machine.publicKeyJwk) !== d.consumerKeyFingerprint) throw createProblemError({ status: 409, title: 'The machine key changed while you were approving' })

    // The vault signs what it hands out. A vault created before signing keys
    // existed gets its key now, from the browser that just unlocked the VMK.
    const vault = await tx.select().from(vaults).where(eq(vaults.id, challenge.vaultId)).get()
    let signingPublicJwk = vault?.signingPublicJwk
    if (!signingPublicJwk) {
      const created = signingKeyField(body.signingKey)
      signingPublicJwk = created.publicJwk
      await tx.update(vaults).set({ signingPublicJwk, signingKeyIv: created.keyWrap.iv, signingKeyCt: created.keyWrap.ct, updatedAt: nowSec() }).where(eq(vaults.id, challenge.vaultId))
    }
    const context = { vaultId: challenge.vaultId, approvalId: d.approvalId, consumerKeyFingerprint: d.consumerKeyFingerprint, secretId: d.secretId, version: d.version }
    const signed = await verifyDelivery(JSON.parse(signingPublicJwk) as JsonWebKey, { epk, ...sealed }, context, signature).catch(() => false)
    if (!signed) throw createProblemError({ status: 400, title: 'The package signature does not match this approval' })

    const now = nowSec()
    await tx.insert(secretApprovals).values({
      id: d.approvalId,
      requestId: d.requestId,
      vaultId: challenge.vaultId,
      ownerEmail: owner,
      requester: request!.requester,
      consumerId: d.consumerId,
      consumerFingerprint: d.consumerKeyFingerprint,
      secretId: d.secretId,
      secretVersion: d.version,
      mode: d.mode,
      expiresAt: d.expiresAt,
      status: 'active',
      packageEpk: epk,
      packageIv: sealed.iv,
      packageCt: sealed.ct,
      packageSig: signature,
      credentialId: confirmedBy.id,
      createdAt: now,
    })
    await tx.update(secretAccessRequests).set({ status: 'approved', decidedAt: now }).where(eq(secretAccessRequests.id, d.requestId))
    await audit(tx, { actor: owner, event: 'request.approved', vaultId: challenge.vaultId, credentialId: confirmedBy.id })
    return { id: d.approvalId, status: 'active', mode: d.mode, expires_at: d.expiresAt, created_at: now }
  })
  setResponseStatus(event, 201)
  return result
})
