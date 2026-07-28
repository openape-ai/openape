import type {
  AdminAllowlistStore,
  CodeEntry,
  CodeStore,
  ConsentEntry,
  ConsentStore,
  EmailHistoryStore,
  GrantChallengeStore,
  JtiStore,
  KeyEntry,
  KeyStore,
  RecoveryStore,
  RecoveryToken,
  RefreshConsumeResult,
  RefreshTokenFamily,
  RefreshTokenListOptions,
  RefreshTokenListResult,
  RefreshTokenResult,
  RefreshTokenStore,
  SshKey,
  SshKeyStore,
  User,
  UserListOptions,
  UserListResult,
  UserStore,
} from './stores.types'
import { createHash, randomBytes } from 'node:crypto'

// The store contracts and their data types live in ./stores.types — this file
// holds only the runtime in-memory implementations. Re-exported so existing
// `from './stores'` imports of the types keep working.
export type * from './stores.types'

export class InMemoryCodeStore implements CodeStore {
  private codes = new Map<string, CodeEntry>()

  async save(entry: CodeEntry): Promise<void> {
    this.codes.set(entry.code, entry)
  }

  async find(code: string): Promise<CodeEntry | null> {
    const entry = this.codes.get(code)
    if (!entry)
      return null
    if (entry.expiresAt < Date.now()) {
      this.codes.delete(code)
      return null
    }
    return entry
  }

  async delete(code: string): Promise<void> {
    this.codes.delete(code)
  }
}

export class InMemoryConsentStore implements ConsentStore {
  private consents = new Map<string, ConsentEntry>()

  private key(userId: string, clientId: string): string {
    return `${userId}:${clientId}`
  }

  async hasConsent(userId: string, clientId: string): Promise<boolean> {
    return this.consents.has(this.key(userId, clientId))
  }

  async save(entry: ConsentEntry): Promise<void> {
    this.consents.set(this.key(entry.userId, entry.clientId), entry)
  }

  async list(userId: string): Promise<ConsentEntry[]> {
    const out: ConsentEntry[] = []
    for (const entry of this.consents.values()) {
      if (entry.userId === userId) out.push(entry)
    }
    out.sort((a, b) => b.grantedAt - a.grantedAt)
    return out
  }

  async revoke(userId: string, clientId: string): Promise<void> {
    this.consents.delete(this.key(userId, clientId))
  }
}

/**
 * Default in-memory implementation. Always denies — apps that want
 * to support `mode=allowlist-admin` must provide a real store with
 * a backing table and an admin UI to populate it. Free-idp ships
 * one such impl; bare module consumers fall back to this.
 */
export class InMemoryAdminAllowlistStore implements AdminAllowlistStore {
  private allowed = new Set<string>()

  private key(userDomain: string, clientId: string): string {
    return `${userDomain.toLowerCase()}:${clientId.toLowerCase()}`
  }

  async isAllowed(userDomain: string, clientId: string): Promise<boolean> {
    return this.allowed.has(this.key(userDomain, clientId))
  }

  /** Test helper — not part of the public AdminAllowlistStore contract. */
  add(userDomain: string, clientId: string): void {
    this.allowed.add(this.key(userDomain, clientId))
  }
}

export class InMemoryJtiStore implements JtiStore {
  private usedJtis = new Map<string, number>()

  async hasBeenUsed(jti: string): Promise<boolean> {
    this.cleanup()
    return this.usedJtis.has(jti)
  }

  async markUsed(jti: string, ttlMs: number): Promise<void> {
    this.usedJtis.set(jti, Date.now() + ttlMs)
  }

  private cleanup(): void {
    const now = Date.now()
    for (const [jti, expiresAt] of this.usedJtis) {
      if (expiresAt < now) {
        this.usedJtis.delete(jti)
      }
    }
  }
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

function generateRefreshToken(): string {
  return randomBytes(48).toString('base64url')
}

const DEFAULT_REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000 // 30 days

export class InMemoryRefreshTokenStore implements RefreshTokenStore {
  private families = new Map<string, RefreshTokenFamily>()
  private tokens = new Map<string, { familyId: string, userId: string, clientId: string, expiresAt: number, used: boolean }>()

  async create(userId: string, clientId: string, ttlMs?: number): Promise<RefreshTokenResult> {
    const token = generateRefreshToken()
    const tokenHash = hashToken(token)
    const familyId = randomBytes(16).toString('hex')
    const now = Date.now()
    const expiresAt = now + (ttlMs ?? DEFAULT_REFRESH_TTL_MS)

    this.families.set(familyId, {
      familyId,
      userId,
      clientId,
      currentTokenHash: tokenHash,
      createdAt: now,
      expiresAt,
      revoked: false,
    })

    this.tokens.set(tokenHash, {
      familyId,
      userId,
      clientId,
      expiresAt,
      used: false,
    })

    return { token, familyId }
  }

  async consume(token: string): Promise<RefreshConsumeResult> {
    const tokenHash = hashToken(token)
    const entry = this.tokens.get(tokenHash)

    if (!entry) {
      throw new Error('Invalid refresh token')
    }

    const family = this.families.get(entry.familyId)
    if (!family || family.revoked) {
      throw new Error('Token family revoked')
    }

    if (entry.expiresAt < Date.now()) {
      throw new Error('Refresh token expired')
    }

    // Replay detection: if token was already used, revoke entire family
    if (entry.used) {
      family.revoked = true
      throw new Error('Refresh token reuse detected — family revoked')
    }

    // Mark current token as used
    entry.used = true

    // Generate new token in same family
    const newToken = generateRefreshToken()
    const newHash = hashToken(newToken)

    this.tokens.set(newHash, {
      familyId: entry.familyId,
      userId: entry.userId,
      clientId: entry.clientId,
      expiresAt: family.expiresAt,
      used: false,
    })

    family.currentTokenHash = newHash

    return {
      newToken,
      userId: entry.userId,
      clientId: entry.clientId,
      familyId: entry.familyId,
    }
  }

  async revokeByToken(token: string): Promise<void> {
    const tokenHash = hashToken(token)
    const entry = this.tokens.get(tokenHash)
    if (entry) {
      const family = this.families.get(entry.familyId)
      if (family) {
        family.revoked = true
      }
    }
  }

  async revokeFamily(familyId: string): Promise<void> {
    const family = this.families.get(familyId)
    if (family) {
      family.revoked = true
    }
  }

  async revokeByUser(userId: string): Promise<void> {
    for (const family of this.families.values()) {
      if (family.userId === userId) {
        family.revoked = true
      }
    }
  }

  async listFamilies(options?: RefreshTokenListOptions | string): Promise<RefreshTokenListResult> {
    // Support legacy string argument (userId)
    const opts: RefreshTokenListOptions = typeof options === 'string' ? { userId: options } : (options ?? {})
    const now = Date.now()
    let result: RefreshTokenFamily[] = []
    for (const family of this.families.values()) {
      if (family.revoked || family.expiresAt < now) continue
      if (opts.userId && family.userId !== opts.userId) continue
      result.push({ ...family })
    }

    // Sort by createdAt DESC
    result.sort((a, b) => b.createdAt - a.createdAt)

    // Cursor pagination (cursor = familyId)
    if (opts.cursor) {
      const idx = result.findIndex(f => f.familyId === opts.cursor)
      if (idx >= 0) result = result.slice(idx + 1)
    }

    const limit = Math.min(Math.max(opts.limit ?? 50, 1), 100)
    const hasMore = result.length > limit
    const data = result.slice(0, limit)

    return {
      data,
      pagination: {
        cursor: data.length > 0 ? data.at(-1)!.familyId : null,
        has_more: hasMore,
      },
    }
  }
}

export class InMemoryUserStore implements UserStore {
  private users = new Map<string, User>()

  async create(user: User): Promise<User> {
    this.users.set(user.email, user)
    return user
  }

  async findByEmail(email: string): Promise<User | null> {
    return this.users.get(email) ?? null
  }

  async list(options?: UserListOptions): Promise<UserListResult> {
    let users = [...this.users.values()].toSorted((a, b) => b.createdAt - a.createdAt)

    // Search filter
    if (options?.search) {
      const q = options.search.toLowerCase()
      users = users.filter(u => u.email.toLowerCase().includes(q) || u.name.toLowerCase().includes(q))
    }

    // Cursor-based pagination (cursor = email)
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
  }

  async update(email: string, data: Partial<Omit<User, 'email' | 'createdAt'>>): Promise<User> {
    const user = this.users.get(email)
    if (!user) throw new Error(`User not found: ${email}`)
    const updated = { ...user, ...data }
    this.users.set(email, updated)
    return updated
  }

  async delete(email: string): Promise<void> {
    this.users.delete(email)
  }

  async findByOwner(owner: string): Promise<User[]> {
    return [...this.users.values()].filter(u => u.owner === owner)
  }

  async findByApprover(approver: string): Promise<User[]> {
    return [...this.users.values()].filter(u => u.approver === approver)
  }
}

export class InMemorySshKeyStore implements SshKeyStore {
  private keys = new Map<string, SshKey>()

  async save(key: SshKey): Promise<void> {
    this.keys.set(key.keyId, key)
  }

  async findById(keyId: string): Promise<SshKey | null> {
    return this.keys.get(keyId) ?? null
  }

  async findByUser(email: string): Promise<SshKey[]> {
    return [...this.keys.values()].filter(k => k.userEmail === email)
  }

  async findByPublicKey(publicKey: string): Promise<SshKey | null> {
    return [...this.keys.values()].find(k => k.publicKey === publicKey) ?? null
  }

  async delete(keyId: string): Promise<void> {
    this.keys.delete(keyId)
  }

  async deleteAllForUser(email: string, opts?: { exceptKeyId?: string }): Promise<void> {
    const except = opts?.exceptKeyId
    for (const [id, key] of this.keys) {
      if (key.userEmail === email && id !== except) this.keys.delete(id)
    }
  }
}

export class InMemoryGrantChallengeStore implements GrantChallengeStore {
  private challenges = new Map<string, { entityId: string, expiresAt: number }>()

  async createChallenge(entityId: string): Promise<string> {
    const challenge = randomBytes(32).toString('hex')
    this.challenges.set(challenge, { entityId, expiresAt: Date.now() + 60_000 })
    return challenge
  }

  async consumeChallenge(challenge: string, entityId: string): Promise<boolean> {
    const stored = this.challenges.get(challenge)
    if (!stored) return false
    this.challenges.delete(challenge)
    if (stored.expiresAt < Date.now()) return false
    if (stored.entityId !== entityId) return false
    return true
  }
}

export class InMemoryKeyStore implements KeyStore {
  private keys: KeyEntry[] = []
  private initialized = false

  async getSigningKey(): Promise<KeyEntry> {
    await this.ensureKeys()
    const key = this.keys[0]
    if (!key) throw new Error('InMemoryKeyStore: no signing key available')
    return key
  }

  async getAllPublicKeys(): Promise<KeyEntry[]> {
    await this.ensureKeys()
    return this.keys
  }

  private async ensureKeys(): Promise<void> {
    if (this.initialized)
      return
    const { generateKeyPair } = await import('@openape/core')
    const { publicKey, privateKey } = await generateKeyPair()
    this.keys.push({ kid: 'key-1', publicKey, privateKey })
    this.initialized = true
  }
}

export class InMemoryEmailHistoryStore implements EmailHistoryStore {
  private history = new Map<string, string[]>()

  async record(accountEmail: string, address: string): Promise<void> {
    const list = this.history.get(accountEmail) ?? []
    if (!list.includes(address)) {
      list.push(address)
      this.history.set(accountEmail, list)
    }
  }

  async listAllForEmail(email: string): Promise<string[]> {
    const list = this.history.get(email) ?? []
    return list.includes(email) ? list : [email, ...list]
  }
}

export class InMemoryRecoveryStore implements RecoveryStore {
  private tokens = new Map<string, RecoveryToken>()

  async save(token: RecoveryToken): Promise<void> {
    this.tokens.set(token.token, token)
  }

  async find(token: string): Promise<RecoveryToken | null> {
    const entry = this.tokens.get(token)
    if (!entry) return null
    if (entry.cancelled || entry.consumed) return null
    if (entry.expiresAt < Date.now()) return null
    return entry
  }

  async listActiveForEmail(email: string): Promise<RecoveryToken[]> {
    const now = Date.now()
    return [...this.tokens.values()].filter(t =>
      t.email === email && !t.cancelled && !t.consumed && t.expiresAt >= now)
  }

  async listAllForEmail(email: string): Promise<RecoveryToken[]> {
    return [...this.tokens.values()].filter(t => t.email === email)
  }

  async markConsumed(token: string): Promise<void> {
    const entry = this.tokens.get(token)
    if (entry) {
      entry.consumed = true
      this.tokens.set(token, entry)
    }
  }

  async cancelAllForEmail(email: string, reason: string): Promise<number> {
    const now = Date.now()
    let count = 0
    for (const [key, entry] of this.tokens) {
      if (entry.email !== email || entry.cancelled || entry.consumed) continue
      if (entry.expiresAt < now) continue
      entry.cancelled = true
      entry.cancelledAt = now
      entry.cancelledReason = reason
      this.tokens.set(key, entry)
      count++
    }
    return count
  }
}
