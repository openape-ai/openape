import { describe, expect, it, vi } from 'vitest'

// The endpoint attaches org membership via raw-SQL subqueries, so a wrong
// column name would only surface at runtime. Run the real query against an
// in-memory LibSQL with the same DDL as 02.database.ts.
vi.mock('../server/database/drizzle', async () => {
  const { createClient } = await import('@libsql/client')
  const { drizzle } = await import('drizzle-orm/libsql')
  const schema = await import('../server/database/schema')
  const client = createClient({ url: 'file::memory:?cache=shared' })
  await client.execute(`CREATE TABLE agents (email TEXT PRIMARY KEY, owner_email TEXT NOT NULL, agent_name TEXT NOT NULL, host_id TEXT, hostname TEXT, nest_host_id TEXT, pubkey_ssh TEXT, pubkey_x25519 TEXT, system_prompt TEXT NOT NULL DEFAULT '', tools TEXT NOT NULL DEFAULT '[]', user_addendum TEXT NOT NULL DEFAULT '', recipe_ref TEXT, paused INTEGER NOT NULL DEFAULT 0, first_seen_at INTEGER, last_seen_at INTEGER, created_at INTEGER NOT NULL)`)
  await client.execute(`CREATE TABLE tasks (agent_email TEXT NOT NULL, task_id TEXT NOT NULL, name TEXT NOT NULL, cron TEXT NOT NULL, user_prompt TEXT NOT NULL, command TEXT, tools TEXT NOT NULL, max_steps INTEGER NOT NULL DEFAULT 10, enabled INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY (agent_email, task_id))`)
  await client.execute(`CREATE TABLE runs (id TEXT PRIMARY KEY, agent_email TEXT NOT NULL, task_id TEXT NOT NULL, started_at INTEGER NOT NULL, finished_at INTEGER, status TEXT NOT NULL, final_message TEXT, step_count INTEGER, trace TEXT)`)
  await client.execute(`CREATE TABLE organizations (id TEXT PRIMARY KEY, owner_email TEXT NOT NULL, name TEXT NOT NULL, vision_md TEXT NOT NULL DEFAULT '', budget_monthly_eur INTEGER NOT NULL DEFAULT 0, vars TEXT NOT NULL DEFAULT '{}', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`)
  await client.execute(`CREATE TABLE org_members (org_id TEXT NOT NULL, agent_email TEXT NOT NULL, agent_name TEXT NOT NULL, role TEXT NOT NULL, persona TEXT, reports_to_email TEXT, status TEXT NOT NULL DEFAULT 'invited', spawned_at INTEGER, retired_at INTEGER, created_at INTEGER NOT NULL, spawn_intent_id TEXT, spawn_status TEXT, spawn_error TEXT, spawn_troop_bearer TEXT, spawn_troop_bearer_expires_at INTEGER, spawn_grant_id TEXT, PRIMARY KEY (org_id, agent_email))`)
  return { useDb: () => drizzle(client, { schema }) }
})

const OWNER = 'owner@example.test'
vi.mock('../server/utils/auth', () => ({ requireOwner: vi.fn(async () => OWNER) }))

// `defineEventHandler` is a Nitro auto-import; outside Nuxt it's just identity.
vi.stubGlobal('defineEventHandler', (fn: unknown) => fn)

const handler = (await import('../server/api/agents/index.get')).default as unknown as (event: unknown) => Promise<Array<Record<string, unknown>>>
const { useDb } = await import('../server/database/drizzle')
const { agents, organizations, orgMembers } = await import('../server/database/schema')

async function seed() {
  const db = useDb()
  await db.insert(organizations).values([
    { id: 'org-a', ownerEmail: OWNER, name: 'OpenApe', createdAt: 1, updatedAt: 1 },
    { id: 'org-b', ownerEmail: OWNER, name: 'Delta Mind', createdAt: 1, updatedAt: 1 },
    { id: 'org-foreign', ownerEmail: 'other@example.test', name: 'Foreign', createdAt: 1, updatedAt: 1 },
  ])
  await db.insert(agents).values([
    { email: 'pm@x', ownerEmail: OWNER, agentName: 'pm', createdAt: 3 },
    { email: 'backend@x', ownerEmail: OWNER, agentName: 'backend', createdAt: 2 },
    { email: 'zaz@x', ownerEmail: OWNER, agentName: 'zaz', createdAt: 1 },
    { email: 'foreign@x', ownerEmail: OWNER, agentName: 'foreign', createdAt: 1 },
    { email: 'retired@x', ownerEmail: OWNER, agentName: 'retired', createdAt: 1 },
  ])
  await db.insert(orgMembers).values([
    { orgId: 'org-a', agentEmail: 'pm@x', agentName: 'pm', role: 'teamlead', status: 'active', createdAt: 10 },
    { orgId: 'org-a', agentEmail: 'backend@x', agentName: 'backend', role: 'specialist', reportsToEmail: 'pm@x', status: 'active', createdAt: 11 },
    // backend joined a second org later — the earliest membership stays its home.
    { orgId: 'org-b', agentEmail: 'backend@x', agentName: 'backend', role: 'specialist', status: 'active', createdAt: 99 },
    { orgId: 'org-foreign', agentEmail: 'foreign@x', agentName: 'foreign', role: 'specialist', status: 'active', createdAt: 1 },
    { orgId: 'org-a', agentEmail: 'retired@x', agentName: 'retired', role: 'specialist', status: 'retired', createdAt: 1 },
  ])
}

describe('GET /api/agents org membership', () => {
  it('attaches company, role and supervisor — and leaves unassigned agents null', async () => {
    await seed()
    const rows = await handler({})
    const by = Object.fromEntries(rows.map(r => [r.agentName as string, r]))

    expect(by.pm).toMatchObject({ orgId: 'org-a', orgName: 'OpenApe', orgRole: 'teamlead', reportsToEmail: null })
    expect(by.backend).toMatchObject({ orgName: 'OpenApe', orgRole: 'specialist', reportsToEmail: 'pm@x' })
    expect(by.zaz).toMatchObject({ orgId: null, orgName: null, orgRole: null, reportsToEmail: null })
    expect(by.foreign).toMatchObject({ orgId: null, orgName: null, orgRole: null, reportsToEmail: null })
    expect(by.retired).toMatchObject({ orgId: null, orgName: null, orgRole: null, reportsToEmail: null })
  })

  it('keeps one row per agent even with a second membership', async () => {
    const rows = await handler({})
    expect(rows.filter(r => r.agentName === 'backend')).toHaveLength(1)
  })
})
