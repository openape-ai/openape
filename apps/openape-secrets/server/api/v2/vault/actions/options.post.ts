import { defineEventHandler, readBody } from 'h3'
import { ulid } from 'ulid'
import { useDb } from '../../../../database/drizzle'
import { createProblemError } from '../../../../utils/problem'
import { requireOwnVault } from '../../../../utils/vault-lookup'
import { requireVaultOwner } from '../../../../utils/vault-owner'
import { activeCredentials, authenticationOptions, issueChallenge } from '../../../../utils/vault-passkeys'
import { requireOwnSecret } from '../../../../utils/vault-secrets'

/**
 * POST /api/v2/vault/actions/options — prepare a change to the vault's
 * contents. The server fixes what the passkey will confirm (which secret, which
 * version) before the owner is asked, so the commit cannot change it.
 *
 * Body: `{ action: 'secret.save', secretId? }` for a new secret or its next
 * version, `{ action: 'secret.delete', secretId }` to delete one.
 */
export default defineEventHandler(async (event) => {
  const owner = await requireVaultOwner(event)
  const body = (await readBody<{ action?: unknown, secretId?: unknown }>(event)) ?? {}
  const vault = await requireOwnVault(owner)

  let descriptor: { action: string, secretId: string, version: number }
  if (body.action === 'secret.save' && body.secretId === undefined) {
    descriptor = { action: 'secret.save', secretId: ulid(), version: 1 }
  }
  else if (body.action === 'secret.save' || body.action === 'secret.delete') {
    const secret = await requireOwnSecret(vault.id, body.secretId)
    descriptor = { action: body.action, secretId: secret.id, version: body.action === 'secret.save' ? secret.currentVersion + 1 : secret.currentVersion }
  }
  else {
    throw createProblemError({ status: 400, title: 'action must be secret.save or secret.delete' })
  }

  const { challengeId, challenge } = await issueChallenge(owner, 'vault.action', vault.id, descriptor)
  return {
    challengeId,
    vaultId: vault.id,
    ...descriptor,
    assertion: await authenticationOptions(challenge, await activeCredentials(useDb(), vault.id)),
  }
})
