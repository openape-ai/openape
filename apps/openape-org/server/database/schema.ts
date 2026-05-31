import { index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core'

// organizations — one row per virtual company.
//
// `ownerEmail` is the human Owner (DDISA email). `name` is human-readable
// and used in URLs after slugification client-side. `visionMd` is the
// Markdown the Owner maintains — the CEO reads it on every interaction
// to ground its decisions; never auto-edited by agents.
// `budgetMonthlyEur` is the hard limit the Sanierer watches against
// rolling 30-day cost. Reserved `owner_email` field is the multi-tenant
// hook for later — for v1 every org is owned by exactly one human.
export const organizations = sqliteTable('organizations', {
  id: text('id').primaryKey(),
  ownerEmail: text('owner_email').notNull(),
  name: text('name').notNull(),
  visionMd: text('vision_md').notNull().default(''),
  budgetMonthlyEur: integer('budget_monthly_eur').notNull().default(0),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
}, table => [
  index('idx_org_owner').on(table.ownerEmail),
])

// org_members — agents that work for this organization, with their
// hierarchy + role.
//
// `agentEmail` matches the DDISA-issued email of the agent in troop.
// `role` is one of: ceo / teamlead / specialist / sanierer / other.
// `reportsToEmail` is the parent agent in the hierarchy — null for
// CEO + Sanierer (CEO reports to Owner; Sanierer reports to Owner too,
// outside the CEO chain). `status` lifecycle: invited → active → retired.
// `spawnedAt` is when troop confirmed the agent existed.
export const orgMembers = sqliteTable('org_members', {
  orgId: text('org_id').notNull(),
  agentEmail: text('agent_email').notNull(),
  agentName: text('agent_name').notNull(),
  role: text('role').notNull(),
  reportsToEmail: text('reports_to_email'),
  status: text('status').notNull().default('invited'),
  spawnedAt: integer('spawned_at'),
  retiredAt: integer('retired_at'),
  createdAt: integer('created_at').notNull(),
}, table => [
  primaryKey({ columns: [table.orgId, table.agentEmail] }),
  index('idx_org_members_org').on(table.orgId),
  index('idx_org_members_role').on(table.orgId, table.role),
])

// objectives — what the org is currently working on. A Kanban-style
// flat list (with optional `parentId` for nesting epics → stories later).
// `status` lifecycle: planned → in_progress → done | abandoned.
// `targetDate` is aspirational, not enforced.
//
// CEO is the only agent allowed to write here at v1 (audit via the
// `createdByEmail` field — always set to the CEO's email when written
// through the API by an authenticated CEO agent).
export const objectives = sqliteTable('objectives', {
  id: text('id').primaryKey(),
  orgId: text('org_id').notNull(),
  title: text('title').notNull(),
  description: text('description').notNull().default(''),
  status: text('status').notNull().default('planned'),
  targetDate: integer('target_date'),
  parentId: text('parent_id'),
  createdByEmail: text('created_by_email').notNull(),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
}, table => [
  index('idx_objectives_org').on(table.orgId),
  index('idx_objectives_status').on(table.orgId, table.status),
])

// reports — markdown reports produced by agents. `kind` is one of:
// daily | weekly | quarterly | alert | adhoc. The Sanierer writes
// `kind='alert'` for threshold-breach notifications; CEO writes the
// recurring `weekly` / `quarterly` summaries.
export const reports = sqliteTable('reports', {
  id: text('id').primaryKey(),
  orgId: text('org_id').notNull(),
  kind: text('kind').notNull(),
  title: text('title').notNull(),
  bodyMd: text('body_md').notNull(),
  generatedByEmail: text('generated_by_email').notNull(),
  createdAt: integer('created_at').notNull(),
}, table => [
  index('idx_reports_org').on(table.orgId, table.createdAt),
])

// cost_snapshots — one row per (org, day). Sanierer writes these by
// polling LiteLLM's cost log + nest infra stats. Rolling 30 days is
// what the budget check uses.
export const costSnapshots = sqliteTable('cost_snapshots', {
  orgId: text('org_id').notNull(),
  day: text('day').notNull(), // ISO date 2026-05-31
  tokensIn: integer('tokens_in').notNull().default(0),
  tokensOut: integer('tokens_out').notNull().default(0),
  inferenceCostCents: integer('inference_cost_cents').notNull().default(0),
  infraCostCents: integer('infra_cost_cents').notNull().default(0),
  outputArtifactsCount: integer('output_artifacts_count').notNull().default(0),
  updatedAt: integer('updated_at').notNull(),
}, table => [
  primaryKey({ columns: [table.orgId, table.day] }),
])

export type Organization = typeof organizations.$inferSelect
export type NewOrganization = typeof organizations.$inferInsert
export type OrgMember = typeof orgMembers.$inferSelect
export type NewOrgMember = typeof orgMembers.$inferInsert
export type Objective = typeof objectives.$inferSelect
export type NewObjective = typeof objectives.$inferInsert
export type Report = typeof reports.$inferSelect
export type NewReport = typeof reports.$inferInsert
export type CostSnapshot = typeof costSnapshots.$inferSelect
export type NewCostSnapshot = typeof costSnapshots.$inferInsert
