import { index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core'

/** How long a request may wait to be filled before it lapses. */
export const DEFAULT_TTL_SEC = 24 * 60 * 60
export const MAX_TTL_SEC = 7 * 24 * 60 * 60

/**
 * A machine that may RECEIVE secrets. Registered by its owner, who is also the
 * only person a request for it can ask. The public key is the whole point: the
 * value is sealed against it in the browser, so this service stores ciphertext
 * it has no way to open.
 */
export const consumers = sqliteTable('consumers', {
  id: text('id').primaryKey(),
  ownerEmail: text('owner_email').notNull(),
  name: text('name').notNull(),
  /** P-256 public key as JWK. Public half only — the private half never leaves the machine. */
  publicKeyJwk: text('public_key_jwk').notNull(),
  /**
   * Identities besides the owner that may raise a request for this consumer,
   * as a JSON string[]. Empty means owner-only, which is the safe default: an
   * open service would let anyone send fill prompts to a stranger.
   */
  allowedRequesters: text('allowed_requesters').notNull().default('[]'),
  createdAt: integer('created_at').notNull(),
}, t => [index('idx_consumers_owner').on(t.ownerEmail)])

/**
 * `requested` → someone asked · `filled` → the owner sealed a value into it
 * · `fetched` → the consumer collected it and the ciphertext is gone
 * · `expired` / `cancelled` → nothing will arrive.
 */
export type SecretRequestStatus = 'requested' | 'filled' | 'fetched' | 'expired' | 'cancelled'

export const secretRequests = sqliteTable('secret_requests', {
  id: text('id').primaryKey(),
  /** The human who has to fill this — always the consumer's owner. */
  ownerEmail: text('owner_email').notNull(),
  /** Who asked. Shown on the fill page: the owner decides knowing who benefits. */
  requester: text('requester').notNull(),
  consumerId: text('consumer_id').notNull(),
  /** What is being asked for, e.g. NUXT_TELEGRAM_BOT_TOKEN. */
  fieldName: text('field_name').notNull(),
  /** Why. Free text from the requester, rendered verbatim to the owner. */
  purpose: text('purpose').notNull().default(''),
  status: text('status', { enum: ['requested', 'filled', 'fetched', 'expired', 'cancelled'] }).notNull().default('requested'),
  expiresAt: integer('expires_at').notNull(),
  /**
   * The sealed envelope, all base64: ephemeral public key, HKDF salt, AES-GCM
   * IV, ciphertext. Null until filled, and null again once fetched — a
   * collected secret leaves nothing behind to steal.
   */
  boxEpk: text('box_epk'),
  boxSalt: text('box_salt'),
  boxIv: text('box_iv'),
  boxCt: text('box_ct'),
  createdAt: integer('created_at').notNull(),
  filledAt: integer('filled_at'),
  fetchedAt: integer('fetched_at'),
}, t => [
  index('idx_requests_owner').on(t.ownerEmail),
  index('idx_requests_consumer').on(t.consumerId),
])

// ---- v2 vault (DDL in vault-tables.ts) -------------------------------------

/** One vault per human owner. Its keys exist only in the owner's browser. */
export const vaults = sqliteTable('vaults', {
  id: text('id').primaryKey(),
  ownerEmail: text('owner_email').notNull().unique(),
  format: text('format').notNull().default('v2'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
})

/**
 * A passkey that can unlock the vault: its WebAuthn public key plus the VMK
 * wrapped under a key derived from its PRF output. `prf_input` and `kdf_salt`
 * are not secret; the PRF output they lead to never reaches this service.
 */
export const vaultCredentials = sqliteTable('vault_credentials', {
  id: text('id').primaryKey(),
  vaultId: text('vault_id').notNull(),
  publicKey: text('public_key').notNull(),
  counter: integer('counter').notNull().default(0),
  transports: text('transports').notNull().default('[]'),
  backedUp: integer('backed_up').notNull().default(0),
  deviceType: text('device_type').notNull().default(''),
  label: text('label').notNull().default(''),
  prfInput: text('prf_input').notNull(),
  kdfSalt: text('kdf_salt').notNull(),
  vmkIv: text('vmk_iv').notNull(),
  vmkCt: text('vmk_ct').notNull(),
  createdAt: integer('created_at').notNull(),
  disabledAt: integer('disabled_at'),
}, t => [index('idx_vault_credentials_vault').on(t.vaultId)])

/** The VMK wrapped for the recovery secret, and the public half of the key that proves its possession. */
export const vaultRecovery = sqliteTable('vault_recovery', {
  vaultId: text('vault_id').primaryKey(),
  recoverySalt: text('recovery_salt').notNull(),
  vmkIv: text('vmk_iv').notNull(),
  vmkCt: text('vmk_ct').notNull(),
  proofKeyIv: text('proof_key_iv').notNull(),
  proofKeyCt: text('proof_key_ct').notNull(),
  proofPublicJwk: text('proof_public_jwk').notNull(),
  createdAt: integer('created_at').notNull(),
})

/** Single-use WebAuthn and recovery challenges, stored as hashes and bound to owner and operation. */
export const webauthnChallenges = sqliteTable('webauthn_challenges', {
  id: text('id').primaryKey(),
  challengeHash: text('challenge_hash').notNull(),
  ownerEmail: text('owner_email').notNull(),
  operation: text('operation').notNull(),
  vaultId: text('vault_id').notNull(),
  /** JSON of what exactly the challenge may confirm, e.g. which secret version a save creates. */
  descriptor: text('descriptor'),
  expiresAt: integer('expires_at').notNull(),
  consumedAt: integer('consumed_at'),
  createdAt: integer('created_at').notNull(),
})

/** A named secret in a vault. Name and type are visible metadata; the value lives only in its versions. */
export const vaultSecrets = sqliteTable('vault_secrets', {
  id: text('id').primaryKey(),
  vaultId: text('vault_id').notNull(),
  alias: text('alias').notNull(),
  type: text('type').notNull(),
  currentVersion: integer('current_version').notNull(),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
  deletedAt: integer('deleted_at'),
})

/** One immutable version: the value under a fresh DEK, and that DEK under the VMK. */
export const vaultSecretVersions = sqliteTable('vault_secret_versions', {
  secretId: text('secret_id').notNull(),
  version: integer('version').notNull(),
  valueIv: text('value_iv').notNull(),
  valueCt: text('value_ct').notNull(),
  dekIv: text('dek_iv').notNull(),
  dekCt: text('dek_ct').notNull(),
  createdAt: integer('created_at').notNull(),
}, t => [primaryKey({ columns: [t.secretId, t.version] })])

/**
 * An agent's request for one vault secret for one machine. The machine key's
 * fingerprint is pinned when the request is made; the request carries no value.
 * `pending` → `approved` | `denied` | `cancelled` (expiry is read from `expires_at`).
 */
export const secretAccessRequests = sqliteTable('secret_access_requests', {
  id: text('id').primaryKey(),
  vaultId: text('vault_id').notNull(),
  ownerEmail: text('owner_email').notNull(),
  requester: text('requester').notNull(),
  requesterAct: text('requester_act').notNull(),
  consumerId: text('consumer_id').notNull(),
  consumerFingerprint: text('consumer_fingerprint').notNull(),
  fieldName: text('field_name').notNull(),
  secretId: text('secret_id'),
  secretVersion: integer('secret_version'),
  purpose: text('purpose').notNull().default(''),
  status: text('status', { enum: ['pending', 'approved', 'denied', 'cancelled'] }).notNull(),
  expiresAt: integer('expires_at').notNull(),
  createdAt: integer('created_at').notNull(),
  decidedAt: integer('decided_at'),
}, t => [index('idx_access_requests_owner').on(t.ownerEmail, t.status)])

/**
 * One approved handover: an exact secret version, sealed for one machine key,
 * with a release mode. The package opens only with that machine's private key.
 * `active` → `consumed` | `revoked`; expiry and supersession are read from the row.
 */
export const secretApprovals = sqliteTable('secret_approvals', {
  id: text('id').primaryKey(),
  requestId: text('request_id').notNull(),
  vaultId: text('vault_id').notNull(),
  ownerEmail: text('owner_email').notNull(),
  requester: text('requester').notNull(),
  consumerId: text('consumer_id').notNull(),
  consumerFingerprint: text('consumer_fingerprint').notNull(),
  secretId: text('secret_id').notNull(),
  secretVersion: integer('secret_version').notNull(),
  mode: text('mode', { enum: ['once', 'timed', 'standing'] }).notNull(),
  expiresAt: integer('expires_at'),
  status: text('status', { enum: ['active', 'consumed', 'revoked'] }).notNull(),
  packageEpk: text('package_epk').notNull(),
  packageIv: text('package_iv').notNull(),
  packageCt: text('package_ct').notNull(),
  credentialId: text('credential_id').notNull(),
  createdAt: integer('created_at').notNull(),
  consumedAt: integer('consumed_at'),
  revokedAt: integer('revoked_at'),
}, t => [index('idx_approvals_owner').on(t.ownerEmail, t.status)])

/** What happened, by IDs only: never values, keys or packages. */
export const secretAuditEvents = sqliteTable('secret_audit_events', {
  id: text('id').primaryKey(),
  actor: text('actor').notNull(),
  event: text('event').notNull(),
  vaultId: text('vault_id'),
  credentialId: text('credential_id'),
  result: text('result').notNull(),
  createdAt: integer('created_at').notNull(),
})
