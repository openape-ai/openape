import { index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core'

// Ein Workspace ist der Datentopf: Deals, Kontakte, Firmen und Notizen hängen
// daran, Zugriff regelt workspace_members (owner|manager|member).

export const workspaces = sqliteTable('workspaces', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  createdBy: text('created_by').notNull(),
  createdAt: integer('created_at').notNull(),
  archivedAt: integer('archived_at'),
})

export const workspaceMembers = sqliteTable('workspace_members', {
  workspaceId: text('workspace_id').notNull(),
  userEmail: text('user_email').notNull(),
  role: text('role', { enum: ['owner', 'manager', 'member'] }).notNull(),
  joinedAt: integer('joined_at').notNull(),
}, t => [
  primaryKey({ columns: [t.workspaceId, t.userEmail] }),
  index('idx_wm_email').on(t.userEmail),
])

export const workspaceInvites = sqliteTable('workspace_invites', {
  id: text('id').primaryKey(),
  /** Zufälliges Geheimnis aus dem Einladungslink — kein JWT, kein Secret nötig. */
  token: text('token').notNull().unique(),
  workspaceId: text('workspace_id').notNull(),
  createdBy: text('created_by').notNull(),
  note: text('note'),
  grantRole: text('grant_role', { enum: ['owner', 'manager', 'member'] }).notNull(),
  maxUses: integer('max_uses').notNull().default(5),
  usedCount: integer('used_count').notNull().default(0),
  expiresAt: integer('expires_at').notNull(),
  revokedAt: integer('revoked_at'),
  createdAt: integer('created_at').notNull(),
}, t => [
  index('idx_wi_workspace').on(t.workspaceId),
])

export const organizations = sqliteTable('organizations', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull(),
  name: text('name').notNull(),
  domain: text('domain'),
  website: text('website'),
  address: text('address'),
  postalCode: text('postal_code'),
  city: text('city'),
  country: text('country'),
  createdAt: integer('created_at').notNull(),
}, t => [
  index('idx_org_workspace').on(t.workspaceId),
])

export const contacts = sqliteTable('contacts', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull(),
  orgId: text('org_id'),
  name: text('name').notNull(),
  firstName: text('first_name'),
  lastName: text('last_name'),
  title: text('title'),
  gender: text('gender'),
  email: text('email'),
  phone: text('phone'),
  createdAt: integer('created_at').notNull(),
}, t => [
  index('idx_contact_workspace').on(t.workspaceId),
])

export const contactEmails = sqliteTable('contact_emails', {
  id: text('id').primaryKey(),
  contactId: text('contact_id').notNull(),
  email: text('email').notNull(),
  position: integer('position').notNull().default(0),
}, t => [
  index('idx_contact_emails').on(t.contactId),
])

export const contactPhones = sqliteTable('contact_phones', {
  id: text('id').primaryKey(),
  contactId: text('contact_id').notNull(),
  phone: text('phone').notNull(),
  position: integer('position').notNull().default(0),
}, t => [
  index('idx_contact_phones').on(t.contactId),
])

export const pipelineStages = sqliteTable('pipeline_stages', {
  workspaceId: text('workspace_id').notNull(),
  key: text('key').notNull(),
  name: text('name').notNull(),
  outcome: text('outcome', { enum: ['open', 'won', 'lost'] }).notNull().default('open'),
  position: integer('position').notNull(),
}, t => [
  primaryKey({ columns: [t.workspaceId, t.key] }),
])

export const deals = sqliteTable('deals', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull(),
  title: text('title').notNull(),
  valueCents: integer('value_cents').notNull().default(0),
  stage: text('stage').notNull(),
  phase: text('phase').notNull().default('deal'),
  stufe: text('stufe').notNull().default('inbound'),
  contactId: text('contact_id'),
  orgId: text('org_id'),
  position: integer('position').notNull().default(0),
  createdBy: text('created_by').notNull(),
  createdAt: integer('created_at').notNull(),
  closedAt: integer('closed_at'),
}, t => [
  index('idx_deal_workspace').on(t.workspaceId),
  index('idx_deal_stage').on(t.workspaceId, t.stage, t.position),
  index('idx_deal_stufe').on(t.workspaceId, t.phase, t.stufe, t.position),
])

export const dealContacts = sqliteTable('deal_contacts', {
  dealId: text('deal_id').notNull(),
  contactId: text('contact_id').notNull(),
}, t => [
  primaryKey({ columns: [t.dealId, t.contactId] }),
])

export const notes = sqliteTable('notes', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull(),
  dealId: text('deal_id').notNull(),
  authorEmail: text('author_email').notNull(),
  kind: text('kind').notNull().default('notiz'),
  title: text('title').notNull().default('Notiz'),
  body: text('body').notNull(),
  createdAt: integer('created_at').notNull(),
}, t => [
  index('idx_note_deal').on(t.dealId, t.createdAt),
])

export const products = sqliteTable('products', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull(),
  name: text('name').notNull(),
  description: text('description'),
  standardPriceCents: integer('standard_price_cents').notNull().default(0),
  standardBilling: text('standard_billing').notNull().default('monatlich'),
  createdAt: integer('created_at').notNull(),
}, t => [
  index('idx_product_workspace').on(t.workspaceId),
])

export const contracts = sqliteTable('contracts', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull(),
  dealId: text('deal_id').notNull(),
  status: text('status').notNull().default('offen'),
  startDate: text('start_date').notNull(),
  minimumTermMonths: integer('minimum_term_months'),
  currency: text('currency').notNull().default('EUR'),
  offerNumber: text('offer_number').notNull(),
  conditions: text('conditions'),
  driveItemId: text('drive_item_id'),
  webUrl: text('web_url'),
  signedDriveItemId: text('signed_drive_item_id'),
  signedWebUrl: text('signed_web_url'),
  createdAt: integer('created_at').notNull(),
}, t => [
  index('idx_contract_deal').on(t.dealId),
])

export const contractLines = sqliteTable('contract_lines', {
  id: text('id').primaryKey(),
  contractId: text('contract_id').notNull(),
  productId: text('product_id').notNull(),
  priceCents: integer('price_cents').notNull(),
  discountCents: integer('discount_cents').notNull().default(0),
  billing: text('billing').notNull(),
}, t => [
  index('idx_line_contract').on(t.contractId),
])

export const dealFiles = sqliteTable('deal_files', {
  id: text('id').primaryKey(),
  dealId: text('deal_id').notNull(),
  contractId: text('contract_id'),
  name: text('name').notNull(),
  driveItemId: text('drive_item_id').notNull(),
  webUrl: text('web_url').notNull(),
  mime: text('mime'),
  size: integer('size'),
  createdAt: integer('created_at').notNull(),
}, t => [
  index('idx_file_deal').on(t.dealId),
])

export const tasks = sqliteTable('tasks', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull(),
  dealId: text('deal_id').notNull(),
  title: text('title').notNull(),
  description: text('description'),
  dueAt: text('due_at'),
  assigneeEmail: text('assignee_email').notNull(),
  status: text('status').notNull().default('offen'),
  createdAt: integer('created_at').notNull(),
}, t => [
  index('idx_task_deal').on(t.dealId),
  index('idx_task_workspace').on(t.workspaceId),
])

export const threads = sqliteTable('threads', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull(),
  dealId: text('deal_id'),
  subject: text('subject').notNull(),
  status: text('status').notNull().default('neu'),
  source: text('source').notNull(),
  internetMessageId: text('internet_message_id'),
  createdAt: integer('created_at').notNull(),
}, t => [
  index('idx_thread_workspace').on(t.workspaceId),
])

export const threadMessages = sqliteTable('thread_messages', {
  id: text('id').primaryKey(),
  threadId: text('thread_id').notNull(),
  fromAddress: text('from_address').notNull(),
  body: text('body').notNull(),
  createdAt: integer('created_at').notNull(),
}, t => [
  index('idx_msg_thread').on(t.threadId),
])

export const graphAccounts = sqliteTable('graph_accounts', {
  userEmail: text('user_email').primaryKey(),
  graphUserId: text('graph_user_id'),
  mail: text('mail'),
  encryptedRefresh: text('encrypted_refresh').notNull(),
  subscriptionId: text('subscription_id'),
  subscriptionExpires: integer('subscription_expires'),
  connectedAt: integer('connected_at').notNull(),
})
