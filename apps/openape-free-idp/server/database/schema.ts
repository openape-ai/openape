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
