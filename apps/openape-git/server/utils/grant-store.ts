import type { OpenApeGrant, OpenApeGrantRequest, PaginatedResponse } from '@openape/core'
import type { GrantListParams, GrantStore } from '@openape/grants'
import { and, desc, eq, sql } from 'drizzle-orm'
import { useDb } from '../database/drizzle'
import { grants } from '../database/schema'

export interface GitGrantStore extends GrantStore {
  findByDelegate: (delegate: string) => Promise<OpenApeGrant[]>
  findByDelegator: (delegator: string) => Promise<OpenApeGrant[]>
}

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
    request,
    status: row.status as OpenApeGrant['status'],
    created_at: row.createdAt,
    decided_at: row.decidedAt ?? undefined,
    decided_by: row.decidedBy ?? undefined,
    expires_at: row.expiresAt ?? undefined,
    used_at: row.usedAt ?? undefined,
  }
}

export function useGrantStore(): GitGrantStore {
  const db = useDb()

  return {
    async save(grant) {
      const row = grantToRow(grant)
      await db.insert(grants).values(row).onConflictDoUpdate({ target: grants.id, set: row })
    },

    async findById(id) {
      const row = await db.select().from(grants).where(eq(grants.id, id)).get()
      return row ? rowToGrant(row) : null
    },

    async updateStatus(id, status, extra?) {
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
      const limit = Math.min(Math.max(params?.limit ?? 20, 1), 1000)
      const rows = await db.select().from(grants).orderBy(desc(grants.createdAt)).limit(limit + 1)
      const page = rows.slice(0, limit).map(rowToGrant)
      return {
        data: page,
        pagination: {
          cursor: page.length > 0 ? String(page.at(-1)!.created_at) : null,
          has_more: rows.length > limit,
        },
      }
    },
  }
}
