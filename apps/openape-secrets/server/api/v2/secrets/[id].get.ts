import { desc, eq } from 'drizzle-orm'
import { defineEventHandler, getRouterParam } from 'h3'
import { useDb } from '../../../database/drizzle'
import { vaultSecretVersions } from '../../../database/schema'
import { requireOwnVault } from '../../../utils/vault-lookup'
import { requireVaultOwner } from '../../../utils/vault-owner'
import { requireOwnSecret } from '../../../utils/vault-secrets'

/**
 * GET /api/v2/secrets/:id — one secret's metadata, version history and the
 * current version's ciphertext. Only a passkey's PRF output, in the owner's
 * browser, turns that into a value.
 */
export default defineEventHandler(async (event) => {
  const owner = await requireVaultOwner(event)
  const vault = await requireOwnVault(owner)
  const secret = await requireOwnSecret(vault.id, getRouterParam(event, 'id'))
  const versions = await useDb().select().from(vaultSecretVersions).where(eq(vaultSecretVersions.secretId, secret.id)).orderBy(desc(vaultSecretVersions.version)).all()
  const current = versions.find(v => v.version === secret.currentVersion)! // written in the same transaction as currentVersion
  return {
    id: secret.id,
    alias: secret.alias,
    type: secret.type,
    version: secret.currentVersion,
    created_at: secret.createdAt,
    updated_at: secret.updatedAt,
    versions: versions.map(v => ({ version: v.version, created_at: v.createdAt })),
    sealed: { value: { iv: current.valueIv, ct: current.valueCt }, dek: { iv: current.dekIv, ct: current.dekCt } },
  }
})
