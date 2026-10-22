import { defineEventHandler } from 'h3'
import { useDb } from '../../../../database/drizzle'
import { requireVaultOwner } from '../../../../utils/vault-owner'
import { activeCredentials, authenticationOptions, issueChallenge, registrationOptions } from '../../../../utils/vault-passkeys'
import { requireOwnVault } from '../../../../utils/vault-lookup'

/**
 * POST /api/v2/vault/credentials/options — add another passkey. One challenge
 * covers both ceremonies: a fresh assertion from a passkey the vault already
 * trusts, then the registration of the new one.
 */
export default defineEventHandler(async (event) => {
  const owner = await requireVaultOwner(event)
  const vault = await requireOwnVault(owner)
  const credentials = await activeCredentials(useDb(), vault.id)
  const { challengeId, challenge } = await issueChallenge(owner, 'credential.add', vault.id)
  return {
    challengeId,
    vaultId: vault.id,
    assertion: await authenticationOptions(challenge, credentials),
    publicKey: await registrationOptions(owner, vault.id, challenge, credentials),
  }
})
