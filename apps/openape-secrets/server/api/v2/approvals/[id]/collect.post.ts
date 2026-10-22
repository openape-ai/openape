import { and, eq, gt, isNull, or, sql } from 'drizzle-orm'
import { defineEventHandler, getRouterParam } from 'h3'
import { useDb } from '../../../../database/drizzle'
import { consumers, secretApprovals, vaults } from '../../../../database/schema'
import { createProblemError } from '../../../../utils/problem'
import { rateLimit } from '../../../../utils/rate-limit'
import { audit, nowSec } from '../../../../utils/vault-passkeys'
import { approvalStatus, auditRefusal, currentVersionOf, EMPTY_PACKAGE, fingerprintOf } from '../../../../utils/vault-requests'

/**
 * POST /api/v2/approvals/:id/collect — the requesting identity picks up the
 * package sealed for its machine. Everything that decides whether it may is
 * part of one UPDATE: still active, not past its end, still the current
 * secret version. Two simultaneous collections of a once approval therefore
 * yield one package at most, and a collection at the exact end time fails
 * whether or not anybody looked at the status first.
 *
 * Only ciphertext and the vault's signature leave here; the machine verifies
 * the signature against the vault key it pinned and opens the package itself.
 */
export default defineEventHandler(async (event) => {
  if (!useRuntimeConfig().vaultEnabled) throw createProblemError({ status: 404, title: 'Not found' })
  const caller = await requireCaller(event)
  rateLimit(event, `collect:${caller.email}`)
  const id = getRouterParam(event, 'id') ?? ''
  const db = useDb()

  const approval = await db.select().from(secretApprovals).where(eq(secretApprovals.id, id)).get()
  // Only the identity the owner approved for may collect; everyone else sees no approval at all.
  if (!approval || approval.requester !== caller.email) {
    await auditRefusal({ actor: caller.email, event: 'approval.collect', vaultId: approval?.vaultId })
    throw createProblemError({ status: 404, title: 'Approval not found' })
  }
  const machine = await db.select().from(consumers).where(eq(consumers.id, approval.consumerId)).get()
  if (!machine || await fingerprintOf(machine.publicKeyJwk) !== approval.consumerFingerprint) {
    await auditRefusal({ actor: caller.email, event: 'approval.collect', vaultId: approval.vaultId })
    throw createProblemError({ status: 409, title: 'The machine key changed since this approval', detail: 'Ask for the secret again from the machine.' })
  }

  const now = nowSec()
  const collectable = and(
    eq(secretApprovals.id, id),
    eq(secretApprovals.status, 'active'),
    or(isNull(secretApprovals.expiresAt), gt(secretApprovals.expiresAt, now)),
    sql`${secretApprovals.secretVersion} = ${currentVersionOf}`,
  )
  const counted = { collectCount: sql`${secretApprovals.collectCount} + 1`, lastCollectedAt: now }
  const row = await db.update(secretApprovals)
    .set(approval.mode === 'once' ? { ...counted, status: 'consumed', consumedAt: now } : counted)
    .where(collectable)
    .returning()
    .get()

  if (!row) {
    await auditRefusal({ actor: caller.email, event: 'approval.collect', vaultId: approval.vaultId })
    const fresh = (await db.select().from(secretApprovals).where(eq(secretApprovals.id, id)).get())!
    const current = await db.get<{ v: number | null }>(sql`SELECT ${currentVersionOf} AS v FROM secret_approvals WHERE id = ${id}`)
    const state = approvalStatus(fresh, current?.v ?? null, now)
    if (state === 'superseded') throw createProblemError({ status: 409, title: 'A newer version replaced this secret', detail: 'Ask for it again to get the current version.' })
    const reason = { consumed: 'This approval was already collected', revoked: 'The owner revoked this approval', expired: 'This approval has ended' }[state] ?? 'This approval cannot be collected'
    throw createProblemError({ status: 410, title: reason })
  }

  // A once package has done its job; nothing should be left to steal.
  if (row.mode === 'once') await db.update(secretApprovals).set(EMPTY_PACKAGE).where(eq(secretApprovals.id, id))
  const vault = await db.select({ signingPublicJwk: vaults.signingPublicJwk }).from(vaults).where(eq(vaults.id, row.vaultId)).get()
  await db.transaction(tx => audit(tx, { actor: caller.email, event: 'approval.collected', vaultId: row.vaultId }))

  return {
    approval_id: row.id,
    mode: row.mode,
    expires_at: row.expiresAt,
    vault_id: row.vaultId,
    consumer_key_fingerprint: row.consumerFingerprint,
    secret: { id: row.secretId, version: row.secretVersion },
    package: { epk: row.packageEpk, iv: row.packageIv, ct: row.packageCt },
    signature: row.packageSig,
    vault_signing_key: JSON.parse(vault!.signingPublicJwk!) as JsonWebKey, // approvals are only stored after a signature check against this key
  }
})
