import type { OpenApeGrant, OpenApeGrantRequest, PaginatedResponse } from '@openape/core'
import type { GrantListParams, GrantStore } from '@openape/grants'
import { and, desc, eq, inArray, isNull, or, lt, sql } from 'drizzle-orm'
import { useDb } from '../database/drizzle'
import { brokerAudit, brokerConnections, grants } from '../database/schema'
import { createError } from 'h3'
import { brokerAuditRow } from './broker-audit'

interface ExtendedGrantStore extends GrantStore {
  findAll: () => Promise<OpenApeGrant[]>
  findByDelegate: (delegate: string) => Promise<OpenApeGrant[]>
  findByDelegator: (delegator: string) => Promise<OpenApeGrant[]>
}

type GrantRow = typeof grants.$inferSelect

const PENDING_REQUEST_TTL_SECONDS = 48 * 3600

export function grantToRow(grant: OpenApeGrant) {
  return {
    id: grant.id,
    status: grant.status,
    type: grant.type ?? null,
    requester: grant.request.requester,
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
    decided_by_standing_grant: row.decidedByStandingGrant ?? undefined,
    auto_approval_kind: (row.autoApprovalKind as OpenApeGrant['auto_approval_kind']) ?? undefined,
  }
}

export function createDrizzleGrantStore(): ExtendedGrantStore {
  const db = useDb()

  async function expirePendingRequests() {
    const cutoff = Math.floor(Date.now() / 1000) - PENDING_REQUEST_TTL_SECONDS
    await db.transaction(async (tx) => {
      const expired = await tx.update(grants)
        .set({ status: 'expired' })
        .where(and(eq(grants.status, 'pending'), lt(grants.createdAt, cutoff)))
        .returning()
      for (const row of expired) {
        if (row.brokered) await tx.insert(brokerAudit).values(brokerAuditRow(rowToGrant(row), 'expired'))
      }
    }, { behavior: 'immediate' })
  }

  return {
    async save(grant) {
      const row = grantToRow(grant)
      if (grant.brokered) {
        await expirePendingRequests()
        await db.transaction(async (tx) => {
          const connection = await tx.select().from(brokerConnections).where(eq(brokerConnections.id, grant.brokered!.connection_id)).get()
          if (!connection || connection.status !== 'active' || connection.owner !== grant.brokered!.owner) throw createError({ statusCode: 403, statusMessage: 'Broker connection is missing or revoked' })
          const pending = await tx.select({ count: sql<number>`count(*)` }).from(grants).where(and(eq(grants.brokerOwner, grant.brokered!.owner), eq(grants.status, 'pending'))).get()
          if ((pending?.count ?? 0) >= 100) throw createError({ statusCode: 429, statusMessage: 'Decide or dismiss existing broker requests before submitting more' })
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

        if ((existing.brokered || existing.status === 'expired') && (status === 'approved' || status === 'denied') && existing.status !== 'pending') throw createError({ statusCode: 409, statusMessage: 'Grant was already decided' })
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

      if (params?.status)
        conditions.push(eq(grants.status, params.status))
      if (params?.requester) {
        const requesters = Array.isArray(params.requester) ? params.requester : [params.requester]
        if (params.brokerOwner === null) conditions.push(and(isNull(grants.brokered), inArray(grants.requester, requesters)))
        else if (params.brokerOwner) conditions.push(or(and(isNull(grants.brokered), inArray(grants.requester, requesters)), eq(grants.brokerOwner, params.brokerOwner)))
        else conditions.push(inArray(grants.requester, requesters))
      }
      if (params?.requesterFilter) conditions.push(eq(grants.requester, params.requesterFilter))
      if (params?.cursor) {
        const cursorTs = Number(params.cursor)
        conditions.push(lt(grants.createdAt, cursorTs))
      }

      const where = conditions.length > 0 ? and(...conditions) : undefined
      const rows = await db.select().from(grants).where(where).orderBy(desc(grants.createdAt)).limit(limit + 1)

      const hasMore = rows.length > limit
      const page = rows.slice(0, limit)
      const result = page.map(rowToGrant)

      return {
        data: result,
        pagination: {
          cursor: result.length > 0 ? String(result.at(-1)!.created_at) : null,
          has_more: hasMore,
        },
      }
    },
  }
}
