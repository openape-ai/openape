import type { User, UserStore } from '@openape/auth'
import { desc, eq } from 'drizzle-orm'
import type { LibSQLDatabase } from 'drizzle-orm/libsql'
import { users } from '../database/schema'
import type * as schema from '../database/schema'

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

export function createDrizzleUserStore(db: LibSQLDatabase<typeof schema>): UserStore {
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

    async list() {
      const rows = await db.select().from(users).orderBy(desc(users.createdAt))
      return rows.map(rowToUser)
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
      return rowToUser(updated!)
    },

    async delete(email) {
      await db.delete(users).where(eq(users.email, email))
    },

    async findByOwner(owner) {
      const rows = await db.select().from(users).where(eq(users.owner, owner))
      return rows.map(rowToUser)
    },
  }
}
