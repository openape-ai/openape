import { eq } from 'drizzle-orm'
import { defineEventHandler, readBody, setResponseStatus } from 'h3'
import { verifyRecoveryProof } from '#shared/vault-crypto'
import { vaultRecovery } from '../../../../database/schema'
import { createProblemError } from '../../../../utils/problem'
import { requireVaultOwner } from '../../../../utils/vault-owner'
import { audit, b64uField, consumeChallenge, insertCredential, vaultTransaction, verifyNewPasskey, wrappedCredentialFields } from '../../../../utils/vault-passkeys'

/**
 * POST /api/v2/vault/recovery/commit — register a replacement passkey after the
 * browser proved it holds the recovery secret: it signed this challenge with
 * the proof key that only that secret unwraps. There is no other way back in;
 * the service has no reset.
 */
export default defineEventHandler(async (event) => {
  const owner = await requireVaultOwner(event)
  const body = (await readBody<Record<string, unknown>>(event)) ?? {}
  const fields = wrappedCredentialFields(body)
  const proof = b64uField(body.proof, 'proof', { max: 128 })
  const signed = typeof body.challenge === 'string' ? body.challenge : ''

  const result = await vaultTransaction(async (tx) => {
    const challenge = await consumeChallenge(tx, body.challengeId, owner, 'vault.recover')
    const recovery = await tx.select().from(vaultRecovery).where(eq(vaultRecovery.vaultId, challenge.vaultId)).get()
    const proven = !!recovery
      && await challenge.matches(signed)
      && await verifyRecoveryProof(JSON.parse(recovery.proofPublicJwk) as JsonWebKey, signed, proof).catch(() => false)
    if (!proven) throw createProblemError({ status: 400, title: 'The recovery code does not match this vault' })

    const passkey = await verifyNewPasskey(body.credential, challenge.matches)
    await insertCredential(tx, challenge.vaultId, passkey, fields)
    await audit(tx, { actor: owner, event: 'vault.recovered', vaultId: challenge.vaultId, credentialId: passkey.id })
    return { credential_id: passkey.id }
  })
  setResponseStatus(event, 201)
  return result
})
