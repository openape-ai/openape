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
 * version, `{ action: 'secret.delete', secretId }` to delete one,
 * `{ action: 'credential.disable', credentialId }` to remove a lost passkey.
 * Removing a passkey must be confirmed by one of the passkeys that stay.
 */
export default defineEventHandler(async (event) => {
  const owner = await requireVaultOwner(event)
  const body = (await readBody<{ action?: unknown, secretId?: unknown, credentialId?: unknown }>(event)) ?? {}
  const vault = await requireOwnVault(owner)
  let confirmers = await activeCredentials(useDb(), vault.id)

  let descriptor: { action: string, secretId?: string, version?: number, credentialId?: string }
  if (body.action === 'secret.save' && body.secretId === undefined) {
    descriptor = { action: 'secret.save', secretId: ulid(), version: 1 }
  }
  else if (body.action === 'secret.save' || body.action === 'secret.delete') {
    const secret = await requireOwnSecret(vault.id, body.secretId)
    descriptor = { action: body.action, secretId: secret.id, version: body.action === 'secret.save' ? secret.currentVersion + 1 : secret.currentVersion }
  }
  else if (body.action === 'credential.disable') {
    const target = confirmers.find(c => c.id === body.credentialId)
    if (!target) throw createProblemError({ status: 404, title: 'Passkey not found' })
    if (confirmers.length < 2) throw createProblemError({ status: 409, title: 'This is your only passkey', detail: 'Add another passkey first, then remove this one.' })
    descriptor = { action: 'credential.disable', credentialId: target.id }
    confirmers = confirmers.filter(c => c.id !== target.id)
  }
  else {
    throw createProblemError({ status: 400, title: 'action must be secret.save, secret.delete or credential.disable' })
  }

  const { challengeId, challenge } = await issueChallenge(owner, 'vault.action', vault.id, descriptor)
  return {
    challengeId,
    vaultId: vault.id,
    ...descriptor,
    assertion: await authenticationOptions(challenge, confirmers),
  }
})
