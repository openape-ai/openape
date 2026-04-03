import { createHash, randomBytes } from 'node:crypto'
import type { ActorType, DDISADelegateClaim, DelegationActClaim, OpenApeAuthorizationDetail } from '@openape/core'
import type { KeyLike } from 'jose'

export interface CodeEntry {
  code: string
  clientId: string
  redirectUri: string
  codeChallenge: string
  userId: string
  nonce?: string
  expiresAt: number
  act?: ActorType
  delegate?: DDISADelegateClaim
  scope?: string
  authorizationDetails?: OpenApeAuthorizationDetail[]
  /** RFC 8693 delegation: the actual actor */
  delegationAct?: DelegationActClaim
  /** Delegation grant ID */
  delegationGrant?: string
}

export interface ConsentEntry {
  userId: string
  clientId: string
  grantedAt: number
}

export interface CodeStore {
  save: (entry: CodeEntry) => Promise<void>
  find: (code: string) => Promise<CodeEntry | null>
  delete: (code: string) => Promise<void>
}

export interface ConsentStore {
  hasConsent: (userId: string, clientId: string) => Promise<boolean>
  save: (entry: ConsentEntry) => Promise<void>
}

export interface KeyEntry {
  kid: string
  privateKey: KeyLike
  publicKey: KeyLike
}

export interface KeyStore {
  getSigningKey: () => Promise<KeyEntry>
  getAllPublicKeys: () => Promise<KeyEntry[]>
}

export interface JtiStore {
  hasBeenUsed: (jti: string) => Promise<boolean>
  markUsed: (jti: string, ttlMs: number) => Promise<void>
}

export interface RefreshTokenFamily {
  familyId: string
  userId: string
  clientId: string
  currentTokenHash: string
  createdAt: number
  expiresAt: number
  revoked: boolean
}

export interface RefreshTokenResult {
  token: string
  familyId: string
}

export interface RefreshConsumeResult {
  newToken: string
  userId: string
  clientId: string
  familyId: string
}

export interface RefreshTokenStore {
  create: (userId: string, clientId: string, ttlMs?: number) => Promise<RefreshTokenResult>
  consume: (token: string) => Promise<RefreshConsumeResult>
  revokeByToken: (token: string) => Promise<void>
  revokeFamily: (familyId: string) => Promise<void>
  revokeByUser: (userId: string) => Promise<void>
  listFamilies: (userId?: string) => Promise<RefreshTokenFamily[]>
}

// In-memory implementations

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

  async listFamilies(userId?: string): Promise<RefreshTokenFamily[]> {
    const now = Date.now()
    const result: RefreshTokenFamily[] = []
    for (const family of this.families.values()) {
      if (family.revoked || family.expiresAt < now) continue
      if (userId && family.userId !== userId) continue
      result.push({ ...family })
    }
    return result
  }
}

// --- Unified User (replaces separate User + Agent) ---

export interface User {
  email: string
  name: string
  owner?: string // undefined = self-registered, set = enrolled by another user
  approver?: string // undefined = defaults to owner or self
  isActive: boolean
  createdAt: number
}

export interface UserStore {
  create: (user: User) => Promise<User>
  findByEmail: (email: string) => Promise<User | null>
  list: () => Promise<User[]>
  update: (email: string, data: Partial<Omit<User, 'email' | 'createdAt'>>) => Promise<User>
  delete: (email: string) => Promise<void>
  findByOwner: (owner: string) => Promise<User[]>
}

// --- SSH Keys ---

export interface SshKey {
  keyId: string
  userEmail: string
  publicKey: string
  name: string
  createdAt: number
}

export interface SshKeyStore {
  save: (key: SshKey) => Promise<void>
  findById: (keyId: string) => Promise<SshKey | null>
  findByUser: (email: string) => Promise<SshKey[]>
  findByPublicKey: (publicKey: string) => Promise<SshKey | null>
  delete: (keyId: string) => Promise<void>
  deleteAllForUser: (email: string) => Promise<void>
}

// --- Grant Challenge Store (ed25519 challenge-response) ---

export interface GrantChallengeStore {
  createChallenge: (entityId: string) => Promise<string>
  consumeChallenge: (challenge: string, entityId: string) => Promise<boolean>
}

// In-memory implementations

export class InMemoryUserStore implements UserStore {
  private users = new Map<string, User>()

  async create(user: User): Promise<User> {
    this.users.set(user.email, user)
    return user
  }

  async findByEmail(email: string): Promise<User | null> {
    return this.users.get(email) ?? null
  }

  async list(): Promise<User[]> {
    return [...this.users.values()].toSorted((a, b) => b.createdAt - a.createdAt)
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

  async deleteAllForUser(email: string): Promise<void> {
    for (const [id, key] of this.keys) {
      if (key.userEmail === email) this.keys.delete(id)
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
    return this.keys[0]
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
