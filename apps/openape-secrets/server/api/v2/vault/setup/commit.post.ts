import { eq } from 'drizzle-orm'
import { defineEventHandler, readBody, setResponseStatus } from 'h3'
import { vaultRecovery, vaults } from '../../../../database/schema'
import { isP256PublicJwk } from '../../../consumers/index.post'
import { createProblemError } from '../../../../utils/problem'
import { requireVaultOwner } from '../../../../utils/vault-owner'
import { audit, b64uField, consumeChallenge, insertCredential, nowSec, sealedField, signingKeyField, vaultTransaction, verifyNewPasskey, wrappedCredentialFields } from '../../../../utils/vault-passkeys'

/**
 * POST /api/v2/vault/setup/commit — create the vault, its first passkey and its
 * recovery wrapper in one transaction. The browser has already proved locally
 * that this passkey's PRF output wraps and unwraps the VMK.
 */
export default defineEventHandler(async (event) => {
  const owner = await requireVaultOwner(event)
  const body = (await readBody<Record<string, unknown>>(event)) ?? {}
  const fields = wrappedCredentialFields(body)
  const recovery = body.recovery as Record<string, unknown> | undefined
  const recoveryRow = {
    recoverySalt: b64uField(recovery?.recoverySalt, 'recovery.recoverySalt', { exact: 32 }),
    vmk: sealedField(recovery?.vmkWrap, 'recovery.vmkWrap', 48),
    proofKey: sealedField(recovery?.proofKeyWrap, 'recovery.proofKeyWrap', 512),
    proofPublicJwk: recovery?.proofPublicJwk,
  }
  if (!isP256PublicJwk(recoveryRow.proofPublicJwk)) throw createProblemError({ status: 400, title: 'recovery.proofPublicJwk must be a public P-256 JWK' })
  const { kty, crv, x, y } = recoveryRow.proofPublicJwk
  const signing = signingKeyField(body.signingKey)

  const result = await vaultTransaction(async (tx) => {
    const challenge = await consumeChallenge(tx, body.challengeId, owner, 'vault.setup')
    const existing = await tx.select({ id: vaults.id }).from(vaults).where(eq(vaults.ownerEmail, owner)).get()
    if (existing) throw createProblemError({ status: 409, title: 'You already have a vault' })
    const passkey = await verifyNewPasskey(body.credential, challenge.matches)

    const vaultId = challenge.vaultId
    await tx.insert(vaults).values({ id: vaultId, ownerEmail: owner, signingPublicJwk: signing.publicJwk, signingKeyIv: signing.keyWrap.iv, signingKeyCt: signing.keyWrap.ct, createdAt: nowSec(), updatedAt: nowSec() })
    await insertCredential(tx, vaultId, passkey, fields)
    await tx.insert(vaultRecovery).values({
      vaultId,
      recoverySalt: recoveryRow.recoverySalt,
      vmkIv: recoveryRow.vmk.iv,
      vmkCt: recoveryRow.vmk.ct,
      proofKeyIv: recoveryRow.proofKey.iv,
      proofKeyCt: recoveryRow.proofKey.ct,
      proofPublicJwk: JSON.stringify({ kty, crv, x, y }),
      createdAt: nowSec(),
    })
    await audit(tx, { actor: owner, event: 'vault.created', vaultId, credentialId: passkey.id })
    return { vault_id: vaultId, credential_id: passkey.id }
  })
  setResponseStatus(event, 201)
  return result
})
