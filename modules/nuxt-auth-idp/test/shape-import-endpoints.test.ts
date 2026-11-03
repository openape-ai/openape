// @vitest-environment node
// Shape tiers (issue 1553): one import path for IdP-wide, domain and personal
// shapes. Only the management token writes IdP-wide shapes, only a domain's
// root admins and operators its domain shapes, only the owner personal ones;
// every refusal writes nothing, every write is audited.
import type { OpenApeGrant } from '@openape/core'
import type { H3Event } from 'h3'
import { createServer } from 'node:http'
import type { ServerShape } from '@openape/grants'
import { createInMemoryShapeStore, InMemoryGrantStore } from '@openape/grants'
import { createApp, createRouter, eventHandler, getHeader, toNodeListener } from 'h3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const managementToken = 'management-token-fixture'
const admin = 'admin@example.test'
const operator = 'operator@example.test'
const member = 'member@example.test'
const foreignAdmin = 'admin@other.test'
const agent = 'agent@example.test'
const issuer = 'https://id.example.test'
const admins = new Set([admin, operator, foreignAdmin])
const registryGit: ServerShape = { cli_id: 'git', executable: 'git', description: 'Git', operations: [{ id: 'git.status', command: ['status'], display: 'Status', action: 'read', risk: 'low', resource_chain: [] }], source: 'builtin', digest: 'SHA-256:git', createdAt: 0, updatedAt: 0 }

let shapeStore = createInMemoryShapeStore([registryGit])
let grantStore = new InMemoryGrantStore()
let server: ReturnType<typeof createServer>
let base: string

vi.mock('../src/runtime/server/utils/agent-auth', () => ({
  tryBearerAuth: async (event: H3Event) => {
    const subject = getHeader(event, 'authorization')?.replace('Bearer ', '')
    if (!subject || subject === managementToken) return null
    if (subject === 'delegated') return { sub: admin, act: 'human', delegation_grant: 'g-delegation' }
    return { sub: subject, act: subject === agent ? 'agent' : 'human' }
  },
}))
vi.mock('../src/runtime/server/utils/session', () => ({ getAppSession: async (event: H3Event) => ({ data: getHeader(event, 'x-test-session') ? { userId: getHeader(event, 'x-test-session') } : {} }) }))
vi.mock('nitropack/runtime', () => ({ useRuntimeConfig: () => ({ openapeIdp: { managementToken } }), useEvent: () => undefined, useStorage: () => ({}) }))
vi.mock('../src/runtime/server/utils/grant-stores', () => ({ useGrantStores: () => ({ grantStore }) }))
vi.mock('../src/runtime/server/utils/shape-store', () => ({ useShapeStore: () => shapeStore }))
vi.mock('../src/runtime/server/utils/stores', () => ({
  getIdpIssuer: () => issuer,
  useIdpStores: () => ({
    userStore: {
      findByEmail: async (email: string) => email === agent ? { email, type: 'agent', owner: member, isActive: true } : { email, type: 'human', isActive: true },
      findByOwner: async (email: string) => email === member ? [{ email: agent, type: 'agent', owner: member, isActive: true }] : [],
    },
  }),
}))

const importRoute = (await import('../src/runtime/server/api/shapes/import.post')).default
const index = (await import('../src/runtime/server/api/shapes/index.get')).default
const changes = (await import('../src/runtime/server/api/shapes/changes.get')).default
const put = (await import('../src/runtime/server/api/shapes/[cliId].put')).default
const remove = (await import('../src/runtime/server/api/shapes/[cliId].delete')).default

function adapter(id: string, { executable = id, operation = 'run', extra = '' } = {}) {
  return `schema = "openape-shapes/v1"

[cli]
id = "${id}"
executable = "${executable}"
audience = "shapes"
version = "1"
${extra}
[[operation]]
id = "${operation}"
command = ["${operation}"]
display = "Run ${id}"
action = "exec"
risk = "low"
resource_chain = ["tool:name=${id}"]
`
}

async function request(method: string, path: string, subject: string | null, body?: unknown, headers: Record<string, string> = {}) {
  const response = await fetch(`${base}${path}`, { method, headers: { 'Content-Type': 'application/json', ...(subject ? { Authorization: `Bearer ${subject}` } : {}), ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
  return { status: response.status, json: await response.json() as Record<string, any> }
}
const batch = (...tomls: string[]) => ({ shapes: tomls.map(toml => ({ toml })) })
async function audit() {
  return [
    ...await shapeStore.listShapeChanges!('instance', '', 100),
    ...await shapeStore.listShapeChanges!('domain', 'example.test', 100),
    ...await shapeStore.listShapeChanges!('domain', 'other.test', 100),
    ...await shapeStore.listShapeChanges!('personal', member, 100),
  ]
}

function domainGrant(cliId: string, digest: string, extra: Record<string, unknown> = { adapter_domain: 'example.test' }): OpenApeGrant {
  return {
    id: `g-${cliId}-${digest}`,
    status: 'approved',
    type: 'command',
    created_at: 1,
    decided_at: 2,
    request: {
      requester: agent,
      target_host: 'macmini',
      audience: 'shapes',
      grant_type: 'always',
      permissions: ['p'],
      authorization_details: [{ type: 'openape_cli', cli_id: cliId, operation_id: 'run', resource_chain: [], action: 'exec', permission: 'p', display: 'Run', risk: 'low' }],
      execution_context: { adapter_id: cliId, adapter_version: 'server', adapter_digest: digest, resolved_executable: cliId, program_sha256: 'a'.repeat(64), ...extra },
    },
  }
}

beforeEach(async () => {
  shapeStore = createInMemoryShapeStore([registryGit])
  grantStore = new InMemoryGrantStore()
  const router = createRouter().post('/shapes/import', importRoute).get('/shapes', index).get('/shapes/changes', changes).put('/shapes/:cliId', put).delete('/shapes/:cliId', remove)
  const app = createApp()
  // The free IdP's resolver: root admin or operator of their own email domain.
  app.use(eventHandler((event) => { event.context.openapeAdminResolver = async (_event, email) => admins.has(email) }))
  server = createServer(toNodeListener(app.use(router)))
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Fixture did not start')
  base = `http://127.0.0.1:${address.port}`
})
afterEach(async () => { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())) })

describe('shape import refusals write nothing', () => {
  it('writes IdP-wide shapes only with the management token', async () => {
    const body = batch(adapter('jev'))
    expect((await request('POST', '/shapes/import?scope=instance', null, body)).status).toBe(401)
    expect((await request('POST', '/shapes/import?scope=instance', 'wrong-token', body)).status).toBe(403)
    expect((await request('POST', '/shapes/import?scope=instance', admin, body)).status).toBe(403)
    const session = await request('POST', '/shapes/import?scope=instance', null, body, { 'x-test-session': admin, 'Origin': issuer })
    expect(session.status).toBe(401)
    expect((await request('PUT', '/shapes/jev?scope=instance', admin, { toml: adapter('jev') })).status).toBe(403)
    expect((await request('DELETE', '/shapes/git?scope=instance', admin)).status).toBe(403)
    expect((await request('POST', '/shapes/import', managementToken, body)).status).toBe(400)
    expect((await shapeStore.listShapes()).map(shape => shape.cli_id)).toEqual(['git'])
    expect(await audit()).toEqual([])
  })

  it('writes domain shapes only by a root admin or operator of their own domain, never by agents, delegations or foreign origins', async () => {
    const body = batch(adapter('jev'))
    expect((await request('POST', '/shapes/import?scope=domain', member, body)).status).toBe(403)
    expect((await request('POST', '/shapes/import?scope=domain', agent, body)).status).toBe(403)
    expect((await request('POST', '/shapes/import?scope=domain', 'delegated', body)).status).toBe(403)
    expect((await request('POST', '/shapes/import?scope=domain', managementToken, body)).status).toBe(403)
    expect((await request('POST', '/shapes/import?scope=domain', null, body, { 'x-test-session': admin, 'Origin': 'https://evil.example' })).status).toBe(403)
    expect((await request('POST', '/shapes/import?scope=domain', null, body)).status).toBe(403)
    // The domain is never a request parameter: an admin of other.test writes only other.test.
    expect((await request('POST', '/shapes/import?scope=domain&domain=example.test', foreignAdmin, body)).json.scope_key).toBe('other.test')
    expect(await shapeStore.listDomainShapes!('example.test')).toEqual([])
    expect((await request('DELETE', '/shapes/jev?scope=domain', foreignAdmin)).status).toBe(200)
    expect(await shapeStore.listDomainShapes!('other.test')).toEqual([])
  })

  it('writes personal shapes only by the direct human owner', async () => {
    expect((await request('POST', '/shapes/import?scope=personal', agent, batch(adapter('jev')))).status).toBe(403)
    expect((await request('POST', '/shapes/import?scope=personal', 'delegated', batch(adapter('jev')))).status).toBe(403)
    expect(await audit()).toEqual([])
  })

  it('rejects a whole batch with one invalid adapter, a desktop name outside instance or a twin program', async () => {
    const invalid = await request('POST', '/shapes/import?scope=domain', admin, batch(adapter('jev'), 'not toml ['))
    expect(invalid.status).toBe(400)
    expect(invalid.json.data.title).toContain('Shape 2')
    const desktop = await request('POST', '/shapes/import?scope=domain', admin, batch(adapter('jev'), adapter('pod-runtime')))
    expect(desktop.status).toBe(409)
    expect((await request('POST', '/shapes/import?scope=personal', member, batch(adapter('pod-ssh')))).status).toBe(409)
    expect((await request('POST', '/shapes/import?scope=domain', admin, batch(adapter('jev'), adapter('jev2', { executable: 'jev' })))).status).toBe(409)
    const facts = await request('POST', '/shapes/import?scope=domain', admin, batch(adapter('jev', { extra: `tested_digests = ["SHA-256:${'a'.repeat(64)}"]` })))
    expect(facts.status).toBe(400)
    expect((await request('POST', '/shapes/import?scope=instance', managementToken, { shapes: [{ toml: adapter('jev') }], extra: true })).status).toBe(400)
    expect(await shapeStore.listDomainShapes!('example.test')).toEqual([])
    expect(await audit()).toEqual([])
  })

  it('never prunes or removes an operation of the Pods desktop', async () => {
    await request('POST', '/shapes/import?scope=instance', managementToken, batch(adapter('pod-runtime'), adapter('git', { operation: 'status' })))
    const pruned = await request('POST', '/shapes/import?scope=instance', managementToken, { ...batch(adapter('git', { operation: 'status' })), prune: true })
    expect(pruned.status).toBe(409)
    expect((await request('DELETE', '/shapes/pod-runtime?scope=instance', managementToken)).status).toBe(409)
    expect((await shapeStore.getShape('pod-runtime'))?.virtual).toBe(true)
  })
})

describe('shape import writes', () => {
  it('previews, applies with audit, repeats without writing and restores an older state', async () => {
    const source = { repo: 'https://git.example/shapes-registry', commit: 'abc1234', dirty: false }
    const preview = await request('POST', '/shapes/import?scope=instance&dry_run=1', managementToken, { ...batch(adapter('jev'), adapter('git', { operation: 'status' })), source })
    expect(preview.json).toMatchObject({ scope: 'instance', scope_key: null, dry_run: true, saved: false, added: ['jev'], rules_changed: ['git'], removed: [] })
    expect(await audit()).toEqual([])

    const applied = await request('POST', '/shapes/import?scope=instance', managementToken, { ...batch(adapter('jev'), adapter('git', { operation: 'status' })), source })
    expect(applied.json).toMatchObject({ saved: true, added: ['jev'], rules_changed: ['git'] })
    expect((await shapeStore.listShapeChanges!('instance', '', 10)).map(change => `${change.action}:${change.cli_id}:${change.actor}:${change.source?.commit}`)).toEqual(['update:git:_management_:abc1234', 'add:jev:_management_:abc1234'])

    const repeat = await request('POST', '/shapes/import?scope=instance', managementToken, { ...batch(adapter('jev'), adapter('git', { operation: 'status' })), source })
    expect(repeat.json).toMatchObject({ saved: false, added: [], rules_changed: [], text_changed: [], unchanged: ['jev', 'git'] })
    expect(await shapeStore.listShapeChanges!('instance', '', 10)).toHaveLength(2)

    // Importing the older directory with prune restores the older state, and the audit keeps the replaced TOML.
    const older = await request('POST', '/shapes/import?scope=instance', managementToken, { shapes: [{ toml: adapter('git', { operation: 'status' }), description: 'Git' }], prune: true })
    expect(older.json).toMatchObject({ removed: ['jev'], text_changed: ['git'] })
    expect((await shapeStore.listShapes()).map(shape => shape.cli_id)).toEqual(['git'])
    const [removal, textChange] = await shapeStore.listShapeChanges!('instance', '', 2)
    expect(removal).toMatchObject({ action: 'remove', cli_id: 'jev', previous_toml: adapter('jev') })
    expect(textChange).toMatchObject({ action: 'update', cli_id: 'git' })
  })

  it('prunes only the writer\'s own tier and names the grants losing reuse and the shapes it overrides', async () => {
    await request('POST', '/shapes/import?scope=domain', foreignAdmin, batch(adapter('jev')))
    await request('POST', '/shapes/import?scope=personal', member, batch(adapter('mine')))
    const first = await request('POST', '/shapes/import?scope=domain', operator, batch(adapter('jev'), adapter('tool')))
    expect(first.json).toMatchObject({ scope_key: 'example.test', added: ['jev', 'tool'], saved: true })
    expect((await shapeStore.listDomainShapes!('example.test')).map(shape => shape.published_by)).toEqual([operator, operator])
    const jevDigest = (await shapeStore.listDomainShapes!('example.test'))[0]!.digest
    await grantStore.save(domainGrant('jev', jevDigest))
    await grantStore.save(domainGrant('git', 'SHA-256:git', {}))

    const preview = await request('POST', '/shapes/import?scope=domain&dry_run=1', admin, { ...batch(adapter('git', { operation: 'status' })), prune: true })
    expect(preview.json).toMatchObject({ added: ['git'], removed: ['jev', 'tool'], grants_losing_reuse: [{ id: `g-jev-${jevDigest}`, requester: agent }] })
    expect(preview.json.overrides).toEqual([{ cli_id: 'git', tier: 'instance', by: 'git', grants: [expect.objectContaining({ id: 'g-git-SHA-256:git' })] }])

    await request('POST', '/shapes/import?scope=domain', admin, { ...batch(adapter('git', { operation: 'status' })), prune: true })
    expect((await shapeStore.listDomainShapes!('example.test')).map(shape => shape.cli_id)).toEqual(['git'])
    expect((await shapeStore.listDomainShapes!('other.test')).map(shape => shape.cli_id)).toEqual(['jev'])
    expect((await shapeStore.listOwnerShapes!(member)).map(shape => shape.cli_id)).toEqual(['mine'])
    expect((await shapeStore.listShapes()).map(shape => shape.cli_id)).toEqual(['git'])
  })

  it('checks and audits concurrent writes against the state each one writes over', async () => {
    // A slow read lets both requests read before either writes, as on a remote database.
    const read = shapeStore.listDomainShapes!.bind(shapeStore)
    shapeStore.listDomainShapes = async (domain) => {
      const shapes = await read(domain)
      await new Promise(resolve => setTimeout(resolve, 20))
      return shapes
    }
    const [first, second] = await Promise.all([
      request('POST', '/shapes/import?scope=domain', admin, batch(adapter('jev'))),
      request('POST', '/shapes/import?scope=domain', operator, batch(adapter('jev2', { executable: 'jev' }))),
    ])
    expect([first.status, second.status].sort()).toEqual([200, 409])
    expect(await shapeStore.listDomainShapes!('example.test')).toHaveLength(1)
    await Promise.all(['one', 'two', 'three'].map(operation => request('PUT', '/shapes/tool?scope=domain', admin, { toml: adapter('tool', { operation }) })))
    const updates = (await shapeStore.listShapeChanges!('domain', 'example.test', 10, 'tool')).reverse()
    expect(updates.map(change => change.previous_digest)).toEqual([null, updates[0]!.digest, updates[1]!.digest])
  })

  it('lists a domain\'s shapes to its members and its history only to its admins', async () => {
    await request('POST', '/shapes/import?scope=domain', admin, batch(adapter('jev')))
    const digest = (await shapeStore.listDomainShapes!('example.test'))[0]!.digest
    await grantStore.save(domainGrant('jev', digest))
    await grantStore.save({ ...domainGrant('jev', digest), id: 'g-colleague', request: { ...domainGrant('jev', digest).request, requester: 'colleague@example.test' } })
    const asMember = await request('GET', '/shapes?scope=domain', member)
    expect(asMember.json).toMatchObject([{ cli_id: 'jev', published_by: admin }])
    // A member sees only their own agents' grants; an admin the domain's.
    expect(asMember.json[0].bound_grants.map((grant: { id: string }) => grant.id)).toEqual([`g-jev-${digest}`])
    expect((await request('GET', '/shapes?scope=domain', admin)).json[0].bound_grants).toHaveLength(2)
    expect((await request('GET', '/shapes?scope=domain', foreignAdmin)).json).toEqual([])
    expect((await request('GET', '/shapes/changes?scope=domain', member)).status).toBe(403)
    expect((await request('GET', '/shapes/changes?scope=domain', admin)).json).toMatchObject([{ action: 'add', cli_id: 'jev', actor: admin }])
    expect((await request('GET', '/shapes/changes?scope=domain', foreignAdmin)).json).toEqual([])
    expect((await request('GET', '/shapes/changes?scope=instance', member)).status).toBe(200)
    expect((await request('GET', '/shapes/changes?scope=instance', null)).status).toBe(401)
  })
})
