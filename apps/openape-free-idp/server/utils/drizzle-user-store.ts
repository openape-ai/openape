import { eq, isNull } from 'drizzle-orm'
import { useDb } from '../database/drizzle'
import { users } from '../database/schema'

interface User {
  email: string
  name: string
}

interface UserStore {
  create: (email: string, name: string) => Promise<User>
  findByEmail: (email: string) => Promise<User | null>
  listUsers: () => Promise<User[]>
  deleteUser: (email: string) => Promise<void>
}

export function createDrizzleUserStore(): UserStore {
  const db = useDb()

  return {
    async create(email, name) {
      await db.insert(users).values({
        email,
        name,
        createdAt: Date.now(),
      }).onConflictDoUpdate({
        target: users.email,
        set: { name },
      })
      return { email, name }
    },

    async findByEmail(email) {
      const row = await db.select().from(users).where(eq(users.email, email)).get()
      if (!row || row.owner) return null
      return { email: row.email, name: row.name }
    },

    async listUsers() {
      const rows = await db.select().from(users).where(isNull(users.owner))
      return rows.map(row => ({ email: row.email, name: row.name }))
    },

    async deleteUser(email) {
      await db.delete(users).where(eq(users.email, email))
    },
  }
}
