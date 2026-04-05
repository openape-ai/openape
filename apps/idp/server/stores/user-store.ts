import type { User, UserListOptions, UserListResult, UserStore } from '@openape/auth'
import { and, desc, eq, like, lt, or } from 'drizzle-orm'
import type { LibSQLDatabase } from 'drizzle-orm/libsql'
import { users } from '../database/schema'
import type * as schema from '../database/schema'

const CACHE_TTL = 30_000 // 30 seconds

function rowToUser(row: typeof users.$inferSelect): User {
  return {
    email: row.email,
    name: row.name,
    owner: row.owner ?? undefined,
    approver: row.approver ?? undefined,
    type: row.type as User['type'],
    isActive: row.isActive,
    createdAt: row.createdAt,
  }
}

/**
 * Drizzle user store with in-memory cache.
 * User lookups are hot during auth flows (challenge + authenticate both look up the same user).
 * Cache TTL is 30s — short enough to pick up changes, long enough to avoid redundant round-trips.
 */
export function createDrizzleUserStore(db: LibSQLDatabase<typeof schema>): UserStore {
  const cache = new Map<string, { user: User, cachedAt: number }>()

  function invalidate(email: string) {
    cache.delete(email)
  }

  function invalidateAll() {
    cache.clear()
  }

  return {
    async create(user) {
      await db.insert(users).values({
        email: user.email,
        name: user.name,
        owner: user.owner ?? null,
        approver: user.approver ?? null,
        type: user.type ?? null,
        isActive: user.isActive,
        createdAt: user.createdAt,
      }).onConflictDoUpdate({
        target: users.email,
        set: {
          name: user.name,
          owner: user.owner ?? null,
          approver: user.approver ?? null,
          type: user.type ?? null,
          isActive: user.isActive,
        },
      })
      invalidate(user.email)
      return user
    },

    async findByEmail(email) {
      const cached = cache.get(email)
      if (cached && Date.now() - cached.cachedAt < CACHE_TTL) {
        return cached.user
      }

      const row = await db.select().from(users).where(eq(users.email, email)).get()
      if (!row) {
        cache.delete(email)
        return null
      }
      const user = rowToUser(row)
      cache.set(email, { user, cachedAt: Date.now() })
      return user
    },

    async list(options?: UserListOptions): Promise<UserListResult> {
      const limit = Math.min(Math.max(options?.limit ?? 50, 1), 100)
      const conditions = []

      // Search
      if (options?.search) {
        const q = `%${options.search}%`
        conditions.push(or(like(users.email, q), like(users.name, q))!)
      }

      // Cursor
      if (options?.cursor) {
        const cursorUser = await db.select().from(users).where(eq(users.email, options.cursor)).get()
        if (cursorUser) {
          conditions.push(lt(users.createdAt, cursorUser.createdAt))
        }
      }

      const where = conditions.length > 0 ? and(...conditions) : undefined
      const rows = where
        ? await db.select().from(users).where(where).orderBy(desc(users.createdAt)).limit(limit + 1)
        : await db.select().from(users).orderBy(desc(users.createdAt)).limit(limit + 1)

      const hasMore = rows.length > limit
      const data = rows.slice(0, limit).map(rowToUser)

      return {
        data,
        pagination: {
          cursor: data.length > 0 ? data.at(-1)!.email : null,
          has_more: hasMore,
        },
      }
    },

    async update(email, data) {
      const existing = await db.select().from(users).where(eq(users.email, email)).get()
      if (!existing) throw new Error(`User not found: ${email}`)

      const updates: Record<string, unknown> = {}
      if (data.name !== undefined) updates.name = data.name
      if (data.owner !== undefined) updates.owner = data.owner
      if (data.approver !== undefined) updates.approver = data.approver
      if (data.type !== undefined) updates.type = data.type
      if (data.isActive !== undefined) updates.isActive = data.isActive

      if (Object.keys(updates).length > 0) {
        await db.update(users).set(updates).where(eq(users.email, email))
      }

      const updated = await db.select().from(users).where(eq(users.email, email)).get()
      invalidate(email)
      return rowToUser(updated!)
    },

    async delete(email) {
      await db.delete(users).where(eq(users.email, email))
      invalidate(email)
    },

    async findByOwner(owner) {
      const rows = await db.select().from(users).where(eq(users.owner, owner))
      return rows.map(rowToUser)
    },
  }
}
