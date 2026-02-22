import { generateSalt, hashPassword, verifyPassword } from '@ddisa/core'
import { useAppStorage } from './storage'

export interface User {
  email: string
  name: string
}

export interface UserStore {
  register: (email: string, password: string, name: string) => Promise<User>
  authenticate: (email: string, password: string) => Promise<User | null>
  findByEmail: (email: string) => Promise<User | null>
  listUsers: () => Promise<User[]>
  deleteUser: (email: string) => Promise<void>
}

interface StoredUser {
  email: string
  name: string
  passwordHash: string
  salt: string
}

export function createUserStore(): UserStore {
  const storage = useAppStorage()

  return {
    async register(email, password, name) {
      const salt = generateSalt()
      const passwordHash = await hashPassword(password, salt)

      await storage.setItem<StoredUser>(`users:${email}`, {
        email,
        name,
        passwordHash,
        salt,
      })

      return { email, name }
    },

    async authenticate(email, password) {
      const user = await storage.getItem<StoredUser>(`users:${email}`)
      if (!user)
        return null

      const valid = await verifyPassword(password, user.salt, user.passwordHash)
      if (!valid)
        return null

      return { email: user.email, name: user.name }
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
