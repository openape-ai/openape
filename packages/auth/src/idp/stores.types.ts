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
  /** All SPs the user has approved, sorted by `grantedAt` desc. */
  list: (userId: string) => Promise<ConsentEntry[]>
  /** Revoke consent for a specific SP. No-op if no consent existed. */
  revoke: (userId: string, clientId: string) => Promise<void>
}

/**
 * Backing store for the DDISA `mode=allowlist-admin` policy. The
 * domain owner pre-approves which SPs may receive assertions for
 * users in their domain; everything else is denied. Reads happen on
 * the hot /authorize path; writes are app-specific (free-idp ships
 * an admin UI, other IdPs may seed via config).
 */
export interface AdminAllowlistStore {
  /**
   * Is `clientId` allowlisted for users in `userDomain`? `userDomain`
   * is the email-domain side of the user's identifier, not the SP's
   * domain — the allowlist is scoped per-tenant-domain.
   */
  isAllowed: (userDomain: string, clientId: string) => Promise<boolean>
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

export interface RefreshTokenListOptions {
  userId?: string
  limit?: number
  cursor?: string
}

export interface RefreshTokenListResult {
  data: RefreshTokenFamily[]
  pagination: {
    cursor: string | null
    has_more: boolean
  }
}

export interface RefreshTokenStore {
  create: (userId: string, clientId: string, ttlMs?: number) => Promise<RefreshTokenResult>
  consume: (token: string) => Promise<RefreshConsumeResult>
  revokeByToken: (token: string) => Promise<void>
  revokeFamily: (familyId: string) => Promise<void>
  revokeByUser: (userId: string) => Promise<void>
  listFamilies: (options?: RefreshTokenListOptions | string) => Promise<RefreshTokenListResult>
}

// --- Unified User (replaces separate User + Agent) ---

export interface User {
  email: string
  name: string
  owner?: string // undefined = self-registered, set = enrolled by another user
  approver?: string // undefined = defaults to owner or self
  type?: 'human' | 'agent' // determines act claim. Default: 'human' if no owner, 'agent' if owner set
  isActive: boolean
  createdAt: number
  lastLoginAt?: number // ms epoch of the last successful passkey login (#462)
  recoveryVacationMode?: boolean // vacation switch: stretch the recovery cooldown (#462)
  recoveryVacationDays?: number // owner-configured vacation cooldown in days, capped at 14 (#462)
}

export interface UserListOptions {
  limit?: number // default 50, max 100
  cursor?: string // email of last item from previous page
  search?: string // filter by email or name (case-insensitive contains)
}

export interface UserListResult {
  data: User[]
  pagination: {
    cursor: string | null
    has_more: boolean
  }
}

export interface UserStore {
  create: (user: User) => Promise<User>
  findByEmail: (email: string) => Promise<User | null>
  list: (options?: UserListOptions) => Promise<UserListResult>
  update: (email: string, data: Partial<Omit<User, 'email' | 'createdAt'>>) => Promise<User>
  delete: (email: string) => Promise<void>
  findByOwner: (owner: string) => Promise<User[]>
  findByApprover: (approver: string) => Promise<User[]>
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
  /**
   * Delete every key for the user except (optionally) `exceptKeyId`.
   * The exception is the safety hatch for "rotate one key into the
   * place of another" flows: save the new one first, then call this
   * with `exceptKeyId` set to the new id so the agent is never
   * without an authenticator (see #295). Backwards-compatible — the
   * options arg is optional.
   */
  deleteAllForUser: (email: string, opts?: { exceptKeyId?: string }) => Promise<void>
}

// --- Grant Challenge Store (ed25519 challenge-response) ---

export interface GrantChallengeStore {
  createChallenge: (entityId: string) => Promise<string>
  consumeChallenge: (challenge: string, entityId: string) => Promise<boolean>
}

// --- Account Recovery (#297) ---
//
// 72h-mail-hold flow that replaces the closed self-service add-credential
// path (#291). The mechanism is inversive: the legitimate owner doesn't
// have to PROVE ownership — they just need to log in once during the
// 72h cooldown from any existing device, which cancels any pending
// recovery (the "active-owner veto").
//
// All timestamps are ms-epoch.

export interface RecoveryToken {
  token: string
  email: string
  createdAt: number
  /**
   * Earliest time the token may be used to enrol a new credential.
   * The mandatory delay is the defence: nobody legitimate is
   * inconvenienced by waiting 72h on a recovery they themselves
   * initiated, and the time-window is exactly what gives the active
   * owner a chance to notice and cancel.
   */
  usableAt: number
  /**
   * Hard expiry. After this the token is invalid regardless. Set so
   * that there's a reasonable window for legitimate users to act
   * after the cooldown ends.
   */
  expiresAt: number
  cancelled: boolean
  cancelledAt?: number
  cancelledReason?: string
  consumed: boolean
  /** IP that initiated the recovery. Audit only. */
  requestIp?: string
  /** User-Agent header from the request. Audit only. */
  requestUserAgent?: string
}

export interface RecoveryStore {
  /** Persist a freshly-issued recovery token. */
  save: (token: RecoveryToken) => Promise<void>
  /** Lookup by token id. Returns null for unknown, expired, cancelled, or consumed tokens. */
  find: (token: string) => Promise<RecoveryToken | null>
  /** All active (uncancelled, unconsumed, unexpired) tokens for an email. */
  listActiveForEmail: (email: string) => Promise<RecoveryToken[]>
  /** Full audit history for an email — running, cancelled, consumed and expired attempts alike (#462). */
  listAllForEmail: (email: string) => Promise<RecoveryToken[]>
  /** Mark a single token as consumed (after a successful enrolment). */
  markConsumed: (token: string) => Promise<void>
  /** Cancel every active token for an email. Returns the count cancelled. Called on every successful login (the active-owner veto). */
  cancelAllForEmail: (email: string, reason: string) => Promise<number>
}

// --- E-mail address history (#462) ---
//
// "Warn every address ever linked to the account": the recovery
// warning-broadcast needs the former addresses too, so a single
// compromised (current) mailbox can't swallow the alarm.

export interface EmailHistoryStore {
  /** Record that `address` is (or was) linked to the account currently identified by `accountEmail`. Idempotent. */
  record: (accountEmail: string, address: string) => Promise<void>
  /** Every address ever linked to the account of `email` — always includes `email` itself. */
  listAllForEmail: (email: string) => Promise<string[]>
}
