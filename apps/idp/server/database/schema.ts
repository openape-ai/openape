import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

// --- Users (unified model with type field) ---

export const users = sqliteTable('users', {
  email: text('email').primaryKey(),
  name: text('name').notNull(),
  owner: text('owner'),
  approver: text('approver'),
  type: text('type'),
  isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
  createdAt: integer('created_at').notNull(),
}, table => [
  index('idx_users_owner').on(table.owner),
])

// --- SSH Keys ---

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

// --- Grants ---

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

// --- Grant Challenges ---

export const grantChallenges = sqliteTable('grant_challenges', {
  challenge: text('challenge').primaryKey(),
  agentId: text('agent_id').notNull(),
  expiresAt: integer('expires_at').notNull(),
})

// --- Auth Codes ---

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

// --- Signing Keys ---

export const signingKeys = sqliteTable('signing_keys', {
  kid: text('kid').primaryKey(),
  privateKeyJwk: text('private_key_jwk', { mode: 'json' }).notNull(),
  publicKeyJwk: text('public_key_jwk', { mode: 'json' }).notNull(),
  isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
  createdAt: integer('created_at').notNull(),
})

// --- JTIs (replay protection) ---

export const jtis = sqliteTable('jtis', {
  jti: text('jti').primaryKey(),
  expiresAt: integer('expires_at').notNull(),
})

// --- Refresh Tokens ---

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

// --- Registration URLs ---

export const registrationUrls = sqliteTable('registration_urls', {
  token: text('token').primaryKey(),
  email: text('email').notNull(),
  name: text('name').notNull(),
  createdAt: integer('created_at').notNull(),
  expiresAt: integer('expires_at').notNull(),
  createdBy: text('created_by').notNull(),
  consumed: integer('consumed', { mode: 'boolean' }).notNull().default(false),
})

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
