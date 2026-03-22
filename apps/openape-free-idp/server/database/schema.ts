import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

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
}, table => [
  index('idx_grants_status').on(table.status),
  index('idx_grants_requester').on(table.requester),
  index('idx_grants_created_at').on(table.createdAt),
  index('idx_grants_type').on(table.type),
])

export const grantChallenges = sqliteTable('grant_challenges', {
  challenge: text('challenge').primaryKey(),
  agentId: text('agent_id').notNull(),
  expiresAt: integer('expires_at').notNull(),
})

// --- Milestone 1: User & Agent ---

export const users = sqliteTable('users', {
  email: text('email').primaryKey(),
  name: text('name').notNull(),
  createdAt: integer('created_at').notNull(),
})

export const agents = sqliteTable('agents', {
  id: text('id').primaryKey(),
  email: text('email').notNull(),
  name: text('name').notNull(),
  owner: text('owner').notNull(),
  approver: text('approver').notNull(),
  publicKey: text('public_key').notNull(),
  createdAt: integer('created_at').notNull(),
  isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
}, table => [
  index('idx_agents_email').on(table.email),
  index('idx_agents_owner').on(table.owner),
  index('idx_agents_approver').on(table.approver),
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
}, table => [
  index('idx_credentials_user_email').on(table.userEmail),
])

export const webauthnChallenges = sqliteTable('webauthn_challenges', {
  token: text('token').primaryKey(),
  challenge: text('challenge').notNull(),
  userEmail: text('user_email'),
  type: text('type').notNull(),
  expiresAt: integer('expires_at').notNull(),
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
