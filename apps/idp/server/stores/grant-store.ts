import type { OpenApeGrant, OpenApeGrantRequest, PaginatedResponse } from '@openape/core'
import type { GrantListParams, GrantStore } from '@openape/grants'
import { and, desc, eq, lt, sql } from 'drizzle-orm'
import type { LibSQLDatabase } from 'drizzle-orm/libsql'
import { grants } from '../database/schema'
import type * as schema from '../database/schema'

type GrantRow = typeof grants.$inferSelect

function grantToRow(grant: OpenApeGrant) {
  return {
    id: grant.id,
    status: grant.status,
    type: grant.type ?? null,
    requester: grant.request.requester,
    targetHost: grant.request.target_host,
    audience: grant.request.audience,
    grantType: grant.request.grant_type ?? 'once',
    request: grant.request as unknown as Record<string, unknown>,
    createdAt: grant.created_at,
    decidedAt: grant.decided_at ?? null,
    decidedBy: grant.decided_by ?? null,
    expiresAt: grant.expires_at ?? null,
    usedAt: grant.used_at ?? null,
  }
}

function rowToGrant(row: GrantRow): OpenApeGrant {
  const request = row.request as unknown as OpenApeGrantRequest
  return {
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
  }
}

export function createDrizzleGrantStore(db: LibSQLDatabase<typeof schema>): GrantStore {
  return {
    async save(grant) {
      const row = grantToRow(grant)
      await db.insert(grants).values(row).onConflictDoUpdate({
        target: grants.id,
        set: {
          status: row.status,
          type: row.type,
          requester: row.requester,
          targetHost: row.targetHost,
          audience: row.audience,
          grantType: row.grantType,
          request: row.request,
          createdAt: row.createdAt,
          decidedAt: row.decidedAt,
          decidedBy: row.decidedBy,
          expiresAt: row.expiresAt,
          usedAt: row.usedAt,
        },
      })
    },

    async findById(id) {
      const row = await db.select().from(grants).where(eq(grants.id, id)).get()
      return row ? rowToGrant(row) : null
    },

    async updateStatus(id, status, extra?) {
      const existing = await db.select().from(grants).where(eq(grants.id, id)).get()
      if (!existing) throw new Error(`Grant not found: ${id}`)

      const updates: Record<string, unknown> = { status }
      if (extra?.decided_by !== undefined) updates.decidedBy = extra.decided_by
      if (extra?.decided_at !== undefined) updates.decidedAt = extra.decided_at
      if (extra?.expires_at !== undefined) updates.expiresAt = extra.expires_at
      if (extra?.used_at !== undefined) updates.usedAt = extra.used_at
      if (extra?.request !== undefined) {
        updates.request = extra.request as unknown as Record<string, unknown>
        updates.grantType = (extra.request as OpenApeGrantRequest).grant_type ?? 'once'
      }

      await db.update(grants).set(updates).where(eq(grants.id, id))
    },

    async findPending() {
      const rows = await db.select().from(grants).where(eq(grants.status, 'pending')).orderBy(desc(grants.createdAt))
      return rows.map(rowToGrant)
    },

    async findByRequester(requester) {
      const rows = await db.select().from(grants).where(eq(grants.requester, requester)).orderBy(desc(grants.createdAt))
      return rows.map(rowToGrant)
    },

    async findByDelegate(delegate) {
      const condition = and(eq(grants.type, 'delegation'), sql`json_extract(${grants.request}, '$.delegate') = ${delegate}`)
      const rows = await db.select().from(grants).where(condition).orderBy(desc(grants.createdAt))
      return rows.map(rowToGrant)
    },

    async findByDelegator(delegator) {
      const condition = and(eq(grants.type, 'delegation'), sql`json_extract(${grants.request}, '$.delegator') = ${delegator}`)
      const rows = await db.select().from(grants).where(condition).orderBy(desc(grants.createdAt))
      return rows.map(rowToGrant)
    },

    async listGrants(params?: GrantListParams): Promise<PaginatedResponse<OpenApeGrant>> {
      const limit = Math.min(Math.max(params?.limit ?? 20, 1), 100)
      const conditions = []

      if (params?.status)
        conditions.push(eq(grants.status, params.status))
      if (params?.requester)
        conditions.push(eq(grants.requester, params.requester))
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
