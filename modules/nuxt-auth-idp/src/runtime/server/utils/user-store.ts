import { useIdpStorage } from './storage'

export interface User {
  email: string
  name: string
}

export interface UserStore {
  create: (email: string, name: string) => Promise<User>
  findByEmail: (email: string) => Promise<User | null>
  listUsers: () => Promise<User[]>
  deleteUser: (email: string) => Promise<void>
}

interface StoredUser {
  email: string
  name: string
  createdAt: number
}

export function createUserStore(): UserStore {
  const storage = useIdpStorage()

  return {
    async create(email, name) {
      await storage.setItem<StoredUser>(`users:${email}`, {
        email,
        name,
        createdAt: Date.now(),
      })

      return { email, name }
    },

    async findByEmail(email) {
      const user = await storage.getItem<StoredUser>(`users:${email}`)
      if (!user)
        return null
      return { email: user.email, name: user.name }
    },

    async listUsers() {
      const keys = await storage.getKeys('users:')
      const users: User[] = []
      for (const key of keys) {
        const stored = await storage.getItem<StoredUser>(key)
        if (stored)
          users.push({ email: stored.email, name: stored.name })
      }
      return users
    },

    async deleteUser(email) {
      await storage.removeItem(`users:${email}`)
    },
  }
}
