import { and, eq, isNull } from 'drizzle-orm'
import { defineEventHandler, readBody, setResponseStatus } from 'h3'
import { vaultCredentials, vaultSecrets, vaultSecretVersions } from '../../../../database/schema'
import { createProblemError } from '../../../../utils/problem'
import { requireVaultOwner } from '../../../../utils/vault-owner'
import { activeCredentials, audit, consumeChallenge, nowSec, vaultTransaction, verifyVaultPasskey } from '../../../../utils/vault-passkeys'
import { aliasField, sealedSecretField, typeField } from '../../../../utils/vault-secrets'

const changedMeanwhile = () => createProblemError({ status: 409, title: 'This secret changed meanwhile', detail: 'Reload it and try again.' })

/**
 * POST /api/v2/vault/actions/commit — apply the change prepared by
 * actions/options after a fresh assertion from one of the vault's passkeys.
 * Versions are append-only: a save that was prepared from an older version
 * than the current one is refused instead of overwriting newer work.
 */
export default defineEventHandler(async (event) => {
  const owner = await requireVaultOwner(event)
  const body = (await readBody<Record<string, unknown>>(event)) ?? {}

  const result = await vaultTransaction(async (tx) => {
    const challenge = await consumeChallenge(tx, body.challengeId, owner, 'vault.action')
    const { action, secretId, version, credentialId } = challenge.descriptor as { action: string, secretId: string, version: number, credentialId: string }
    const confirmedBy = await verifyVaultPasskey(tx, challenge.vaultId, body.assertion, challenge.matches)
    const now = nowSec()

    if (action === 'credential.disable') {
      if (confirmedBy.id === credentialId) throw createProblemError({ status: 400, title: 'Confirm with one of the passkeys you keep' })
      const active = await activeCredentials(tx, challenge.vaultId)
      if (!active.some(c => c.id === credentialId) || active.length < 2) throw createProblemError({ status: 409, title: 'This passkey cannot be removed now', detail: 'Reload your passkeys and try again.' })
      await tx.update(vaultCredentials).set({ disabledAt: now }).where(eq(vaultCredentials.id, credentialId))
      await audit(tx, { actor: owner, event: 'credential.disabled', vaultId: challenge.vaultId, credentialId: confirmedBy.id })
      return { credential_id: credentialId, status: 'disabled' }
    }

    const current = await tx.select().from(vaultSecrets).where(and(eq(vaultSecrets.id, secretId), eq(vaultSecrets.vaultId, challenge.vaultId))).get()

    if (action === 'secret.delete') {
      if (!current || current.deletedAt || current.currentVersion !== version) throw changedMeanwhile()
      await tx.update(vaultSecrets).set({ deletedAt: now, updatedAt: now }).where(eq(vaultSecrets.id, secretId))
      // The name stays as a tombstone for approval history; the ciphertext goes.
      await tx.delete(vaultSecretVersions).where(eq(vaultSecretVersions.secretId, secretId))
    }
    else {
      const sealed = sealedSecretField(body.sealed)
      if (version === 1) {
        if (current) throw changedMeanwhile()
        const alias = aliasField(body.alias)
        const taken = await tx.select({ id: vaultSecrets.id }).from(vaultSecrets).where(and(eq(vaultSecrets.vaultId, challenge.vaultId), eq(vaultSecrets.alias, alias), isNull(vaultSecrets.deletedAt))).get()
        if (taken) throw createProblemError({ status: 409, title: `${alias} is already in your vault`, detail: 'Save a new version of it instead.' })
        await tx.insert(vaultSecrets).values({ id: secretId, vaultId: challenge.vaultId, alias, type: typeField(body.type), currentVersion: 1, createdAt: now, updatedAt: now })
      }
      else {
        if (!current || current.deletedAt || current.currentVersion !== version - 1) throw changedMeanwhile()
        await tx.update(vaultSecrets).set({ currentVersion: version, updatedAt: now }).where(eq(vaultSecrets.id, secretId))
      }
      await tx.insert(vaultSecretVersions).values({ secretId, version, valueIv: sealed.value.iv, valueCt: sealed.value.ct, dekIv: sealed.dek.iv, dekCt: sealed.dek.ct, createdAt: now })
    }

    await audit(tx, { actor: owner, event: action === 'secret.delete' ? 'secret.deleted' : 'secret.saved', vaultId: challenge.vaultId, credentialId: confirmedBy.id })
    return { secret_id: secretId, version }
  })
  setResponseStatus(event, 201)
  return result
})
