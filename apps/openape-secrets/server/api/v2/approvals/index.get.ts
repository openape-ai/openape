import { desc, eq, inArray } from 'drizzle-orm'
import { defineEventHandler } from 'h3'
import { useDb } from '../../../database/drizzle'
import { consumers, secretApprovals, vaultSecrets } from '../../../database/schema'
import { requireVaultOwner } from '../../../utils/vault-owner'
import { approvalStatus } from '../../../utils/vault-requests'

/** GET /api/v2/approvals — every handover the owner approved, newest first. No packages. */
export default defineEventHandler(async (event) => {
  const owner = await requireVaultOwner(event)
  const db = useDb()
  const rows = await db.select().from(secretApprovals).where(eq(secretApprovals.ownerEmail, owner)).orderBy(desc(secretApprovals.createdAt)).all()
  if (!rows.length) return []
  const [machines, secrets] = await Promise.all([
    db.select().from(consumers).where(inArray(consumers.id, [...new Set(rows.map(r => r.consumerId))])).all(),
    db.select().from(vaultSecrets).where(inArray(vaultSecrets.id, [...new Set(rows.map(r => r.secretId))])).all(),
  ])
  return rows.map((row) => {
    const secret = secrets.find(s => s.id === row.secretId)
    return {
      id: row.id,
      status: approvalStatus(row, secret && !secret.deletedAt ? secret.currentVersion : null),
      mode: row.mode,
      expires_at: row.expiresAt,
      created_at: row.createdAt,
      consumed_at: row.consumedAt,
      collect_count: row.collectCount,
      last_collected_at: row.lastCollectedAt,
      revoked_at: row.revokedAt,
      requester: row.requester,
      consumer: { id: row.consumerId, name: machines.find(m => m.id === row.consumerId)?.name ?? 'Unknown machine', fingerprint: row.consumerFingerprint },
      secret: { id: row.secretId, alias: secret?.alias ?? 'Deleted secret', version: row.secretVersion },
    }
  })
})
