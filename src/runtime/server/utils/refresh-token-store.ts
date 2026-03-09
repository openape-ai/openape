import { createHash, randomBytes } from 'node:crypto'
import type { RefreshConsumeResult, RefreshTokenFamily, RefreshTokenResult, RefreshTokenStore } from '@openape/auth'
import { useIdpStorage } from './storage'

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

function generateRefreshToken(): string {
  return randomBytes(48).toString('base64url')
}

const DEFAULT_REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000 // 30 days

interface StoredFamily {
  familyId: string
  userId: string
  clientId: string
  currentTokenHash: string
  createdAt: number
  expiresAt: number
  revoked: boolean
}

interface StoredToken {
  tokenHash: string
  familyId: string
  userId: string
  clientId: string
  expiresAt: number
  used: boolean
}

export function createRefreshTokenStore(): RefreshTokenStore {
  const storage = useIdpStorage()

  return {
    async create(userId: string, clientId: string, ttlMs?: number): Promise<RefreshTokenResult> {
      const token = generateRefreshToken()
      const tokenHash = hashToken(token)
      const familyId = randomBytes(16).toString('hex')
      const now = Date.now()
      const expiresAt = now + (ttlMs ?? DEFAULT_REFRESH_TTL_MS)

      await storage.setItem<StoredFamily>(`refresh-families:${familyId}`, {
        familyId,
        userId,
        clientId,
        currentTokenHash: tokenHash,
        createdAt: now,
        expiresAt,
        revoked: false,
      })

      await storage.setItem<StoredToken>(`refresh-tokens:${tokenHash}`, {
        tokenHash,
        familyId,
        userId,
        clientId,
        expiresAt,
        used: false,
      })

      return { token, familyId }
    },

    async consume(token: string): Promise<RefreshConsumeResult> {
      const tokenHash = hashToken(token)
      const entry = await storage.getItem<StoredToken>(`refresh-tokens:${tokenHash}`)

      if (!entry) {
        throw new Error('Invalid refresh token')
      }

      const family = await storage.getItem<StoredFamily>(`refresh-families:${entry.familyId}`)
      if (!family || family.revoked) {
        throw new Error('Token family revoked')
      }

      if (entry.expiresAt < Date.now()) {
        throw new Error('Refresh token expired')
      }

      if (entry.used) {
        family.revoked = true
        await storage.setItem(`refresh-families:${entry.familyId}`, family)
        throw new Error('Refresh token reuse detected — family revoked')
      }

      entry.used = true
      await storage.setItem(`refresh-tokens:${tokenHash}`, entry)

      const newToken = generateRefreshToken()
      const newHash = hashToken(newToken)

      await storage.setItem<StoredToken>(`refresh-tokens:${newHash}`, {
        tokenHash: newHash,
        familyId: entry.familyId,
        userId: entry.userId,
        clientId: entry.clientId,
        expiresAt: family.expiresAt,
        used: false,
      })

      family.currentTokenHash = newHash
      await storage.setItem(`refresh-families:${entry.familyId}`, family)

      return {
        newToken,
        userId: entry.userId,
        clientId: entry.clientId,
        familyId: entry.familyId,
      }
    },

    async revokeByToken(token: string): Promise<void> {
      const tokenHash = hashToken(token)
      const entry = await storage.getItem<StoredToken>(`refresh-tokens:${tokenHash}`)
      if (entry) {
        const family = await storage.getItem<StoredFamily>(`refresh-families:${entry.familyId}`)
        if (family) {
          family.revoked = true
          await storage.setItem(`refresh-families:${entry.familyId}`, family)
        }
      }
    },

    async revokeFamily(familyId: string): Promise<void> {
      const family = await storage.getItem<StoredFamily>(`refresh-families:${familyId}`)
      if (family) {
        family.revoked = true
        await storage.setItem(`refresh-families:${familyId}`, family)
      }
    },

    async revokeByUser(userId: string): Promise<void> {
      const keys = await storage.getKeys('refresh-families:')
      for (const key of keys) {
        const family = await storage.getItem<StoredFamily>(key)
        if (family && family.userId === userId && !family.revoked) {
          family.revoked = true
          await storage.setItem(key, family)
        }
      }
    },

    async listFamilies(userId?: string): Promise<RefreshTokenFamily[]> {
      const keys = await storage.getKeys('refresh-families:')
      const now = Date.now()
      const result: RefreshTokenFamily[] = []

      for (const key of keys) {
        const family = await storage.getItem<StoredFamily>(key)
        if (!family || family.revoked || family.expiresAt < now) continue
        if (userId && family.userId !== userId) continue
        result.push(family)
      }

      return result
    },
  }
}
