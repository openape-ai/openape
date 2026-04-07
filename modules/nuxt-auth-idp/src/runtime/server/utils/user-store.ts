import type { User, UserListOptions, UserListResult, UserStore } from '@openape/auth'
import { useIdpStorage } from './storage'

export type { User, UserStore }

export function createUserStore(): UserStore {
  const storage = useIdpStorage()

  async function getAllUsers(): Promise<User[]> {
    const keys = await storage.getKeys('users:')
    const users: User[] = []
    for (const key of keys) {
      const stored = await storage.getItem<User>(key)
      if (stored)
        users.push(stored)
    }
    return users.sort((a, b) => b.createdAt - a.createdAt)
  }

  return {
    async create(user) {
      await storage.setItem(`users:${user.email}`, user)
      return user
    },

    async findByEmail(email) {
      return await storage.getItem<User>(`users:${email}`) ?? null
    },

    async list(options?: UserListOptions): Promise<UserListResult> {
      let users = await getAllUsers()

      if (options?.search) {
        const q = options.search.toLowerCase()
        users = users.filter(u => u.email.toLowerCase().includes(q) || u.name.toLowerCase().includes(q))
      }

      if (options?.cursor) {
        const idx = users.findIndex(u => u.email === options.cursor)
        if (idx >= 0) users = users.slice(idx + 1)
      }

      const limit = Math.min(Math.max(options?.limit ?? 50, 1), 100)
      const hasMore = users.length > limit
      const data = users.slice(0, limit)

      return {
        data,
        pagination: {
          cursor: data.length > 0 ? data.at(-1)!.email : null,
          has_more: hasMore,
        },
      }
    },

    async update(email, data) {
      const user = await storage.getItem<User>(`users:${email}`)
      if (!user)
        throw new Error(`User not found: ${email}`)
      const updated = { ...user, ...data }
      await storage.setItem(`users:${email}`, updated)
      return updated
    },

    async delete(email) {
      await storage.removeItem(`users:${email}`)
    },

    async findByOwner(owner) {
      const all = await getAllUsers()
      return all.filter(u => u.owner === owner)
    },

    async findByApprover(approver) {
      const all = await getAllUsers()
      return all.filter(u => u.approver === approver)
    },
  }
}
