import { eq } from 'drizzle-orm'
import { defineEventHandler } from 'h3'
import { ulid } from 'ulid'
import { useDb } from '../../../../database/drizzle'
import { vaults } from '../../../../database/schema'
import { createProblemError } from '../../../../utils/problem'
import { requireVaultOwner } from '../../../../utils/vault-owner'
import { issueChallenge, registrationOptions } from '../../../../utils/vault-passkeys'

/** POST /api/v2/vault/setup/options — start creating a vault with its first passkey. */
export default defineEventHandler(async (event) => {
  const owner = await requireVaultOwner(event)
  const existing = await useDb().select({ id: vaults.id }).from(vaults).where(eq(vaults.ownerEmail, owner)).get()
  if (existing) throw createProblemError({ status: 409, title: 'You already have a vault' })

  const vaultId = ulid()
  const { challengeId, challenge } = await issueChallenge(owner, 'vault.setup', vaultId)
  return { challengeId, vaultId, publicKey: await registrationOptions(owner, vaultId, challenge, []) }
})
