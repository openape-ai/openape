import { and, desc, eq, isNull } from 'drizzle-orm'
import { defineEventHandler } from 'h3'
import { useDb } from '../../../database/drizzle'
import { vaults, vaultSecrets } from '../../../database/schema'
import { requireVaultOwner } from '../../../utils/vault-owner'

/** GET /api/v2/secrets — names, types and versions of the owner's secrets. No ciphertext. */
export default defineEventHandler(async (event) => {
  const owner = await requireVaultOwner(event)
  const db = useDb()
  const vault = await db.select({ id: vaults.id }).from(vaults).where(eq(vaults.ownerEmail, owner)).get()
  if (!vault) return []
  const rows = await db.select().from(vaultSecrets).where(and(eq(vaultSecrets.vaultId, vault.id), isNull(vaultSecrets.deletedAt))).orderBy(desc(vaultSecrets.updatedAt)).all()
  return rows.map(r => ({ id: r.id, alias: r.alias, type: r.type, version: r.currentVersion, created_at: r.createdAt, updated_at: r.updatedAt }))
})
