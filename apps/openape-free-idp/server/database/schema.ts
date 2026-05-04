import { index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const grants = sqliteTable('grants', {
  id: text('id').primaryKey(),
  status: text('status').notNull(),
  type: text('type'),
  requester: text('requester').notNull(),
  targetHost: text('target_host').notNull(),
  audience: text('audience').notNull(),
  grantType: text('grant_type').notNull(),
  request: text('request', { mode: 'json' }).notNull(),
  createdAt: integer('created_at').notNull(),
  decidedAt: integer('decided_at'),
  decidedBy: text('decided_by'),
  expiresAt: integer('expires_at'),
  usedAt: integer('used_at'),
  // When this grant was auto-approved by matching a standing grant, this
  // column records the standing grant's id for audit-trail purposes.
  // Null for grants decided via the normal manual approval path.
  decidedByStandingGrant: text('decided_by_standing_grant'),
  // Which auto-approval path decided this grant. Null = human decision,
  // 'standing' = standing-grant match, 'yolo' = per-agent YOLO policy.
  autoApprovalKind: text('auto_approval_kind'),
}, table => [
  index('idx_grants_status').on(table.status),
  index('idx_grants_requester').on(table.requester),
  index('idx_grants_created_at').on(table.createdAt),
  index('idx_grants_type').on(table.type),
])

// --- Server-side shape registry ---
// Replaces client-side ~/.openape/shapes/adapters/*.toml — the IdP is the
// canonical source of CLI operation definitions. Populated via the seed
// script (scripts/seed-shapes.ts) and eventually user uploads.
export const shapes = sqliteTable('shapes', {
  cliId: text('cli_id').primaryKey(),
  executable: text('executable').notNull(),
  description: text('description').notNull(),
  // JSON-encoded ServerShapeOperation[]; see packages/grants/src/shape-registry.ts
  operations: text('operations', { mode: 'json' }).notNull(),
  // 'builtin' (seeded from monorepo) or 'custom' (uploaded by user)
  source: text('source').notNull(),
  // sha256:<hex> of the serialized shape for drift detection
  digest: text('digest').notNull(),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
}, table => [
  index('idx_shapes_source').on(table.source),
  index('idx_shapes_executable').on(table.executable),
])

export const grantChallenges = sqliteTable('grant_challenges', {
  challenge: text('challenge').primaryKey(),
  agentId: text('agent_id').notNull(),
  expiresAt: integer('expires_at').notNull(),
})

// --- Milestone 1: Unified Users (humans + agents) ---

export const users = sqliteTable('users', {
  email: text('email').primaryKey(),
  id: text('id'),
  name: text('name').notNull(),
  owner: text('owner'),
  approver: text('approver'),
  type: text('type'),
  publicKey: text('public_key'),
  isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
  createdAt: integer('created_at').notNull(),
}, table => [
  index('idx_users_id').on(table.id),
  index('idx_users_owner').on(table.owner),
  index('idx_users_approver').on(table.approver),
])

// --- Milestone 2: Auth Tokens ---

export const refreshTokenFamilies = sqliteTable('refresh_token_families', {
  familyId: text('family_id').primaryKey(),
  userId: text('user_id').notNull(),
  clientId: text('client_id').notNull(),
  currentTokenHash: text('current_token_hash').notNull(),
  createdAt: integer('created_at').notNull(),
  expiresAt: integer('expires_at').notNull(),
  revoked: integer('revoked', { mode: 'boolean' }).notNull().default(false),
}, table => [
  index('idx_refresh_families_user_id').on(table.userId),
  index('idx_refresh_families_client_id').on(table.clientId),
])

export const refreshTokens = sqliteTable('refresh_tokens', {
  tokenHash: text('token_hash').primaryKey(),
  familyId: text('family_id').notNull(),
  userId: text('user_id').notNull(),
  clientId: text('client_id').notNull(),
  expiresAt: integer('expires_at').notNull(),
  used: integer('used', { mode: 'boolean' }).notNull().default(false),
}, table => [
  index('idx_refresh_tokens_family_id').on(table.familyId),
])

export const codes = sqliteTable('codes', {
  code: text('code').primaryKey(),
  clientId: text('client_id').notNull(),
  redirectUri: text('redirect_uri').notNull(),
  codeChallenge: text('code_challenge').notNull(),
  userId: text('user_id').notNull(),
  nonce: text('nonce'),
  expiresAt: integer('expires_at').notNull(),
  extraData: text('extra_data', { mode: 'json' }),
})

export const jtis = sqliteTable('jtis', {
  jti: text('jti').primaryKey(),
  expiresAt: integer('expires_at').notNull(),
})

// --- Milestone 3: WebAuthn ---

export const credentials = sqliteTable('credentials', {
  credentialId: text('credential_id').primaryKey(),
  userEmail: text('user_email').notNull(),
  publicKey: text('public_key').notNull(),
  counter: integer('counter').notNull(),
  transports: text('transports', { mode: 'json' }),
  deviceType: text('device_type').notNull(),
  backedUp: integer('backed_up', { mode: 'boolean' }).notNull(),
  createdAt: integer('created_at').notNull(),
  name: text('name'),
  rpId: text('rp_id'),
}, table => [
  index('idx_credentials_user_email').on(table.userEmail),
  index('idx_credentials_rp_id').on(table.rpId),
])

export const webauthnChallenges = sqliteTable('webauthn_challenges', {
  token: text('token').primaryKey(),
  challenge: text('challenge').notNull(),
  userEmail: text('user_email'),
  type: text('type').notNull(),
  expiresAt: integer('expires_at').notNull(),
  rpId: text('rp_id'),
})

export const registrationUrls = sqliteTable('registration_urls', {
  token: text('token').primaryKey(),
  email: text('email').notNull(),
  name: text('name').notNull(),
  createdAt: integer('created_at').notNull(),
  expiresAt: integer('expires_at').notNull(),
  createdBy: text('created_by').notNull(),
  consumed: integer('consumed', { mode: 'boolean' }).notNull().default(false),
})

// --- Milestone 4: Signing Keys ---

export const signingKeys = sqliteTable('signing_keys', {
  kid: text('kid').primaryKey(),
  privateKeyJwk: text('private_key_jwk', { mode: 'json' }).notNull(),
  publicKeyJwk: text('public_key_jwk', { mode: 'json' }).notNull(),
  isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
  createdAt: integer('created_at').notNull(),
})

// --- Milestone 6: YOLO auto-approval policies ---
// One row per agent. Presence = enabled. Deny rules mark the subset of
// grant requests that fall back to the normal (human) approval flow.
export const yoloPolicies = sqliteTable('yolo_policies', {
  agentEmail: text('agent_email').notNull(),
  // Audience scope. '*' = applies to ALL audiences as a fallback.
  // Specific audience strings like 'ape-shell', 'ape-proxy', 'escapes' override
  // the '*' fallback when the request matches. Composite PK with agent_email
  // means per-agent-per-audience policies are independent rows.
  audience: text('audience').notNull().default('*'),
  // Pattern-list interpretation:
  //   'deny-list' (default; backwards-compatible with pre-M3.5 rows): auto-
  //     approve UNLESS a pattern matches. Risk-threshold also applies.
  //   'allow-list': require manual approval UNLESS a pattern matches. Risk-
  //     threshold does NOT apply (operator already enumerated the safe set).
  mode: text('mode').notNull().default('deny-list'),
  enabledBy: text('enabled_by').notNull(),
  denyRiskThreshold: text('deny_risk_threshold'),
  // Two independent pattern lists, one per mode. The active list is picked
  // by `mode`. Keeping both means flipping the YOLO toggle in the UI doesn't
  // destroy the inactive list (the previous single-list shape was confusing:
  // the same array got relabeled as deny-patterns when YOLO was on and as
  // allow-patterns when YOLO was off).
  denyPatterns: text('deny_patterns', { mode: 'json' }).notNull().default('[]'),
  allowPatterns: text('allow_patterns', { mode: 'json' }).notNull().default('[]'),
  enabledAt: integer('enabled_at').notNull(),
  expiresAt: integer('expires_at'),
  updatedAt: integer('updated_at').notNull(),
}, table => [
  primaryKey({ columns: [table.agentEmail, table.audience] }),
])

// --- Milestone 5: SSH Keys ---

export const sshKeys = sqliteTable('ssh_keys', {
  keyId: text('key_id').primaryKey(),
  userEmail: text('user_email').notNull(),
  publicKey: text('public_key').notNull(),
  name: text('name').notNull(),
  createdAt: integer('created_at').notNull(),
}, table => [
  index('idx_ssh_keys_user_email').on(table.userEmail),
  index('idx_ssh_keys_public_key').on(table.publicKey),
])

// --- Milestone 7: Web Push for grant approvers ---
// One row per (user, browser-install) pair. The endpoint URL is the
// browser's push-service URL — stable per (browser, install) — and is
// used as the natural primary key. p256dh + auth are the public keys
// the server uses to encrypt push payloads; without them, web-push
// can't deliver. Subscriptions are pruned when a 404/410 comes back
// (browser uninstalled the PWA or revoked permission).
export const pushSubscriptions = sqliteTable('push_subscriptions', {
  endpoint: text('endpoint').primaryKey(),
  userEmail: text('user_email').notNull(),
  p256dh: text('p256dh').notNull(),
  auth: text('auth').notNull(),
  createdAt: integer('created_at').notNull(),
}, table => [
  index('idx_push_subs_user_email').on(table.userEmail),
])

// --- DDISA allowlist-user consents (#301) ---
// One row per (user, SP) pair the user has approved via the consent
// screen. PK is composite — re-approving the same SP just refreshes
// `granted_at`. Revocation is a DELETE; the user sees the consent
// screen again on next /authorize.
export const consents = sqliteTable('consents', {
  userEmail: text('user_email').notNull(),
  clientId: text('client_id').notNull(),
  grantedAt: integer('granted_at').notNull(),
}, table => [
  primaryKey({ columns: [table.userEmail, table.clientId] }),
  index('idx_consents_user_email').on(table.userEmail),
])
