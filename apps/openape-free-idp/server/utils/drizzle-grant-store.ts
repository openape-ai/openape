import type { OpenApeGrant, OpenApeGrantRequest, PaginatedResponse } from '@openape/core'
import type { GrantListParams, GrantStore } from '@openape/grants'
import { assertGrantReferenceRequest, assertSameReferencedGrant, grantReferenceKey, grantCursor, parseGrantCursor } from '@openape/grants'
import { and, desc, eq, ne, inArray, isNull, or, lt, sql } from 'drizzle-orm'
import { useDb } from '../database/drizzle'
import { brokerAudit, brokerConnections, grants } from '../database/schema'
import { createError } from 'h3'
import { brokerAuditRow } from './broker-audit'

interface ExtendedGrantStore extends GrantStore {
  findAll: () => Promise<OpenApeGrant[]>
  findByDelegate: (delegate: string) => Promise<OpenApeGrant[]>
  findByDelegator: (delegator: string) => Promise<OpenApeGrant[]>
  claimOnce: NonNullable<GrantStore['claimOnce']>
  markConsumed: NonNullable<GrantStore['markConsumed']>
}

type GrantRow = typeof grants.$inferSelect

const PENDING_REQUEST_TTL_SECONDS = 48 * 3600
export const BROKER_PENDING_LIMIT = 300
const pendingExpirations = new WeakMap<ReturnType<typeof useDb>, Promise<void>>()

export function grantToRow(grant: OpenApeGrant) {
  return {
    id: grant.id,
    status: grant.status,
    type: grant.type ?? null,
    requester: grant.request.requester,
    referenceKey: grant.request.reference === undefined ? null : grantReferenceKey(grant.request.requester, grant.request.reference, grant.brokered),
    brokered: grant.brokered ?? null,
    brokerOwner: grant.brokered?.owner ?? null,
    targetHost: grant.request.target_host,
    audience: grant.request.audience,
    grantType: grant.request.grant_type ?? 'once',
    request: grant.request as unknown as Record<string, unknown>,
    createdAt: grant.created_at,
    decidedAt: grant.decided_at ?? null,
    decidedBy: grant.decided_by ?? null,
    expiresAt: grant.expires_at ?? null,
    usedAt: grant.used_at ?? null,
    withdrawReason: grant.withdraw_reason ?? null,
    decidedByStandingGrant: grant.decided_by_standing_grant ?? null,
    autoApprovalKind: grant.auto_approval_kind ?? null,
  }
}

export function rowToGrant(row: GrantRow): OpenApeGrant {
  const request = row.request as unknown as OpenApeGrantRequest
  return {
    ...(row.brokered ? { brokered: row.brokered as OpenApeGrant['brokered'] } : {}),
    id: row.id,
    type: row.type as OpenApeGrant['type'],
    request: {
      ...request,
      requester: row.requester,
      target_host: row.targetHost,
      audience: row.audience,
      grant_type: row.grantType as OpenApeGrantRequest['grant_type'],
    },
    status: row.status as OpenApeGrant['status'],
    created_at: row.createdAt,
    decided_at: row.decidedAt ?? undefined,
    decided_by: row.decidedBy ?? undefined,
    expires_at: row.expiresAt ?? undefined,
    used_at: row.usedAt ?? undefined,
    ...(row.withdrawReason ? { withdraw_reason: row.withdrawReason } : {}),
    decided_by_standing_grant: row.decidedByStandingGrant ?? undefined,
    auto_approval_kind: (row.autoApprovalKind as OpenApeGrant['auto_approval_kind']) ?? undefined,
  }
}

/** SQLite serializes writers; retry only lock contention, never a binding conflict. */
async function retryReferenceTransaction<T>(write: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try { return await write() }
    catch (error) {
      if (attempt >= 7 || !(error && typeof error === 'object' && 'code' in error && error.code === 'SQLITE_BUSY')) throw error
      await new Promise(resolve => setTimeout(resolve, 10 * (attempt + 1)))
    }
  }
}

export function createDrizzleGrantStore(): ExtendedGrantStore {
  const db = useDb()

  async function expirePendingRequests() {
    const pending = pendingExpirations.get(db)
    if (pending) return pending
    const expiration = expireRequests()
    pendingExpirations.set(db, expiration)
    try { await expiration }
    finally { pendingExpirations.delete(db) }
  }

  async function expireRequests() {
    const cutoff = Math.floor(Date.now() / 1000) - PENDING_REQUEST_TTL_SECONDS
    const condition = and(eq(grants.status, 'pending'), lt(grants.createdAt, cutoff))
    const expiredRequest = await db.select({ id: grants.id }).from(grants).where(condition).limit(1).get()
    if (!expiredRequest) return
    await db.transaction(async (tx) => {
      const expired = await tx.update(grants)
        .set({ status: 'expired' })
        .where(condition)
        .returning()
      for (const row of expired) {
        if (row.brokered) await tx.insert(brokerAudit).values(brokerAuditRow(rowToGrant(row), 'expired'))
      }
    }, { behavior: 'immediate' })
  }

  return {
    async createReferenced(grant) {
      assertGrantReferenceRequest(grant.request)
      const row = grantToRow(grant)
      if (!row.referenceKey) throw new Error('A reference is required')
      await expirePendingRequests()
      return await retryReferenceTransaction(() => db.transaction(async (tx) => {
        if (grant.brokered) {
          const connection = await tx.select().from(brokerConnections).where(eq(brokerConnections.id, grant.brokered.connection_id)).get()
          if (!connection || connection.status !== 'active' || connection.owner !== grant.brokered.owner) throw createError({ statusCode: 403, statusMessage: 'Broker connection is missing or revoked' })
        }
        const existing = await tx.select().from(grants).where(eq(grants.referenceKey, row.referenceKey!)).get()
        if (existing) {
          const retained = rowToGrant(existing)
          assertSameReferencedGrant(retained, grant)
          return { grant: retained, created: false }
        }
        if (grant.brokered) {
          const pending = await tx.select({ count: sql<number>`count(*)` }).from(grants).where(and(eq(grants.brokerOwner, grant.brokered.owner), eq(grants.status, 'pending'))).get()
          if ((pending?.count ?? 0) >= BROKER_PENDING_LIMIT) throw createError({ statusCode: 429, statusMessage: 'Decide or dismiss existing broker requests before submitting more' })
        }
        await tx.insert(grants).values(row)
        if (grant.brokered) await tx.insert(brokerAudit).values(brokerAuditRow(grant, 'created'))
        return { grant, created: true }
      }, { behavior: 'immediate' }))
    },

    async save(grant) {
      if (grant.request.reference !== undefined) throw new Error('Use atomic createReferenced for a referenced grant')
      const row = grantToRow(grant)
      if (grant.brokered) {
        await expirePendingRequests()
        await db.transaction(async (tx) => {
          const connection = await tx.select().from(brokerConnections).where(eq(brokerConnections.id, grant.brokered!.connection_id)).get()
          if (!connection || connection.status !== 'active' || connection.owner !== grant.brokered!.owner) throw createError({ statusCode: 403, statusMessage: 'Broker connection is missing or revoked' })
          const pending = await tx.select({ count: sql<number>`count(*)` }).from(grants).where(and(eq(grants.brokerOwner, grant.brokered!.owner), eq(grants.status, 'pending'))).get()
          // A request batch submits one once-grant per item (up to 30), so the inbox bound counts items, not decisions.
          if ((pending?.count ?? 0) >= BROKER_PENDING_LIMIT) throw createError({ statusCode: 429, statusMessage: 'Decide or dismiss existing broker requests before submitting more' })
          await tx.insert(grants).values(row)
          await tx.insert(brokerAudit).values(brokerAuditRow(grant, 'created'))
        }, { behavior: 'immediate' })
        return
      }

      await db.insert(grants).values(row).onConflictDoUpdate({
        target: grants.id,
        set: {
          status: row.status,
          type: row.type,
          requester: row.requester,
          brokered: row.brokered,
          brokerOwner: row.brokerOwner,
          targetHost: row.targetHost,
          audience: row.audience,
          grantType: row.grantType,
          request: row.request,
          createdAt: row.createdAt,
          decidedAt: row.decidedAt,
          decidedBy: row.decidedBy,
          expiresAt: row.expiresAt,
          usedAt: row.usedAt,
          decidedByStandingGrant: row.decidedByStandingGrant,
          autoApprovalKind: row.autoApprovalKind,
        },
      })

    },

    async findById(id) {
      await expirePendingRequests()
      const row = await db.select().from(grants).where(eq(grants.id, id)).get()
      return row ? rowToGrant(row) : null
    },

    async updateStatus(id, status, extra?) {
      await expirePendingRequests()
      await db.transaction(async (tx) => {
        const existing = await tx.select().from(grants).where(eq(grants.id, id)).get()
        if (!existing)
          throw new Error(`Grant not found: ${id}`)

        if (extra?.request && rowToGrant(existing).request.reference) assertSameReferencedGrant(rowToGrant(existing), { ...rowToGrant(existing), request: extra.request })
        if ((existing.brokered || existing.referenceKey || existing.status === 'expired') && (status === 'approved' || status === 'denied') && existing.status !== 'pending') throw createError({ statusCode: 409, statusMessage: 'Grant was already decided' })
        if (existing.status === 'withdrawn') throw createError({ statusCode: 409, statusMessage: 'Grant was withdrawn by its requester' })
        const updates: Record<string, unknown> = { status }
        if (extra?.decided_by !== undefined) updates.decidedBy = extra.decided_by
        if (extra?.decided_at !== undefined) updates.decidedAt = extra.decided_at
        if (extra?.expires_at !== undefined) updates.expiresAt = extra.expires_at
        if (extra?.used_at !== undefined) updates.usedAt = extra.used_at
        if ((extra as Record<string, unknown> | undefined)?.decided_by_standing_grant !== undefined) {
          updates.decidedByStandingGrant = (extra as Record<string, unknown>).decided_by_standing_grant
        }
        if ((extra as Record<string, unknown> | undefined)?.auto_approval_kind !== undefined) {
          updates.autoApprovalKind = (extra as Record<string, unknown>).auto_approval_kind
        }
        if (extra?.request !== undefined) {
          updates.request = extra.request as unknown as Record<string, unknown>
          updates.grantType = (extra.request as OpenApeGrantRequest).grant_type ?? 'once'
        }

        await tx.update(grants).set(updates).where(eq(grants.id, id))
        if (existing.brokered) await tx.insert(brokerAudit).values(brokerAuditRow(rowToGrant(existing), status))
      }, { behavior: 'immediate' })
    },

    async claimOnce(id, usedAt) {
      return await db.transaction(async (tx) => {
        const claimed = await tx.update(grants).set({ status: 'used', usedAt }).where(and(eq(grants.id, id), eq(grants.status, 'approved'))).returning()
        const row = claimed[0]
        if (!row) return false
        if (row.brokered) await tx.insert(brokerAudit).values(brokerAuditRow(rowToGrant(row), 'used'))
        return true
      }, { behavior: 'immediate' })
    },

    async withdraw(id, withdrawnAt, reason) {
      return await retryReferenceTransaction(() => db.transaction(async (tx) => {
        // The immediate transaction holds the write lock, so the status read here is the one replaced.
        const previous = await tx.select({ status: grants.status, grantType: grants.grantType }).from(grants).where(eq(grants.id, id)).get()
        if (!previous || !(previous.status === 'pending' || (previous.status === 'approved' && previous.grantType === 'once'))) return null
        const withdrawn = await tx.update(grants).set({ status: 'withdrawn', decidedAt: withdrawnAt, withdrawReason: reason ?? null }).where(and(eq(grants.id, id), eq(grants.status, previous.status))).returning()
        const row = withdrawn[0]
        if (!row) return null
        if (row.brokered) await tx.insert(brokerAudit).values(brokerAuditRow(rowToGrant(row), 'withdrawn'))
        return previous.status as 'pending' | 'approved'
      }, { behavior: 'immediate' }))
    },

    async markConsumed(id, jti) {
      const redeemed = await db.update(grants).set({ consumedJti: jti }).where(and(eq(grants.id, id), isNull(grants.consumedJti))).returning({ id: grants.id })
      return redeemed.length > 0
    },

    async findPending() {
      await expirePendingRequests()
      const rows = await db.select().from(grants).where(eq(grants.status, 'pending')).orderBy(desc(grants.createdAt))
      return rows.map(rowToGrant)
    },

    async findByRequester(requester) {
      await expirePendingRequests()
      const rows = await db.select().from(grants).where(eq(grants.requester, requester)).orderBy(desc(grants.createdAt))
      return rows.map(rowToGrant)
    },

    async findAll() {
      await expirePendingRequests()
      const rows = await db.select().from(grants).orderBy(desc(grants.createdAt))
      return rows.map(rowToGrant)
    },

    async findByDelegate(delegate) {
      await expirePendingRequests()
      const condition = and(eq(grants.type, 'delegation'), sql`json_extract(${grants.request}, '$.delegate') = ${delegate}`)
      const rows = await db.select().from(grants).where(condition).orderBy(desc(grants.createdAt))
      return rows.map(rowToGrant)
    },

    async findByDelegator(delegator) {
      await expirePendingRequests()
      const condition = and(eq(grants.type, 'delegation'), sql`json_extract(${grants.request}, '$.delegator') = ${delegator}`)
      const rows = await db.select().from(grants).where(condition).orderBy(desc(grants.createdAt))
      return rows.map(rowToGrant)
    },

    async listGrants(params?: GrantListParams): Promise<PaginatedResponse<OpenApeGrant>> {
      await expirePendingRequests()
      const limit = Math.min(Math.max(params?.limit ?? 20, 1), 1000)
      const conditions = []

      if (params?.excludeStatus) conditions.push(ne(grants.status, params.excludeStatus))
      if (params?.status)
        conditions.push(eq(grants.status, params.status))
      if (params?.requester) {
        const requesters = Array.isArray(params.requester) ? params.requester : [params.requester]
        if (params.brokerOwner === null) conditions.push(and(isNull(grants.brokered), inArray(grants.requester, requesters)))
        else if (params.brokerOwner) conditions.push(or(and(isNull(grants.brokered), inArray(grants.requester, requesters)), eq(grants.brokerOwner, params.brokerOwner)))
        else conditions.push(inArray(grants.requester, requesters))
      }
      if (params?.requesterFilter) conditions.push(eq(grants.requester, params.requesterFilter))
      if (params?.batch) conditions.push(sql`json_extract(${grants.request}, '$.batch.id') = ${params.batch}`)
      if (params?.reference) conditions.push(sql`json_extract(${grants.request}, '$.reference') = ${params.reference}`)
      if (params?.referenceKey) conditions.push(eq(grants.referenceKey, params.referenceKey))
      if (params?.cursor) {
        const position = parseGrantCursor(params.cursor)
        conditions.push(position.id === undefined ? lt(grants.createdAt, position.createdAt) : or(lt(grants.createdAt, position.createdAt), and(eq(grants.createdAt, position.createdAt), lt(grants.id, position.id))))
      }

      const where = conditions.length > 0 ? and(...conditions) : undefined
      const rows = await db.select().from(grants).where(where).orderBy(desc(grants.createdAt), desc(grants.id)).limit(limit + 1)

      const hasMore = rows.length > limit
      const page = rows.slice(0, limit)
      const result = page.map(rowToGrant)

      return {
        data: result,
        pagination: {
          cursor: result.length > 0 ? grantCursor(result.at(-1)!) : null,
          has_more: hasMore,
        },
      }
    },
  }
}
