import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const magicLinkTokens = sqliteTable('magic_link_tokens', {
  token: text('token').primaryKey(),
  email: text('email').notNull(),
  expiresAt: integer('expires_at').notNull(),
  createdAt: integer('created_at').notNull().$defaultFn(() => Date.now()),
})

export const authCodes = sqliteTable('auth_codes', {
  code: text('code').primaryKey(),
  spId: text('sp_id').notNull(),
  redirectUri: text('redirect_uri').notNull(),
  codeChallenge: text('code_challenge').notNull(),
  userId: text('user_id').notNull(),
  nonce: text('nonce').notNull(),
  expiresAt: integer('expires_at').notNull(),
})

export const signingKeys = sqliteTable('signing_keys', {
  kid: text('kid').primaryKey(),
  privateKeyJwk: text('private_key_jwk').notNull(),
  publicKeyJwk: text('public_key_jwk').notNull(),
  isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
  createdAt: integer('created_at').notNull().$defaultFn(() => Date.now()),
})

export const rateLimits = sqliteTable('rate_limits', {
  key: text('key').primaryKey(),
  count: integer('count').notNull().default(0),
  windowStart: integer('window_start').notNull(),
})
