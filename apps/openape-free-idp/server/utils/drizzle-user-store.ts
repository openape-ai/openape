import type { User, UserListOptions, UserListResult, UserStore } from '@openape/auth'
import { desc, eq, like, or } from 'drizzle-orm'
import { useDb } from '../database/drizzle'
import { users } from '../database/schema'

type UserRow = typeof users.$inferSelect

function rowToUser(row: UserRow): User {
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

export function createDrizzleUserStore(): UserStore {
  const db = useDb()

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
      return user
    },

    async findByEmail(email) {
      const row = await db.select().from(users).where(eq(users.email, email)).get()
      if (!row) return null
      return rowToUser(row)
    },

    async list(options?: UserListOptions): Promise<UserListResult> {
      let query = db.select().from(users).orderBy(desc(users.createdAt)).$dynamic()

      if (options?.search) {
        const q = `%${options.search}%`
        query = query.where(or(like(users.email, q), like(users.name, q)))
      }

      const limit = Math.min(Math.max(options?.limit ?? 50, 1), 100)

      if (options?.cursor) {
        const cursorRow = await db.select().from(users).where(eq(users.email, options.cursor)).get()
        if (cursorRow) {
          const { lt } = await import('drizzle-orm')
          query = query.where(lt(users.createdAt, cursorRow.createdAt))
        }
      }

      const rows = await query.limit(limit + 1)
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

      await db.update(users).set(updates).where(eq(users.email, email))
      const updated = await db.select().from(users).where(eq(users.email, email)).get()
      return rowToUser(updated!)
    },

    async delete(email) {
      await db.delete(users).where(eq(users.email, email))
    },

    async findByOwner(owner) {
      const rows = await db.select().from(users).where(eq(users.owner, owner)).orderBy(desc(users.createdAt))
      return rows.map(rowToUser)
    },

    async findByApprover(approver) {
      const rows = await db.select().from(users).where(eq(users.approver, approver)).orderBy(desc(users.createdAt))
      return rows.map(rowToUser)
    },
  }
}
