import { describe, expect, it, vi } from 'vitest'

// The allowlist derivation + persistence hit the real DB layer; run them
// against an in-memory LibSQL with the same DDL as 02.database.ts.
vi.mock('../server/database/drizzle', async () => {
  const { createClient } = await import('@libsql/client')
  const { drizzle } = await import('drizzle-orm/libsql')
  const schema = await import('../server/database/schema')
  const client = createClient({ url: 'file::memory:?cache=shared' })
  await client.execute(`CREATE TABLE IF NOT EXISTS organizations (id TEXT PRIMARY KEY, owner_email TEXT NOT NULL, name TEXT NOT NULL, vision_md TEXT NOT NULL DEFAULT '', budget_monthly_eur INTEGER NOT NULL DEFAULT 0, vars TEXT NOT NULL DEFAULT '{}', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`)
  await client.execute(`CREATE TABLE IF NOT EXISTS objectives (id TEXT PRIMARY KEY, org_id TEXT NOT NULL, title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'planned', target_date INTEGER, parent_id TEXT, created_by_email TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`)
  await client.execute(`CREATE TABLE IF NOT EXISTS cockpit_agents (id TEXT PRIMARY KEY, owner_email TEXT NOT NULL, org_id TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'specialist', label TEXT NOT NULL DEFAULT '', duties TEXT NOT NULL DEFAULT '', procedure TEXT NOT NULL DEFAULT '', vars TEXT NOT NULL DEFAULT '{}', injection_score REAL NOT NULL DEFAULT 0, injection_reason TEXT NOT NULL DEFAULT '', tools TEXT NOT NULL DEFAULT '[]', reports_to TEXT, enabled INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL)`)
  await client.execute(`CREATE TABLE IF NOT EXISTS memory (id TEXT PRIMARY KEY, owner_email TEXT NOT NULL, org_id TEXT NOT NULL, scope TEXT NOT NULL DEFAULT 'company', target_id TEXT NOT NULL DEFAULT '', title TEXT NOT NULL DEFAULT '', body TEXT NOT NULL DEFAULT '', mode TEXT NOT NULL DEFAULT 'inline', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`)
  await client.execute(`CREATE TABLE IF NOT EXISTS cockpit_skills (id TEXT PRIMARY KEY, owner_email TEXT NOT NULL, org_id TEXT NOT NULL, name TEXT NOT NULL DEFAULT '', description TEXT NOT NULL DEFAULT '', prompt TEXT NOT NULL DEFAULT '', assigned_to TEXT NOT NULL DEFAULT '[]', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`)
  const db = drizzle(client, { schema })
  return { useDb: () => db }
})
vi.mock('../server/utils/cockpit/auth', () => ({ requireCockpitAgent: vi.fn(async () => 'next@x') }))
// next.post.ts is a Nitro handler — give it the auto-imported wrapper.
;(globalThis as Record<string, unknown>).defineEventHandler = (h: unknown) => h

const { useDb } = await import('../server/database/drizzle')
const { cockpitAgents, organizations } = await import('../server/database/schema')
const { orgAllowedTools } = await import('../server/utils/cockpit/allowed-tools')
const { fireProactiveTask } = await import('../server/utils/cockpit/fire')
const { claimNext, enqueue, getTask, restoreTask } = await import('../server/utils/cockpit/queue')
const { ensureTaskTable, loadAndPrunePending, saveTask } = await import('../server/utils/cockpit/task-store')
const nextHandler = (await import('../server/api/cockpit/agent/tasks/next.post')).default as unknown as (event: unknown) => Promise<{ task: { metadata: Record<string, unknown> } | null }>

let seq = 0
async function seedAgent(owner: string, orgId: string, tools: string[], enabled = true): Promise<void> {
  seq += 1
  await useDb().insert(cockpitAgents).values({
    id: `ag-${seq}`, ownerEmail: owner, orgId, role: 'specialist', label: `A${seq}`,
    duties: '', procedure: '', vars: {}, injectionScore: 0, injectionReason: '',
    tools, reportsTo: null, enabled, createdAt: Date.now(),
  })
}

async function seedOrg(owner: string, orgId: string): Promise<void> {
  await useDb().insert(organizations).values({
    id: orgId, ownerEmail: owner, name: orgId, visionMd: '', budgetMonthlyEur: 0,
    vars: {}, createdAt: Date.now(), updatedAt: Date.now(),
  })
}

it('does not grant tools to an agent from a foreign owner', async () => {
  await seedAgent('owner-x', 'org-owned', ['o365-cli *'])
  expect(await orgAllowedTools('agent-x', 'org-owned')).toEqual([])
})

describe('orgAllowedTools — server-side derivation (#1036)', () => {
  it('unions the tools of all enabled roles, deduplicated', async () => {
    await seedAgent('alice@x', 'org-a', ['o365-cli *', 'gh *'])
    await seedAgent('alice@x', 'org-a', ['o365-cli *', 'curl *'])
    await seedAgent('alice@x', 'org-a', ['rm *'], false) // disabled — must not count
    const tools = await orgAllowedTools('alice@x', 'org-a')
    expect(new Set(tools)).toEqual(new Set(['o365-cli *', 'gh *', 'curl *']))
    expect(tools).toHaveLength(3)
  })

  it('returns [] for an org without roles', async () => {
    expect(await orgAllowedTools('alice@x', 'org-empty')).toEqual([])
  })

  it('returns [] when the roles declare no tools', async () => {
    await seedAgent('bob@x', 'org-b', [])
    expect(await orgAllowedTools('bob@x', 'org-b')).toEqual([])
  })

  it('is owner-bound — a foreign owner\'s roles never leak in', async () => {
    await seedAgent('carol@x', 'org-shared', ['ssh *'])
    expect(await orgAllowedTools('dave@x', 'org-shared')).toEqual([])
  })

  it('keeps an agent\'s allowlist isolated from another owner in the same org', async () => {
    await seedAgent('erin@x', 'org-agents', ['o365-cli *'])
    await seedAgent('frank@x', 'org-agents', ['curl *'])
    expect(await orgAllowedTools('erin@x', 'org-agents')).toEqual(['o365-cli *'])
  })
})

describe('enqueue carries allowedTools as task data', () => {
  it('stores the given allowlist on the task', () => {
    const t = enqueue('c-tools', 'sp', 'q', 'erin@x', undefined, ['o365-cli *'])
    expect(getTask(t.id)?.allowedTools).toEqual(['o365-cli *'])
  })

  it('defaults to an empty allowlist (hard sandbox)', () => {
    const t = enqueue('c-none', 'sp', 'q', 'erin@x')
    expect(getTask(t.id)?.allowedTools).toEqual([])
  })

  it('fireProactiveTask (schedule/hook path) derives the org union', async () => {
    await seedOrg('fiona@x', 'org-fire')
    await seedAgent('fiona@x', 'org-fire', ['gh *'])
    await seedAgent('fiona@x', 'org-fire', ['gh *', 'curl *'])
    expect(await fireProactiveTask('fiona@x', 'org-fire', 'ping')).toBe(true)
    const task = claimNext('fiona@x')
    expect(new Set(task?.allowedTools)).toEqual(new Set(['gh *', 'curl *']))
  })
})

describe('tasks/next — metadata carries allowedTools + company', () => {
  it('hands the worker the allowlist and org as data, not prose', async () => {
    enqueue('org-meta', 'sp', 'q', 'next@x', undefined, ['o365-cli *', 'gh *'])
    const res = await nextHandler({})
    expect(res.task?.metadata.allowedTools).toEqual(['o365-cli *', 'gh *'])
    expect(res.task?.metadata.company).toBe('org-meta')
  })
})

describe('persistence — restore roundtrip keeps allowedTools', () => {
  it('saveTask → loadAndPrunePending → restoreTask preserves the allowlist', async () => {
    await ensureTaskTable()
    await saveTask({ id: 'pt-1', company: 'org-p', owner: 'gina@x', systemPrompt: 'sp', userMessage: 'q', createdAt: Date.now(), allowedTools: ['o365-cli *'] })
    const rows = await loadAndPrunePending(60_000, Date.now())
    const row = rows.find(r => r.id === 'pt-1')
    expect(row?.allowedTools).toEqual(['o365-cli *'])
    restoreTask(row!)
    expect(getTask('pt-1')?.allowedTools).toEqual(['o365-cli *'])
  })

  it('a legacy row without allowed_tools restores to an empty allowlist', () => {
    restoreTask({ id: 'pt-legacy', company: 'org-p', owner: 'gina@x', systemPrompt: 'sp', userMessage: 'q', createdAt: Date.now() })
    expect(getTask('pt-legacy')?.allowedTools).toEqual([])
  })
})
