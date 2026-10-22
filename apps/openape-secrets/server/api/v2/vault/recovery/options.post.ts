import { eq } from 'drizzle-orm'
import { defineEventHandler } from 'h3'
import { useDb } from '../../../../database/drizzle'
import { vaultRecovery } from '../../../../database/schema'
import { createProblemError } from '../../../../utils/problem'
import { requireOwnVault } from '../../../../utils/vault-lookup'
import { requireVaultOwner } from '../../../../utils/vault-owner'
import { activeCredentials, issueChallenge, registrationOptions } from '../../../../utils/vault-passkeys'

/**
 * POST /api/v2/vault/recovery/options — start replacing lost passkeys with the
 * recovery secret. Returns the recovery wrappers (ciphertext only), a challenge
 * to sign with the recovery proof key, and options for the replacement passkey.
 */
export default defineEventHandler(async (event) => {
  const owner = await requireVaultOwner(event)
  const db = useDb()
  const vault = await requireOwnVault(owner)
  const recovery = await db.select().from(vaultRecovery).where(eq(vaultRecovery.vaultId, vault.id)).get()
  if (!recovery) throw createProblemError({ status: 409, title: 'This vault has no recovery kit' })

  const { challengeId, challenge } = await issueChallenge(owner, 'vault.recover', vault.id)
  return {
    challengeId,
    challenge,
    vaultId: vault.id,
    recovery: {
      recoverySalt: recovery.recoverySalt,
      vmkWrap: { iv: recovery.vmkIv, ct: recovery.vmkCt },
      proofKeyWrap: { iv: recovery.proofKeyIv, ct: recovery.proofKeyCt },
      proofPublicJwk: JSON.parse(recovery.proofPublicJwk) as JsonWebKey,
    },
    publicKey: await registrationOptions(owner, vault.id, challenge, await activeCredentials(db, vault.id)),
  }
})
