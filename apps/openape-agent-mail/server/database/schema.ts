import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const organizations = sqliteTable('organizations', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  openapeSubject: text('openape_subject').notNull(),
  maxMailboxes: integer('max_mailboxes').default(5),
  mailboxSizeMb: integer('mailbox_size_mb').default(30),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
})

export const domains = sqliteTable('domains', {
  id: text('id').primaryKey(),
  orgId: text('org_id').notNull().references(() => organizations.id),
  domain: text('domain').notNull().unique(),
  resendDomainId: text('resend_domain_id'),
  status: text('status', { enum: ['pending', 'verified', 'failed'] }).default('pending'),
  dnsRecords: text('dns_records', { mode: 'json' }).$type<{ type: string, name: string, value: string }[]>(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
})

export const mailboxes = sqliteTable('mailboxes', {
  id: text('id').primaryKey(),
  orgId: text('org_id').notNull().references(() => organizations.id),
  domainId: text('domain_id').notNull().references(() => domains.id),
  localPart: text('local_part').notNull(),
  address: text('address').notNull().unique(),
  apiKeyHash: text('api_key_hash').notNull(),
  totalSizeBytes: integer('total_size_bytes').default(0),
  softCapBytes: integer('soft_cap_bytes').notNull(),
  messageCount: integer('message_count').default(0),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
})

export const messages = sqliteTable('messages', {
  id: text('id').primaryKey(),
  mailboxId: text('mailbox_id').notNull().references(() => mailboxes.id),
  direction: text('direction', { enum: ['inbound', 'outbound'] }).notNull(),
  fromAddr: text('from_addr').notNull(),
  toAddr: text('to_addr').notNull(),
  subject: text('subject'),
  textBody: text('text_body'),
  htmlBody: text('html_body'),
  sizeBytes: integer('size_bytes').notNull(),
  resendEmailId: text('resend_email_id'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
}, table => [
  index('idx_messages_mailbox_created').on(table.mailboxId, table.createdAt),
])
