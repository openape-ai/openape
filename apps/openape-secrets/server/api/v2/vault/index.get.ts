import { eq } from 'drizzle-orm'
import { defineEventHandler } from 'h3'
import { keyFingerprint } from '#shared/vault-crypto'
import { useDb } from '../../../database/drizzle'
import { vaultRecovery, vaults } from '../../../database/schema'
import { requireVaultOwner } from '../../../utils/vault-owner'
import { activeCredentials } from '../../../utils/vault-passkeys'

/**
 * GET /api/v2/vault — the owner's vault metadata and the wrapped VMK per
 * passkey. Everything here is ciphertext or public: unlocking happens in the
 * browser with a passkey's PRF output, which this service never sees.
 */
export default defineEventHandler(async (event) => {
  const owner = await requireVaultOwner(event)
  const db = useDb()
  const vault = await db.select().from(vaults).where(eq(vaults.ownerEmail, owner)).get()
  if (!vault) return { id: null, credentials: [], has_recovery: false }

  const [credentials, recovery] = await Promise.all([
    activeCredentials(db, vault.id),
    db.select({ vaultId: vaultRecovery.vaultId }).from(vaultRecovery).where(eq(vaultRecovery.vaultId, vault.id)).get(),
  ])
  return {
    id: vault.id,
    created_at: vault.createdAt,
    has_recovery: !!recovery,
    /** Machines pin this key to tell vault-made packages from injected ones. */
    signing_key_fingerprint: vault.signingPublicJwk ? await keyFingerprint(JSON.parse(vault.signingPublicJwk) as JsonWebKey) : null,
    credentials: credentials.map(c => ({
      id: c.id,
      label: c.label,
      created_at: c.createdAt,
      transports: JSON.parse(c.transports) as string[],
      prfInput: c.prfInput,
      kdfSalt: c.kdfSalt,
      vmkWrap: { iv: c.vmkIv, ct: c.vmkCt },
    })),
  }
})
